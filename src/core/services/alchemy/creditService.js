/**
 * CreditService (Refactored Facade)
 * 
 * This is a facade that maintains backward compatibility while delegating
 * to specialized services extracted from the original monolithic implementation.
 * 
 * All public APIs are maintained for backward compatibility.
 */
const { ethers } = require('ethers');
const tokenDecimalService = require('../tokenDecimalService');

// Import extracted services
const EventDeduplicationService = require('./credit/EventDeduplicationService');
const DepositNotificationService = require('./credit/DepositNotificationService');
const ReferralRewardService = require('./credit/ReferralRewardService');
const AdminOperationsService = require('./credit/AdminOperationsService');
const DepositProcessorService = require('./credit/DepositProcessorService');
const ReferralVaultService = require('./credit/ReferralVaultService');
const EventWebhookProcessor = require('./credit/EventWebhookProcessor');
const CreditWorker = require('./credit/CreditWorker');
const { WebhookEventQueueDb } = require('../db/alchemy/webhookEventQueueDb');

const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * @class CreditService
 * @description Facade that manages the credit lifecycle by delegating to specialized services.
 */
class CreditService {
  /**
   * @param {object} services - A container for required service instances.
   * @param {EthereumService} services.ethereumService - Instance of EthereumService.
   * @param {CreditLedgerDB} services.creditLedgerDb - Instance of CreditLedgerDB.
   * @param {SystemStateDB} services.systemStateDb - Instance of SystemStateDB.
   * @param {PriceFeedService} services.priceFeedService - Service for fetching token prices.
   * @param {TokenRiskEngine} services.tokenRiskEngine - Service for assessing collateral risk.
   * @param {InternalApiClient} services.internalApiClient - Client for internal API communication.
   * @param {UserCoreDB} services.userCoreDb - Service for core user data.
   * @param {WalletLinkingRequestDB} services.walletLinkingRequestDb - Service for magic amount requests.
   * @param {WalletLinkingService} services.walletLinkingService - Service for handling linking logic.
   * @param {SaltMiningService} services.saltMiningService - Service for mining CREATE2 salts.
   * @param {WebSocketService} services.webSocketService - Service for WebSocket notifications.
   * @param {AdminActivityService} services.adminActivityService - Service for admin activity monitoring.
   * @param {SpellPaymentService} services.spellPaymentService - Service for spell payment tracking.
   * @param {object} config - Configuration object.
   * @param {string} config.contractAddress - The address of the on-chain CreditVault contract.
   * @param {Array} config.contractAbi - The ABI of the CreditVault contract.
   * @param {object} logger - A logger instance.
   */
  constructor(services, config, logger) {
    this.logger = logger || console;
    tokenDecimalService.setLogger(this.logger);

    const {
      ethereumService,
      creditLedgerDb,
      systemStateDb,
      priceFeedService,
      tokenRiskEngine,
      internalApiClient,
      userCoreDb,
      saltMiningService,
      webSocketService,
      adminActivityService,
      nftPriceService,
      spellsDb
    } = services;

    if (!ethereumService || !creditLedgerDb || !systemStateDb || !priceFeedService || !tokenRiskEngine || !internalApiClient || !userCoreDb || !saltMiningService || !webSocketService) {
      throw new Error('CreditService: Missing one or more required services.');
    }

    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.systemStateDb = systemStateDb;
    this.priceFeedService = priceFeedService;
    this.tokenRiskEngine = tokenRiskEngine;
    this.internalApiClient = internalApiClient;
    this.userCoreDb = userCoreDb;
    this.saltMiningService = saltMiningService;
    this.webSocketService = webSocketService;
    this.adminActivityService = adminActivityService;
    this.nftPriceService = nftPriceService || null;
    this.spellPaymentService = services.spellPaymentService || null;
    this.spellsDb = spellsDb || null;
    
    const { contractAddress, contractAbi, disableWebhookActions: disableWebhookActionsConfig } = config;
    const disableWebhookActionsEnv = process.env.DISABLE_CREDIT_WEBHOOK_ACTIONS === '1';
    this.disableWebhookActions = (typeof disableWebhookActionsConfig === 'boolean')
      ? disableWebhookActionsConfig
      : disableWebhookActionsEnv;
    if (this.disableWebhookActions) {
      this.logger.debug('[CreditService] Webhook-dependent credit actions are DISABLED for this environment.');
    }
    if (!contractAddress || !contractAbi) {
      throw new Error('CreditService: Missing contract address or ABI in config.');
    }
    this.contractConfig = { address: contractAddress, abi: contractAbi };

    // Initialize extracted services
    this._initializeServices();

    this.logger.debug(`[CreditService] Configured to use CreditVault at address: ${this.contractConfig.address}`);
    this.logger.debug('[CreditService] Initialized (refactored facade).');
  }

