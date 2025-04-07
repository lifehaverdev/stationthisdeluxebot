# Points System Lifecycle Analysis

## 1. Lifecycle Flow

### Point Types and Origins

The application has multiple types of points that form a complex economy:

- **Points**: Base currency earned through user activities
- **Doints**: Generated points that decay over time, used for immediate activities
- **Boints**: Bonus points awarded in special circumstances
- **Qoints**: Premium currency used for API access and group operations
- **Exp**: Experience points accumulated over time that don't decay

### Creation and Initialization

1. **New User Initialization**
   - When a user is first created in `gatekeep.js` via `initializeNewUser()`
   - Default point values set in `defaultUserData.js`
   - Initial values typically start at zero except for free starter allocations

2. **Points Earning**
   - Points are added after successful image generation in `queue.js` via `addPoints()`
   - Points may be awarded for other activities (not fully visible in the provided files)
   - Balance-based calculations determine maximum point limits via `calculateMaxPoints()`

3. **Temporary Point Allocation**
   - When a task is enqueued in `queue.js`, temporary doints are added:
     ```javascript
     const dointsToAdd = task.promptObj.type === 'MS3.3' ? 1000 : 100;
     lobby[userId].doints = (lobby[userId].doints || 0) + dointsToAdd;
     task.promptObj.dointsAdded = dointsToAdd;
     ```
   - These temporary doints are removed if the task fails

### Spending and Deduction

1. **Generation Costs**
   - Points are implicitly spent through the accumulation mechanism
   - When users reach their point limit in `checkUserPoints()`, they're prevented from generating images
   - The limit is calculated based on wallet balance: `(balance + NOCOINERSTARTER) / POINTMULTI`

2. **API Usage**
   - Qoints are checked before API access in `api/index.js`:
     ```javascript
     if (!userEconomy || !userEconomy.qoints || userEconomy.qoints < 50) {
         throw new Error('Insufficient qoints');
     }
     ```
   - Low qoint warnings are sent at thresholds (e.g., below 1000)

3. **Failed Generations**
   - Temporary doints are removed if a generation fails in `queue.js`:
     ```javascript
     function removeDoints(task) {
         const userId = task.promptObj.userId;
         if (lobby[userId]) {
             lobby[userId].doints -= (task.promptObj.dointsAdded || 0);
         }
     }
     ```

### Regeneration and Decay

1. **Periodic Point Processing**
   - Runs on a scheduled interval via `cleanLobby()` in `gatekeep.js`
   - Configured by `LOBBY_CLEAN_INTERVAL` (typically 15 minutes)

2. **Point Conversion**
   - Points, doints, and boints are processed together in `addPointsToAllUsers()`:
     ```javascript
     const totalPoints = oldPoints + oldBoints;
     const newDoints = Math.max(0, oldDoints + oldPoints);
     const newExp = Math.max(0, oldExp + totalPoints);
     ```
   - Points are reset to zero, added to doints, and contribute to exp

3. **Regeneration Logic**
   - For returning users, points are regenerated via `regenerateDoints()`:
     ```javascript
     const timeSinceLastRun = Date.now() - userData.kickedAt;
     const maxPoints = calculateMaxPoints(userData.balance);
     const regenerationCycles = Math.floor(timeSinceLastRun / (LOBBY_CLEAN_INTERVAL));
     const regeneratedPoints = (maxPoints / 18) * regenerationCycles;
     userData.doints = Math.max(oldDoints - regeneratedPoints, 0);
     ```
   - The rate is based on wallet balance and time away

4. **Soft Reset**
   - `softResetPoints()` reduces doints periodically for active users:
     ```javascript
     const maxPoints = calculateMaxPoints(userData.balance);
     const regeneratedPoints = (maxPoints / 18);
     userData.doints = Math.max(userData.doints - regeneratedPoints, 0);
     ```

## 2. Points Interaction Map

| File | Role in Points Flow | Related Functions | Notes |
|------|---------------------|-------------------|-------|
| `utils/bot/gatekeep.js` | User session and point regeneration | `calculateMaxPoints()`, `regenerateDoints()`, `softResetPoints()`, `addExp()`, `checkUserPoints()` | Core point lifecycle management including regeneration, limits, and user checks |
| `utils/bot/queue.js` | Task queuing and point allocation | `enqueueTask()`, `removeDoints()`, `addPoints()`, `deliver()` | Handles temporary point allocation and removal based on generation status |
| `db/operations/batchPoints.js` | Batch point processing | `addPointsToAllUsers()` | Processes accumulated points across all users |
| `utils/bot/points.js` (implied) | Core point accounting | `addPoints()` (referenced in queue.js) | Central point accounting logic (not visible in provided files) |
| `api/index.js` | API-specific point checks | `authenticateApiUser()` | Validates qoint balances for API access |
| `utils/bot/bot.js` | Global state storage | N/A | Contains shared `lobby` object where point state is stored |

## 3. Key Point Calculations

