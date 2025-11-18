# Public Spell Endpoint & Upfront Payment System - Implementation Plan

**Date:** 2025-01-27  
**Status:** Planning Complete

## Overview

This document outlines the step-by-step implementation plan for completing the public spell endpoint with upfront payment functionality. The implementation is divided into phases to allow incremental delivery and testing.

## Architecture Summary

### Components

1. **Guest User System** - Temporary accounts for public spell execution
2. **On-Chain Payment Integration** - Crypto payments via Foundation contract
3. **Transaction Monitoring** - Track blockchain events for payment confirmation
4. **Public Spell Execution** - Guest-authenticated spell casting
5. **Refund System** - On-chain withdrawal of excess points

### Data Flow

```
User → Connect Wallet → Generate Transaction → Sign & Send → 
On-Chain Payment → Event Monitoring → Guest Account → Points Credit → 
Upfront Charge → Spell Execution → Refund Calculation → On-Chain Withdrawal → Results
```

## Phase 1: Guest User System

### 1.1 User Account Flagging

**Approach:** Use existing user account system with guest flag

The system already has `find-or-create-by-wallet` functionality. We'll:
1. Use existing user account creation
2. Flag accounts as guest accounts
3. Store guest metadata on the user document

**File:** `src/core/services/guestAccountService.js` (new)

```javascript
class GuestAccountService {
  constructor({ logger, internalApiClient, userCoreDb }) {
    this.logger = logger;
    this.internalApiClient = internalApiClient;
    this.userCoreDb = userCoreDb;
  }

  /**
   * Create or find user account and flag as guest
   */
  async createOrFindGuestAccount({ walletAddress, spellPaymentId, spellId, txHash }) {
    // Use existing find-or-create endpoint
    const response = await this.internalApiClient.post('/internal/v1/auth/find-or-create-by-wallet', {
      address: walletAddress
    });
    
    const user = response.data.user;
    const userId = user._id.toString();
    
    // Flag as guest account with metadata
    await this.userCoreDb.updateOne(
      { _id: user._id },
      {
        $set: {
          isGuest: true,
          guestMetadata: {
            spellPaymentId,
            spellId,
            txHash,
            createdAt: new Date()
          }
        }
      }
    );
    
    return {
      masterAccountId: userId,
      walletAddress: walletAddress.toLowerCase(),
      isNewUser: response.data.isNewUser
    };
  }

  /**
   * Find guest account by spell payment ID
   */
  async findBySpellPaymentId(spellPaymentId) {
    return await this.userCoreDb.findOne({
      'guestMetadata.spellPaymentId': spellPaymentId,
      isGuest: true
    });
  }

  /**
   * Find guest account by transaction hash
   */
  async findByTxHash(txHash) {
    return await this.userCoreDb.findOne({
      'guestMetadata.txHash': txHash,
      isGuest: true
    });
  }

  /**
   * Convert guest account to full account (optional future feature)
   */
  async convertToFullAccount(userId) {
    await this.userCoreDb.updateOne(
      { _id: userId },
      {
        $unset: { isGuest: '', guestMetadata: '' }
      }
    );
  }
}

module.exports = GuestAccountService;
```

**MongoDB Index:**
```javascript
// Add indexes to existing userCore collection
db.userCore.createIndex({ 'guestMetadata.spellPaymentId': 1 });
db.userCore.createIndex({ 'guestMetadata.txHash': 1 });
db.userCore.createIndex({ isGuest: 1 });
```

### 1.2 Guest Authentication Service

**File:** `src/core/services/guestAuthService.js` (new)

