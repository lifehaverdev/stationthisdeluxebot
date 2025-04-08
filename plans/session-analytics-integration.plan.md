# Analytics System Session Integration Plan

## Overview

The analytics system currently accesses `lobby[userId]` directly to record user session data for events. This makes it a good candidate for our first real-world integration of SessionAdapter because:

1. It's primarily a **read-only** use case (low risk of unexpected side effects)
2. It's a non-critical subsystem (errors won't break core functionality)
3. It's relatively isolated (not deeply intertwined with other systems)
4. The code path is executed frequently (high test coverage during normal operation)

## Current Usage of lobby[userId]

In `src/db/models/analyticsEvents.js`, the analytics system directly references `lobby[userId]` in four primary locations:

1. **User Join Tracking** (`trackUserJoin` method):
```javascript
data: {
    eventType: isFirstTime ? 'first_join' : 'check_in',
    kickedAt: lobby[userId]?.kickedAt,
    verified: lobby[userId]?.verified || false
}
```

2. **User Kick Tracking** (`trackUserKick` method):
```javascript
data: {
    eventType: 'kicked',
    reason,
    lastTouch: lobby[userId]?.lastTouch,
    timeSinceLastTouch: Date.now() - (lobby[userId]?.lastTouch || 0)
}
```

3. **Verification Tracking** (`trackVerification` method):
```javascript
data: {
    success,
    wallet: lobby[userId]?.wallet,
    ...details
}
```

4. **File Imports**: The file also directly imports the lobby object:
```javascript
const { lobby, waiting, taskQueue } = require('../../bot/core/core');
```

## Proposed Changes

### 1. Create Analytics Service

Create a new service to encapsulate analytics functionality with SessionAdapter:

```javascript
// src/core/analytics/AnalyticsService.js
class AnalyticsService {
  constructor(sessionAdapter, analyticsDB) {
    this.sessionAdapter = sessionAdapter;
    this.analyticsDB = analyticsDB;
  }
  
  // Methods that wrap the original analytics methods
  async trackUserJoin(userId, username, isFirstTime = false) {
    // Get session data from adapter
    const sessionData = await this.sessionAdapter.getSessionProperty(userId, null, {});
    
    const event = {
      type: 'user_state',
      userId,
      username,
      timestamp: new Date(),
      data: {
        eventType: isFirstTime ? 'first_join' : 'check_in',
        kickedAt: sessionData.kickedAt,
        verified: sessionData.verified || false
      },
      groupId: null
    };
    
    return this.analyticsDB.updateOne(
      { userId, type: 'user_state', timestamp: event.timestamp },
      event,
      { upsert: true }
    );
  }
  
  // Other wrapper methods...
}
```

### 2. Add Analytics-Specific Methods to SessionAdapter

```javascript
// Add to SessionAdapter in src/core/session/adapter.js
async getUserAnalyticsData(userId) {
  const session = await this.getSession(userId, false);
  if (!session) return {};
  
  const now = Date.now();
  
  return {
    kickedAt: session.kickedAt,
    verified: session.verified || false,
    lastTouch: session.lastTouch,
    timeSinceLastTouch: now - (session.lastTouch || 0),
    wallet: session.wallet
  };
}
```

### 3. Create Factory Function

```javascript
// src/core/analytics/index.js
const { createSessionAdapter } = require('../session');
const { AnalyticsEvents } = require('../../db/models/analyticsEvents');

function createAnalyticsService(legacyLobby, sessionService = null) {
  const sessionAdapter = createSessionAdapter(legacyLobby, sessionService);
  const analyticsDB = new AnalyticsEvents();
  
  return new AnalyticsService(sessionAdapter, analyticsDB);
}

module.exports = {
  createAnalyticsService,
  AnalyticsService
};
```

## Refactor Steps

### Approach 1: Wrapper Service (Lower Risk)

1. Create `AnalyticsService` that wraps the existing `AnalyticsEvents` class
2. Add session adapter as a dependency
3. Use composition pattern to delegate to original functionality where possible
4. Gradually replace direct lobby access with adapter calls

**Pros**: 
- Minimal changes to existing code
- Easier fallback strategy
- Can be done incrementally

**Cons**:
- More boilerplate code
- Less clean architecture in the short term

### Approach 2: Direct Refactor (Higher Impact)

1. Directly modify the `AnalyticsEvents` class to use SessionAdapter
2. Remove lobby imports and replace with SessionAdapter
3. Update all methods to be async-aware

**Pros**:
- Cleaner end result
- Less code overall
- More consistent with clean architecture

**Cons**:
- Higher risk of breaking existing functionality
- More challenging to implement fallbacks
- Requires more comprehensive testing

## Recommended Approach

We'll take **Approach 1 (Wrapper Service)** as it provides:
- Lower implementation risk
- Better compatibility with existing code
- Easier fallback mechanism
- More gradual migration path

## Migration Strategy

### Phase 1: Initial Implementation (Current Task)

1. Create `src/core/analytics/AnalyticsService.js` wrapper
2. Implement the three methods that currently use `lobby[userId]`:
   - `trackUserJoin`
   - `trackUserKick`
   - `trackVerification`
3. Provide factory function to create properly configured service
4. Add unit tests for the new service

### Phase 2: Basic Integration

1. Create integration point in an isolated part of the codebase
2. Update a single event tracking call to use the new service
3. Validate data consistency and performance
4. Implement logging to compare old vs new results

### Phase 3: Expand Coverage

1. Gradually replace more AnalyticsEvents calls with AnalyticsService
2. Add more session properties as needed to the session model
3. Monitor for any issues or discrepancies
4. Extend test coverage to all migrated methods

### Phase 4: Legacy Removal (Future)

1. After validation period, remove direct lobby access
2. Make AnalyticsService the primary interface
3. Consider refactoring AnalyticsEvents to directly use SessionAdapter

## Testing Approach

### Unit Tests

1. Create `tests/core/analytics/AnalyticsService.test.js`
2. Mock SessionAdapter and AnalyticsEvents
3. Verify each method properly translates between session and analytics format
4. Test error handling and fallback mechanisms

### Integration Tests

1. Create test that verifies analytics event recording for each method
2. Compare data with and without SessionAdapter
3. Verify properties match between old and new approach
4. Test with various session states (new user, returning user, kicked user)

## Risks and Mitigations

### Risk: Async Performance Impact

**Mitigation:**
- Add property batching to SessionAdapter (get multiple properties at once)
- Add caching for recently accessed sessions
- Profile before and after to measure actual impact

### Risk: Missing Session Properties

**Mitigation:**
- Ensure the SessionModel.fromLobby method maps all required properties
- Add fallback defaults for all properties
- Create session validation to detect missing required fields

### Risk: Disruption to Analytics Collection

**Mitigation:**
- Implement side-by-side collection before switching
- Add robust error handling with fallback to direct lobby access
- Monitor analytics events closely during initial rollout

## Success Criteria

1. All identified `lobby[userId]` references in analytics code use SessionAdapter
2. Unit and integration tests validate data consistency
3. No observable performance degradation
4. Error handling properly manages edge cases
5. New analytics events have identical data format to previous implementation 