1. **Maximum Points Calculation**
   ```javascript
   function calculateMaxPoints(balance) {
       return Math.floor((balance + NOCOINERSTARTER) / POINTMULTI);
   }
   ```
   - `NOCOINERSTARTER` = 199800 (base allowance)
   - `POINTMULTI` = 540 (divider for balance-to-points ratio)

2. **Regeneration Rate**
   ```javascript
   const regeneratedPoints = (maxPoints / 18) * regenerationCycles;
   ```
   - Points regenerate at 1/18 of max points per cycle
   - Cycles occur every 15 minutes (`LOBBY_CLEAN_MINUTE`)

3. **API Cost Threshold**
   ```javascript
   if (!userEconomy || !userEconomy.qoints || userEconomy.qoints < 50) {
       throw new Error('Insufficient qoints');
   }
   ```
   - Minimum 50 qoints required for API access

## 4. Refactor Plan

### Core Architecture

```
src/
├── core/
│   ├── points/
│   │   ├── PointsService.js         # Core points management logic
│   │   ├── PointTypes.js            # Definitions of different point types
│   │   ├── CalculationService.js    # Point calculation formulas
│   │   ├── RegenerationService.js   # Point regeneration logic
│   │   └── LimitService.js          # Enforcement of point limits
│   │
│   ├── users/
│   │   └── UserPointsAdapter.js     # Bridge between users and points
│   │
│   └── tasks/
│       └── TaskPointsService.js     # Task-related point operations
│
├── integrations/
│   ├── telegram/
│   │   └── points/
│   │       ├── CommandHandlers.js   # Telegram-specific point commands
│   │       └── NotificationService.js # Point-related notifications
│   │
│   └── api/
│       └── points/
│           ├── PointsRoutes.js      # API endpoints for points
│           └── UsageTracking.js     # API-specific usage tracking
│
└── infrastructure/
    ├── persistence/
    │   └── PointsRepository.js      # Data access for points
    │
    └── scheduler/
        └── PointsJobs.js           # Scheduled point operations
```

### Implementation Plan

#### 1. Create Core PointsService

```javascript
// src/core/points/PointsService.js
class PointsService {
  constructor(
    pointsRepository,
    calculationService,
    regenerationService,
    eventBus
  ) {
    this.pointsRepository = pointsRepository;
    this.calculationService = calculationService;
    this.regenerationService = regenerationService;
    this.eventBus = eventBus;
  }

  // Add points of specific type to user
  async addPoints(userId, amount, type = 'points') {
    const userPoints = await this.pointsRepository.getUserPoints(userId);
    const updated = { ...userPoints };
    
    updated[type] = (updated[type] || 0) + amount;
    
    await this.pointsRepository.saveUserPoints(userId, updated);
    this.eventBus.emit('points:added', { userId, amount, type, total: updated[type] });
    
    return updated;
  }

  // Check if user has sufficient points
  async hasSufficientPoints(userId, amount, type = 'points') {
    const userPoints = await this.pointsRepository.getUserPoints(userId);
    return (userPoints[type] || 0) >= amount;
  }

  // Process periodic point updates
  async processPointsUpdate(userId) {
    const userPoints = await this.pointsRepository.getUserPoints(userId);
    const userBalance = await this.pointsRepository.getUserBalance(userId);
    
    const maxPoints = this.calculationService.calculateMaxPoints(userBalance);
    const result = this.regenerationService.applyPeriodicUpdate(userPoints, maxPoints);
    
    await this.pointsRepository.saveUserPoints(userId, result);
    this.eventBus.emit('points:updated', { userId, result });
    
    return result;
  }
}
```

#### 2. Create CalculationService 

```javascript
// src/core/points/CalculationService.js
class PointsCalculationService {
  constructor(config) {
    this.config = config; // Inject configuration
  }
  
  // Calculate max points based on balance
  calculateMaxPoints(balance) {
    return Math.floor(
      (balance + this.config.NOCOINERSTARTER) / this.config.POINTMULTI
    );
  }
  
  // Check if user has reached their point limit
  hasReachedLimit(points, doints, balance) {
    const totalPoints = points + doints;
    return totalPoints * this.config.POINTMULTI > (balance + this.config.NOCOINERSTARTER);
  }
  
  // Calculate regeneration amount
  calculateRegenerationAmount(maxPoints, elapsedCycles) {
    return (maxPoints / this.config.REGEN_DIVISOR) * elapsedCycles;
  }
}
```

#### 3. Create RegenerationService