```javascript
const jwt = require('jsonwebtoken');

class GuestAuthService {
  constructor({ logger, userCoreDb }) {
    this.logger = logger;
    this.userCoreDb = userCoreDb;
    this.jwtSecret = process.env.JWT_SECRET;
  }

  async createGuestToken(user) {
    const payload = {
      userId: user._id.toString(),
      isGuest: true
    };
    // No expiration - tokens can be long-lived since accounts persist
    return jwt.sign(payload, this.jwtSecret);
  }

  async verifyGuestToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      if (!decoded.isGuest) {
        throw new Error('Invalid guest token');
      }
      const user = await this.userCoreDb.findById(decoded.userId);
      if (!user || !user.isGuest) {
        throw new Error('Guest account not found or invalid');
      }
      return user;
    } catch (error) {
      throw new Error('Invalid guest token');
    }
  }
}

module.exports = GuestAuthService;
```

### 1.3 Guest Authentication Middleware

**File:** `src/platforms/web/middleware/guestAuth.js` (new)

```javascript
const { createLogger } = require('../../../utils/logger');
const logger = createLogger('GuestAuthMiddleware');

function authenticateGuestOrUser(guestAuthService) {
  return async (req, res, next) => {
    // Try regular authentication first
    if (req.user && req.user.userId) {
      return next();
    }

    // Try guest token
    const guestToken = req.headers['x-guest-token'] || req.cookies?.guestToken;
    if (guestToken) {
      try {
        const user = await guestAuthService.verifyGuestToken(guestToken);
        req.user = {
          userId: user._id.toString(),
          isGuest: true
        };
        req.guestUser = user;
        return next();
      } catch (error) {
        logger.warn('Guest token verification failed:', error.message);
        // Fall through to 401
      }
    }

    // No valid authentication
    if (req.accepts('html')) {
      return res.redirect('/landing');
    }
    return res.status(401).json({ 
      error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } 
    });
  };
}

module.exports = { authenticateGuestOrUser };
```

### 1.4 Integration

**Update:** `src/core/services/index.js`
- Add `guestAccountService` to service initialization
- Add `guestAuthService` to service container (uses existing `userCoreDb`)

**Update:** `src/platforms/web/index.js`
- Import `guestAuthService` and `authenticateGuestOrUser`
- Pass to route handlers

## Phase 2: On-Chain Payment Integration

### 2.1 Payment Transaction Service

**File:** `src/core/services/spellPaymentService.js` (new)

