# Cook System Remaining Issues

**Date:** 2025-01-27  
**Status:** After Critical Issues  
**Priority:** MEDIUM/LOW

---

## Medium Priority Issues

### Issue 1: Deprecated Components Still in Use

**Severity:** 🟡 MEDIUM  
**Files:** Multiple

#### CookJobStore

**Status:** Deprecated but still imported and used

**Locations:**
- `src/api/internal/cookApi.js` - imported (line 2), used in `/active` (lines 69-73) and `/debug/queue` (line 315)
- `src/core/services/cook/index.js` - imported (line 1), exported (line 33)
- `src/core/services/cook/CookEmbeddedWorker.js` - imported (line 3)
- `scripts/workers/cookWorker.js` - imported (line 7)

**Impact:**
- Code confusion - deprecated code still active
- Potential for bugs if someone uses deprecated API
- Maintenance burden

**Fix Required:**
- Remove all imports and usages
- Remove `/debug/queue` endpoint or migrate to generationOutputs query
- Update `/active` endpoint to not use cook_jobs fallback
- Remove from exports

#### CookProjectionUpdater

**Status:** Potentially deprecated - uses cook_events and cook_status collections

**Locations:**
- `src/core/services/cook/index.js` - initialized (lines 14-15)
- `src/api/internal/cookApi.js` - used in `/status` endpoint (line 301)
- `CookOrchestratorService.js` - writes to cook_events (line 79, 92)

**Impact:**
- May be redundant if status can be derived from generationOutputs
- Event system may be useful for audit trail

**Recommendation:**
- Evaluate if cook_status projection is still needed
- Consider deriving status directly from generationOutputs
- Keep cook_events for audit trail if desired

#### CookEmbeddedWorker

**Status:** Deprecated - auto-start disabled

**Locations:**
- `src/core/services/cook/index.js` - imported (line 6), conditionally started (lines 19-26)

**Impact:**
- Dead code - worker disabled but still in codebase
- Depends on deprecated CookJobStore

**Fix Required:**
- Remove CookEmbeddedWorker entirely
- Remove from index.js

---

### Issue 2: Type Validation Missing

**Severity:** 🟡 MEDIUM  
**Files:** Multiple

#### ObjectId Validation Missing

**Locations:**
- `src/core/services/db/cooksDb.js` - `createCook` (line 12), `addGeneration` (line 27)
- `src/core/services/cook/CookOrchestratorService.js` - `_getProducedCount` (line 104)
- `src/core/services/db/cookCollectionsDb.js` - `createCollection` (line 21)

**Problem:**
- No `ObjectId.isValid()` checks before conversion
- Will throw runtime errors on invalid format
- No clear error messages

**Fix Required:**
```javascript
if (!ObjectId.isValid(userId)) {
  throw new Error(`Invalid userId format: ${userId}`);
}
const objectId = new ObjectId(userId);
```

#### collectionId Type Inconsistency

**Problem:**
- collectionId is UUID string (from cookCollectionsDb)
- But used as-is in queries without validation
- Could be string, number, or ObjectId depending on source

**Fix Required:**
- Standardize collectionId as UUID string
- Add validation before use
- Document expected format

---

### Issue 3: Supply Counting Uses Inconsistent Logic

**Severity:** 🟡 MEDIUM  
**File:** `src/core/services/cook/CookOrchestratorService.js`

**Locations:**
- Line 140: `producedSoFar >= state.total`
- Line 148: `(state.generatedCount + state.running.size) < state.total`
- Line 277: `producedNow + state.running.size >= state.total`

**Problem:**
- Three different checks use different logic
- `state.generatedCount` may be stale
- `producedSoFar` vs `producedNow` - different queries

**Impact:**
- Inconsistent supply enforcement
- Can allow more or fewer pieces than intended
- Off-by-one errors possible

**Fix Required:**
- Use single source of truth: always query `_getProducedCount()`
- Remove `state.generatedCount` - always use database count
- Standardize supply check logic

---

### Issue 4: Error Handling Swallows Errors - No Recovery

**Severity:** 🟡 MEDIUM  
**Files:** Multiple

#### Cook Document Update Failure

**Location:** `CookOrchestratorService.js` lines 228-252

**Problem:**
```javascript
try {
  // ... update cook document ...
} catch (err) {
  this.logger.error(`[CookOrchestrator] Failed to update cook ${state.cookId}: ${err.message}`);
  // ❌ Error logged but cook continues - cost may not be tracked
}
```

**Impact:**
- Cook cost tracking may be inaccurate
- Generation may not be linked to cook
- No way to recover missing updates

**Fix Required:**
- Add retry logic with exponential backoff
- Consider making updates idempotent
- Add reconciliation job to fix missing updates

#### scheduleNext Failure in Webhook Processor

**Location:** `webhookProcessor.js` lines 463-467

**Problem:**
```javascript
try {
  await CookOrchestratorService.scheduleNext({ ... });
} catch (e) {
  logger.warn(`[Webhook Processor] scheduleNext error: ${e.message}`);
  // ❌ Error swallowed - cook may not advance
}
```

**Impact:**
- Cook can stall if scheduleNext fails
- No retry mechanism
- No alerting

**Fix Required:**
- Add retry logic
- Add alerting for repeated failures
- Consider dead letter queue for failed schedules

---