  /**
   * Initializes all extracted services.
   * @private
   */
  _initializeServices() {
    // 1. Event Deduplication Service (stateless utility)
    this.eventDeduplicationService = new EventDeduplicationService(this.logger);

    // 2. Deposit Notification Service
    this.depositNotificationService = new DepositNotificationService(this.webSocketService, this.logger);

    // 3. Referral Reward Service
    this.referralRewardService = new ReferralRewardService(this.creditLedgerDb, this.logger);

    // 4. Admin Operations Service
    this.adminOperationsService = new AdminOperationsService(this.ethereumService, this.logger);

    // 5. Deposit Processor Service (CreditVault — quote-matching + live pricing)
    this.depositProcessorService = new DepositProcessorService(
      this.ethereumService,
      this.creditLedgerDb,
      this.priceFeedService,
      this.nftPriceService,
      this.depositNotificationService,
      this.eventDeduplicationService,
      this.contractConfig,
      this.logger,
      this.userCoreDb,
      this.internalApiClient
    );

    // 6. Referral Vault Service
    this.referralVaultService = new ReferralVaultService(
      this.ethereumService,
      this.creditLedgerDb,
      this.saltMiningService,
      this.internalApiClient,
      this.depositNotificationService,
      this.contractConfig,
      this.logger,
      this.userCoreDb
    );

    // 7. Event Webhook Processor (CreditVault — simplified routing)
    if (!this.disableWebhookActions) {
      this.eventWebhookProcessor = new EventWebhookProcessor(
        this.ethereumService,
        this.depositProcessorService,
        this.eventDeduplicationService,
        this.creditLedgerDb,
        this.contractConfig,
        this.logger
      );
    } else {
      this.eventWebhookProcessor = null;
      this.logger.debug('[CreditService] Event webhook processor not initialized (disabled).');
    }

    // 8. Webhook Event Queue (MongoDB-backed job queue)
    this.webhookEventQueueDb = new WebhookEventQueueDb(this.logger);

    // 9. Credit Worker (processes queued webhook events)
    if (!this.disableWebhookActions && this.eventWebhookProcessor) {
      this.creditWorker = new CreditWorker(
        this.webhookEventQueueDb,
        this.eventWebhookProcessor,
        this.logger
      );
    } else {
      this.creditWorker = null;
      this.logger.debug('[CreditService] Credit worker not initialized (webhook actions disabled).');
    }
  }

  /**
   * Starts the service.
   * Runs the startup reconciliation for missed events and processes the pending queue.
   * Each stage runs independently so failures in one don't block the others.
   */
  async start() {
    this.logger.info('[CreditService] Starting service...');

    // Skip startup processing when webhook actions are disabled (e.g., local dev)
    // This prevents the dev server from accidentally processing real deposits
    if (this.disableWebhookActions) {
      this.logger.warn('[CreditService] Webhook actions disabled - skipping startup processing (Stage 1, 2, 3). Use production server to process deposits.');
      return;
    }

    let stagesCompleted = 0;
    let stagesFailed = 0;

    // Stage 1: Ensure quote indexes exist
    try {
      this.logger.info('[CreditService] Stage 1: Ensuring quote indexes...');
      await this.creditLedgerDb.ensureQuoteIndexes();
      this.logger.info('[CreditService] Stage 1 complete.');
      stagesCompleted++;
    } catch (error) {
      stagesFailed++;
      this.logger.error('[CreditService] Stage 1 failed (quote indexes):', error.message);
    }

    // Stage 2: Start credit worker for queue processing (drains pending events)
    try {
      this.logger.info('[CreditService] Stage 2: Starting credit worker and draining pending events...');
      await this.startCreditWorker();
      this.logger.info('[CreditService] Stage 2 complete. Credit worker started and queue drained.');
      stagesCompleted++;
    } catch (error) {
      stagesFailed++;
      this.logger.error('[CreditService] Stage 2 failed (credit worker start):', error.message);
    }

    if (stagesFailed > 0) {
      this.logger.warn(`[CreditService] Startup completed with ${stagesFailed} failed stage(s) and ${stagesCompleted} successful stage(s).`);
    } else {
      this.logger.info('[CreditService] Startup processing complete. All stages succeeded.');
    }
  }

