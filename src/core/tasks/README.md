# Tasks Module

This module handles task management and processing for StationThis bot, with a particular focus on integrating with the points system.

## Components

### TaskPointsService

The `TaskPointsService` integrates the task system with the points system, providing:

- Automatic point allocation when tasks are created
- Task completion rewards based on processing time
- Management of temporary point allocations (doints)
- Point refunds for failed or cancelled tasks

## Usage

### Basic Integration

```javascript
// Import required modules
const { createPointsSystem } = require('../points');
const { createTaskServices } = require('../tasks');

// Create points system
const pointsSystem = createPointsSystem({
  // Configuration options
});

// Create task services
const taskServices = createTaskServices({
  pointsService: pointsSystem.service,
  // Additional options
});

// Get task points service
const { taskPointsService } = taskServices;

// Use task points service
async function handleTaskCreation(userId, taskDetails) {
  // Check if user has sufficient points
  const checkResult = await taskPointsService.checkSufficientPoints(userId, taskDetails);
  
  if (!checkResult.hasSufficient) {
    return { success: false, reason: 'insufficient_points' };
  }
  
  // Allocate points for the task
  const allocation = await taskPointsService.allocateTaskPoints(userId, taskDetails);
  
  // Create actual task with allocated points info
  const task = {
    ...taskDetails,
    userId,
    dointsAllocated: allocation.dointsAllocated
  };
  
  // Return task for processing
  return { success: true, task };
}
```

### Event-Based Integration

The `TaskPointsService` subscribes to task lifecycle events and automatically handles point operations:

- `task:enqueued` - Allocates points when a task is enqueued
- `task:completed` - Processes task completion and rewards points
- `task:failed` - Refunds allocated points when a task fails
- `task:cancelled` - Refunds allocated points when a task is cancelled

To use this functionality, simply emit these events when appropriate:

```javascript
// When a task is enqueued
eventBus.publish('task:enqueued', { task });

// When a task is completed
eventBus.publish('task:completed', { task });

// When a task fails
eventBus.publish('task:failed', { task });

// When a task is cancelled
eventBus.publish('task:cancelled', { task });
```

## Point Lifecycle During Task Processing

1. **Task Creation**
   - User initiates a task
   - System checks if user has sufficient points
   - System allocates temporary points (doints) for the task

2. **Task Processing**
   - Task is processed by the generation system
   - Points remain allocated during processing

3. **Task Completion**
   - Temporary points (doints) are removed
   - Reward points are added based on task duration and type
   - Points are saved to the user's account

4. **Task Failure or Cancellation**
   - Temporary points (doints) are refunded
   - No reward points are added
   - User's account is restored to previous state

## Group Task Handling

The TaskPointsService also supports special handling for tasks executed in a group context, with these differences:

- Points can be charged to the group account rather than the user
- Different calculation rates may apply based on group settings
- Group-specific point limits and thresholds may be enforced 