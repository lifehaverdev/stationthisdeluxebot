# Gatekeeping System Analysis

## Flow Summary

When a user interacts with the bot, the gatekeeping system:

1. **Initial Contact Detection**
   - User sends a message or callback query that triggers `checkIn()` or `callbackCheckIn()`
   - System checks if the user exists in the in-memory `lobby` object

2. **User Data Retrieval & Validation**
   - If user is not in lobby, `handleUserData()` fetches data from MongoDB
   - For existing users: retrieves data via `fetchUserCore()` and `fetchFullUserData()`
   - For new users: creates data via `initializeNewUser()`
   - Validates structure of user data against template with `validateUserData()`

3. **Wallet & Balance Verification**
   - For users with connected ETH wallets, fetches asset balances via `getUserAssets()`
   - Adds burn bonus if user has burn records
   - Updates user's balance and worth in the lobby

4. **Session Management**
   - Updates `lastTouch` timestamp to track user activity
   - Manages point regeneration for returning users via `regenerateDoints()`
   - Sets user state to `IDLE` via `setUserState()`

5. **Access Control Logic**
   - `checkLobby()` performs comprehensive checks for message actions:
     - Group-specific gatekeeping via `handleGroupCheck()`
     - Points/balance verification via `checkUserPoints()`
     - Blacklist checking via `checkBlacklist()`

6. **Resource Management**
   - Cleans inactive users via scheduled `cleanLobby()` (runs on interval)
   - Manages point regeneration with `softResetPoints()` and user expulsion with `kick()`
   - Tracks analytics events throughout the process

## Dependencies and Actions

| File/Module Used | Purpose | Coupling | Notes |
|------------------|---------|----------|-------|
| ./bot.js | Provides global state objects (lobby, ledger, etc.) | High | Central dependency with shared mutable state |
| ../../db/index.js | Database model classes | Medium | Abstracted database access |
| ../../db/operations/userFetch.js | User data retrieval functions | Medium | Database operations with specific format |
| ../../db/operations/newUser.js | User creation functions | Medium | Creates standardized user records |
| ../../db/operations/batchPoints.js | Adds points to all users | Medium | Bulk database operations |
| ../../db/operations/repairUsers.js | Fixes corrupted user data | Medium | Maintenance operations |
| ../users/checkBalance.js | Wallet verification functions | High | Direct blockchain interaction |
| ../utils.js | Utility functions (setUserState, sendMessage, react) | High | Telegram-specific interactions |
| ./intitialize.js | Data refresh functions | High | Global state initialization |
| ../users/defaultUserData.js | User data templates | Low | Static configuration |
| ../../db/models/analyticsEvents.js | Event tracking | Medium | Analytics dependency |
| ./handlers/iWallet.js | Asset retrieval functions | High | Wallet-specific logic |
| ./handlers/iGroup.js | Group information functions | High | Telegram group functionality |

## Core Logic Components

1. **User Session Management**
   - `LobbyManager` class for tracking active users
   - Periodic cleanup via `cleanLobby()` function
   - Session expiration based on inactivity (`shouldKick()`)

2. **User Data Lifecycle**
   - Initial creation → validation → storage → in-memory caching
   - Point generation and consumption tracking
   - Wallet verification and balance updates

3. **Access Control System**
   - Multi-tier gatekeeping (user status, group requirements, points)
   - Token/NFT-based access restrictions
   - Admin/membership verification

4. **Resource Management**
   - Points regeneration based on user balance
   - Session timeout and cleanup
   - Batch operations for performance

## Refactor Plan

### 1. Service Extraction

#### Create Core User Service
```javascript
// src/core/users/UserService.js
class UserService {
  constructor(db, eventBus) {
    this.db = db;
    this.eventBus = eventBus;
    this.activeUsers = new Map();
  }

  async handleUserTouch(userId, context) {
    // Platform-agnostic user handling
    const user = await this.getOrCreateUser(userId);
    user.lastActivity = Date.now();
    
    // Emit events instead of direct coupling
    this.eventBus.emit('user:active', { user, context });
    
    return user;
  }
  
  // Additional methods for user lifecycle management
}
```

