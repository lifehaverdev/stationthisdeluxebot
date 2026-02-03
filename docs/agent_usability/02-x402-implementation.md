# x402 Payment Protocol Implementation

**Status:** Planning
**Phase:** 2 of 4
**Created:** 2026-02-02
**Depends On:** Claude Skill (Phase 1) - for documented API endpoints

---

## Executive Summary

x402 is an open payment protocol by Coinbase that enables instant stablecoin micropayments via HTTP 402 responses. Integrating x402 gives NOEMA a second payment rail that:

- Enables anonymous/guest usage without account creation
- Supports AI agents with their own wallets
- Provides real-time pay-per-request instead of prepaid credits
- Opens access to the growing x402 ecosystem (15M+ transactions)

This document outlines the implementation strategy for adding x402 to NOEMA alongside the existing points/credits system.

---

## Protocol Overview

### How x402 Works

```
1. Client → Request protected resource
2. Server → 402 Payment Required + PaymentRequirements header
3. Client → Signs payment, resends with PAYMENT-SIGNATURE header
4. Server → Verifies via facilitator
5. Server → Fulfills request
```

### Key Components

| Component | Description |
|-----------|-------------|
| **PaymentRequirements** | JSON describing price, network, receiver address |
| **PAYMENT-SIGNATURE** | Client's signed payment authorization |
| **Facilitator** | Third-party that verifies and settles payments |

### Supported Networks

| Network | Asset | Status |
|---------|-------|--------|
| Base (mainnet) | USDC | Recommended |
| Base Sepolia | USDC | Testing |
| Ethereum | USDC | Supported |
| Solana | USDC | Supported |

---

## Current NOEMA Payment Architecture

### Existing System

```
User Balance (Points)
    ↓
chargeSpellExecution() deducts from creditLedger
    ↓
Creator share → Referral vault (70%)
    ↓
Generation executes
```

**Key files:**
- `src/core/services/alchemy/creditService.js` - Main payment facade
- `src/core/services/SpellsService.js` - Where charges happen (line 127-150)
- `src/api/internal/costCalculationApi.js` - Quote generation
- `src/platforms/web/middleware/auth.js` - Auth pattern to follow

### Conversion Rate

```javascript
// src/core/constants/economy.js
1 point = $0.000337 USD
```

---

## Integration Strategy

### Design Principle: Base-Native Onramp to Existing System

x402 is NOT a separate payment rail. It's a **Base chain entry point** into the same credit system:

```
                ETHEREUM MAINNET                              BASE
                ================                              ====

        User deposits ETH/USDC                      x402 User pays USDC
                  ↓                                         ↓
        Foundation Contract                     Foundation Contract
        (0xABC...original)                      (0xABC...same via CreateX)
                  ↓                                         ↓
        Alchemy webhook                            x402 verification
                  ↓                                         ↓
                  └─────────────────┬────────────────────────┘
                                    ↓
                            creditLedgerDb
                            (unified ledger)
                                    ↓
                          master_account_id
                                    ↓
                          points_remaining
                                    ↓
                      chargeSpellExecution()
```

### Key Design Principle: Payment IS Authentication

x402 payments are **self-contained one-time auth tokens**. No account required for one-off usage.

```
┌─────────────────────────────────────────────────────────┐
│                   Authentication Modes                   │
├─────────────────┬───────────────┬───────────────────────┤
│ API Key         │ CSRF + JWT    │ x402 Payment          │
│ (programmatic)  │ (web session) │ (one-off agent)       │
├─────────────────┼───────────────┼───────────────────────┤
│ Persistent      │ Session       │ Single request        │
│ Account required│ Account req.  │ NO account required   │
└─────────────────┴───────────────┴───────────────────────┘
```

### Two Modes of x402 Usage

**Mode A: One-Off (Default)**
```
Agent sends request + x402 payment signature
              ↓
Payment verified by facilitator
              ↓
Execute generation
              ↓
Return result
              ↓
Done. No account. No state. Payment was the auth.
```

