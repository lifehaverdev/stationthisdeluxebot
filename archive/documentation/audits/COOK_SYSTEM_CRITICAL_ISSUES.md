# Cook System Critical Issues

**Date:** 2025-01-27  
**Status:** Requires Immediate Attention  
**Priority:** CRITICAL

---

## Issue 1: Race Condition in startCook - Duplicate State Creation

**Severity:** 🔴 CRITICAL  
**File:** `src/core/services/cook/CookOrchestratorService.js`  
**Location:** Lines 130-136

### Problem

Two concurrent `startCook` calls can both see that the key doesn't exist and create duplicate state entries:

```javascript
if (!this.runningByCollection.has(key)) {
  this.runningByCollection.set(key, { running: new Set(), ... });
}
const state = this.runningByCollection.get(key);
state.nextIndex = Math.max(state.nextIndex, producedSoFar);
state.total = supply; // update if changed
```

### Impact

- Duplicate state entries for same collection+user
- State corruption
- Supply limits not enforced correctly
- Can cause overscheduling

### Root Cause

Non-atomic check-and-set operation. Between `has()` check and `set()`, another call can also see `!has()` and create duplicate state.

### Fix Required

Use atomic check-and-set pattern:

```javascript
const existingState = this.runningByCollection.get(key);
if (!existingState) {
  const newState = { running: new Set(), nextIndex: producedSoFar, generatedCount: producedSoFar, total: supply, maxConcurrent: 3, toolId: toolId || null, cookId, spellId: spellId || null, traitTree, paramOverrides, traitTypes, paramsTemplate };
  this.runningByCollection.set(key, newState);
  // Use newState
} else {
  // Update existing state
  existingState.total = supply;
  existingState.nextIndex = Math.max(existingState.nextIndex, producedSoFar);
  // Use existingState
}
```

Or better: Use a mutex/lock per key to ensure atomicity.

---

## Issue 2: Race Condition in scheduleNext - Concurrent Execution

**Severity:** 🔴 CRITICAL  
**File:** `src/core/services/cook/CookOrchestratorService.js`  
**Location:** Lines 221-307

### Problem

Multiple `scheduleNext` calls can run concurrently for the same collection+user, causing:

1. Multiple pieces scheduled beyond maxConcurrent
2. Supply limit exceeded
3. Duplicate piece indices
4. State corruption

```javascript
async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
  const key = this._getKey(collectionId, userId);
  const state = this.runningByCollection.get(key);
  if (!state) return;
  state.running.delete(String(finishedJobId));
  
  // ... no locking ...
  
  while (
    state.running.size < state.maxConcurrent &&
    state.nextIndex < state.total
  ) {
    // ... can be executed by multiple concurrent calls ...
    state.running.add(String(enq.jobId));
    state.nextIndex += 1;
  }
}
```

### Impact

- Can schedule 3x (or more) pieces than maxConcurrent allows
- Can exceed totalSupply limit
- Duplicate piece indices
- Resource exhaustion
- Poor performance

### Root Cause

No locking mechanism. Multiple concurrent calls can all pass the `state.running.size < state.maxConcurrent` check before any of them add to the set.

### Fix Required

Add home-baked async mutex per collection+user key:

```javascript
class CookOrchestratorService {
  constructor() {
    // ... existing code ...
    this.locks = new Map(); // key -> Promise (mutex chain)
  }

  /**
   * Acquire lock for a specific collection+user key
   * Returns a function to release the lock
   */
  async _acquireLock(key) {
    // Get or create lock promise chain for this key
    if (!this.locks.has(key)) {
      this.locks.set(key, Promise.resolve());
    }
    
    // Add ourselves to the chain - wait for previous operations
    const previousLock = this.locks.get(key);
    let releaseLock;
    const ourLock = previousLock.then(() => {
      return new Promise(resolve => {
        releaseLock = resolve; // Store release function
      });
    });
    
    // Update chain with our lock
    this.locks.set(key, ourLock);
    
    // Wait for our turn
    await ourLock;
    
    // Return release function
    return () => {
      releaseLock(); // Release lock, allowing next operation
    };
  }

  async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
    const key = this._getKey(collectionId, userId);
    
    // Acquire lock - wait for any concurrent operations to finish
    const releaseLock = await this._acquireLock(key);
    
    try {
      const state = this.runningByCollection.get(key);
      if (!state) {
        releaseLock();
        return;
      }
      
      // ... rest of protected logic ...
      
    } finally {
      releaseLock(); // Always release lock, even on error
    }
  }
}
```

