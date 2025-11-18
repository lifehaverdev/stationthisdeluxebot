# Public Spell Endpoint & Upfront Payment System - Investigation Report

**Date:** 2025-01-27  
**Status:** Investigation Complete

## Executive Summary

The public spell endpoint (`/spells/:slug`) exists and has basic infrastructure, but the **upfront payment flow is incomplete**. The system has:

- ✅ Public spell page route and template
- ✅ Cost estimation system (`quoteSpell`)
- ✅ Spell execution infrastructure
- ✅ Points charging system (`chargeSpellExecution`)
- ❌ **Missing:** Upfront payment integration
- ❌ **Missing:** Guest user creation flow
- ❌ **Missing:** Public spell execution without authentication
- ❌ **Missing:** Payment processing for non-authenticated users

## Current State Analysis

### 1. Public Spell Page (`/spells/:slug`)

**Route:** `src/platforms/web/index.js:106`
```106:108:src/platforms/web/index.js
      app.get('/spells/:slug', (req, res) => {
        res.sendFile(path.join(publicPath, 'spell.html'));
      });
```

**Template:** `public/spell.html`
- Basic HTML structure with sections for metadata, input form, quote, run button, and output
- References `/js/spell_execute.js` and `/js/websocketClient.js`
- No authentication required (route is public)

**JavaScript Implementation:** `public/js/spell_execute.js`

**What Works:**
- ✅ Fetches spell metadata from `/api/v1/spells/:slug`
- ✅ Renders spell metadata (name, description, author)
- ✅ Renders input form from `exposedInputs`
- ✅ Fetches cost quote from `/api/v1/spells/:spellIdentifier/quote`
- ✅ Displays estimated cost in points
- ✅ Shows "Run Spell" button after quote is loaded
- ✅ WebSocket integration for live updates

**What's Broken/Incomplete:**
- ❌ **Line 129-130:** Points charge flow is commented out with TODO
  ```javascript
  // TODO: implement points charge flow once backend endpoint is ready
  // const chargeRes = await fetch('/api/v1/points/charge', {method:'POST'});
  ```
- ❌ **Line 133:** `/api/v1/spells/cast` endpoint requires authentication (see below)
- ❌ No payment UI or payment method selection
- ❌ No guest user creation
- ❌ No upfront payment processing

### 2. Cost Estimation System

**Implementation:** `src/core/services/SpellsService.js:108-185`

**Method:** `quoteSpell(spellIdentifier, { sampleSize = 10 })`

**How It Works:**
1. Fetches spell by slug or ObjectId
2. Iterates through spell steps
3. Aggregates historical costs from `generationOutputsDb`:
   - Matches by `serviceName` (tool identifier)
   - Filters for `status: 'completed'`
   - Takes most recent `sampleSize` records (default: 10)
   - Calculates average `durationMs` and `costUsd`
4. Converts USD to points using `USD_TO_POINTS_CONVERSION_RATE = 0.000337`
5. Returns:
   ```javascript
   {
     spellId: ObjectId,
     totalRuntimeMs: number,
     totalCostPts: number,
     breakdown: [{ toolId, avgRuntimeMs, avgCostPts }]
   }
   ```

**Endpoint:** `POST /api/v1/spells/:spellIdentifier/quote`
- **External API:** `src/api/external/spells/spellsApi.js:122-134`
  - ✅ **PUBLIC** (no authentication required)
  - Proxies to internal API
- **Internal API:** `src/api/internal/spells/spellsApi.js:496-514`
  - Calls `spellsService.quoteSpell()`

**Status:** ✅ **Fully Functional**

**Limitations:**
- Requires historical data (new spells with no runs return 0 cost)
- No safety margin/buffer for cost overruns
- No handling for spells with missing tool identifiers

### 3. Spell Execution Flow

**Endpoint:** `POST /api/v1/spells/cast`