**Mode B: Upgrade to Full User (Optional)**
```
x402 user wants: API key, create spells, earn creator rewards
              ↓
Initiate magic USDC amount linking
              ↓
Send specific amount from their wallet
              ↓
Wallet ownership verified
              ↓
Account created + API key issued
              ↓
Now a bonafide user with full access
```

### Creator Rewards (For Bonafide Users Only)

| Reward Type | Rate | Eligibility |
|-------------|------|-------------|
| Model used in generation | Up to 5% additional | Account holder |
| Spell used | Up to 15% additional | Account holder |
| Combined max | 20% additional on execution | Account holder |

x402 one-off users don't earn creator rewards (no account to credit).
x402 users who upgrade via magic linking DO earn creator rewards.

---

## Implementation Plan

### Phase 2.0: Foundation Contract on Base (Prerequisites)

Before implementing x402, deploy Foundation Contract to Base:

**CreateX Deployment:**
```solidity
// Deploy to Base with identical address as mainnet
// Using CreateX deterministic deployment

// 1. Get current Foundation bytecode
// 2. Compute CREATE2 salt that produces same address
// 3. Deploy via CreateX on Base mainnet/sepolia
```

**Base Foundation Configuration:**
```bash
# .env additions for Base Foundation
FOUNDATION_ADDRESS_BASE=0x...        # Same as mainnet via CreateX
FOUNDATION_ABI_BASE=...              # Same ABI
BASE_RPC_URL=https://mainnet.base.org
BASE_ALCHEMY_WEBHOOK_ID=...          # For deposit events on Base
```

**Required Contract Work:**
- [ ] Verify Foundation contract compiles for Base
- [ ] Test CreateX deployment on Base Sepolia
- [ ] Deploy to Base mainnet with matching address
- [ ] Configure Alchemy webhooks for Base Foundation events
- [ ] Update `EthereumService` to support multi-chain

---

### Phase 2.1: Dependencies & Setup

**Install x402 packages:**
```bash
npm install @x402/core @x402/evm @x402/express
```

**Environment variables:**
```bash
# .env additions
X402_ENABLED=true
X402_NETWORK=base                    # or base-sepolia for testing
X402_FACILITATOR_URL=https://x402.org/facilitator

# Foundation on Base (same address as mainnet via CreateX)
FOUNDATION_ADDRESS_BASE=0x...        # Same as FOUNDATION_ADDRESS
BASE_RPC_URL=https://mainnet.base.org
BASE_ALCHEMY_API_KEY=...
```

**Files to create:**
```
src/
├── platforms/web/middleware/
│   └── x402Payment.js              # NEW: x402 middleware
├── core/services/
│   ├── x402/
│   │   ├── x402Service.js          # NEW: Payment verification
│   │   ├── x402AccountService.js   # NEW: Account creation/linking
│   │   └── x402DepositService.js   # NEW: Credit ledger integration
│   └── alchemy/
│       └── baseEthereumService.js  # NEW: Base chain provider
└── core/services/db/
    └── (reuse creditLedgerDb with source_chain field)
```

---

### Phase 2.2: x402 Middleware

**File:** `src/platforms/web/middleware/x402Payment.js`

```javascript
const { verifyPayment } = require('@x402/core');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('x402Middleware');

/**
 * x402 Payment Middleware
 *
 * Checks for x402 payment proof and validates it.
 * Sets req.x402 with payment details if valid.
 */
function createX402Middleware(config) {
  const { receiverAddress, network, facilitatorUrl } = config;

  return async function x402PaymentMiddleware(req, res, next) {
    // Check if x402 is enabled
    if (!process.env.X402_ENABLED) {
      return next();
    }

    // Check for payment signature header
    const paymentSignature = req.headers['x-payment-signature'] ||
                             req.headers['payment-signature'];

    if (!paymentSignature) {
      // No x402 payment - continue to normal auth flow
      req.x402 = null;
      return next();
    }

    try {
      // Verify the payment with facilitator
      const verification = await verifyPayment({
        paymentSignature,
        facilitatorUrl,
        expectedReceiver: receiverAddress,
        expectedNetwork: network
      });

      if (verification.valid) {
        req.x402 = {
          paid: true,
          amount: verification.amount,
          amountUsd: verification.amountUsd,
          payer: verification.payer,
          signature: paymentSignature,
          network: verification.network,
          txHash: verification.txHash,
          timestamp: Date.now()
        };

        logger.info('x402 payment verified', {
          payer: verification.payer,
          amount: verification.amountUsd,
          network: verification.network
        });
      } else {
        req.x402 = { paid: false, error: verification.error };
        logger.warn('x402 payment invalid', { error: verification.error });
      }
    } catch (error) {
      logger.error('x402 verification failed', { error: error.message });
      req.x402 = { paid: false, error: error.message };
    }

    next();
  };
}

module.exports = { createX402Middleware };
```