```javascript
const { ethers } = require('ethers');
const { v4: uuidv4 } = require('uuid');

class SpellPaymentService {
  constructor({ logger, ethereumService, creditService, guestAccountService, guestAuthService, foundationConfig }) {
    this.logger = logger;
    this.ethereumService = ethereumService;
    this.creditService = creditService;
    this.guestAccountService = guestAccountService;
    this.guestAuthService = guestAuthService;
    this.foundationAddress = foundationConfig.address;
    this.foundationAbi = foundationConfig.abi;
    this.USD_TO_POINTS_CONVERSION_RATE = 0.000337;
    
    // In-memory cache for spellPaymentId -> txHash mapping
    // Could also use Redis or a temporary DB collection
    this.paymentTracking = new Map(); // spellPaymentId -> { txHash, walletAddress, spellId }
  }

  /**
   * Calculate USD amount from points
   */
  pointsToUsd(points) {
    return points * this.USD_TO_POINTS_CONVERSION_RATE;
  }

  /**
   * Generate payment transaction parameters
   */
  async generatePaymentTransaction({ amountPts, spellId, slug, walletAddress, preferredToken = 'ETH' }) {
    const amountUsd = this.pointsToUsd(amountPts);
    const spellPaymentId = uuidv4();

    // Get token price and calculate amount needed
    const priceFeedService = this.creditService.priceFeedService;
    const tokenPrice = await priceFeedService.getTokenPrice(preferredToken);
    const tokenAmount = amountUsd / tokenPrice;

    // Generate transaction parameters
    let txParams;
    if (preferredToken === 'ETH' || preferredToken === ethers.ZeroAddress) {
      // Native ETH payment
      txParams = {
        to: this.foundationAddress,
        value: ethers.parseEther(tokenAmount.toFixed(18)),
        data: '0x'
      };
    } else {
      // ERC20 token payment - need to encode transfer function
      const erc20Abi = ['function transfer(address to, uint256 amount)'];
      const iface = new ethers.Interface(erc20Abi);
      txParams = {
        to: preferredToken,
        value: '0x0',
        data: iface.encodeFunctionData('transfer', [
          this.foundationAddress,
          ethers.parseUnits(tokenAmount.toFixed(18), 18)
        ])
      };
    }

    // Estimate gas
    const gasEstimate = await this.ethereumService.getProvider().estimateGas({
      ...txParams,
      from: walletAddress
    });

    // Store payment tracking info (will create guest account on confirmation)
    this.paymentTracking.set(spellPaymentId, {
      walletAddress,
      spellId,
      amountPts,
      amountUsd,
      token: preferredToken
    });

    return {
      ...txParams,
      gasEstimate: gasEstimate.toString(),
      spellPaymentId,
      amountUsd,
      amountPts,
      token: preferredToken
    };
  }
  
  /**
   * Update payment tracking when transaction is sent
   */
  async trackTransactionSent(spellPaymentId, txHash) {
    const tracking = this.paymentTracking.get(spellPaymentId);
    if (tracking) {
      tracking.txHash = txHash;
      this.paymentTracking.set(spellPaymentId, tracking);
    }
  }
  
  /**
   * Get payment tracking info by spellPaymentId
   */
  getPaymentTracking(spellPaymentId) {
    return this.paymentTracking.get(spellPaymentId);
  }
  
  /**
   * Get payment tracking info by transaction hash
   */
  getPaymentTrackingByTxHash(txHash) {
    for (const [spellPaymentId, tracking] of this.paymentTracking.entries()) {
      if (tracking.txHash === txHash) {
        return { spellPaymentId, ...tracking };
      }
    }
    return null;
  }

  /**
   * Monitor for payment confirmation
   * This hooks into CreditService's event processing
   */
  async checkPaymentStatus(spellPaymentId) {
    const user = await this.guestAccountService.findBySpellPaymentId(spellPaymentId);
    
    if (!user) {
      return { status: 'not_found' };
    }

    if (user.isGuest && user.guestMetadata?.txHash) {
      // Payment confirmed, get guest token
      const guestToken = await this.guestAuthService.createGuestToken(user);
      
      // Get points balance from credit ledger
      const activeDeposits = await this.creditService.creditLedgerDb.findActiveDepositsForUser(user._id.toString());
      const pointsBalance = activeDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);
      
      return {
        status: 'confirmed',
        txHash: user.guestMetadata.txHash,
        guestToken,
        pointsCredited: pointsBalance
      };
    }

    if (user.guestMetadata?.txHash) {
      // Transaction sent but not yet confirmed
      return {
        status: 'pending',
        txHash: user.guestMetadata.txHash
      };
    }

    return {
      status: 'pending_payment',
      message: 'Waiting for transaction'
    };
  }

  /**
   * Handle ContributionRecorded event for spell payment
   * Called by CreditService when processing events
   */
  async handleSpellPaymentEvent(event, decodedLog, spellPaymentId) {
    const { user: walletAddress, amount, transactionHash } = decodedLog.args || decodedLog;
    
    // Check if this transaction is for a spell payment
    // We need to track spellPaymentId -> txHash mapping
    // This can be done via a temporary tracking collection or in-memory cache
    
    // For now, we'll check if user account exists and has guest metadata
    // The spellPaymentId should be stored when generating the transaction
    const user = await this.guestAccountService.findByTxHash(transactionHash);
    
    if (!user || !user.isGuest) {
      // Not a spell payment, or user account doesn't exist yet
      // Create guest account now
      if (spellPaymentId) {
        const guestAccount = await this.guestAccountService.createOrFindGuestAccount({
          walletAddress,
          spellPaymentId,
          spellId: null, // Will be updated later
          txHash: transactionHash
        });
        
        return {
          masterAccountId: guestAccount.masterAccountId,
          spellPaymentId
        };
      }
      return null;
    }

    // User account already exists and is flagged as guest
    // Points will be credited automatically by CreditService
    
    return {
      masterAccountId: user._id.toString(),
      spellPaymentId: user.guestMetadata?.spellPaymentId
    };
  }
}

module.exports = SpellPaymentService;
```

