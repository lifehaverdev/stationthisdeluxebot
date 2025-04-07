# Points Core Module

This module provides the core points domain model and services for the application. It manages all point types, calculations, regeneration, and transaction operations, following a clean architecture approach with separation of concerns.

## Components

### Models

- **`UserPoints`**: Contains all point balances for a user (points, doints, qoints, boints, exp)
- **`PointType`**: Enum of point types (POINTS, DOINTS, QOINTS, BOINTS, EXP)
- **`PointConstants`**: Constants and default values used in point calculations
- **`PointOperation`**: Represents a point transaction (add/deduct)

### Services

- **`PointsService`**: Business logic for point operations such as:
  - Adding and deducting points
  - Checking point balances and limits
  - Regenerating points
  - Processing point conversions
  - Batch point operations

- **`PointsCalculationService`**: Formulas and calculations for points:
  - Maximum point limits based on token balance
  - Regeneration rates and timings
  - Points-to-tokens conversions
  - Generation costs

### Repository

- **`PointsRepository`**: Data access for point entities
  - Implements the generic Repository interface
  - Maintains backward compatibility with legacy database
  - Provides both individual and batch operations

## Usage Examples

### Getting User Points

```javascript
const { service } = require('./src/core/points');

// Get user points
const userPoints = await service.getUserPoints('123456789');

if (userPoints) {
  console.log(`Points: ${userPoints.points}`);
  console.log(`Doints: ${userPoints.doints}`);
  console.log(`Total spendable: ${userPoints.getTotalPoints()}`);
}
```

### Adding Points

```javascript
const { service, PointType } = require('./src/core/points');

// Add points
await service.addPoints('123456789', 100, PointType.POINTS, 'generation-reward');

// Add doints
await service.addPoints('123456789', 50, PointType.DOINTS, 'system-bonus');

// Add experience
await service.addPoints('123456789', 200, PointType.EXP, 'level-up');
```

### Checking Point Limits

```javascript
const { service } = require('./src/core/points');

// Check if user has reached point limit
const hasReachedLimit = await service.hasReachedPointLimit('123456789');

if (hasReachedLimit) {
  console.log('User has reached their point limit');
  
  // Get time until next regeneration
  const timeUntilRegen = await service.getTimeUntilNextRegen('123456789');
  console.log(`Points will regenerate in ${Math.ceil(timeUntilRegen / 60000)} minutes`);
}
```

### Regenerating Points

```javascript
const { service } = require('./src/core/points');

// Regenerate points for a user
const updatedPoints = await service.regeneratePoints('123456789');
console.log(`Doints after regeneration: ${updatedPoints.doints}`);
```

### Processing Points Conversion

```javascript
const { service } = require('./src/core/points');

// Process points conversion for a user (points to doints)
await service.processPointsConversion('123456789');

// Process points for all users in batch
const usersList = [/* list of user objects with point data */];
const processedCount = await service.batchProcessPointsConversion(usersList);
console.log(`Processed ${processedCount} users`);
```

## Events

The points module emits the following events through the event bus:

- **`points:added`**: When points are added to a user
- **`points:deducted`**: When points are deducted from a user
- **`points:updated`**: When a user's points are updated
- **`points:regenerated`**: When points are regenerated
- **`points:converted`**: When points are converted (e.g., points to doints)
- **`points:batch-converted`**: When points are converted for multiple users

You can subscribe to these events:

```javascript
const eventBus = require('./src/core/shared/events');

eventBus.subscribe('points:added', (data) => {
  console.log(`${data.amount} ${data.pointType} added to user ${data.userId}`);
});
```

## Migration Notes

This module is designed to work with both the new architecture and the legacy database structure. The `PointsRepository` acts as an adapter between the domain models and the existing database, allowing for a gradual migration without disrupting the existing functionality.

During the migration phase, this module will:

1. Interface with the legacy database using the existing DB models
2. Transform data between the new domain models and legacy structures
3. Maintain backward compatibility for all point operations
4. Emit events for other modules to react to point changes 