---

### Phase 2.3: x402 One-Off Execution Service

For one-off payments, no account creation. Payment is the auth.

**File:** `src/core/services/x402/x402ExecutionService.js`

```javascript
class X402ExecutionService {
  constructor(services, logger) {
    this.x402PaymentLog = services.x402PaymentLog;
    this.logger = logger;
  }

  /**
   * Validate x402 payment covers the required cost
   * No account creation - payment IS the authorization
   */
  async validatePaymentForExecution(x402Payment, requiredCostUsd) {
    const { amountUsd, signature, txHash } = x402Payment;

    // 1. Check payment covers cost
    if (amountUsd < requiredCostUsd) {
      return {
        valid: false,
        error: 'INSUFFICIENT_PAYMENT',
        required: requiredCostUsd,
        provided: amountUsd
      };
    }

    // 2. Check for replay (same signature used twice)
    const alreadyUsed = await this.x402PaymentLog.findBySignature(signature);
    if (alreadyUsed) {
      return {
        valid: false,
        error: 'PAYMENT_ALREADY_USED',
        signature
      };
    }

    return { valid: true };
  }

  /**
   * Log x402 payment after successful execution
   * This is for audit/replay protection, NOT account management
   */
  async logPaymentUsed(x402Payment, executionDetails) {
    await this.x402PaymentLog.record({
      signature: x402Payment.signature,
      tx_hash: x402Payment.txHash,
      payer: x402Payment.payer,
      amount_usd: x402Payment.amountUsd,
      network: x402Payment.network,

      // What it was used for
      tool_id: executionDetails.toolId,
      generation_id: executionDetails.generationId,

      // Timestamps
      used_at: new Date()
    });

    this.logger.info(`[x402] Payment ${x402Payment.signature.slice(0, 16)}... used for ${executionDetails.toolId}`);
  }
}

module.exports = { X402ExecutionService };
```

---

### Phase 2.4: x402 Payment Log (Replay Protection)

Simple log for tracking used x402 payments. NOT a credit ledger.

**File:** `src/core/services/db/x402PaymentLog.js`

```javascript
const COLLECTION = 'x402_payment_log';

const x402PaymentLog = {
  async record(payment) {
    const db = await getDb();
    return db.collection(COLLECTION).insertOne(payment);
  },

  async findBySignature(signature) {
    const db = await getDb();
    return db.collection(COLLECTION).findOne({ signature });
  },

  async findByTxHash(txHash) {
    const db = await getDb();
    return db.collection(COLLECTION).findOne({ tx_hash: txHash });
  },

  // For analytics only
  async getStats(startDate, endDate) {
    const db = await getDb();
    return db.collection(COLLECTION).aggregate([
      { $match: { used_at: { $gte: startDate, $lte: endDate } } },
      { $group: {
          _id: null,
          totalUsd: { $sum: '$amount_usd' },
          count: { $sum: 1 }
      }}
    ]).toArray();
  }
};

module.exports = { x402PaymentLog };
```

---

### Phase 2.5: Upgrade Path (Magic USDC Linking)

For x402 users who WANT accounts (API keys, creator rewards).

**File:** `src/core/services/alchemy/credit/MagicAmountLinkingService.js` (extend existing)