### 2.2 Payment API Endpoints

**File:** `src/api/external/payments/paymentsApi.js` (new)

```javascript
const express = require('express');
const { createLogger } = require('../../../utils/logger');

function createPaymentsApi(dependencies) {
  const router = express.Router();
  const { spellPaymentService, logger } = dependencies;

  // Generate payment transaction (PUBLIC)
  router.post('/generate-transaction', async (req, res) => {
    try {
      const { amountPts, spellId, slug, walletAddress, preferredToken } = req.body;
      
      if (!amountPts || !spellId || !slug || !walletAddress) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'Missing required fields.' }
        });
      }

      // Validate wallet address
      if (!ethers.isAddress(walletAddress)) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'Invalid wallet address.' }
        });
      }

      const result = await spellPaymentService.generatePaymentTransaction({
        amountPts,
        spellId,
        slug,
        walletAddress,
        preferredToken: preferredToken || 'ETH'
      });

      res.status(200).json(result);
    } catch (error) {
      logger.error('Failed to generate payment transaction:', error);
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate transaction.' }
      });
    }
  });

  // Check payment status (PUBLIC)
  router.get('/status/:spellPaymentId', async (req, res) => {
    try {
      const { spellPaymentId } = req.params;
      const status = await spellPaymentService.checkPaymentStatus(spellPaymentId);
      res.status(200).json(status);
    } catch (error) {
      logger.error('Failed to check payment status:', error);
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check payment status.' }
      });
    }
  });

  return router;
}

module.exports = createPaymentsApi;
```

### 2.3 Credit Service Integration

**Update:** `src/core/services/alchemy/creditService.js`

Modify `processPendingConfirmations()` to check for spell payments:

```javascript
// In processPendingConfirmations method, after processing deposit group:
// Check if this deposit is for a spell payment
if (spellPaymentService) {
  // Check payment tracking for this transaction
  const tracking = spellPaymentService.getPaymentTrackingByTxHash(confirmationTxHash);
  
  if (tracking) {
    const spellPaymentResult = await spellPaymentService.handleSpellPaymentEvent(
      null, // event not available here, but we have decoded data
      { args: { user, amount, transactionHash: confirmationTxHash } },
      tracking.spellPaymentId
    );
    
    if (spellPaymentResult) {
      this.logger.info(`[CreditService] Spell payment confirmed for ${spellPaymentResult.masterAccountId}`);
      // Guest account is now active, points credited via normal flow
    }
  }
}
```

**Note:** Points are automatically credited via the existing deposit processing flow. The spell payment service creates/updates the guest account flag on the user document.

## Phase 3: Public Spell Execution

### 3.1 Update External Spells API

**File:** `src/api/external/spells/spellsApi.js`

**Change:** Update `/cast` endpoint to support guest authentication

```javascript
// Replace line 137: router.use(dualAuth);
// With:
router.use(authenticateGuestOrUser); // New middleware that supports both

// Update /cast endpoint (line 218-251)
router.post('/cast', async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.userId) {
      return res.status(401).json({ 
        error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } 
      });
    }

    const { slug, context = {} } = req.body || {};
    if (!slug) {
      return res.status(400).json({ 
        error: { code: 'BAD_REQUEST', message: 'Missing spell slug in request body.' } 
      });
    }

    const proxyPayload = {
      slug,
      context: {
        ...context,
        masterAccountId: user.userId,
        platform: context.platform || 'web-public',
        parameterOverrides: context.parameterOverrides || {},
        isGuest: user.isGuest || false
      }
    };

    const internalResp = await internalApiClient.post('/internal/v1/data/spells/cast', proxyPayload);
    return res.status(internalResp.status || 200).json(internalResp.data);
  } catch (error) {
    // ... error handling
  }
});
```

