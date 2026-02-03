# x402 Troubleshooting

## Common Errors

### Unauthorized (401/403)

**Error**:
```
Unexpected token 'U', "Unauthorized\n" is not valid JSON
```

**Cause**: CDP Facilitator authentication failed.

**Solutions**:
1. Verify CDP credentials are set:
   ```bash
   echo $CDP_API_KEY_ID
   echo $CDP_API_KEY_SECRET | head -c 20
   ```

2. Check environment variable names (must be exact):
   ```bash
   CDP_API_KEY_ID=organizations/xxx/apiKeys/xxx
   CDP_API_KEY_SECRET=base64string==
   ```

3. Ensure dotenv is loaded before x402 middleware:
   ```javascript
   // app.js - must be first line
   require('dotenv').config();
   ```

4. Restart server after changing .env

---

### Invalid Payload

**Error**:
```
VerifyError: verification failed: invalid_payload
```

**Causes**:
1. **Self-payment**: `from` and `to` addresses are the same
2. **Wrong receiver**: `payTo` doesn't match server's configured receiver
3. **Wrong network**: Payment signed for different network than server expects
4. **Expired**: Payment's `validBefore` timestamp has passed

**Solutions**:
1. Use different wallet for testing (payer ≠ receiver)
2. Verify `X402_RECEIVER_ADDRESS` matches client expectations
3. Verify `X402_NETWORK` matches (eip155:8453 for Base mainnet)
4. Increase `maxTimeoutSeconds` or sign payment closer to execution

---

### Credit Check Failed

**Error**:
```json
{
  "error": {
    "code": "CREDIT_CHECK_FAILED",
    "message": "Could not verify your available points."
  }
}
```

**Cause**: Internal execution API is doing credit check instead of bypassing for x402.

**Solution**: Ensure the user object includes `isX402: true`:

```javascript
// x402GenerationApi.js
const payload = {
  user: {
    masterAccountId: `x402:${x402.payer}`,
    isX402: true,  // ← This flag must be present
    payerAddress: x402.payer
  }
};
```

And the execution API checks for it:

```javascript
// generationExecutionApi.js
const isX402Execution = user.isX402 === true;
if (isX402Execution) {
  // Skip credit check
}
```

---

### Invalid masterAccountId Format

**Error**:
```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Invalid masterAccountId format. Must be a valid MongoDB ObjectId string.",
    "details": { "value": "x402:0x1821BD18..." }
  }
}
```

**Cause**: Internal API is treating x402 synthetic ID as ObjectId.

**Solution**: Use the `toMasterAccountId` helper:

```javascript
// generationExecutionApi.js
function toMasterAccountId(id, isX402 = false) {
  if (isX402) return id;  // Keep as string
  return new ObjectId(id);
}

// Usage
masterAccountId: toMasterAccountId(masterAccountId, isX402Execution)
```

---

### No Facilitator for Network

**Error**:
```
No facilitator registered for scheme: exact and network: eip155:8453
```

**Cause**: Using wrong facilitator for the network.

**Solutions**:
1. For Base mainnet, use CDP Facilitator (`@coinbase/x402`)
2. For Sepolia, may need x402.org facilitator (limited support)

```javascript
// Use CDP facilitator
const { createFacilitatorConfig } = require('@coinbase/x402');
const cdpFacilitator = createFacilitatorConfig(apiKeyId, apiKeySecret);
```

---

### Payment Already Used

**Error**:
```json
{
  "error": "PAYMENT_ALREADY_USED",
  "message": "This payment signature has already been used"
}
```

**Cause**: Replay protection - same payment signature submitted twice.

**Solution**: Generate new payment signature for each request. The nonce ensures uniqueness.

---

### Insufficient Payment

**Error**:
```json
{
  "error": "INSUFFICIENT_PAYMENT",
  "message": "Payment of $0.01 is less than required $0.012",
  "required": 0.012,
  "provided": 0.01
}
```

**Cause**: Payment amount is less than quoted price.

**Solutions**:
1. Fetch fresh quote before signing payment
2. Ensure client uses the exact `amount` from 402 response
3. Account for any price changes between quote and execution

---

### Settlement Failed

**Error**:
```json
{
  "x402": {
    "settled": false,
    "settlementError": "insufficient_balance"
  }
}
```

**Cause**: Settlement failed after successful execution.

**Possible Causes**:
1. Payer's USDC balance decreased between verify and settle
2. Payer revoked allowance
3. Network congestion / timeout

**Note**: Execution still succeeded - this is a payment collection issue, not an execution issue.

---

## Debugging Steps

### 1. Enable Debug Logging

The middleware logs detailed information:

```javascript
logger.debug('[x402] Payment header decoded', { ... });
console.log('[x402] Verifying with facilitator:');
console.log('paymentPayload:', JSON.stringify(paymentPayload, null, 2));
```

Check server output for these logs.

### 2. Verify Environment

```bash
# Check all x402 env vars
env | grep -E "(X402|CDP)"
```

Expected:
```
X402_ENABLED=true
X402_RECEIVER_ADDRESS=0x...
X402_NETWORK=eip155:8453
CDP_API_KEY_ID=organizations/...
CDP_API_KEY_SECRET=...==
```

### 3. Test Facilitator Directly

```bash
# Test CDP facilitator endpoint
curl -X GET https://api.cdp.coinbase.com/platform/v2/x402/supported \
  -H "Authorization: Bearer YOUR_JWT"
```

### 4. Check Database State

```javascript
// Check recent payments
db.x402_payment_log.find().sort({created_at:-1}).limit(5)

// Check for VERIFIED but not SETTLED
db.x402_payment_log.find({status:"VERIFIED"})

// Check for FAILED with reasons
db.x402_payment_log.find({status:"FAILED"})
```

### 5. Verify On-Chain

For settled payments, verify the transaction:
- https://basescan.org/tx/YOUR_TX_HASH
- Check sender, receiver, amount, token

### 6. Check Wallet Balance

```bash
# Using cast (foundry)
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  "balanceOf(address)(uint256)" \
  0xYOUR_WALLET_ADDRESS \
  --rpc-url https://mainnet.base.org
```

---

## Server Startup Checklist

Verify these log messages on startup:

```
✓ [x402] CDP credentials found, key ID: organiza...
✓ [x402] CDP Facilitator URL: https://api.cdp.coinbase.com/platform/v2/x402
✓ [x402] Middleware initialized { receiverAddress, network, facilitator }
✓ [X402PaymentLogDB] Indexes ensured
✓ External x402 Generation API router mounted at /x402
```

If any are missing, check:
1. Environment variables loaded
2. Database connection working
3. Dependencies injected correctly

---

## Getting Help

1. **Check Logs**: Server logs contain detailed error information
2. **Verify On-Chain**: Use BaseScan to verify transactions
3. **CDP Status**: Check [Coinbase Status](https://status.coinbase.com/) for facilitator issues
4. **x402 Spec**: Reference https://www.x402.org/ for protocol details