**External API:** `src/api/external/spells/spellsApi.js:218-251`
```218:251:src/api/external/spells/spellsApi.js
    router.post('/cast', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }

            const { slug, context = {} } = req.body || {};
            if (!slug) {
                return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing spell slug in request body.' } });
            }

            const proxyPayload = {
                slug,
                context: {
                    ...context,
                    masterAccountId: user.userId,
                    platform: context.platform || 'web-sandbox',
                    parameterOverrides: context.parameterOverrides || {},
                }
            };

            // Forward FULL response from internal API so frontend immediately knows castId / generationId
            const internalResp = await internalApiClient.post('/internal/v1/data/spells/cast', proxyPayload);
            // Typical success -> 200 OK with body { castId, generationId?, status }
            return res.status(internalResp.status || 200).json(internalResp.data);
        } catch (error) {
            const statusCode = error.response ? error.response.status : 502;
            const errorData = error.response ? error.response.data : { message: 'Unable to cast spell.' };
            logger.error('Failed to cast spell via external API:', errorData);
            res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
        }
    });
```

**Authentication:** ❌ **REQUIRES AUTHENTICATION**
- Protected by `dualAuth` middleware (line 137)
- Requires `req.user.userId` (line 221-224)
- **Cannot be used by public/guest users**

**Internal API:** `src/api/internal/spells/spellsApi.js:50-87`
- Requires `context.masterAccountId` (line 54)
- Calls `spellsService.castSpell()` (line 70)

**Spell Execution Service:** `src/core/services/SpellsService.js:16-92`
- Finds spell by slug
- Checks permissions (public/owned/licensed)
- Creates cast record
- Executes via `workflowExecutionService.execute()`
- Increments usage count

**Status:** ✅ **Functional for authenticated users**  
**Status:** ❌ **Not accessible to public/guest users**

### 4. Points Charging System

**Implementation:** `src/core/services/alchemy/creditService.js:1665-1791`

**Method:** `chargeSpellExecution(payerAccountId, spellId, quote, creatorSharePct = 0.7)`

**How It Works:**
1. Validates quote has `totalCostPts`
2. Checks user has sufficient points in active deposits
3. Throws `INSUFFICIENT_POINTS` if not enough
4. Deducts points from deposits (cheapest first)
5. Routes creator share (70% default) to creator/referral vault
6. Returns `{ creditTxId, pointsCharged }`

**Status:** ✅ **Fully Functional**

**Limitations:**
- Requires existing user account with points
- No guest user support
- No integration with public spell payment flow

### 5. Payment Processing

**Current System:** ✅ **ON-CHAIN CRYPTO PAYMENTS**

The system uses **on-chain crypto payments** via the Foundation contract:

- **EthereumService** (`src/core/services/alchemy/ethereumService.js`) - Handles blockchain interactions
- **CreditService** (`src/core/services/alchemy/creditService.js`) - Processes `ContributionRecorded` events
- Users send crypto transactions directly to the Foundation contract
- System monitors blockchain events via webhooks/polling
- Points are credited based on deposit value and funding rates

**How It Works:**
1. User sends crypto (ETH/tokens) to Foundation contract address
2. Contract emits `ContributionRecorded` event
3. CreditService processes event and credits points to user account
4. Points conversion: `USD_TO_POINTS_CONVERSION_RATE = 0.000337`

**What's Missing for Public Spells:**
- ❌ No wallet connection UI for public spell page
- ❌ No on-chain payment flow for guest users
- ❌ No transaction monitoring for spell-specific payments
- ❌ No guest account creation tied to on-chain transactions

### 6. Guest User Creation

**Search Results:** ❌ **NO GUEST USER SYSTEM FOUND**

- No temporary account creation
- No anonymous user support
- No session-based guest accounts
- All user operations require `masterAccountId`

## Gap Analysis

### Critical Missing Features

#### 1. Upfront Payment Flow
**Current State:** Points charge is commented out in `spell_execute.js`  
**Required:**
- Payment method selection UI
- Payment processing integration (Stripe recommended)
- Points purchase endpoint for guests
- Pre-execution points deduction
- Refund mechanism if actual cost < estimated cost

#### 2. Guest User Creation
**Current State:** No guest user system exists  
**Required:**
- Temporary account creation on payment
- Session-based guest accounts
- Guest account cleanup after execution
- Optional: Email collection for result delivery

#### 3. Public Spell Execution
**Current State:** `/cast` endpoint requires authentication  
**Required:**
- Public execution endpoint or guest authentication bypass
- Guest `masterAccountId` generation
- Guest account linking to spell execution

#### 4. On-Chain Payment Integration
**Current State:** On-chain payment system exists but not integrated for public spells  
**Required:**
- Wallet connection UI (MetaMask, WalletConnect, etc.)
- Transaction generation for spell payment amount
- Transaction monitoring/polling for confirmation
- Guest account creation on payment confirmation
- Points credit to guest account via existing CreditService