  /**
   * Starts the credit worker for processing queued webhook events.
   * Drains any pending events from previous run, then goes idle.
   */
  async startCreditWorker() {
    if (!this.creditWorker) {
      this.logger.warn('[CreditService] Credit worker not available (webhook actions may be disabled).');
      return;
    }
    await this.creditWorker.start();
  }

  /**
   * Stops the credit worker gracefully.
   * @returns {Promise<void>}
   */
  async stopCreditWorker() {
    if (!this.creditWorker) {
      return;
    }
    await this.creditWorker.stop();
  }

  /**
   * Gets credit worker statistics.
   * @returns {object|null}
   */
  getCreditWorkerStats() {
    if (!this.creditWorker) {
      return null;
    }
    return this.creditWorker.getStats();
  }

  /**
   * Gets webhook queue statistics.
   * @returns {Promise<object>}
   */
  async getWebhookQueueStats() {
    if (!this.webhookEventQueueDb) {
      return { error: 'Queue not available' };
    }
    return this.webhookEventQueueDb.getQueueStats();
  }

  /**
   * Gracefully stops the credit service.
   * Waits for the worker to finish current processing before returning.
   * @returns {Promise<void>}
   */
  async stop() {
    this.logger.info('[CreditService] Stopping service...');
    await this.stopCreditWorker();
    this.logger.info('[CreditService] Service stopped gracefully.');
  }

  /**
   * Checks for vault deployments that have been pending for too long and marks them as failed.
   */
  async checkStaleVaultDeployments() {
    return await this.referralVaultService.checkStaleDeployments();
  }

  /**
   * Handles all events received from an Alchemy webhook.
   * Enqueues the event for processing by the worker (fire-and-forget for fast response).
   * @param {object} webhookPayload - The raw webhook payload
   * @param {object} options - Options
   * @param {boolean} options.synchronous - If true, process immediately instead of enqueueing (legacy mode)
   * @returns {Promise<{success: boolean, message: string, eventId?: string}>}
   */
  async handleEventWebhook(webhookPayload, options = {}) {
    if (this.disableWebhookActions) {
      this.logger.warn('[CreditService] Ignoring event webhook because webhook-driven actions are disabled.');
      return { success: false, message: 'Webhook actions disabled in this environment.' };
    }

    // Legacy synchronous mode (for testing or direct processing)
    if (options.synchronous) {
      if (!this.eventWebhookProcessor) {
        this.logger.error('[CreditService] Event webhook processor unavailable.');
        return { success: false, message: 'Webhook processor unavailable.' };
      }
      return await this.eventWebhookProcessor.processWebhook(webhookPayload);
    }

    // Default: Enqueue for worker processing (fast response, reliable delivery)
    if (!this.webhookEventQueueDb) {
      this.logger.error('[CreditService] Webhook event queue unavailable.');
      return { success: false, message: 'Webhook queue unavailable.' };
    }

    try {
      const result = await this.webhookEventQueueDb.enqueue('credit_webhook', webhookPayload, {
        received_at: new Date().toISOString()
      });

      this.logger.debug(`[CreditService] Webhook enqueued for processing: ${result.insertedId}`);

      // Immediately trigger processing (event-driven, no polling)
      if (this.creditWorker) {
        // Fire and forget - don't await, return fast to Alchemy
        this.creditWorker.triggerProcessing().catch(err => {
          this.logger.error('[CreditService] Error triggering worker:', err);
        });
      }

      return {
        success: true,
        message: 'Webhook enqueued for processing',
        eventId: result.insertedId.toString()
      };
    } catch (error) {
      this.logger.error('[CreditService] Failed to enqueue webhook:', error);
      return { success: false, message: `Failed to enqueue: ${error.message}` };
    }
  }

  /**
   * Creates a new referral vault account for a user.
   */
  async createReferralVault(ownerAddress) {
    return await this.referralVaultService.createVault(ownerAddress);
  }

