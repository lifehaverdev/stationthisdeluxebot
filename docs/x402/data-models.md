# x402 Data Models

## Overview

x402 payments create records in two collections:

1. **x402_payment_log** - Payment audit trail (dedicated x402 collection)
2. **generationOutputs** - Generation records (shared with regular generations)

## x402_payment_log Collection

Tracks the complete lifecycle of each x402 payment.

### Schema

```javascript
{
  // Unique identifier (hash of payment signature)
  signature_hash: "6b5caf2d730c33b69ef78ea594f1aacb1662650054f9a5bb80908443cdbf5e49",

  // Payer information
  payer: "0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6",  // Wallet address (lowercase)

  // Payment details
  amount: "12000",                                       // Atomic units (USDC has 6 decimals)
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // USDC contract address
  network: "eip155:8453",                               // CAIP-2 network ID
  pay_to: "0x428Bea9Fd786659c84b0bD62D372bb4a482aF653", // Receiver address

  // Settlement (populated after successful settlement)
  tx_hash: "0x73ca7f5ff04a7d32deb4f52c3b72cb7b7c130f1be35d70475173bb35684ddc0f",

  // Execution context
  tool_id: "chatgpt-free",
  generation_id: "69821ce536d6148ae2b1a9cc",            // Link to generationOutputs
  spell_id: null,                                       // If part of a spell

  // Cost tracking
  cost_usd: 0.012,                                      // Expected cost
  paid_usd: 0.012,                                      // Actual payment amount

  // Status lifecycle
  status: "SETTLED",                                    // VERIFIED | SETTLED | FAILED
  failure_reason: null,                                 // If FAILED

  // Timestamps
  verified_at: ISODate("2026-02-03T16:05:55.000Z"),
  settled_at: ISODate("2026-02-03T16:05:58.000Z"),
  failed_at: null,
  created_at: ISODate("2026-02-03T16:05:55.000Z")
}
```

### Status Values

| Status | Description |
|--------|-------------|
| `VERIFIED` | Payment signature verified, execution allowed |
| `SETTLED` | Execution succeeded, USDC transferred on-chain |
| `FAILED` | Execution failed or settlement failed |

### Indexes

```javascript
// Unique constraint for replay protection
{ signature_hash: 1 }, { unique: true }

// Query by payer address
{ payer: 1 }

// Query by settlement transaction
{ tx_hash: 1 }, { sparse: true }

// Status + time queries
{ status: 1, created_at: -1 }

// Time-based analytics
{ created_at: -1 }
{ settled_at: -1 }, { sparse: true }
```

### Example Queries

```javascript
// Find payment by signature
db.x402_payment_log.findOne({ signature_hash: "6b5caf2d..." })

// Get payer history
db.x402_payment_log.find({ payer: "0x1821BD18..." })
  .sort({ created_at: -1 })
  .limit(50)

// Revenue by day
db.x402_payment_log.aggregate([
  { $match: { status: "SETTLED", settled_at: { $gte: startDate } } },
  { $group: {
    _id: { $dateToString: { format: "%Y-%m-%d", date: "$settled_at" } },
    count: { $sum: 1 },
    total_usd: { $sum: "$paid_usd" }
  }},
  { $sort: { _id: 1 } }
])

// Top payers
db.x402_payment_log.aggregate([
  { $match: { status: "SETTLED" } },
  { $group: {
    _id: "$payer",
    count: { $sum: 1 },
    total_usd: { $sum: "$paid_usd" }
  }},
  { $sort: { total_usd: -1 } },
  { $limit: 10 }
])
```

## generationOutputs Collection (x402 Records)

x402 generations are stored in the same collection as regular generations, with some differences.

### Schema (x402-specific fields)