#### 5. Cost Estimation Improvements
**Current State:** Basic estimation works  
**Recommended:**
- Add safety margin (e.g., 20% buffer)
- Handle new spells with no history (fallback to tool defaults)
- Real-time cost tracking during execution
- Refund calculation and processing

## Code Flow Diagrams

### Current Flow (Broken for Public Users)

```
User visits /spells/:slug
  ↓
spell.html loads
  ↓
spell_execute.js:
  1. fetchMetadata() → GET /api/v1/spells/:slug ✅
  2. renderMetadata() ✅
  3. renderForm() ✅
  4. fetchQuote() → POST /api/v1/spells/:id/quote ✅
  5. Display quote ✅
  6. User clicks "Run Spell"
  7. ❌ Points charge (commented out)
  8. ❌ POST /api/v1/spells/cast → 401 UNAUTHORIZED
```

### Required Flow (With On-Chain Upfront Payment)

```
User visits /spells/:slug
  ↓
spell.html loads
  ↓
spell_execute.js:
  1. fetchMetadata() ✅
  2. renderMetadata() ✅
  3. renderForm() ✅
  4. fetchQuote() ✅
  5. Display quote + "Pay & Run" button ✅
  6. User clicks "Pay & Run"
  7. [NEW] Connect wallet (MetaMask/WalletConnect)
  8. [NEW] Generate payment transaction
  9. [NEW] User signs & sends on-chain transaction
 10. [NEW] Monitor blockchain for ContributionRecorded event
 11. [NEW] Create guest account on event confirmation
 12. [NEW] Points credited via existing CreditService flow
 13. [NEW] Charge points upfront
 14. [NEW] POST /api/v1/spells/cast (with guest auth)
 15. Execute spell ✅
 16. [NEW] Calculate actual cost
 17. [NEW] Refund excess via on-chain withdrawal (if any)
 18. Display results ✅
```

## Architecture Recommendations

### 1. Guest User System

**Approach:** Flagged accounts in existing user system

Since the system already has `find-or-create-by-wallet` functionality, we can simply:
1. Use existing user account creation flow
2. Flag accounts as guest accounts with `isGuest: true` or `accountType: 'guest'`
3. No expiration/cleanup needed - accounts persist indefinitely

```javascript
// On payment confirmation, create/find user account
POST /internal/v1/auth/find-or-create-by-wallet
{
  address: walletAddress
}
Response: {
  user: { _id, wallets: [...], ... },
  isNewUser: boolean
}

// Then flag as guest account
PATCH /internal/v1/data/users/:userId
{
  isGuest: true,
  guestMetadata: {
    spellPaymentId: string,
    spellId: string,
    txHash: string,
    createdAt: Date
  }
}
```

**Database:**
- Use existing `userCore` collection
- Add optional fields:
  - `isGuest` (boolean) - Flag indicating guest account
  - `guestMetadata` (object, optional) - Stores guest-specific info:
    - `spellPaymentId` (string)
    - `spellId` (string)
    - `txHash` (string)
    - `createdAt` (Date)

**Benefits:**
- No separate collection needed
- No TTL indexes or cleanup jobs
- Accounts can be converted to full accounts later
- Simpler architecture

### 2. On-Chain Payment Integration

**Transaction Generation:**

```javascript
// Backend: Generate payment transaction parameters
POST /api/v1/payments/generate-transaction
{
  amountPts: number,
  spellId: string,
  slug: string,
  walletAddress: string
}
Response: {
  to: string,           // Foundation contract address
  value: string,        // Amount in wei (if ETH)
  data: string,         // Encoded function call (if ERC20)
  gasEstimate: string,
  spellPaymentId: string  // Unique ID to track this payment
}

// Frontend: User signs and sends transaction via wallet
// Uses ethers.js or web3.js to send transaction

// Backend: Monitor for payment confirmation
GET /api/v1/payments/status/:spellPaymentId
Response: {
  status: 'pending' | 'confirmed' | 'failed',
  txHash?: string,
  guestToken?: string,  // Created on confirmation
  pointsCredited?: number
}
```

**Event Monitoring:**

- CreditService already monitors `ContributionRecorded` events
- Need to add spell-specific payment tracking
- Link transaction to spell execution request

