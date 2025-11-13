# WebSocket Connection Investigation Prompt

## Context

We have a spell execution system where:
- **Spells** are multi-step workflows that combine AI tools
- When a spell executes, each step completion should trigger a **WebSocket notification** to update the frontend UI in real-time
- The frontend uses `SpellWindow.js` to display spell execution progress and results
- The backend uses `WebSocketService` to send notifications to connected users

## The Problem

**Spell executions complete successfully**, but **WebSocket notifications are not being delivered** to the frontend. The logs consistently show:

```
[WebSocketService]: [WebSocketService] No active connections for user 681a27d761a6acd963d084dd.
[WebSandboxNotifier] No active WS connections for user 681a27d761a6acd963d084dd. Notification not delivered.
```

This means:
1. ✅ Spell execution completes successfully (all steps finish)
2. ✅ Backend attempts to send WebSocket notifications
3. ❌ No WebSocket connection exists for the user
4. ❌ Frontend never receives updates
5. ❌ User never sees the spell completion or results

## Evidence from Logs

From the execution logs, we can see:
- Spell execution completes: `[WorkflowExecution] Spell "stylecaption" finished successfully`
- Final notification record created: `[WorkflowExecution] Final notification record for spell "stylecaption" created`
- WebSocket attempt made: `[WebSandboxNotifier] Attempting to dispatch notification`
- **Connection missing**: `[WebSocketService] No active connections for user 681a27d761a6acd963d084dd`

The notifications are being created with the correct payload:
```json
{
  "generationId": "6915ff6e6ddb12f260e8b698",
  "status": "completed",
  "outputs": [...],
  "toolId": "spell-stylecaption-68e019",
  "spellId": "68e01958eb26adaf366d5326",
  "castId": "6915ff596ddb12f260e8b68e"
}
```

## Files to Investigate

### Frontend
- **`src/platforms/web/client/src/sandbox/window/SpellWindow.js`** - The spell window component that should receive updates
- **`src/platforms/web/client/src/sandbox/node/websocketHandlers.js`** - WebSocket event handlers (mentioned in grep results)
- **`src/platforms/web/client/src/sandbox/state.js`** - Contains `checkPendingGenerations()` function for recovering from disconnections

### Backend
- **`src/core/services/websocket/server.js`** - WebSocket server implementation
- **`src/core/services/notificationDispatcher.js`** - Dispatches notifications (lines 113-120 show WebSandboxNotifier)
- **`src/platforms/web/`** - Web platform initialization and WebSocket setup

## Investigation Tasks

1. **Find where WebSocket connections are established**
   - When does the frontend connect to the WebSocket server?
   - What endpoint/URL is used for the WebSocket connection?
   - Is the connection established when `SpellWindow.js` mounts?
   - Is the connection established when the page loads?

2. **Check WebSocket connection lifecycle**
   - Is the connection being established but then dropped?
   - Are there any connection errors or failures?
   - Is the connection being closed prematurely?
   - Are there reconnection mechanisms in place?

3. **Verify user identification**
   - How does the WebSocket server identify users? (JWT, session, user ID?)
   - Does the user ID match between connection and notification attempts?
   - Is `681a27d761a6acd963d084dd` the correct format for user identification?

4. **Check `checkPendingGenerations()` function**
   - This function is supposed to recover from WebSocket disconnections
   - Is it being called on page load?
   - Is it working correctly?
   - Should it be called when `SpellWindow.js` mounts?

5. **Review WebSocket event handlers**
   - What events does the frontend listen for?
   - Are the event types matching what the backend sends?
   - Is `SpellWindow.js` subscribed to the right events?

6. **Check WebSocket server implementation**
   - How does `WebSocketService.sendToUser()` work?
   - How are user connections tracked?
   - Is there a connection registry that might be losing connections?

## Expected Behavior

When a spell is cast:
1. Frontend establishes WebSocket connection (if not already connected)
2. Spell execution begins
3. Each step completion sends a WebSocket update
4. Frontend receives updates and updates `SpellWindow.js` UI
5. Final spell completion sends final WebSocket update
6. Frontend displays final results in `SpellWindow.js`

## Success Criteria

The investigation should result in:
1. ✅ WebSocket connection established when user loads the sandbox page
2. ✅ Connection maintained throughout spell execution
3. ✅ Notifications successfully delivered to `SpellWindow.js`
4. ✅ UI updates in real-time as spell executes
5. ✅ Final results displayed when spell completes

## Additional Context

- The backend spell execution system is working correctly (all fixes have been applied)
- The issue is purely with WebSocket connectivity/delivery
- User is accessing via `web-sandbox` platform
- The `checkPendingGenerations()` function suggests there's a recovery mechanism, but it may not be working or may not be called

## Questions to Answer

1. **Where should the WebSocket connection be established?** (page load, window mount, etc.)
2. **Why isn't the connection being established?** (missing code, error, timing issue)
3. **Is there a reconnection mechanism?** (if so, why isn't it working?)
4. **How should `SpellWindow.js` subscribe to WebSocket events?** (does it need explicit subscription?)
5. **Should `checkPendingGenerations()` be called automatically?** (if so, where?)

## Deliverables

Please provide:
1. Root cause analysis of why WebSocket connections aren't being established
2. Code fixes to establish and maintain WebSocket connections
3. Updates to `SpellWindow.js` if needed to subscribe to events
4. Verification that notifications are being received and processed
5. Any additional improvements to connection reliability/recovery

