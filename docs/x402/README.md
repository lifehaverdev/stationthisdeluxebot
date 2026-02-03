# x402 Payment Protocol Integration

> **Status**: Production-ready on Base Mainnet
> **First Settlement**: February 3, 2026
> **Transaction**: [0x73ca7f5ff04a7d32deb4f52c3b72cb7b7c130f1be35d70475173bb35684ddc0f](https://basescan.org/tx/0x73ca7f5ff04a7d32deb4f52c3b72cb7b7c130f1be35d70475173bb35684ddc0f)

## Overview

x402 is Coinbase's HTTP 402 payment protocol that enables instant stablecoin micropayments for API access. This integration allows users to pay for tool executions directly with USDC on Base, without needing an account or prepaid points.

### Key Benefits

- **No Account Required**: Payment IS authentication
- **Gasless for Users**: CDP Facilitator handles gas fees
- **Instant Settlement**: USDC transfers on-chain after successful execution
- **Pay-Per-Request**: Only pay for what you use
- **Atomic Execution**: If execution fails, payment is not settled

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System design, flow diagrams, component overview |
| [API Reference](./api-reference.md) | Endpoints, request/response formats, headers |
| [Configuration](./configuration.md) | Environment variables, setup instructions |
| [Data Models](./data-models.md) | Database schemas, what's stored |
| [Testing](./testing.md) | Test script usage, local development |
| [Troubleshooting](./troubleshooting.md) | Common errors and solutions |
| [Roadmap](./roadmap.md) | Future enhancements |

## Quick Start

### 1. Environment Setup

```bash
# Required in .env
X402_ENABLED=true
X402_RECEIVER_ADDRESS=0x428Bea9Fd786659c84b0bD62D372bb4a482aF653
X402_NETWORK=eip155:8453
CDP_API_KEY_ID=your-cdp-key-id
CDP_API_KEY_SECRET=your-cdp-key-secret
```

### 2. Get a Quote

```bash
curl http://localhost:4000/api/v1/x402/quote?toolId=chatgpt-free
```

```json
{
  "toolId": "chatgpt-free",
  "baseCostUsd": 0.01,
  "totalCostUsd": 0.012,
  "totalCostAtomic": "12000",
  "currency": "USDC",
  "network": "eip155:8453"
}
```

### 3. Request Without Payment → 402

```bash
curl -X POST http://localhost:4000/api/v1/x402/generate \
  -H "Content-Type: application/json" \
  -d '{"toolId": "chatgpt-free", "inputs": {"prompt": "hello"}}'
```

Returns `402 Payment Required` with `X-PAYMENT-REQUIRED` header containing payment instructions.

### 4. Request With Payment → Execute + Settle

```bash
curl -X POST http://localhost:4000/api/v1/x402/generate \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <base64-encoded-payment>" \
  -d '{"toolId": "chatgpt-free", "inputs": {"prompt": "hello"}}'
```

Returns `200 OK` with generation result and settlement info.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           x402 Payment Flow                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  Client                    NOEMA Server              CDP Facilitator       Base
    │                            │                          │                 │
    │  1. POST /generate         │                          │                 │
    │  (no payment)              │                          │                 │
    │ ─────────────────────────► │                          │                 │
    │                            │                          │                 │
    │  2. 402 + PaymentRequired  │                          │                 │
    │ ◄───────────────────────── │                          │                 │
    │                            │                          │                 │
    │  3. Sign EIP-3009 auth     │                          │                 │
    │  (transferWithAuth)        │                          │                 │
    │                            │                          │                 │
    │  4. POST /generate         │                          │                 │
    │  + X-PAYMENT header        │                          │                 │
    │ ─────────────────────────► │                          │                 │
    │                            │                          │                 │
    │                            │  5. Verify payment       │                 │
    │                            │ ──────────────────────►  │                 │
    │                            │                          │                 │
    │                            │  6. Valid ✓              │                 │
    │                            │ ◄──────────────────────  │                 │
    │                            │                          │                 │
    │                            │  7. Execute tool         │                 │
    │                            │  (ChatGPT, etc.)         │                 │
    │                            │                          │                 │
    │                            │  8. Settle payment       │                 │
    │                            │ ──────────────────────►  │                 │
    │                            │                          │                 │
    │                            │                          │  9. Transfer    │
    │                            │                          │  USDC on-chain  │
    │                            │                          │ ───────────────►│
    │                            │                          │                 │
    │                            │  10. tx_hash             │                 │
    │                            │ ◄──────────────────────  │                 │
    │                            │                          │                 │
    │  11. 200 + result          │                          │                 │
    │  + X-PAYMENT-RESPONSE      │                          │                 │
    │ ◄───────────────────────── │                          │                 │
    │                            │                          │                 │
```

## Key Concepts

### EIP-3009 (transferWithAuthorization)

USDC implements EIP-3009, allowing gasless transfers via signed authorization. The payer signs a message authorizing a transfer, and the facilitator submits the transaction on-chain.

### CDP Facilitator

Coinbase Developer Platform provides a facilitator service that:
- Verifies payment signatures
- Settles payments on-chain
- Handles gas fees for the payer

### Payment Lifecycle

1. **VERIFIED**: Payment signature validated, execution allowed
2. **SETTLED**: Execution succeeded, USDC transferred on-chain
3. **FAILED**: Execution failed, payment NOT charged

## File Structure

```
src/
├── platforms/web/middleware/
│   └── x402.js                    # Payment verification middleware
├── api/external/x402/
│   └── x402GenerationApi.js       # API endpoints
├── core/services/x402/
│   ├── index.js                   # Service exports
│   ├── X402ExecutionService.js    # Execution & settlement logic
│   └── X402PricingService.js      # Cost calculation
└── core/services/db/
    └── x402PaymentLogDb.js        # Payment audit trail
```

## Dependencies

```json
{
  "@coinbase/x402": "^2.1.0",       // CDP facilitator client
  "@x402/core": "^2.2.0",           // x402 protocol primitives
  "@x402/evm": "^2.2.0",            // EVM payment helpers
  "@x402/express": "^2.2.0"         // Express middleware (optional)
}
```