```javascript
// Add support for USDC on Base alongside existing ETH support

async checkMagicAmount(depositorAddress, tokenAddress, amountWei, chain = 'ethereum') {
  try {
    // Support both mainnet ETH and Base USDC
    const linkingRequest = await this.walletLinkingRequestDb.findPendingRequestByAmount(
      amountWei,
      tokenAddress,
      chain  // NEW: 'ethereum' | 'base'
    );

    if (linkingRequest) {
      this.logger.info(`[MagicAmountLinking] Detected magic amount on ${chain}. Request ID: ${linkingRequest._id}`);
      await this.completeLinking(linkingRequest, depositorAddress);
      return true;
    }
    return false;
  } catch (error) {
    this.logger.error(`[MagicAmountLinking] Error:`, error);
    return false;
  }
}

// walletLinkingRequestDb needs new method:
async findPendingRequestByAmount(amount, tokenAddress, chain) {
  return this.collection.findOne({
    magic_amount: amount,
    token_address: tokenAddress,
    chain: chain,
    status: 'PENDING'
  });
}
```

This is OPTIONAL for x402 users. Only needed if they want:
- API key for repeated programmatic access
- To create spells and earn creator rewards (5-15% additional)
- Full platform features

---

### Phase 2.5: PaymentRequirements Generation

When a request arrives without payment, return 402 with requirements.

**File:** `src/core/services/x402/x402Service.js`

```javascript
const { createPaymentRequirements } = require('@x402/core');

class X402Service {
  constructor(config) {
    this.receiverAddress = config.receiverAddress;
    this.network = config.network;
    this.facilitatorUrl = config.facilitatorUrl;
  }

  /**
   * Generate PaymentRequirements for a tool execution
   */
  generateRequirements(tool, parameters) {
    // Calculate cost in USD
    const costUsd = this.calculateToolCost(tool, parameters);

    return createPaymentRequirements({
      receiver: this.receiverAddress,
      amount: costUsd,
      currency: 'USD',
      network: this.network,
      description: `NOEMA: ${tool.displayName} generation`,
      metadata: {
        toolId: tool.toolId,
        service: 'noema.art'
      }
    });
  }

  /**
   * Calculate USD cost for a tool
   * Reuses existing costing logic
   */
  calculateToolCost(tool, parameters) {
    const { costingModel } = tool;

    if (!costingModel) {
      return 0.01; // Default minimum
    }

    switch (costingModel.rateSource) {
      case 'static':
        return costingModel.staticCost?.amount || 0.01;

      case 'machine':
        // Calculate based on estimated duration
        const durationSec = tool.metadata?.avgHistoricalDurationMs / 1000 || 10;
        return costingModel.rate * durationSec;

      case 'api':
        // Use cost table lookup (e.g., DALL-E pricing)
        return this.lookupApiCost(tool, parameters);

      default:
        return 0.01;
    }
  }

  lookupApiCost(tool, parameters) {
    // Handle DALL-E style cost tables
    const costTable = tool.metadata?.costTable;
    if (!costTable) return 0.05;

    const model = parameters.model || Object.keys(costTable)[0];
    const size = parameters.size || '1024x1024';
    const quality = parameters.quality || 'standard';

    return costTable[model]?.[size]?.[quality] || 0.05;
  }
}

module.exports = { X402Service };
```

---

### Phase 2.6: Modify Generation Execution

**File:** `src/api/external/generations/generationExecutionApi.js`

Add x402 as a parallel auth method (alongside API key, CSRF, etc.):

