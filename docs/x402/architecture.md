# x402 Architecture

## System Overview

The x402 integration consists of four main components:

1. **Middleware** (`x402.js`) - Intercepts requests, verifies payments
2. **API Router** (`x402GenerationApi.js`) - Handles endpoints, orchestrates flow
3. **Execution Service** (`X402ExecutionService.js`) - Validates, records, settles
4. **Pricing Service** (`X402PricingService.js`) - Calculates costs

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              External Request                                 │
│                         POST /api/v1/x402/generate                           │
│                         + X-PAYMENT header (optional)                         │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           x402 Middleware                                     │
│                     src/platforms/web/middleware/x402.js                      │
├──────────────────────────────────────────────────────────────────────────────┤
│  • Check for X-PAYMENT header                                                 │
│  • Decode payment payload (base64 → JSON)                                     │
│  • Verify with CDP Facilitator                                                │
│  • Attach req.x402 = { verified, payer, amount, ... }                        │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        x402 Generation API                                    │
│                   src/api/external/x402/x402GenerationApi.js                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  Endpoints:                                                                   │
│  • GET  /quote          - Get cost estimate                                   │
│  • GET  /tools          - List available tools with pricing                   │
│  • POST /generate       - Execute with payment                                │
│  • GET  /status/:id     - Poll generation status                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  POST /generate Flow:                                                         │
│  1. Check req.x402.verified                                                   │
│  2. If not verified → 402 + PaymentRequired                                   │
│  3. If verified:                                                              │
│     a. Validate payment covers cost                                           │
│     b. Check for replay (signature_hash)                                      │
│     c. Record payment as VERIFIED                                             │
│     d. Execute via Internal API                                               │
│     e. On success: Settle payment → SETTLED                                   │
│     f. On failure: Mark payment → FAILED                                      │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│   X402PricingService    │  │  X402ExecutionService   │  │    Internal API         │
│                         │  │                         │  │                         │
│ • calculateToolCost()   │  │ • validatePayment()     │  │ POST /execute           │
│ • generatePaymentReq()  │  │ • recordPaymentVerified │  │                         │
│ • lookupCostTable()     │  │ • settlePayment()       │  │ • Skip credit check     │
│                         │  │                         │  │   for isX402=true       │
│ Uses: ToolRegistry      │  │ Uses: x402PaymentLogDb  │  │ • Create generation     │
│       costingModel      │  │       HTTPFacilitator   │  │ • Execute tool          │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

## Middleware Flow

```javascript
// src/platforms/web/middleware/x402.js

async function x402PaymentMiddleware(req, res, next) {
  // 1. Skip if x402 disabled
  if (process.env.X402_ENABLED !== 'true') {
    req.x402 = null;
    return next();
  }

  // 2. Check for payment header
  const paymentHeader = req.headers['x-payment'];
  if (!paymentHeader) {
    req.x402 = null;
    return next();
  }

  // 3. Decode payment payload
  const paymentPayload = decodePaymentSignatureHeader(paymentHeader);

  // 4. Verify with CDP Facilitator
  const verifyResult = await facilitatorClient.verify(paymentPayload, requirements);

  // 5. Attach to request
  req.x402 = {
    verified: verifyResult.isValid,
    payer: verifyResult.payer,
    amount: requirements.amount,
    payload: paymentPayload,
    _facilitatorClient: facilitatorClient  // For settlement
  };

  next();
}
```

## Pricing Model

The `X402PricingService` calculates costs based on tool configuration:

```javascript
// Tool costing models supported:
{
  rateSource: 'static',   // Fixed price per request
  rateSource: 'api',      // Price from cost table (DALL-E)
  rateSource: 'machine'   // Price per second (ComfyUI)
}

// Platform markup applied
const PLATFORM_MARKUP = 0.20;  // 20%
const MINIMUM_CHARGE_USD = 0.01;

// Conversion to USDC atomic units (6 decimals)
totalCostAtomic = Math.ceil(totalCostUsd * 1_000_000).toString();
```

### Cost Table Example (DALL-E)

```javascript
costTable: {
  'dall-e-3': {
    '1024x1024': { standard: 0.04, hd: 0.08 },
    '1792x1024': { standard: 0.08, hd: 0.12 },
    '1024x1792': { standard: 0.08, hd: 0.12 }
  },
  'dall-e-2': {
    '256x256': 0.016,
    '512x512': 0.018,
    '1024x1024': 0.020
  }
}
```

## Payment Required Response

When no valid payment is provided:

```http
HTTP/1.1 402 Payment Required
X-PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi4uLg==

{
  "error": "PAYMENT_REQUIRED",
  "message": "Payment required to execute this tool",
  "paymentRequired": {
    "x402Version": 2,
    "resource": {
      "url": "http://localhost:4000/api/v1/x402/generate",
      "description": "ChatGPT execution",
      "mimeType": "application/json"
    },
    "accepts": [{
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "12000",
      "payTo": "0x428Bea9Fd786659c84b0bD62D372bb4a482aF653",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USD Coin",
        "version": "2"
      }
    }]
  }
}
```

## Settlement Flow

```javascript
// After successful execution in x402GenerationApi.js

// 1. Execute the tool
const executionResult = await internalApiClient.post('/internal/v1/data/execute', payload);

// 2. Settle the payment
const settlement = await x402ExecutionService.settlePayment(x402, signatureHash);

// Settlement calls CDP Facilitator
const settleResult = await facilitatorClient.settle(payload, requirements);

// Returns:
{
  success: true,
  transaction: "0x73ca7f5ff04a7d32...",  // On-chain tx hash
  network: "eip155:8453",
  payer: "0x1821BD18..."
}
```

## Internal API Integration

The execution API (`generationExecutionApi.js`) handles x402 requests specially:

```javascript
// Detect x402 execution
const isX402Execution = user.isX402 === true;

// Skip credit check for x402
if (isX402Execution) {
  logger.info(`[Execute] x402 payment detected - skipping credit check`);
  // No user lookup, no points check
}

// Store with synthetic masterAccountId
const generationParams = {
  masterAccountId: toMasterAccountId(masterAccountId, isX402Execution),
  // For x402: stores as string "x402:0x1821BD18..."
  // For regular: stores as ObjectId

  pointsSpent: isX402Execution ? 0 : pointsRequired,
  // x402 pays in USDC, not points
};
```

## Security Considerations

### Replay Protection

Each payment signature can only be used once:

```javascript
// Before execution
const isUsed = await x402PaymentLogDb.isSignatureUsed(signatureHash);
if (isUsed) {
  return { valid: false, errorCode: 'PAYMENT_ALREADY_USED' };
}

// Record immediately after verification
await x402PaymentLogDb.recordVerified({ signatureHash, ... });
```

### Atomic Execution

Payment is only settled AFTER successful execution:

```javascript
try {
  // Execute first
  const result = await execute(tool, inputs);

  // Only settle on success
  await settlePayment(x402, signatureHash);

} catch (error) {
  // Execution failed - mark payment as failed, don't settle
  await x402PaymentLogDb.recordFailed(signatureHash, error.message);
  // User keeps their USDC
}
```

### Signature Verification

The CDP Facilitator verifies:
- EIP-712 typed data signature is valid
- Signer matches `from` address
- Amount matches requirements
- Token/network match
- Nonce hasn't been used
- Timestamps are valid
