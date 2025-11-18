# Public Spell Page Test Plan

## Overview
This document outlines comprehensive test cases for the public spell page (`/spells/:slug`) to ensure all delivery types, user states, and edge cases work correctly.

## ✅ Confirmed Working
- **Text output delivery** for authenticated user with sufficient points
- **Cost estimation** with historical data
- **WebSocket connection** for authenticated users
- **Polling fallback** for unauthenticated users

---

## Test Cases

### 1. Output Type Tests

#### 1.1 Text Output ✅ (Confirmed)
- **Setup**: Spell that produces text output (e.g., ChatGPT, string-primitive)
- **Expected**: Text displayed correctly with proper formatting
- **Status**: ✅ Working

#### 1.2 Image Output ⏳ (Needs Testing)
- **Setup**: Spell that produces image output (e.g., image generation tool)
- **Expected**: 
  - Image displayed in output section
  - Image URL is valid and accessible
  - Image renders correctly in browser
- **Test Steps**:
  1. Navigate to spell page with image-generating spell
  2. Execute spell
  3. Verify image appears in output section
  4. Verify image is clickable/viewable
- **Status**: ⏳ Pending

#### 1.3 Video Output ⏳ (Needs Testing)
- **Setup**: Spell that produces video output
- **Expected**:
  - Video player displayed in output section
  - Video URL is valid and accessible
  - Video plays correctly in browser
- **Test Steps**:
  1. Navigate to spell page with video-generating spell
  2. Execute spell
  3. Verify video player appears
  4. Verify video plays correctly
- **Status**: ⏳ Pending

#### 1.4 Mixed Output (Multi-step) ⏳ (Needs Testing)
- **Setup**: Spell with multiple steps producing different output types
- **Expected**:
  - Each step's output displayed correctly
  - Final result highlighted
  - All output types render properly
- **Test Steps**:
  1. Navigate to multi-step spell (e.g., image → text → image)
  2. Execute spell
  3. Verify all step outputs display
  4. Verify final result is highlighted
- **Status**: ⏳ Pending

---

### 2. User State Tests

#### 2.1 Authenticated User with Sufficient Points ✅ (Confirmed)
- **Setup**: User logged in with points >= spell cost
- **Expected**: 
  - Direct execution without payment
  - WebSocket connection established
  - Real-time progress updates
  - Output delivered via WebSocket
- **Status**: ✅ Working

#### 2.2 Authenticated User with Insufficient Points ⏳ (Needs Testing)
- **Setup**: User logged in with points < spell cost
- **Expected**:
  - `buyPointsModal` opens automatically
  - After purchase, spell auto-executes
  - WebSocket connects after purchase
  - Output delivered correctly
- **Test Steps**:
  1. Log in with account that has < spell cost
  2. Click "Run Spell"
  3. Verify buyPointsModal opens
  4. Complete purchase
  5. Verify spell auto-executes
  6. Verify output appears
- **Status**: ⏳ Pending

#### 2.3 Guest User (No Account) ⏳ (Needs Testing)
- **Setup**: No authentication, no wallet connected
- **Expected**:
  - Wallet connection prompt appears
  - After wallet connection, payment transaction generated
  - After payment confirmation, guest account created
  - Guest token set
  - WebSocket connects with guest token
  - Spell executes and output delivered
- **Test Steps**:
  1. Open spell page in incognito/private window
  2. Click "Run Spell"
  3. Verify wallet connection modal appears
  4. Connect wallet
  5. Verify payment transaction generated
  6. Send transaction
  7. Wait for confirmation
  8. Verify guest token is set
  9. Verify WebSocket connects
  10. Verify spell executes
  11. Verify output appears
- **Status**: ⏳ Pending

#### 2.4 Guest User After Payment ⏳ (Needs Testing)
- **Setup**: Guest user who has already paid (guest token exists)
- **Expected**:
  - WebSocket connects immediately
  - Can execute spells without re-payment
  - Output delivered correctly
- **Test Steps**:
  1. Complete guest payment flow (from 2.3)
  2. Refresh page
  3. Verify guest token persists
  4. Execute another spell
  5. Verify no payment required
  6. Verify output appears
