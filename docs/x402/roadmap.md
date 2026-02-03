# x402 Roadmap

## Current Status (v1.0)

✅ **Implemented**:
- Core x402 payment verification
- CDP Facilitator integration (Base mainnet)
- Payment settlement after execution
- Replay protection
- Cost calculation with markup
- API endpoints (quote, tools, generate, status)
- Payment audit trail
- Integration with generation execution

⚠️ **Known Limitations**:
- ~~No webhook notifier for async results~~ ✅ Implemented
- Webhook delivers final result only (no progress updates)
- Frontend integration not yet available
- Spells not yet supported
- No admin dashboard for x402 analytics

---

## Phase 2: Webhook Delivery ✅

**Goal**: Support webhook delivery for async generation results.

**Status**: COMPLETED

### What's Implemented

1. **WebhookNotifier** (`src/platforms/webhook/webhookNotifier.js`)
   - HTTP POST delivery with retry logic (3 attempts, exponential backoff)
   - HMAC-SHA256 signature verification
   - Proper payload formatting

2. **NotificationDispatcher Integration**
   - Webhook platform registered in notifiers map
   - Special handling for webhook (no notificationContext required)
   - Triggers on `generationUpdated` event

3. **x402GenerationApi Support**
   - `delivery.mode: 'webhook'` supported
   - `delivery.url` and `delivery.secret` parameters
   - Sets `notificationPlatform: 'webhook'` and `metadata.webhookUrl`

### Current Limitations

- **Final result only**: Webhooks receive completed/failed status
- **No progress updates**: Intermediate states (queued, running, uploading) are sent via WebSocket only, NOT to HTTP webhooks

### Future Enhancement: Progress Webhooks

To send progress updates via webhook, would need:

```javascript
// In webhookProcessor.js, around line 107
if (generationRecordForProgress && generationRecordForProgress.metadata?.webhookUrl) {
  // Send progress via HTTP webhook
  const webhookNotifier = notifiers.get('webhook');
  await webhookNotifier.sendProgressUpdate({
    generationId: generationRecordForProgress._id,
    status: status,  // 'running', 'queued', etc.
    progress: progress,  // 0-1 float
    liveStatus: live_status
  });
}
```

This is tracked in Phase 2.1 below.

---

## Phase 2.1: Progress Webhooks (Optional Enhancement)

**Goal**: Send intermediate progress updates via HTTP webhook, not just final results.

### Current State

Progress updates (running, queued, uploading) are sent via **WebSocket** only:
- `webhookProcessor.js` sends `generationProgress` events to connected clients
- No HTTP webhook equivalent exists

### Proposed Implementation

1. **Extend WebhookNotifier**
   ```javascript
   // src/platforms/webhook/webhookNotifier.js
   async sendProgressUpdate(webhookUrl, secret, progressPayload) {
     // Lower retry count for progress (non-critical)
     await this._sendWithRetry(webhookUrl, {
       type: 'progress',
       generationId: progressPayload.generationId,
       status: progressPayload.status,
       progress: progressPayload.progress,
       liveStatus: progressPayload.liveStatus,
       timestamp: new Date().toISOString()
     }, { secret, maxRetries: 1 });
   }
   ```

2. **Hook into webhookProcessor.js**
   ```javascript
   // Around line 107, after WebSocket progress send
   if (generationRecordForProgress?.metadata?.webhookUrl) {
     const webhookNotifier = require('../../platforms/webhook/webhookNotifier');
     await webhookNotifier.sendProgressUpdate(
       generationRecordForProgress.metadata.webhookUrl,
       generationRecordForProgress.metadata.webhookSecret,
       { generationId, status, progress, liveStatus: live_status }
     ).catch(err => logger.warn(`Progress webhook failed: ${err.message}`));
   }
   ```

3. **API Parameter**
   ```json
   {
     "delivery": {
       "mode": "webhook",
       "url": "https://example.com/webhook",
       "secret": "...",
       "includeProgress": true  // NEW: opt-in for progress updates
     }
   }
   ```

### Considerations

- **Volume**: Progress webhooks can be frequent (every few seconds)
- **Reliability**: Progress is non-critical, so lower retry count
- **Opt-in**: Make it optional to avoid overwhelming clients
- **Rate limiting**: Consider throttling to max 1 progress update per 5 seconds

### Priority: Low

Most clients prefer polling for progress or can use WebSocket. HTTP webhook progress is a nice-to-have.

---

## Phase 3: Frontend Integration

**Goal**: Allow web users to pay with x402 directly in the browser.

### Components

