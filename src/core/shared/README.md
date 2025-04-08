# Core Shared Components

This directory contains shared utilities and infrastructure components that are used across multiple parts of the core application.

## Contents

- **[events.js](./events.js)** - Event bus and event handling utilities
- **[repository.js](./repository.js)** - Base repository interfaces and implementations
- **[state.js](./state.js)** - Immutable state management utilities
- **[mongo](./mongo/)** - MongoDB repository implementations and utilities

## StateContainer

The `StateContainer` provides a general-purpose immutable state container with version tracking, event emission, and history support. It's designed to be a foundation for state management throughout the application, replacing direct state mutation with a controlled, immutable approach.

### Features

- **Immutable State** - All state is frozen to prevent unintended mutations
- **Version Tracking** - Each state change increments a version number
- **Change Events** - Emits events when state changes
- **History Support** - Optional tracking of previous state versions
- **Selectors** - Efficient computation of derived state with memoization
- **Deep Freezing** - Ensures nested objects are also immutable

### Basic Usage

```javascript
const { createStateContainer } = require('./state');

// Create a container with initial state
const container = createStateContainer({
  initialState: {
    user: { id: 1, name: 'Alice' },
    settings: { theme: 'dark' }
  }
});

// Get the current state (returns frozen object)
const state = container.getState();

// Update the state (creates a new frozen state)
container.setState({ 
  settings: { theme: 'light' } 
});

// Use functional updaters for state that depends on previous state
container.setState(state => ({
  counter: (state.counter || 0) + 1
}));

// Get specific values
const theme = container.get('settings').theme;

// Set specific values
container.set('user', { id: 2, name: 'Bob' });

// Listen for changes
container.on('stateChanged', (event) => {
  console.log('State changed:', event.changes);
});

// Listen for specific property changes
container.on('userChanged', (event) => {
  console.log('User changed from', event.oldValue, 'to', event.newValue);
});

// Create a selector for derived data
const getActiveUsers = container.createSelector(
  state => state.users?.filter(u => u.active) || []
);

// Use the selector (result is memoized until state changes)
const activeUsers = getActiveUsers();
```

### Configuration Options

When creating a state container, you can provide these options:

```javascript
const container = createStateContainer({
  // Initial state object
  initialState: { /* ... */ },
  
  // Maximum number of previous states to keep (0 disables history)
  maxHistoryLength: 10,
  
  // Whether to emit events when state changes
  emitEvents: true,
  
  // Whether to deep freeze nested objects
  deepFreeze: true
});
```

### Key Methods

- **`getState()`** - Returns the current state (immutable)
- **`setState(updates, source)`** - Updates the state with new values
- **`get(key, defaultValue)`** - Gets a specific property from the state
- **`set(key, value, source)`** - Updates a specific property in the state
- **`setMultiple(keyValuePairs, source)`** - Updates multiple properties at once
- **`remove(key, source)`** - Removes a property from the state
- **`getVersion()`** - Gets the current state version number
- **`getHistory()`** - Gets the state history (if enabled)
- **`resetState(initialState, source)`** - Resets the state to a new initial state
- **`createSelector(selectorFn)`** - Creates a memoized selector function
- **`subscribe(eventName, listener)`** - Subscribes to state change events

### Event Types

- **`stateChanged`** - Emitted when any part of the state changes
- **`stateReset`** - Emitted when the state is reset
- **`${propertyName}Changed`** - Emitted when a specific property changes

### Best Practices

1. **Never mutate state directly** - Always use the provided methods to update state
2. **Use selectors for derived data** - This ensures efficient calculation
3. **Keep state normalized** - Avoid deeply nested state structures
4. **Use functional updaters** for changes that depend on the previous state
5. **Listen for state changes** rather than polling the state

### Integration with SessionAdapter

The `StateContainer` can be used with `SessionAdapter` to provide an immutable state layer on top of session state:

```javascript
const { createSessionAdapter } = require('../../session/adapter');
const { createStateContainer } = require('../state');

// Create session adapter
const sessionAdapter = createSessionAdapter({ /* ... */ });

// Create state container with session state
const sessionState = await sessionAdapter.getUserSessionData(userId);
const container = createStateContainer({
  initialState: sessionState || {}
});

// When state changes, update session
container.on('stateChanged', async ({ newState }) => {
  await sessionAdapter.updateUserSession(userId, newState);
});
```

## Repository Interface

The `repository.js` file defines the core Repository interface used throughout the application. This interface is implemented by various repository classes to provide data access abstraction.

## Event Utilities

The `events.js` file provides an event bus implementation and utilities for event-based communication between components. This allows for loose coupling between different parts of the application. 