### 3.2 Update Spell Execution Flow

**File:** `src/core/services/SpellsService.js`

**Update:** `castSpell()` method to handle upfront payment

```javascript
async castSpell(slug, context, castsDb = null) {
  // ... existing spell lookup code ...

  // NEW: Charge upfront if quote provided
  if (context.quote && context.chargeUpfront !== false) {
    try {
      const chargeResult = await this.creditService.chargeSpellExecution(
        context.masterAccountId,
        spell._id.toString(),
        context.quote
      );
      context.creditTxId = chargeResult.creditTxId;
      context.pointsCharged = chargeResult.pointsCharged;
    } catch (error) {
      if (error.message === 'INSUFFICIENT_POINTS') {
        throw new Error('Insufficient points to execute spell. Please purchase more points.');
      }
      throw error;
    }
  }

  // ... rest of existing execution code ...
}
```

## Phase 4: Frontend Integration

### 4.1 Wallet Connection

**File:** `public/js/wallet-connect.js` (new)

```javascript
// Wallet connection utilities
let provider = null;
let signer = null;
let walletAddress = null;

async function connectWallet() {
  if (typeof window.ethereum !== 'undefined') {
    try {
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      walletAddress = accounts[0];
      
      // Initialize ethers provider
      const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js');
      provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = provider.getSigner();
      
      return { walletAddress, provider, signer };
    } catch (error) {
      throw new Error('User rejected wallet connection');
    }
  } else {
    throw new Error('No Ethereum wallet found. Please install MetaMask or another Web3 wallet.');
  }
}

function getWalletAddress() {
  return walletAddress;
}

function getSigner() {
  return signer;
}

window.walletConnect = { connectWallet, getWalletAddress, getSigner };
```

### 4.2 Update spell_execute.js

**File:** `public/js/spell_execute.js`

**Add on-chain payment flow:**

```javascript
// Add wallet connection script
// <script src="/js/wallet-connect.js"></script>

let walletConnected = false;
let walletAddress = null;

// Update run button click handler
runBtn.addEventListener('click', async () => {
  if (!currentQuote) return;
  
  runBtn.disabled = true;
  
  try {
    // 1. Connect wallet if not connected
    if (!walletConnected) {
      runBtn.textContent = 'Connecting wallet...';
      const { walletAddress: addr } = await window.walletConnect.connectWallet();
      walletAddress = addr;
      walletConnected = true;
      runBtn.textContent = 'Preparing payment...';
    }
    
    // 2. Generate payment transaction
    const paymentAmountPts = Math.ceil(currentQuote.totalCostPts * 1.2); // 20% buffer
    const txRes = await fetch('/api/v1/payments/generate-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountPts: paymentAmountPts,
        spellId: spellMeta._id,
        slug: slug,
        walletAddress: walletAddress,
        preferredToken: 'ETH' // or allow user to select
      })
    });
    
    if (!txRes.ok) {
      throw new Error('Failed to generate payment transaction');
    }
    
    const txParams = await txRes.json();
    const { spellPaymentId, to, value, data, gasEstimate } = txParams;
    
    // 3. Send transaction via wallet
    runBtn.textContent = 'Confirm payment in wallet...';
    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js');
    const signer = window.walletConnect.getSigner();
    
    const tx = await signer.sendTransaction({
      to,
      value: ethers.BigNumber.from(value),
      data: data || '0x',
      gasLimit: ethers.BigNumber.from(gasEstimate).mul(120).div(100) // 20% buffer
    });
    
    // 4. Update guest account with tx hash
    await fetch(`/api/v1/payments/tx-sent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spellPaymentId,
        txHash: tx.hash
      })
    });
    
    // 5. Wait for payment confirmation (poll)
    runBtn.textContent = 'Waiting for payment confirmation...';
    const guestToken = await waitForPaymentConfirmation(spellPaymentId, tx.hash);
    
    // 6. Store guest token
    document.cookie = `guestToken=${guestToken}; path=/; max-age=86400`;
    
    // 7. Execute spell
    runBtn.textContent = 'Running spell...';
    const csrfToken = await getCsrfToken();
    const execRes = await fetch('/api/v1/spells/cast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken || '',
        'x-guest-token': guestToken
      },
      credentials: 'include',
      body: JSON.stringify({
        slug,
        context: {
          parameterOverrides: currentInputs,
          quote: { totalCostPts: paymentAmountPts },
          chargeUpfront: true
        }
      })
    });
    
    const data = await execRes.json();
    
    if (!execRes.ok) {
      throw new Error(data.error?.message || 'Spell execution failed');
    }
    
    // 8. Track execution for refund calculation
    trackExecutionForRefund(data.castId, spellPaymentId);
    
    // 9. Display results
    outputEl.textContent = 'Spell execution started. Results will appear here...';
    
  } catch (err) {
    outputEl.textContent = `Error: ${err.message}`;
    console.error('Payment/execution error:', err);
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Spell';
  }
});