### 3. Public Spell Execution

**Option A: Guest Authentication Middleware**

```javascript
// New middleware: authenticateGuestOrUser
function authenticateGuestOrUser(req, res, next) {
  // Try regular auth first
  if (req.user) return next();
  
  // Try guest token
  const guestToken = req.headers['x-guest-token'] || req.cookies.guestToken;
  if (guestToken) {
    // Verify guest token
    const guest = verifyGuestToken(guestToken);
    req.user = { userId: guest.masterAccountId, isGuest: true };
    return next();
  }
  
  return res.status(401).json({ error: 'Authentication required' });
}
```

**Option B: Separate Public Endpoint**

```javascript
POST /api/v1/spells/cast-public
{
  slug: string,
  guestToken: string,
  context: { parameterOverrides: {} }
}
// No dualAuth middleware
// Validates guestToken
// Creates guest masterAccountId if needed
```

### 4. Upfront Payment & Refund Flow

```javascript
// 1. User pays on-chain (with buffer)
const estimatedCost = quote.totalCostPts;
const buffer = Math.ceil(estimatedCost * 0.2); // 20% buffer
const chargeAmount = estimatedCost + buffer;
const chargeAmountUsd = chargeAmount * USD_TO_POINTS_CONVERSION_RATE;

// User sends transaction for chargeAmountUsd worth of crypto
// Transaction is monitored via ContributionRecorded event

// 2. On event confirmation, create guest account and credit points
const guestAccount = await createGuestAccount({
  walletAddress: txArgs.user,
  txHash: txHash,
  spellId: spellId
});

// Points automatically credited via existing CreditService flow

// 3. Charge upfront from credited points
await creditService.chargeSpellExecution(
  guestAccount.masterAccountId,
  spellId,
  { totalCostPts: chargeAmount }
);

// 4. Execute spell
const result = await spellsService.castSpell(slug, {
  masterAccountId: guestAccount.masterAccountId,
  ...
});

// 5. Calculate actual cost
const actualCost = await calculateActualCost(castId);

// 6. Refund excess (on-chain withdrawal)
if (chargeAmount > actualCost) {
  const refundPts = chargeAmount - actualCost;
  const refundUsd = refundPts * USD_TO_POINTS_CONVERSION_RATE;
  // Initiate on-chain withdrawal via CreditService
  await creditService.initiateWithdrawal(
    guestAccount.masterAccountId,
    refundUsd
  );
}
```

### 5. Cost Estimation Improvements

```javascript
async quoteSpell(spellIdentifier, { sampleSize = 10, includeBuffer = true } = {}) {
  // ... existing logic ...
  
  let totalCostPts = /* calculated cost */;
  
  // Add buffer for safety
  if (includeBuffer) {
    totalCostPts = Math.ceil(totalCostPts * 1.2); // 20% buffer
  }
  
  // Handle new spells with no history
  if (totalCostPts === 0 && breakdown.length === 0) {
    // Fallback to tool defaults or minimum cost
    totalCostPts = 100; // Minimum cost fallback
  }
  
  return {
    spellId,
    totalRuntimeMs,
    totalCostPts,
    baseCostPts: totalCostPts / 1.2, // Original cost without buffer
    bufferPts: totalCostPts - (totalCostPts / 1.2),
    breakdown
  };
}
```

## Testing Strategy

### Unit Tests
- `quoteSpell()` with various spell configurations
- `chargeSpellExecution()` with insufficient points
- Guest account creation and expiration
- Refund calculation

### Integration Tests
- Public spell page load
- Quote generation
- Payment flow (Stripe test mode)
- Guest spell execution
- Refund processing

### E2E Tests
- Complete flow: Visit → Quote → Pay → Execute → Refund
- Error handling: Payment failure, insufficient points, spell execution failure

## Security Considerations

1. **Rate Limiting:** Prevent abuse of public endpoints
2. **Payment Verification:** Always verify Stripe webhooks
3. **Guest Token Expiration:** Short-lived tokens (24 hours)
4. **Cost Validation:** Prevent cost manipulation
5. **Refund Limits:** Maximum refund amount to prevent abuse

## Next Steps

See `PUBLIC_SPELL_ENDPOINT_IMPLEMENTATION_PLAN.md` for detailed implementation steps.