**How it works:**
1. First call creates lock chain, proceeds immediately
2. Second call waits for first call's lock
3. First call finishes, releases lock, second call proceeds
4. Result: Operations are serialized per key, preventing race conditions

---

## Issue 3: Multiple scheduleNext Calls - Need Idempotency

**Severity:** 🔴 CRITICAL  
**Files:** 
- `src/core/services/comfydeploy/webhookProcessor.js` (lines 454-472)
- `src/core/services/notificationDispatcher.js` (lines 311-325)
- `src/api/internal/generations/generationExecutionApi.js` (lines 527-537, 647-653)

### Problem

Multiple different places call `scheduleNext` for completed generations, which is **necessary** for different tool execution types:

1. **Generation Execution API** - For immediate/synchronous tools (String, ChatGPT)
   - Tools complete synchronously, return response immediately
   - scheduleNext called directly in execution API (lines 527-537, 644-654)
   - **Necessary** - these tools don't go through webhook

2. **Webhook Processor** - For webhook-based async tools (ComfyUI)
   - Tools start job, complete asynchronously via webhook
   - scheduleNext called when webhook updates generation to completed (lines 454-472)
   - **Necessary** - webhook is completion signal

3. **Notification Dispatcher** - For polling-based async tools (HuggingFace JoyCaption)
   - Tools use async adapters with polling
   - Polling detects completion, emits generationUpdated event
   - Notification dispatcher calls scheduleNext (lines 311-325)
   - **Potentially necessary** - polling tools may not trigger webhook

**However**, the same generation can trigger multiple paths, causing duplicate scheduling.

### Impact

- Can schedule multiple pieces instead of 1
- Can exceed supply limit
- State corruption
- Resource exhaustion

### Root Cause

No idempotency check. Same generation completion can trigger scheduleNext from multiple paths:
- Immediate tool: execution API calls scheduleNext
- Webhook tool: webhook processor calls scheduleNext  
- Polling tool: notification dispatcher calls scheduleNext
- But if a tool triggers both webhook AND notification dispatcher, both call scheduleNext

### Fix Required

**Add idempotency check** in scheduleNext to prevent duplicate processing:

```javascript
class CookOrchestratorService {
  constructor() {
    // ... existing code ...
    this.processedJobIds = new Set(); // Track processed jobIds
    this.processedJobIdsCleanup = new Map(); // key -> setTimeout handle
  }

  async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
    const key = this._getKey(collectionId, userId);
    
    // ✅ IDEMPOTENCY CHECK
    const jobKey = `${key}:${finishedJobId}`;
    if (this.processedJobIds.has(jobKey)) {
      this.logger.debug(`[CookOrchestrator] scheduleNext already processed for jobId ${finishedJobId}, skipping`);
      return;
    }
    
    // Mark as processed
    this.processedJobIds.add(jobKey);
    
    // Cleanup after 1 hour (safety measure)
    if (this.processedJobIdsCleanup.has(jobKey)) {
      clearTimeout(this.processedJobIdsCleanup.get(jobKey));
    }
    const timeout = setTimeout(() => {
      this.processedJobIds.delete(jobKey);
      this.processedJobIdsCleanup.delete(jobKey);
    }, 60 * 60 * 1000); // 1 hour
    this.processedJobIdsCleanup.set(jobKey, timeout);
    
    // Acquire lock (from Issue 2 fix)
    const releaseLock = await this._acquireLock(key);
    
    try {
      // ... rest of scheduleNext logic ...
    } finally {
      releaseLock();
    }
  }
}
```