async function waitForPaymentConfirmation(spellPaymentId, txHash) {
  // Poll for payment confirmation (up to 5 minutes)
  const maxAttempts = 300; // 5 minutes at 1 second intervals
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`/api/v1/payments/status/${spellPaymentId}`);
    const data = await res.json();
    
    if (data.status === 'confirmed' && data.guestToken) {
      return data.guestToken;
    }
    
    if (data.status === 'failed') {
      throw new Error('Payment failed');
    }
    
    // Show progress
    if (i % 10 === 0) {
      outputEl.textContent = `Waiting for blockchain confirmation... (${i}s)`;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('Payment confirmation timeout. Please check your transaction on the blockchain.');
}

function trackExecutionForRefund(castId, spellPaymentId) {
  // Store for later refund processing
  localStorage.setItem(`spell_exec_${castId}`, JSON.stringify({
    spellPaymentId,
    timestamp: Date.now()
  }));
}
```

### 4.3 Add Wallet Connection UI

**Update:** `public/spell.html`

Add wallet connection section:

```html
<div id="wallet-section" class="card" style="display:none;">
  <h3>Connect Wallet</h3>
  <button id="connect-wallet-btn" class="btn btn-primary">Connect Wallet</button>
  <p id="wallet-address" style="display:none;"></p>
</div>
```

**Update:** `public/js/spell_execute.js`

Add wallet connection UI:

```javascript
const walletSection = document.getElementById('wallet-section');
const connectWalletBtn = document.getElementById('connect-wallet-btn');
const walletAddressEl = document.getElementById('wallet-address');

// Show wallet section when quote is ready
function showWalletSection() {
  if (currentQuote && !walletConnected) {
    walletSection.style.display = 'block';
  }
}