#### Create Separate Gatekeeping Service
```javascript
// src/core/gatekeeping/GatekeeperService.js
class GatekeeperService {
  constructor(userService, walletService, configService) {
    this.userService = userService;
    this.walletService = walletService;
    this.configService = configService;
  }

  async verifyAccess(userId, context) {
    const user = await this.userService.getUser(userId);
    
    // Chain of responsibility pattern for checks
    const checks = [
      this.checkUserStatus,
      this.checkResourceLimits,
      this.checkGroupAccess,
      // etc.
    ];
    
    for (const check of checks) {
      const { allowed, reason } = await check(user, context);
      if (!allowed) return { allowed, reason };
    }
    
    return { allowed: true };
  }
}
```

### 2. State Management Refactor

1. **Replace Global State**
   - Move `lobby` to a proper session store in `UserSessionService`
   - Replace direct object references with methods: `sessions.get(userId)` vs `lobby[userId]`
   - Use immutable patterns for user data updates

2. **Event-Based Communication**
   - Create an event bus for cross-service communication
   - Replace direct state mutations with events
   ```javascript
   // Before
   lobby[userId].points += 100;
   
   // After
   eventBus.emit('user:points:add', { userId, amount: 100 });
   ```

3. **Dependency Injection**
   - Use a proper DI system to inject services rather than requiring modules
   - Create factory functions for component initialization
   ```javascript
   const createGatekeeper = ({ userService, walletService }) => 
     new GatekeeperService(userService, walletService);
   ```

### 3. Telegram Decoupling

1. **Create Adapter Layer**
   - Move all Telegram-specific code to `src/integrations/telegram/`
   - Create adapters that translate Telegram messages to internal events
   ```javascript
   // src/integrations/telegram/MessageAdapter.js
   function adaptMessage(telegramMessage) {
     return {
       userId: telegramMessage.from.id,
       content: telegramMessage.text,
       timestamp: Date.now(),
       platform: 'telegram',
       raw: telegramMessage
     };
   }
   ```

2. **Abstract Response Mechanisms**
   - Replace direct calls to `sendMessage` and `react` with platform-agnostic responses
   ```javascript
   // Before
   sendMessage(message, "You don't have enough points");
   
   // After
   responseService.sendText(userId, "You don't have enough points", { 
     platform: 'telegram',
     contextId: message.chat.id
   });
   ```

### 4. Migration Path

1. **Phase 1: Create Core Services**
   - Extract core functionality without changing behavior
   - Begin with user session management as the central service
   - Document all cross-dependencies

2. **Phase 2: Introduce Event System**
   - Implement event bus for communication
   - Gradually replace direct state mutations with events
   - Add proper logging and monitoring

3. **Phase 3: Platform Adapters**
   - Create Telegram adapter
   - Move platform-specific code to adapter layer
   - Test with multiple interfaces (Telegram + API)

4. **Phase 4: Clean Integration API**
   - Finalize the public API for core services
   - Document integration patterns
   - Implement comprehensive testing

### 5. New Directory Structure

```
src/
├── core/
│   ├── users/
│   │   ├── UserService.js        # User lifecycle management
│   │   ├── UserSessionStore.js   # Active user tracking
│   │   ├── UserValidator.js      # User data validation
│   │   └── types.js              # User data types/interfaces
│   │
│   ├── gatekeeping/
│   │   ├── GatekeeperService.js  # Access control logic
│   │   ├── AccessPolicy.js       # Policy definitions
│   │   ├── GroupPolicy.js        # Group-specific policies
│   │   └── ResourceLimits.js     # Points/resources management
│   │
│   └── events/
│       ├── EventBus.js           # Central event system
│       └── UserEvents.js         # User-specific events
│
├── integrations/
│   ├── telegram/
│   │   ├── TelegramAdapter.js    # Main Telegram integration
│   │   ├── MessageHandler.js     # Telegram-specific message processing
│   │   └── CommandHandler.js     # Telegram command handling
│   │
│   └── api/
│       └── ApiAdapter.js         # HTTP API integration
│
└── services/
    ├── wallet/
    │   ├── WalletService.js      # Wallet operations
    │   └── BalanceService.js     # Balance tracking
    │
    └── analytics/
        └── AnalyticsService.js   # Event tracking
``` 