```javascript
// src/core/points/RegenerationService.js
class PointsRegenerationService {
  constructor(calculationService, config) {
    this.calculationService = calculationService;
    this.config = config;
  }
  
  // Calculate regeneration for returning users
  calculateReturningUserRegeneration(userData, currentTime) {
    if (!userData.kickedAt) return userData;
    
    const timeSinceLastRun = currentTime - userData.kickedAt;
    const maxPoints = this.calculationService.calculateMaxPoints(userData.balance);
    const regenerationCycles = Math.floor(
      timeSinceLastRun / this.config.CLEAN_INTERVAL
    );
    
    const regeneratedPoints = this.calculationService.calculateRegenerationAmount(
      maxPoints, 
      regenerationCycles
    );
    
    return {
      ...userData,
      doints: Math.max(userData.doints - regeneratedPoints, 0),
      kickedAt: undefined // Remove kickedAt flag
    };
  }
  
  // Apply periodic point update (called by scheduler)
  applyPeriodicUpdate(pointsData, maxPoints) {
    // Convert points to doints and exp
    const totalPoints = pointsData.points + pointsData.boints;
    const regeneratedPoints = this.calculationService.calculateRegenerationAmount(maxPoints, 1);
    
    return {
      ...pointsData,
      points: 0,
      boints: 0,
      doints: Math.max(pointsData.doints - regeneratedPoints, 0),
      exp: pointsData.exp + totalPoints
    };
  }
}
```

#### 4. Task Point Integration

```javascript
// src/core/tasks/TaskPointsService.js
class TaskPointsService {
  constructor(pointsService, config) {
    this.pointsService = pointsService;
    this.config = config;
  }
  
  // Allocate temporary points for task
  async allocateTaskPoints(userId, taskType) {
    const pointsToAdd = taskType === 'MS3.3' ? 
      this.config.PREMIUM_TASK_POINTS : 
      this.config.STANDARD_TASK_POINTS;
      
    await this.pointsService.addPoints(userId, pointsToAdd, 'doints');
    
    return pointsToAdd;
  }
  
  // Remove temporary points if task fails
  async removeTaskPoints(userId, amount) {
    return this.pointsService.addPoints(userId, -amount, 'doints');
  }
  
  // Award points for completed task
  async awardTaskCompletion(userId, taskDetails) {
    // Calculate reward based on task complexity
    const rewardPoints = this.calculateTaskReward(taskDetails);
    
    // Add to different point types
    await this.pointsService.addPoints(userId, rewardPoints, 'points');
    
    return rewardPoints;
  }
  
  // Helper to calculate appropriate reward
  calculateTaskReward(taskDetails) {
    // Implementation of reward calculation logic
    return 100; // Placeholder
  }
}
```

#### 5. API Integration

```javascript
// src/integrations/api/points/UsageTracking.js
class ApiPointsService {
  constructor(pointsService, config) {
    this.pointsService = pointsService;
    this.config = config;
  }
  
  // Verify user has sufficient qoints for API call
  async verifyApiAccess(userId) {
    const hasQoints = await this.pointsService.hasSufficientPoints(
      userId, 
      this.config.MIN_API_QOINTS,
      'qoints'
    );
    
    if (!hasQoints) {
      throw new Error('Insufficient qoints for API access');
    }
    
    const userPoints = await this.pointsService.getUserPoints(userId);
    
    // Optional warning for low balance
    if (userPoints.qoints < this.config.LOW_QOINTS_WARNING) {
      await this.sendLowQointsWarning(userId, userPoints.qoints);
    }
    
    return true;
  }
  
  // Deduct points for API usage
  async deductApiUsage(userId, operationType) {
    const costMap = {
      'generation': this.config.GENERATION_COST,
      'high-resolution': this.config.HIGH_RES_COST,
      // other operation types
    };
    
    const cost = costMap[operationType] || this.config.DEFAULT_API_COST;
    return this.pointsService.addPoints(userId, -cost, 'qoints');
  }
}
```

### Migration Strategy

1. **Phase 1: Extract Models and Interfaces**
   - Define clear interfaces for point operations
   - Create data models for different point types
   - Document calculation formulas and business rules

2. **Phase 2: Implement Core Services**
   - Build centralized point services with proper separation of concerns
   - Create in-memory adapter that mimics current behavior
   - Develop comprehensive test suite for point operations

3. **Phase 3: Integration Points**
   - Create adapter layer for Telegram integration
   - Implement API routes for point management
   - Build admin interface for point adjustments

4. **Phase 4: Storage Transition**
   - Move from in-memory state to proper persistence
   - Implement point history tracking
   - Add audit logging for all point operations

5. **Phase 5: Feature Enhancement**
   - Implement point expiration for premium features
   - Add point transaction rollback capability
   - Create advanced analytics for point economy

### Decoupling Strategy

1. **Replace Direct State Mutations**
   ```javascript
   // Before
   lobby[userId].doints += 100;
   
   // After
   await pointsService.addPoints(userId, 100, 'doints');
   ```

2. **Move Calculations to Service**
   ```javascript
   // Before
   const maxPoints = calculateMaxPoints(userData.balance);
   
   // After
   const maxPoints = calculationService.calculateMaxPoints(userData.balance);
   ```

3. **Use Events for Cross-Boundary Communication**
   ```javascript
   // Emit events for point changes
   this.eventBus.emit('points:added', { userId, amount, type, total });
   
   // Subscribe to events in appropriate services
   eventBus.on('points:added', async (data) => {
     if (data.type === 'qoints' && data.total < LOW_THRESHOLD) {
       await notificationService.sendLowQointsWarning(data.userId, data.total);
     }
   });
   ``` 