### Issue 5: No Retry Logic for Critical Operations

**Severity:** 🟡 MEDIUM

**Operations Missing Retries:**
1. Cook document updates
2. scheduleNext calls
3. Generation lookups
4. Cast creation (has retry but could be improved)

**Fix Required:**
- Add retry logic with exponential backoff
- Add max retry limits
- Add retry logging
- Consider circuit breaker pattern for repeated failures

---

## Low Priority Issues

### Issue 6: Metadata Schema Inconsistency

**Severity:** 🟢 LOW  
**File:** `CookOrchestratorService.js` line 99-117

**Problem:**
Query checks both `metadata.reviewOutcome` and top-level `reviewOutcome`:

```javascript
$and: [
  { $or: [
    { 'metadata.reviewOutcome': { $exists: false } },
    { 'metadata.reviewOutcome': { $ne: 'rejected' } },
  ]},
  { $or: [
    { reviewOutcome: { $exists: false } },
    { reviewOutcome: { $ne: 'rejected' } },
  ]},
]
```

**Impact:**
- Confusing query logic
- May miss or double-count pieces
- Performance impact

**Fix Required:**
- Standardize on single location for reviewOutcome
- Update all code to use consistent field
- Add migration if needed

---

### Issue 7: Platform Field Incorrect

**Severity:** 🟢 LOW  
**File:** `CookOrchestratorService.js` line 199

**Problem:**
```javascript
user: { masterAccountId: userId, platform: 'none' },
```

Should be `platform: 'cook'` not `'none'`.

**Fix Required:**
- Change to `platform: 'cook'`

---

### Issue 8: No Index Mentioned for Supply Count Query

**Severity:** 🟢 LOW  
**File:** `CookOrchestratorService.js` line 99-117

**Problem:**
`_getProducedCount` query may be slow without proper index:

```javascript
return this.outputsCol.countDocuments({
  'metadata.collectionId': collectionId,
  masterAccountId: new ObjectId(userId),
  // ... complex $and conditions ...
});
```

**Fix Required:**
- Add index: `{ 'metadata.collectionId': 1, masterAccountId: 1, 'metadata.reviewOutcome': 1 }`
- Verify index exists in `_init()` method

---

### Issue 9: success Parameter Ignored

**Severity:** 🟢 LOW  
**File:** `CookOrchestratorService.js` line 221

**Problem:**
```javascript
async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
  // ... success parameter not used ...
}
```

**Impact:**
- Failed pieces treated same as successful
- No way to track failure rate
- Cook can complete even if all pieces failed

**Fix Required:**
- Track failed pieces separately
- Add option to retry failed pieces
- Consider failure threshold for cook completion

---

### Issue 10: Hardcoded maxConcurrent

**Severity:** 🟢 LOW  
**File:** `CookOrchestratorService.js` line 131

**Problem:**
```javascript
maxConcurrent: 3,
```

**Impact:**
- Not configurable
- Can't adjust based on system load
- Can't tune per collection

**Fix Required:**
- Make configurable via environment variable
- Add to collection config
- Default to 3

---

### Issue 11: State Cleanup on Error

**Severity:** 🟢 LOW  
**File:** `CookOrchestratorService.js`

**Problem:**
- State cleanup happens in multiple places
- Could miss cleanup on error
- No cleanup on process restart

**Fix Required:**
- Centralize cleanup logic
- Add timeout/expiration for stale state
- Rebuild state from database on startup

---

### Issue 12: No Input Validation on API Endpoints

**Severity:** 🟢 LOW  
**File:** `src/api/internal/cookApi.js`

**Problem:**
- No validation of totalSupply range
- No validation of traitTree/paramOverrides structure
- No validation of collectionId format

**Fix Required:**
- Add input validation middleware
- Validate all input formats
- Add schema validation for complex objects

---

### Issue 13: No Rate Limiting

**Severity:** 🟢 LOW  
**File:** `src/api/internal/cookApi.js`

**Problem:**
- No rate limiting on cook endpoints
- Users can spam cook requests
- Can cause resource exhaustion

**Fix Required:**
- Add rate limiting middleware
- Per-user limits
- Per-collection limits

---

### Issue 14: Legacy Fallback Logic

**Severity:** 🟢 LOW  
**File:** `src/api/internal/cookApi.js` lines 156-167, 250-260

**Problem:**
```javascript
if ((!collections || collections.length === 0)) {
  try {
    const legacy = await cookDb.findMany({ $or: [ { userId: { $exists: false } }, { userId: null } ] }, { projection: { _id: 0 } });
    // ... fallback to legacy collections ...
  }
}
```

**Impact:**
- Code complexity
- May mask data issues
- Security concern if legacy collections shouldn't be accessible

**Fix Required:**
- Remove legacy fallback after migration
- Or make it explicit opt-in
- Document why fallback exists

---

## Summary

**Medium Issues:** 5  
**Low Issues:** 9

**Key Themes:**
1. Deprecated code cleanup needed
2. Type validation missing
3. Error handling improvements needed
4. Configuration and flexibility improvements
5. Code quality and consistency

**Recommended Priority:**
1. Fix deprecated components (reduces confusion)
2. Add type validation (prevents runtime errors)
3. Improve error handling (improves reliability)
4. Add configuration options (improves flexibility)
5. Code quality improvements (reduces technical debt)

