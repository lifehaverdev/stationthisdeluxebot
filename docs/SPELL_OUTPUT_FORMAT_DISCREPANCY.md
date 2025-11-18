# Spell Output Format Discrepancy: Telegram vs Web Platform

## Problem Statement

Recent fixes to resolve duplicate spell execution on Telegram have inadvertently broken spell output delivery on the web platform. Spells now work correctly on Telegram but fail to display outputs properly on the web sandbox - users only see "outputs available" instead of the actual results.

## Context

### What Changed
1. **Removed duplicate emission from `AsyncJobPoller`**: Previously, both `AsyncJobPoller` and the API endpoint were emitting `generationUpdated` events, causing duplicate spell execution.
2. **Added `deliveryStrategy` detection in API endpoint**: The API endpoint now detects spell steps and sets `deliveryStrategy: 'spell_step'` when emitting events.
3. **Fixed `responsePayload` format handling**: Added support for `{ result: "text" }` format in `TelegramNotifier` to handle ChatGPT outputs.

### Current State

**Telegram (Working ✅):**
- Spells execute once (no duplicates)
- Final results are delivered correctly
- Output format: `{ result: "text" }` is converted to array format for Telegram

**Web Sandbox (Broken ❌):**
- Spells execute correctly
- Final notification is sent via WebSocket
- But output format is not being parsed/displayed correctly
- Users see "outputs available" instead of actual content

## Evidence from Logs

### Web Sandbox Execution (Line 626-688)
```
[StepContinuator] No chatId found in notificationContext. originalContext.telegramContext: undefined
```

This is expected for web-sandbox (no Telegram context).

### Notification Payload (Line 660-683)
```javascript
{
  generationId: '691772522240681fc9e0d5fc',
  status: 'completed',
  outputs: {
    result: "Miladyii style, I understand your request..."
  },
  toolId: 'chatgpt-free',
  spellId: '68e01958eb26adaf366d5326',
  castId: '691772402240681fc9e0d5f6',
  costUsd: NaN,  // ⚠️ Issue: costUsd is NaN
  ...
}
```

### Issues Identified
1. **Output format**: `outputs.result` format may not match what `SpellWindow.js` expects
2. **Cost display**: `costUsd: NaN` suggests cost data isn't being passed correctly
3. **Output parsing**: The web frontend may expect a different structure than what's being sent

## Investigation Tasks

### 1. Understand Current Output Format Expectations

**Files to examine:**
- `src/platforms/web/client/src/sandbox/window/SpellWindow.js` - How does it parse/display outputs?
- `src/core/services/notifications/webSandboxNotifier.js` - How does it format outputs for WebSocket?
- `src/core/services/workflow/continuation/StepContinuator.js` - What format does it use when updating final step?

**Questions:**
- What format does `SpellWindow.js` expect for `output` property?
- How does the web frontend parse spell completion notifications?
- What's the difference between Telegram's expected format and Web's expected format?

### 2. Trace the Output Flow

**For Web Platform:**
1. Spell completes → `StepContinuator._finalizeSpell()` updates final generation record
2. API endpoint emits `generationUpdated` with `deliveryStrategy: 'spell_final'`
3. `NotificationDispatcher` routes to `WebSandboxNotifier`
4. `WebSandboxNotifier` formats payload and sends via WebSocket
5. Frontend receives WebSocket message
6. `SpellWindow.js` should parse and display the output

**Investigate:**
- What format does `StepContinuator` use for `responsePayload`?
- How does `WebSandboxNotifier` transform `responsePayload` into WebSocket payload?
- What format does the frontend WebSocket handler expect?

### 3. Compare Telegram vs Web Format Handling

**Telegram:**
- `TelegramNotifier` converts `{ result: "text" }` to array format: `[{ type: 'text', data: { text: ["..."] } }]`
- This works correctly

**Web:**
- `WebSandboxNotifier` may not be doing similar conversion
- Or the frontend expects a different format entirely

**Action:**
- Compare `TelegramNotifier.sendNotification()` with `WebSandboxNotifier.sendNotification()`
- Identify format differences
- Ensure consistent handling or platform-specific conversion