- **Status**: ⏳ Pending

#### 2.5 Zero-Cost Spell ⏳ (Needs Testing)
- **Setup**: Spell with 0 cost (no historical data or free tool)
- **Expected**:
  - No wallet connection required
  - No payment required
  - Direct execution
  - Output delivered correctly
- **Test Steps**:
  1. Navigate to zero-cost spell
  2. Verify no wallet prompt
  3. Click "Run Spell"
  4. Verify direct execution
  5. Verify output appears
- **Status**: ⏳ Pending

---

### 3. Delivery Method Tests

#### 3.1 WebSocket Delivery (Authenticated) ✅ (Confirmed)
- **Setup**: Authenticated user with WebSocket connection
- **Expected**:
  - Real-time progress updates
  - Step-by-step progress shown
  - Final output delivered via WebSocket
  - No polling occurs
- **Status**: ✅ Working

#### 3.2 WebSocket Delivery (Guest) ⏳ (Needs Testing)
- **Setup**: Guest user with guest token
- **Expected**:
  - WebSocket connects with guest token
  - Real-time updates received
  - Output delivered via WebSocket
- **Test Steps**:
  1. Complete guest payment flow
  2. Execute spell
  3. Verify WebSocket connects
  4. Verify real-time updates
  5. Verify output via WebSocket
- **Status**: ⏳ Pending

#### 3.3 Polling Fallback ⏳ (Needs Testing)
- **Setup**: WebSocket unavailable or fails to connect
- **Expected**:
  - Polling starts automatically
  - Status updates via polling
  - Output fetched via polling when complete
  - Polling stops when WebSocket connects
- **Test Steps**:
  1. Disable WebSocket (or simulate failure)
  2. Execute spell
  3. Verify polling starts
  4. Verify status updates via polling
  5. Verify output fetched when complete
- **Status**: ⏳ Pending

#### 3.4 WebSocket Reconnection ⏳ (Needs Testing)
- **Setup**: WebSocket disconnects during execution
- **Expected**:
  - Polling fallback activates
  - Output still delivered
  - WebSocket reconnects if possible
- **Test Steps**:
  1. Start spell execution with WebSocket
  2. Disconnect WebSocket mid-execution
  3. Verify polling starts
  4. Verify output still delivered
- **Status**: ⏳ Pending

---

### 4. Edge Cases

#### 4.1 Multi-Step Spell Progress ⏳ (Needs Testing)
- **Setup**: Spell with 3+ steps
- **Expected**:
  - Each step progress shown
  - Intermediate outputs displayed (if configured)
  - Final result highlighted
  - All steps listed in output
- **Test Steps**:
  1. Execute multi-step spell
  2. Verify step-by-step progress
  3. Verify all step outputs shown
  4. Verify final result highlighted
- **Status**: ⏳ Pending

#### 4.2 Failed Step Handling ⏳ (Needs Testing)
- **Setup**: Spell where one step fails
- **Expected**:
  - Error message displayed
  - Failed step identified
  - Cast status shows "failed"
  - No further steps execute
- **Test Steps**:
  1. Execute spell with invalid inputs (to cause failure)
  2. Verify error message appears
  3. Verify failed step identified
  4. Verify cast status is "failed"
- **Status**: ⏳ Pending

#### 4.3 Network Error Handling ⏳ (Needs Testing)
- **Setup**: Network interruption during execution
- **Expected**:
  - Error message displayed
  - User can retry
  - No duplicate charges
- **Test Steps**:
  1. Start spell execution
  2. Disconnect network mid-execution
  3. Verify error handling
  4. Reconnect and verify can retry
- **Status**: ⏳ Pending

#### 4.4 Page Refresh During Execution ⏳ (Needs Testing)
- **Setup**: Refresh page while spell is executing
- **Expected**:
  - Cast ID persists (if stored)
  - Can check status of running spell
  - Output appears when complete
- **Test Steps**:
  1. Start spell execution
  2. Note cast ID
  3. Refresh page
  4. Verify can check status (if cast ID stored)
  5. Verify output appears when complete
- **Status**: ⏳ Pending