  /**
   * Estimates the gas cost in USD for a deposit transaction.
   */
  async estimateDepositGasCostInUsd({ type, assetAddress, amount, userWalletAddress, tokenId }) {
    const { address: vaultAddress, abi: vaultAbi } = this.contractConfig;
    try {
      if (type === 'token') {
        if (assetAddress === '0x0000000000000000000000000000000000000000') {
          const tx = {
            to: vaultAddress,
            from: userWalletAddress,
            value: '0x1', // 1 wei — gas units are identical regardless of ETH value sent
          };
          const gasEstimate = await this.ethereumService.getProvider().estimateGas(tx);
          const gasPrice = (await this.ethereumService.getProvider().getFeeData()).gasPrice;
          const ethPriceUsd = await this.priceFeedService.getPriceInUsd(assetAddress);
          const estimatedCostUsd = tokenDecimalService.calculateUsdValue(gasEstimate * gasPrice, '0x0000000000000000000000000000000000000000', ethPriceUsd);
          return estimatedCostUsd;
        } else {
          return await this.ethereumService.estimateGasCostInUsd(
            vaultAddress,
            vaultAbi,
            'pay',
            assetAddress,
            amount
          );
        }
      } else if (type === 'nft') {
        const erc721Abi = ["function safeTransferFrom(address from, address to, uint256 tokenId)"];
        return await this.ethereumService.estimateGasCostInUsd(
          assetAddress,
          erc721Abi,
          'safeTransferFrom',
          userWalletAddress,
          vaultAddress,
          tokenId
        );
      } else {
        throw new Error(`Unsupported type for gas estimation: ${type}`);
      }
    } catch (err) {
      this.logger.error('[CreditService] Failed to estimate deposit gas cost:', err);
      throw err;
    }
  }

  /**
   * Deploys a new referral vault, records it, and returns the vault data.
   */
  async deployReferralVault(details) {
    return await this.referralVaultService.deployVault(details);
  }

  /**
   * Finalizes a vault deployment after the on-chain transaction is confirmed.
   */
  async finalizeVaultDeployment(txHash, vaultAddress) {
    return await this.referralVaultService.finalizeDeployment(txHash, vaultAddress);
  }

  /**
   * Charges a user for spell execution by deducting points from their confirmed deposits.
   */
  async chargeSpellExecution(payerAccountId, spellId, quote, creatorSharePct = 0.7) {
    if (!quote || typeof quote.totalCostPts !== 'number') {
      throw new Error('chargeSpellExecution requires a quote with totalCostPts');
    }
    const pointsNeeded = Math.ceil(quote.totalCostPts);
    if (pointsNeeded <= 0) {
      throw new Error('Quote totalCostPts must be greater than zero');
    }

    // 1. Ensure user has enough points
    const activeDeposits = await this.creditLedgerDb.findActiveDepositsForUser(payerAccountId);
    let pointsAvailable = activeDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);
    if (pointsAvailable < pointsNeeded) {
      throw new Error('INSUFFICIENT_POINTS');
    }

    // 2. Deduct points from deposits (cheapest first)
    let remaining = pointsNeeded;
    for (const deposit of activeDeposits) {
      if (remaining <= 0) break;
      const deduct = Math.min(deposit.points_remaining, remaining);
      await this.creditLedgerDb.deductPointsFromDeposit(deposit._id, deduct);
      remaining -= deduct;
    }

    // 3. Fetch spell metadata to identify creator
    // Phase 7i: in-process spell lookup replacing HTTP GET /spells/:id
    let spellMeta;
    try {
      if (this.spellsDb) {
        spellMeta = await this.spellsDb.findById(spellId);
      } else {
        const resp = await this.internalApiClient.get(`/internal/v1/data/spells/${spellId}`);
        spellMeta = resp.data;
      }
    } catch (err) {
      this.logger.warn(`[CreditService] Unable to fetch spell ${spellId} for creator payout: ${err.message}`);
    }

    if (spellMeta && spellMeta.creatorId) {
      const creatorSharePts = Math.floor(pointsNeeded * creatorSharePct);
      try {
        await this.routeReferralOrCreatorShare(spellMeta.creatorId, creatorSharePts, { spellId });
      } catch (err) {
        this.logger.error('[CreditService] Failed to route creator share:', err);
      }
    }

    const { v4: uuidv4 } = require('uuid');
    const creditTxId = uuidv4();
    return { creditTxId, pointsCharged: pointsNeeded };
  }

  /**
   * Routes a point reward to the creator's referral vault if it exists, otherwise directly to the creator.
   */
  async routeReferralOrCreatorShare(creatorAccountId, points, meta = {}) {
    return await this.referralRewardService.routeReward(creatorAccountId, points, meta);
  }

  /**
   * Checks if an address is the admin (owner of miladystation NFT #598).
   */
  async isAdminAddress(address) {
    return await this.adminOperationsService.isAdmin(address);
  }
}

module.exports = CreditService;