connectWalletBtn.addEventListener('click', async () => {
  try {
    const { walletAddress: addr } = await window.walletConnect.connectWallet();
    walletAddress = addr;
    walletConnected = true;
    walletAddressEl.textContent = `Connected: ${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    walletAddressEl.style.display = 'block';
    connectWalletBtn.textContent = 'Connected';
    connectWalletBtn.disabled = true;
  } catch (err) {
    alert(`Wallet connection failed: ${err.message}`);
  }
});

// Show wallet section after quote is fetched
// In fetchQuote() function, add:
// showWalletSection();
```

## Phase 5: Refund System

### 5.1 Cost Tracking

**File:** `src/core/services/costTrackingService.js` (new)

```javascript
class CostTrackingService {
  constructor({ logger, castsDb, creditService }) {
    this.logger = logger;
    this.castsDb = castsDb;
    this.creditService = creditService;
  }

  async calculateActualCost(castId) {
    const cast = await this.castsDb.findOne({ _id: castId });
    if (!cast) {
      throw new Error('Cast not found');
    }

    // Sum costs from generationOutputsDb for this cast
    const totalCostUsd = await this.sumGenerationCosts(cast.stepGenerationIds);
    const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
    return totalCostUsd / USD_TO_POINTS_CONVERSION_RATE;
  }

  async processRefund(castId, paymentIntentId) {
    const actualCost = await this.calculateActualCost(castId);
    const guestAccount = await this.guestAccountsDb.findByPaymentIntentId(paymentIntentId);
    
    if (!guestAccount) {
      throw new Error('Guest account not found');
    }

    // Get original charge amount from payment metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const chargedPts = parseInt(paymentIntent.metadata.amountPts);
    
    if (chargedPts > actualCost) {
      const refundPts = chargedPts - actualCost;
      await this.creditService.refundPoints(guestAccount.masterAccountId, refundPts);
      return { refunded: refundPts, actualCost };
    }
    
    return { refunded: 0, actualCost };
  }
}

module.exports = CostTrackingService;
```

### 5.2 Refund Endpoint

**File:** `src/api/external/payments/paymentsApi.js`

Add refund endpoint:

```javascript
router.post('/refund/:castId', async (req, res) => {
  try {
    const { castId } = req.params;
    const { paymentIntentId } = req.body;
    
    const result = await costTrackingService.processRefund(castId, paymentIntentId);
    res.json(result);
  } catch (error) {
    logger.error('Refund failed:', error);
    res.status(500).json({ error: 'Refund failed' });
  }
});
```

## Phase 6: Testing & Deployment

### 6.1 Unit Tests

- Guest account creation and expiration
- Payment intent creation
- Webhook handling
- Cost calculation
- Refund processing

### 6.2 Integration Tests

- Complete payment flow
- Guest spell execution
- Refund calculation
- Error handling

### 6.3 E2E Tests

- Public spell page → Payment → Execution → Refund
- Payment failure scenarios
- Insufficient points handling

### 6.4 Deployment Checklist

- [ ] Foundation contract address configured
- [ ] Ethereum RPC URL configured
- [ ] UserCore collection indexes created (guestMetadata fields)
- [ ] Rate limiting configured
- [ ] Blockchain event monitoring active
- [ ] Monitoring alerts set up
- [ ] Error logging configured
- [ ] Wallet connection tested (MetaMask, WalletConnect)

## Implementation Order

1. **Phase 1:** Guest User System (Foundation)
2. **Phase 2:** On-Chain Payment Integration (Crypto payments)
3. **Phase 3:** Public Spell Execution (Connect pieces)
4. **Phase 4:** Frontend Integration (Wallet connection & UI)
5. **Phase 5:** Refund System (On-chain withdrawals)
6. **Phase 6:** Testing & Deployment (Quality assurance)

## Estimated Timeline

- Phase 1: 2-3 days
- Phase 2: 3-4 days
- Phase 3: 2-3 days
- Phase 4: 3-4 days
- Phase 5: 2-3 days
- Phase 6: 3-4 days

**Total:** ~15-21 days

## Risk Mitigation

1. **Transaction Failures:** Clear error messages, gas estimation with buffer
2. **Blockchain Delays:** Polling with reasonable timeout, show progress to user
3. **Cost Overruns:** 20% buffer on payments, maximum cost limits
4. **Guest Account Abuse:** Rate limiting, transaction amount validation
5. **Refund Errors:** Comprehensive logging, on-chain withdrawal verification
6. **Wallet Connection Issues:** Fallback UI, clear instructions for users

## Success Metrics

- Public spell execution success rate > 95%
- Payment success rate > 98%
- Average time from payment to execution start < 5 seconds
- Refund accuracy 100%
- Guest account cleanup rate 100%