#### 4.5 Concurrent Executions ⏳ (Needs Testing)
- **Setup**: Multiple spell executions in quick succession
- **Expected**:
  - Each execution tracked separately
  - Outputs don't mix
  - All executions complete successfully
- **Test Steps**:
  1. Execute spell
  2. Immediately execute again
  3. Verify both tracked separately
  4. Verify outputs don't mix
- **Status**: ⏳ Pending

---

### 5. Payment Flow Tests

#### 5.1 Buy Points Modal Integration ⏳ (Needs Testing)
- **Setup**: User needs to purchase points
- **Expected**:
  - Modal opens automatically
  - Default mode is "donate"
  - After purchase, spell auto-executes
  - Points balance updates
- **Test Steps**:
  1. Execute spell with insufficient points
  2. Verify modal opens
  3. Verify default is "donate"
  4. Complete purchase
  5. Verify spell auto-executes
  6. Verify balance updates
- **Status**: ⏳ Pending

#### 5.2 Transaction Rejection ⏳ (Needs Testing)
- **Setup**: User rejects payment transaction
- **Expected**:
  - Error message displayed
  - User can retry
  - No charges applied
- **Test Steps**:
  1. Start payment flow
  2. Reject transaction in wallet
  3. Verify error message
  4. Verify can retry
- **Status**: ⏳ Pending

#### 5.3 Payment Timeout ⏳ (Needs Testing)
- **Setup**: Payment transaction takes too long
- **Expected**:
  - Timeout message displayed
  - User can check transaction status
  - Can retry if needed
- **Test Steps**:
  1. Start payment flow
  2. Wait for timeout (or simulate)
  3. Verify timeout handling
  4. Verify can check status
- **Status**: ⏳ Pending

---

### 6. UI/UX Tests

#### 6.1 Account Info Display ⏳ (Needs Testing)
- **Setup**: Authenticated user
- **Expected**:
  - Wallet address shown
  - Points balance shown
  - Updates after transactions
- **Test Steps**:
  1. Log in
  2. Verify account info displays
  3. Execute spell
  4. Verify balance updates
- **Status**: ⏳ Pending

#### 6.2 Cost Breakdown Display ⏳ (Needs Testing)
- **Setup**: Spell with cost estimation
- **Expected**:
  - Base cost shown
  - Payment amount (with buffer) shown
  - Cost breakdown by tool shown
  - Balance comparison shown
- **Test Steps**:
  1. Navigate to spell page
  2. Verify cost breakdown displays
  3. Verify tool-by-tool breakdown
  4. Verify balance comparison
- **Status**: ⏳ Pending

#### 6.3 Loading States ⏳ (Needs Testing)
- **Setup**: Various loading scenarios
- **Expected**:
  - Quote loading state
  - Execution loading state
  - Payment confirmation loading state
  - Progress indicators shown
- **Test Steps**:
  1. Navigate to spell page
  2. Verify quote loading
  3. Execute spell
  4. Verify execution loading
  5. Verify progress indicators
- **Status**: ⏳ Pending

---

## Test Execution Checklist

### Priority 1 (Critical Path)
- [ ] Image output delivery
- [ ] Video output delivery
- [ ] Guest user payment flow
- [ ] Guest user WebSocket connection
- [ ] Insufficient points → buyPointsModal flow

### Priority 2 (Important)
- [ ] Multi-step spell progress
- [ ] Polling fallback
- [ ] WebSocket reconnection
- [ ] Failed step handling
- [ ] Zero-cost spell execution

### Priority 3 (Edge Cases)
- [ ] Network error handling
- [ ] Page refresh during execution
- [ ] Concurrent executions
- [ ] Payment timeout
- [ ] Transaction rejection

---

## Notes

- All tests should be performed on both authenticated and guest user flows
- WebSocket vs polling should be tested for both user types
- Output rendering should be tested for all supported types (text, image, video)
- Payment flows should be tested with both "donate" and "contribute" modes
- Error handling should be tested for all failure scenarios

---

## Test Results Template

```
Test Case: [Name]
Date: [Date]
Tester: [Name]
Status: ✅ Pass / ❌ Fail / ⚠️ Partial
Notes: [Any observations or issues]
```