```javascript
// In the cast endpoint handler

// Check for x402 payment
if (req.x402?.paid) {
  // Calculate required cost
  const requiredCost = x402Service.calculateToolCost(tool, parameters);

  // Validate payment covers cost
  const validation = await x402ExecutionService.validatePaymentForExecution(
    req.x402,
    requiredCost
  );

  if (!validation.valid) {
    if (validation.error === 'INSUFFICIENT_PAYMENT') {
      return res.status(402).json({
        error: 'INSUFFICIENT_PAYMENT',
        required: validation.required,
        provided: validation.provided,
        paymentRequirements: x402Service.generateRequirements(tool, parameters)
      });
    }
    if (validation.error === 'PAYMENT_ALREADY_USED') {
      return res.status(400).json({
        error: 'PAYMENT_ALREADY_USED',
        message: 'This x402 payment signature has already been used'
      });
    }
  }

  // Payment is valid - execute generation
  // NO account creation, NO chargeSpellExecution
  // The x402 payment IS the payment

  const result = await executeGeneration(tool, parameters);

  // Log payment as used (replay protection)
  await x402ExecutionService.logPaymentUsed(req.x402, {
    toolId: tool.toolId,
    generationId: result.generationId
  });

  return res.json(result);

} else if (isX402OnlyRoute(req.path)) {
  // Route requires x402 payment, none provided
  const requirements = x402Service.generateRequirements(tool, parameters);

  return res.status(402)
    .set('X-Payment-Required', Buffer.from(JSON.stringify(requirements)).toString('base64'))
    .json({
      error: 'PAYMENT_REQUIRED',
      message: 'This endpoint requires payment via x402 protocol',
      paymentRequirements: requirements
    });

} else {
  // Fall back to existing auth (API key, CSRF+JWT, etc.)
  // ... existing flow with chargeSpellExecution
}
```

**Key difference from account-based flow:**
- No `masterAccountId` needed
- No `chargeSpellExecution()` - payment already happened
- No creator rewards (no account to credit)
- Just: validate → execute → log → return

---

### Phase 2.8: Route Configuration

Define which routes require/accept x402 payment.

**File:** `src/core/config/x402Routes.js`

```javascript
/**
 * x402 Route Configuration
 *
 * Routes can be:
 * - x402Only: Requires x402 payment (no points fallback)
 * - x402Preferred: Accepts x402 or points
 * - pointsOnly: Traditional points system only
 */
const x402Routes = {
  // Generation endpoints - accept both
  '/api/v1/generation/cast': {
    mode: 'x402Preferred',
    pricing: 'dynamic' // Based on tool
  },

  '/api/v1/spells/:spellId/cast': {
    mode: 'x402Preferred',
    pricing: 'dynamic'
  },

  // Future: x402-only endpoints for anonymous access
  '/api/v1/x402/generate': {
    mode: 'x402Only',
    pricing: 'dynamic'
  }
};

function isX402ProtectedRoute(path) {
  const route = x402Routes[path];
  return route?.mode === 'x402Only';
}

function getX402RouteConfig(path) {
  return x402Routes[path] || null;
}

module.exports = { x402Routes, isX402ProtectedRoute, getX402RouteConfig };
```

---

### Phase 2.9: Unified Ledger Schema Update

Update `creditLedgerDb` to support x402 deposits. No separate collection needed.

**File:** `src/core/services/db/alchemy/creditLedgerDb.js` (modify existing)

Add new fields to deposit schema:

```javascript
// New fields for x402 support
const x402Fields = {
  // Chain discrimination
  source_chain: String,      // 'ethereum' | 'base'
  source_protocol: String,   // 'foundation' | 'x402'

  // x402 specific (only for deposit_type: 'X402_PAYMENT')
  x402_signature: String,
  x402_tx_hash: String,
  x402_network: String       // 'base' | 'base-sepolia'
};

// Add index for x402 lookups
await collection.createIndex({ x402_tx_hash: 1 }, { sparse: true, unique: true });
await collection.createIndex({ source_chain: 1, status: 1 });
```

**New query methods:**