### 4. Fix the Output Format

**Potential Solutions:**

**Option A: Normalize in WebSandboxNotifier**
- Convert `{ result: "text" }` format to expected web format
- Similar to what `TelegramNotifier` does

**Option B: Normalize in StepContinuator**
- Ensure `responsePayload` is always in a consistent format
- Platform-specific notifiers handle display, not format conversion

**Option C: Update Frontend**
- Update `SpellWindow.js` to handle `{ result: "text" }` format
- More flexible but requires frontend changes

**Recommendation:** Option A or B - normalize at the service layer, not the frontend.

### 5. Fix Cost Display Issue

**Problem:** `costUsd: NaN` in WebSocket payload (line 680)

**Investigation:**
- Check how `StepContinuator` sets `costUsd` in final generation record
- Check how `WebSandboxNotifier` extracts cost data
- Ensure cost is properly passed through the chain

**Files to check:**
- `src/core/services/workflow/continuation/StepContinuator.js` - `_finalizeSpell()` method
- `src/core/services/notifications/webSandboxNotifier.js` - cost extraction logic

### 6. Harden the System

**Prevent Future Issues:**

1. **Type Safety:**
   - Add TypeScript or JSDoc types for `responsePayload` formats
   - Document expected formats per platform
   - Add runtime validation

2. **Format Normalization:**
   - Create a shared utility for normalizing `responsePayload` formats
   - Ensure all notifiers use consistent base format
   - Platform-specific notifiers only handle display differences

3. **Integration Tests:**
   - Add tests for spell completion on both Telegram and Web
   - Verify output format matches expectations
   - Test cost display on both platforms

4. **Documentation:**
   - Document expected `responsePayload` formats
   - Document how each platform notifier transforms outputs
   - Create a decision tree for format handling

## Files to Modify

### Core Files (Likely Need Changes)
- `src/core/services/notifications/webSandboxNotifier.js` - Output format conversion
- `src/core/services/workflow/continuation/StepContinuator.js` - Ensure consistent format
- `src/core/services/workflow/adapters/AdapterCoordinator.js` - Output normalization

### Frontend Files (May Need Changes)
- `src/platforms/web/client/src/sandbox/window/SpellWindow.js` - Output parsing
- WebSocket message handlers (find where spell completion messages are processed)

### Test Files (Should Add)
- Integration tests for spell completion on web platform
- Unit tests for output format normalization

## Success Criteria

1. ✅ Spells display outputs correctly on web sandbox
2. ✅ Cost information displays correctly (not NaN)
3. ✅ Telegram delivery still works (regression test)
4. ✅ Output format is consistent or properly normalized
5. ✅ System is hardened to prevent similar issues

## Testing Checklist

- [ ] Cast a spell with async adapter tool (e.g., JoyCaption) on web sandbox
- [ ] Verify output displays correctly in SpellWindow
- [ ] Verify cost displays correctly (not NaN)
- [ ] Cast the same spell on Telegram
- [ ] Verify Telegram output still works
- [ ] Test with different output types (text, images, etc.)
- [ ] Test with multi-step spells
- [ ] Test with immediate tools vs async tools

## Related Files Reference

**Core Services:**
- `src/core/services/notifications/webSandboxNotifier.js`
- `src/core/services/notifications/telegramNotifier.js`
- `src/core/services/workflow/continuation/StepContinuator.js`
- `src/core/services/workflow/adapters/AdapterCoordinator.js`
- `src/core/services/notificationDispatcher.js`

**API Endpoints:**
- `src/api/internal/generations/generationOutputsApi.js`
- `src/api/internal/generations/generationExecutionApi.js`

**Frontend:**
- `src/platforms/web/client/src/sandbox/window/SpellWindow.js`
- WebSocket message handlers (search for `generationUpdate` or `spell`)

## Notes

- The changes that fixed Telegram were necessary and correct
- The issue is that web platform expects a different output format
- Solution should normalize formats at the service layer, not require frontend changes
- Consider creating a shared `ResponsePayloadNormalizer` utility