**Recommendation:**
- Keep scheduleNext calls in all three places (they're needed for different tool types)
- Remove from notification dispatcher ONLY if polling tools also trigger webhook processor
- Add idempotency check to prevent duplicate processing
- Add mutex (from Issue 2) to prevent race conditions

---

## Issue 4: Failed Submission Still Marks JobId as Running

**Severity:** 🔴 CRITICAL  
**File:** `src/core/services/cook/CookOrchestratorService.js`  
**Location:** Lines 148-166

### Problem

JobId is added to `state.running` BEFORE submission, so if submission fails, the jobId remains in the running set but never completes:

```javascript
const enq = await this._enqueuePiece({ ... });
const enqueuedJobId = enq.jobId;
state.running.add(String(enqueuedJobId));  // ❌ Added before submit

if (IMMEDIATE_SUBMIT) {
  try {
    const resp = await submitPiece({ spellId: spellId, submission });
    this.logger.info(`[Cook] Submitted piece. job=${enqueuedJobId} resp=${resp?.status || 'ok'}`);
  } catch (e) {
    this.logger.error(`[CookOrchestrator] Immediate submit failed: ${e.message}`);
    // ❌ JobId still in running set, but never completes
  }
}
```

### Impact

- Cook can get stuck - waiting for jobId that never completes
- State inconsistency
- No way to recover without manual intervention
- Can prevent cook completion

### Root Cause

State update happens before operation that can fail. If operation fails, state is inconsistent.

### Fix Required

Move `state.running.add()` to AFTER successful submission:

```javascript
const enq = await this._enqueuePiece({ ... });
const enqueuedJobId = enq.jobId;

if (IMMEDIATE_SUBMIT) {
  try {
    const resp = await submitPiece({ spellId: spellId, submission });
    this.logger.info(`[Cook] Submitted piece. job=${enqueuedJobId} resp=${resp?.status || 'ok'}`);
    state.running.add(String(enqueuedJobId));  // ✅ Added after successful submit
  } catch (e) {
    this.logger.error(`[CookOrchestrator] Immediate submit failed: ${e.message}`);
    // JobId not added - cook can retry or fail gracefully
    throw e; // Or handle error appropriately
  }
} else {
  state.running.add(String(enqueuedJobId)); // Only if not immediate submit
}
```

Also apply same fix in `scheduleNext` (line 291).

---

## Issue 5: No Authorization Checks - Users Can Cook Any Collection

**Severity:** 🔴 CRITICAL  
**File:** `src/api/internal/cookApi.js`  
**Location:** Lines 16-51 (`/start` endpoint)

### Problem

No check that user owns the collection before allowing cook to start:

```javascript
router.post('/start', async (req, res) => {
  try {
    const { collectionId, userId, spellId, toolId } = req.body;
    if (!collectionId || !userId) {
      return res.status(400).json({ error: 'collectionId and userId required' });
    }
    // ❌ No authorization check
    
    const cook = await cooksDb.createCook({ collectionId, initiatorAccountId: userId, targetSupply: totalSupply });
    // ...
  }
});
```

### Impact

- Users can cook collections they don't own
- Security vulnerability
- Can cause unauthorized resource usage
- Potential for abuse

### Root Cause

Missing authorization middleware or check.

### Fix Required

Add authorization check:

```javascript
router.post('/start', async (req, res) => {
  try {
    const { collectionId, userId, spellId, toolId } = req.body;
    if (!collectionId || !userId) {
      return res.status(400).json({ error: 'collectionId and userId required' });
    }
    
    // ✅ Verify collection exists and user owns it
    if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
    const collection = await cookDb.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'collection-not-found' });
    }
    if (collection.userId !== userId) {
      return res.status(403).json({ error: 'unauthorized' });
    }
    
    // ... rest of logic ...
  }
});
```

Also add to other endpoints that modify collections.

---

## Issue 6: State Updates Not Atomic - Can Cause Duplicate Indices

**Severity:** 🔴 CRITICAL  
**File:** `src/core/services/cook/CookOrchestratorService.js`  
**Location:** Lines 291-294

### Problem

Multiple state fields updated separately without atomicity:

```javascript
state.running.add(String(enq.jobId));
this.logger.info('[Cook DEBUG] queued job', { jobId: enq.jobId, pieceIndex: idx });
state.nextIndex += 1;  // ❌ Not atomic with above
state.generatedCount = producedNow; // ❌ Not atomic
```

Concurrent calls can interleave these updates, causing:
- Duplicate indices
- Inconsistent state
- Lost updates

### Impact

- Duplicate piece indices
- State corruption
- Inconsistent counts
- Can cause data integrity issues

### Root Cause

No transaction or lock mechanism. Updates are separate operations.

### Fix Required

Use mutex (see Issue 2) or make updates atomic:

```javascript
// Within mutex lock:
const idx = state.nextIndex;
const enq = await this._enqueuePiece({ ... });
state.running.add(String(enq.jobId));
state.nextIndex = idx + 1;  // Atomic update
state.generatedCount = producedNow;
```

Or use atomic operations if moving to database.

---

## Summary

All critical issues relate to:
1. **Concurrency** - Race conditions from lack of locking
2. **State Management** - Non-atomic updates
3. **Security** - Missing authorization
4. **Error Handling** - State updated before operations complete
5. **Idempotency** - Multiple completion paths need deduplication

**Immediate Actions Required:**
1. Add home-baked async mutex mechanism (per collection+user key)
2. Add idempotency check in scheduleNext (track processed jobIds)
3. Add authorization checks (verify user owns collection)
4. Fix state update ordering (move state.running.add() after successful submit)
5. Evaluate notification dispatcher necessity (may be needed for polling tools)