1. **x402 Payment Modal**
   ```jsx
   // Components/X402PaymentModal.jsx
   function X402PaymentModal({ tool, inputs, onSuccess }) {
     const { signTypedData } = useWalletClient();

     const handlePay = async () => {
       // 1. Get payment requirements
       const res = await fetch('/api/v1/x402/generate', {
         method: 'POST',
         body: JSON.stringify({ toolId: tool.id, inputs })
       });
       const { paymentRequired } = await res.json();

       // 2. Sign payment
       const signature = await signTypedData(paymentRequired.accepts[0]);

       // 3. Submit with payment
       const result = await fetch('/api/v1/x402/generate', {
         method: 'POST',
         headers: { 'X-PAYMENT': encodePayment(signature) },
         body: JSON.stringify({ toolId: tool.id, inputs })
       });

       onSuccess(await result.json());
     };

     return (
       <Modal>
         <h2>Pay with USDC</h2>
         <p>Cost: ${tool.price}</p>
         <Button onClick={handlePay}>Pay & Execute</Button>
       </Modal>
     );
   }
   ```

2. **Wallet Connection**
   - Use wagmi/viem for wallet connection
   - Support WalletConnect, Coinbase Wallet, MetaMask
   - Handle network switching to Base

3. **Balance Check**
   - Show user's USDC balance
   - Warn if insufficient funds
   - Link to bridge/purchase USDC

### User Flow

1. User clicks "Execute" on a tool
2. If not logged in, show "Pay with USDC" option
3. Connect wallet if needed
4. Show payment confirmation modal
5. Sign EIP-712 typed data
6. Submit request with payment
7. Show result (or poll for async)

---

## Phase 4: Spell Support

**Goal**: Allow x402 to fund multi-step spell executions.

### Challenges

1. **Cost Estimation**: Spells have variable costs based on steps
2. **Partial Execution**: What if step 3 of 5 fails?
3. **Progressive Payment**: Pay per step vs. upfront

### Proposed Approach

**Option A: Upfront Payment**
```javascript
// Calculate total spell cost
const spellCost = spell.steps.reduce((sum, step) => {
  return sum + pricingService.calculateToolCost(step.toolId, step.inputs);
}, 0);

// Single payment covers all steps
// If any step fails, refund remaining?
```

**Option B: Per-Step Payment**
```javascript
// Each step requires separate payment
// More granular but more friction
// Requires persistent payment session
```

**Option C: Escrow Model**
```javascript
// Upfront escrow of estimated cost
// Actual cost deducted as steps complete
// Refund excess at end
// Requires smart contract for escrow
```

### Recommended: Option A with Retry

1. Estimate total spell cost (with buffer)
2. Single x402 payment upfront
3. Execute all steps
4. If step fails:
   - Log partial completion
   - User can retry from failed step
   - No automatic refund (too complex)

---

## Phase 5: Analytics Dashboard

**Goal**: Admin visibility into x402 revenue and usage.

### Metrics

- **Revenue**: Daily/weekly/monthly USDC settled
- **Volume**: Number of x402 transactions
- **Conversion**: 402 responses → successful payments
- **Top Payers**: Highest volume wallet addresses
- **Tool Popularity**: Which tools are paid for most
- **Failure Rate**: VERIFIED → FAILED ratio

### Implementation

1. **API Endpoints**
   ```
   GET /admin/x402/stats?period=30d
   GET /admin/x402/revenue/daily
   GET /admin/x402/top-payers
   GET /admin/x402/top-tools
   ```

2. **Dashboard UI**
   - Revenue chart (line graph)
   - Payment status breakdown (pie chart)
   - Recent transactions table
   - Alert on high failure rate

3. **Aggregation Jobs**
   - Daily rollup of payment stats
   - Store in separate analytics collection
   - Avoid querying raw logs for dashboard

---

## Phase 6: Advanced Features

### Multi-Token Support

Allow payment in other tokens (USDT, DAI, ETH):
- Different facilitator or DEX integration
- Dynamic pricing based on token
- More complex settlement

### Subscription Model

Prepaid USDC balance for reduced per-request cost:
- Deposit USDC to user account
- Deduct from balance on execution
- Lower markup for prepaid users

### Volume Discounts

Reduced markup for high-volume payers:
- Track cumulative spend per wallet
- Tier-based pricing (20% → 15% → 10%)
- Automatic tier calculation

### Refund Flow

Handle refunds for failed executions:
- Manual refund trigger by admin
- Refund to original payer address
- Requires wallet integration for sending

---

## Implementation Priority

| Phase | Priority | Effort | Impact | Status |
|-------|----------|--------|--------|--------|
| Phase 2: Webhooks | High | Low | Enables async tool usage | ✅ Done |
| Phase 2.1: Progress Webhooks | Low | Low | Real-time progress via HTTP | Planned |
| Phase 3: Frontend | High | Medium | Opens to web users | Planned |
| Phase 4: Spells | Medium | High | Premium feature | Planned |
| Phase 5: Analytics | Medium | Medium | Business visibility | Planned |
| Phase 6: Advanced | Low | High | Future differentiation | Planned |

---

## Technical Debt

### Current

- [ ] Clean up debug `console.log` statements in middleware
- [ ] Add request validation (Zod/Joi schemas)
- [ ] Add rate limiting for quote endpoint
- [ ] Add metrics/monitoring integration

### Before Production

- [ ] Security audit of payment flow
- [ ] Load testing with concurrent payments
- [ ] Error handling edge cases
- [ ] Retry logic for settlement failures
- [ ] Alerting for settlement failures