```javascript
async findDepositsForUser(masterAccountId, filters = {}) {
  const query = { master_account_id: masterAccountId, ...filters };
  return this.collection.find(query).sort({ created_at: -1 }).toArray();
}

async findByTxHash(txHash) {
  // Works for both mainnet tx_hash and x402_tx_hash
  return this.collection.findOne({
    $or: [
      { tx_hash: txHash },
      { x402_tx_hash: txHash }
    ]
  });
}

async getRevenueByChain(startDate, endDate) {
  return this.collection.aggregate([
    {
      $match: {
        created_at: { $gte: startDate, $lte: endDate },
        status: 'CONFIRMED'
      }
    },
    {
      $group: {
        _id: '$source_chain',
        totalUsd: { $sum: '$original_amount_usd' },
        totalPoints: { $sum: '$points_credited' },
        count: { $sum: 1 }
      }
    }
  ]).toArray();
}
```

This keeps all deposits in one collection with `source_chain` discriminator for reporting.

---

### Phase 2.10: Register Middleware

**File:** `src/platforms/web/index.js`

```javascript
const { createX402Middleware } = require('./middleware/x402Payment');

// ... existing middleware ...

// Add x402 middleware after CSRF, before auth
if (process.env.X402_ENABLED === 'true') {
  const x402Middleware = createX402Middleware({
    receiverAddress: process.env.X402_RECEIVER_ADDRESS,
    network: process.env.X402_NETWORK || 'base',
    facilitatorUrl: process.env.X402_FACILITATOR_URL
  });

  app.use('/api/v1', x402Middleware);
}

// ... existing auth middleware ...
```

---

## Testing Strategy

### Phase 2.11: Test on Base Sepolia

1. **Set up test environment:**
   ```bash
   X402_ENABLED=true
   X402_NETWORK=base-sepolia
   X402_RECEIVER_ADDRESS=0xYourTestAddress
   ```

2. **Get test USDC:**
   - Use Base Sepolia faucet
   - Mint test USDC from testnet contract

3. **Test with x402 client:**
   ```javascript
   import { wrapFetch } from '@x402/fetch';
   import { createWalletClient } from 'viem';

   const x402Fetch = wrapFetch(fetch, {
     wallet: walletClient,
     network: 'base-sepolia'
   });

   const response = await x402Fetch('https://noema.art/api/v1/generation/cast', {
     method: 'POST',
     body: JSON.stringify({
       toolId: 'dall-e-3-image',
       parameters: { prompt: 'test image' }
     })
   });
   ```

4. **Verify:**
   - 402 returned without payment
   - Payment signature accepted
   - Generation executes
   - Payment logged in database

---

## Deployment Checklist

### Contract Prerequisites

- [ ] Foundation contract verified for Base compatibility
- [ ] CreateX deployment tested on Base Sepolia
- [ ] Same address achieved on Base Sepolia as mainnet

### Pre-Production (One-Off Flow)

- [ ] x402 packages installed (`@x402/core`, `@x402/evm`, `@x402/express`)
- [ ] Environment variables configured
- [ ] Foundation deployed to Base (receives x402 payments)
- [ ] x402 middleware implemented and registered
- [ ] x402 execution service implemented
- [ ] x402 payment log collection created with indexes
- [ ] Route configuration complete
- [ ] Tested one-off flow on Base Sepolia

### Production Launch

- [ ] Switch to `X402_NETWORK=base`
- [ ] Foundation contract live on Base mainnet
- [ ] Monitor facilitator responses
- [ ] Set up x402 revenue dashboard
- [ ] Update Claude Skill documentation with x402 payment info
- [ ] Announce x402 support

### Optional: Upgrade Path

- [ ] Magic USDC amount linking implemented
- [ ] walletLinkingRequestDb supports Base chain
- [ ] Documentation for x402 → full user upgrade

---

## Revenue & Accounting

### Reconciliation

x402 payments settle on-chain. Track separately from points:

| Source | Settlement | Tracking |
|--------|------------|----------|
| Points | Internal ledger | creditLedgerDb |
| x402 | Base blockchain | x402PaymentsDb |

### Creator Royalties

For spells with creators, split x402 revenue same as points:

```javascript
if (spell.creator && req.x402?.paid) {
  const creatorShare = req.x402.amountUsd * 0.70; // 70% to creator
  await recordCreatorEarnings(spell.creator, creatorShare, 'x402');
}
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| No payment header | 402 + PaymentRequirements |
| Invalid signature | 402 + error message |
| Insufficient amount | 402 + required vs provided |
| Facilitator down | 503 + retry guidance |
| Network mismatch | 400 + supported networks |

---

## Future Enhancements

### Phase 2.x: Advanced Features

1. **Multi-network support** - Accept payments on Base, Ethereum, Solana
2. **Subscription mode** - Pre-authorize recurring payments
3. **Bulk discounts** - Reduce per-request price for volume
4. **Creator direct payment** - Route x402 directly to spell creators
5. **Refund handling** - Process refunds for failed generations

### Integration with ERC-8004 (Phase 3)

The ERC-8004 profile will advertise:
- x402 payment support
- Accepted networks
- Price ranges
- Receiver address

---

## References

### Official Resources
- [x402.org](https://www.x402.org/) - Protocol home
- [GitHub - coinbase/x402](https://github.com/coinbase/x402) - Reference implementation
- [x402 Whitepaper](https://www.x402.org/x402-whitepaper.pdf) - Technical specification
- [Coinbase x402 Docs](https://docs.cdp.coinbase.com/x402/quickstart-for-buyers) - Quickstart guides

### NPM Packages
- [@x402/core](https://www.npmjs.com/package/@x402/core) - Core protocol
- [@x402/express](https://www.npmjs.com/package/@x402/express) - Express middleware
- [@x402/evm](https://www.npmjs.com/package/@x402/evm) - EVM chain support

### Tutorials
- [QuickNode x402 Guide](https://www.quicknode.com/guides/infrastructure/how-to-use-x402-payment-required)
- [HeimLabs Express Tutorial](https://medium.com/@heimlabs/create-a-pay-per-use-api-with-x402-express-js-83390b17985f)

---

## Implementation Timeline

| Step | Description | Dependencies |
|------|-------------|--------------|
| **2.0** | **Deploy Foundation to Base via CreateX** | Contract work |
| 2.1 | Install x402 packages, env vars | 2.0 |
| 2.2 | x402 middleware (payment verification) | 2.1 |
| 2.3 | x402 execution service (one-off flow) | 2.1 |
| 2.4 | x402 payment log (replay protection) | 2.1 |
| 2.5 | PaymentRequirements service | 2.1 |
| 2.6 | Modify generation execution flow | 2.2-2.5 |
| 2.7 | Route configuration | 2.6 |
| 2.8 | Register middleware | 2.2-2.7 |
| 2.9 | Testing on Base Sepolia | 2.8 |
| **2.10** | **(Optional) Magic USDC linking for upgrade path** | 2.9 |

**Estimated effort:** Medium (simplified - no account management for one-offs)
**Risk:** Low (x402 is isolated, doesn't touch existing credit system)

### Critical Path

```
Foundation on Base (2.0)
         ↓
    x402 packages (2.1)
         ↓
    ┌────┴─────────┬─────────────┐
    ↓              ↓             ↓
Middleware    Execution     Payment Log
  (2.2)       Service(2.3)    (2.4)
    ↓              ↓             ↓
    └──────────────┼─────────────┘
                   ↓
         Execution Flow (2.6)
                   ↓
              Testing (2.9)
                   ↓
         (Optional) Magic USDC (2.10)
```

### Simplified Architecture

```
x402 Request
      ↓
┌─────────────────────────────┐
│  x402 Middleware            │
│  - Verify payment signature │
│  - Extract amount, payer    │
└─────────────────────────────┘
      ↓
┌─────────────────────────────┐
│  Execution Service          │
│  - Check payment ≥ cost     │
│  - Check not replay         │
└─────────────────────────────┘
      ↓
┌─────────────────────────────┐
│  Execute Generation         │
│  (same as any other auth)   │
└─────────────────────────────┘
      ↓
┌─────────────────────────────┐
│  Log Payment Used           │
│  (replay protection)        │
└─────────────────────────────┘
      ↓
   Return Result
```

No accounts. No credit ledger. No chargeSpellExecution. Just: verify → execute → log → return.