```javascript
{
  _id: ObjectId("69821ce536d6148ae2b1a9cc"),

  // Synthetic ID format for x402 (string, not ObjectId)
  masterAccountId: "x402:0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6",

  // Standard generation fields
  serviceName: "openai",
  toolId: "chatgpt-free",
  toolDisplayName: "ChatGPT",

  requestPayload: {
    prompt: "Hello, world!"
  },

  responsePayload: [{
    type: "text",
    data: {
      text: ["Hello! How can I assist you today?"]
    }
  }],

  status: "completed",              // pending | processing | completed | failed
  deliveryStatus: "dropped",        // No notifier for x402 platform yet

  // x402-specific: No points used
  pointsSpent: 0,
  protocolNetPoints: 0,
  costUsd: 0.000023,               // Actual provider cost

  // Notification routing
  notificationPlatform: "x402",     // Or "webhook" if webhook delivery

  // x402 metadata
  metadata: {
    x402: true,                     // Flag for x402 execution
    payer: "0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6",
    signatureHash: "6b5caf2d730c33b6...",
    // ... other tool metadata
  },

  // Timestamps
  requestTimestamp: ISODate("2026-02-03T16:05:55.000Z"),
  responseTimestamp: ISODate("2026-02-03T16:05:57.000Z")
}
```

### Key Differences from Regular Generations

| Field | Regular | x402 |
|-------|---------|------|
| masterAccountId | ObjectId | String `"x402:0x..."` |
| pointsSpent | > 0 | 0 |
| notificationPlatform | telegram, web, discord | x402, webhook |
| metadata.x402 | undefined | true |
| metadata.payer | undefined | wallet address |

### Example Queries

```javascript
// Find all x402 generations
db.generationOutputs.find({ "metadata.x402": true })
  .sort({ requestTimestamp: -1 })

// Find generations by payer
db.generationOutputs.find({
  "metadata.payer": "0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6"
})

// Count x402 vs regular generations
db.generationOutputs.aggregate([
  { $group: {
    _id: { $cond: [{ $eq: ["$metadata.x402", true] }, "x402", "regular"] },
    count: { $sum: 1 }
  }}
])
```

## Linking Records

Payment log records link to generation records:

```javascript
// From payment log, get generation
const payment = db.x402_payment_log.findOne({ signature_hash: "..." })
const generation = db.generationOutputs.findOne({ _id: ObjectId(payment.generation_id) })

// From generation, find payment
const generation = db.generationOutputs.findOne({ _id: ObjectId("...") })
const payment = db.x402_payment_log.findOne({
  signature_hash: generation.metadata.signatureHash
})
```

## Data Retention

Consider implementing retention policies:

```javascript
// Archive old settled payments (keep summary)
db.x402_payment_log.deleteMany({
  status: "SETTLED",
  settled_at: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }  // 90 days
})

// Keep failed payments longer for debugging
db.x402_payment_log.deleteMany({
  status: "FAILED",
  created_at: { $lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }  // 1 year
})
```

## Analytics Views

### Daily Revenue Summary

```javascript
db.createView("x402_daily_revenue", "x402_payment_log", [
  { $match: { status: "SETTLED" } },
  { $group: {
    _id: { $dateToString: { format: "%Y-%m-%d", date: "$settled_at" } },
    payments: { $sum: 1 },
    revenue_usd: { $sum: "$paid_usd" },
    unique_payers: { $addToSet: "$payer" }
  }},
  { $addFields: {
    unique_payer_count: { $size: "$unique_payers" }
  }},
  { $project: { unique_payers: 0 } },
  { $sort: { _id: -1 } }
])
```

### Tool Usage Summary

```javascript
db.createView("x402_tool_usage", "x402_payment_log", [
  { $match: { status: "SETTLED" } },
  { $group: {
    _id: "$tool_id",
    payments: { $sum: 1 },
    revenue_usd: { $sum: "$paid_usd" },
    avg_payment: { $avg: "$paid_usd" }
  }},
  { $sort: { revenue_usd: -1 } }
])
```
