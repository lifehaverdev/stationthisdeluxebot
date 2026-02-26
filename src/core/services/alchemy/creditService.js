/**
 * CreditService (Refactored Facade)
 * 
 * This is a facade that maintains backward compatibility while delegating
 * to specialized services extracted from the original monolithic implementation.
 * 
 * All public APIs are maintained for backward compatibility.
 */
const { ethers } = require('ethers');
const { getCustodyKey, splitCustodyAmount } = require('./contractUtils');
const tokenDecimalService = require('../tokenDecimalService');

// Import extracted services
const EventDeduplicationService = require('./credit/EventDeduplicationService');
const DepositNotificationService = require('./credit/DepositNotificationService');
const ReferralRewardService = require('./credit/ReferralRewardService');
const MagicAmountLinkingService = require('./credit/MagicAmountLinkingService');
const AdminOperationsService = require('./credit/AdminOperationsService');
const DonationProcessorService = require('./credit/DonationProcessorService');
const EventReconciliationService = require('./credit/EventReconciliationService');
const DepositConfirmationService = require('./credit/DepositConfirmationService');
const DepositProcessorService = require('./credit/DepositProcessorService');
const WithdrawalExecutionService = require('./credit/WithdrawalExecutionService');
const WithdrawalProcessorService = require('./credit/WithdrawalProcessorService');
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
   * @param {string} config.foundationAddress - The address of the on-chain Foundation contract.
   * @param {Array} config.foundationAbi - The ABI of the Foundation contract.
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
      walletLinkingRequestDb,
      walletLinkingService,
      saltMiningService,
      webSocketService,
      adminActivityService,
      spellsDb // Phase 7i: in-process spell metadata lookup
    } = services;
    
    if (!ethereumService || !creditLedgerDb || !systemStateDb || !priceFeedService || !tokenRiskEngine || !internalApiClient || !userCoreDb || !walletLinkingRequestDb || !walletLinkingService || !saltMiningService || !webSocketService) {
      throw new Error('CreditService: Missing one or more required services.');
    }

    // Store dependencies for direct access if needed
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.systemStateDb = systemStateDb;
    this.priceFeedService = priceFeedService;
    this.tokenRiskEngine = tokenRiskEngine;
    this.internalApiClient = internalApiClient;
    this.userCoreDb = userCoreDb;
    this.walletLinkingRequestDb = walletLinkingRequestDb;
    this.walletLinkingService = walletLinkingService;
    this.saltMiningService = saltMiningService;
    this.webSocketService = webSocketService;
    this.adminActivityService = adminActivityService;
    this.spellPaymentService = services.spellPaymentService || null;
    this.spellsDb = spellsDb || null;
    
    const { foundationAddress, foundationAbi, disableWebhookActions: disableWebhookActionsConfig } = config;
    const disableWebhookActionsEnv = process.env.DISABLE_CREDIT_WEBHOOK_ACTIONS === '1';
    this.disableWebhookActions = (typeof disableWebhookActionsConfig === 'boolean')
      ? disableWebhookActionsConfig
      : disableWebhookActionsEnv;
    if (this.disableWebhookActions) {
      this.logger.debug('[CreditService] Webhook-dependent credit actions are DISABLED for this environment.');
    }
    if (!foundationAddress || !foundationAbi) {
      throw new Error('CreditService: Missing contract address or ABI in config.');
    }
    this.contractConfig = { address: foundationAddress, abi: foundationAbi };

    // Initialize extracted services
    this._initializeServices();

    this.logger.debug(`[CreditService] Configured to use Foundation at address: ${this.contractConfig.address}`);
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

    // 4. Magic Amount Linking Service
    this.magicAmountLinkingService = new MagicAmountLinkingService(
      this.walletLinkingRequestDb,
      this.walletLinkingService,
      this.userCoreDb,
      this.logger
    );

    // 5. Admin Operations Service
    this.adminOperationsService = new AdminOperationsService(this.ethereumService, this.logger);

    // 6. Donation Processor Service
    this.donationProcessorService = new DonationProcessorService(
      this.ethereumService,
      this.creditLedgerDb,
      this.priceFeedService,
      this.internalApiClient,
      this.depositNotificationService,
      this.eventDeduplicationService,
      this.contractConfig,
      this.logger
    );

    // 7. Event Reconciliation Service
    this.eventReconciliationService = new EventReconciliationService(
      this.ethereumService,
      this.systemStateDb,
      this.creditLedgerDb,
      this.magicAmountLinkingService,
      this.contractConfig,
      this.logger
    );

    // 8. Deposit Confirmation Service
    this.depositConfirmationService = new DepositConfirmationService(
      this.ethereumService,
      this.creditLedgerDb,
      this.priceFeedService,
      this.tokenRiskEngine,
      this.internalApiClient,
      this.depositNotificationService,
      this.eventDeduplicationService,
      this.contractConfig,
      this.spellPaymentService,
      this.adminActivityService,
      this.logger
    );

    // 9. Deposit Processor Service
    this.depositProcessorService = new DepositProcessorService(
      this.ethereumService,
      this.creditLedgerDb,
      this.internalApiClient,
      this.depositConfirmationService,
      this.magicAmountLinkingService,
      this.eventDeduplicationService,
      this.contractConfig,
      this.logger,
      this.userCoreDb // Phase 7b: in-process wallet lookup
    );

    // 10. Withdrawal Execution Service
    this.withdrawalExecutionService = new WithdrawalExecutionService(
      this.ethereumService,
      this.creditLedgerDb,
      this.priceFeedService,
      this.tokenRiskEngine,
      this.adminOperationsService,
      this.adminActivityService,
      this.contractConfig,
      this.logger
    );

    // 11. Withdrawal Processor Service
    this.withdrawalProcessorService = new WithdrawalProcessorService(
      this.ethereumService,
      this.creditLedgerDb,
      this.internalApiClient,
      this.withdrawalExecutionService,
      this.contractConfig,
      this.logger,
      this.userCoreDb // Phase 7b: in-process wallet lookup
    );

    // 12. Referral Vault Service
    this.referralVaultService = new ReferralVaultService(
      this.ethereumService,
      this.creditLedgerDb,
      this.saltMiningService,
      this.internalApiClient,
      this.depositNotificationService,
      this.contractConfig,
      this.logger,
      this.userCoreDb // Phase 7b: in-process wallet lookup
    );

    // 13. Event Webhook Processor
    if (!this.disableWebhookActions) {
      this.eventWebhookProcessor = new EventWebhookProcessor(
        this.ethereumService,
        this.depositProcessorService,
        this.donationProcessorService,
        this.withdrawalProcessorService,
        this.referralVaultService,
        this.eventDeduplicationService,
        this.depositConfirmationService,
        this.contractConfig,
        this.logger
      );
    } else {
      this.eventWebhookProcessor = null;
      this.logger.debug('[CreditService] Event webhook processor not initialized (disabled).');
    }

    // 14. Webhook Event Queue (MongoDB-backed job queue)
    this.webhookEventQueueDb = new WebhookEventQueueDb(this.logger);

    // 15. Credit Worker (processes queued webhook events)
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

    // Stage 1: Acknowledge new deposit events (may fail if internal API not ready)
    try {
      this.logger.info('[CreditService] Stage 1: Acknowledging new deposit events...');
      await this.acknowledgeNewEvents();
      this.logger.info('[CreditService] Stage 1 complete.');
      stagesCompleted++;
    } catch (error) {
      stagesFailed++;
      this.logger.error('[CreditService] Stage 1 failed (acknowledging events):', error.message);
      // Continue to Stage 2 anyway
    }

    // Stage 2: Process pending confirmations (critical for confirming deposits)
    try {
      this.logger.info('[CreditService] Stage 2: Processing pending confirmations...');
      await this.processPendingConfirmations();
      this.logger.info('[CreditService] Stage 2 complete.');
      stagesCompleted++;
    } catch (error) {
      stagesFailed++;
      this.logger.error('[CreditService] Stage 2 failed (processing confirmations):', error.message);
      // Continue to Stage 3 anyway
    }

    // Stage 3: Check for stale vault deployments
    try {
      this.logger.info('[CreditService] Stage 3: Checking for stale vault deployments...');
      await this.checkStaleVaultDeployments();
      this.logger.info('[CreditService] Stage 3 complete.');
      stagesCompleted++;
    } catch (error) {
      stagesFailed++;
      this.logger.error('[CreditService] Stage 3 failed (stale vault check):', error.message);
    }

    // Stage 4: Initial reconciliation of stuck deposits
    try {
      this.logger.info('[CreditService] Stage 4: Running initial reconciliation of stuck deposits...');
      const result = await this.reconcileStuckDeposits();
      this.logger.info(`[CreditService] Stage 4 complete. Reconciled: ${result.reconciled}, Still stuck: ${result.stillStuck}`);
      stagesCompleted++;
    } catch (error) {
      stagesFailed++;
      this.logger.error('[CreditService] Stage 4 failed (stuck deposit reconciliation):', error.message);
    }

    // Stage 5: Start credit worker for queue processing (drains pending events)
    try {
      this.logger.info('[CreditService] Stage 5: Starting credit worker and draining pending events...');
      await this.startCreditWorker();
      this.logger.info('[CreditService] Stage 5 complete. Credit worker started and queue drained.');
      stagesCompleted++;
    } catch (error) {
      stagesFailed++;
      this.logger.error('[CreditService] Stage 5 failed (credit worker start):', error.message);
    }

    if (stagesFailed > 0) {
      this.logger.warn(`[CreditService] Startup completed with ${stagesFailed} failed stage(s) and ${stagesCompleted} successful stage(s).`);
    } else {
      this.logger.info('[CreditService] Startup processing complete. All stages succeeded.');
    }

    // Start periodic reconciliation (every 5 minutes)
    this.startPeriodicReconciliation(5 * 60 * 1000);
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
   * Starts periodic reconciliation of stuck deposits.
   * @param {number} intervalMs - Interval in milliseconds (default: 5 minutes)
   */
  startPeriodicReconciliation(intervalMs = 5 * 60 * 1000) {
    if (this.reconciliationInterval) {
      this.logger.warn('[CreditService] Periodic reconciliation already running. Clearing existing interval.');
      clearInterval(this.reconciliationInterval);
    }

    this.logger.info(`[CreditService] Starting periodic reconciliation every ${intervalMs / 1000}s`);
    this.reconciliationInterval = setInterval(async () => {
      try {
        await this.reconcileStuckDeposits();
      } catch (error) {
        this.logger.error('[CreditService] Periodic reconciliation failed:', error.message);
      }
    }, intervalMs);

    // Don't let the interval keep the process alive if everything else is done
    if (this.reconciliationInterval.unref) {
      this.reconciliationInterval.unref();
    }
  }

  /**
   * Stops periodic reconciliation.
   */
  stopPeriodicReconciliation() {
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
      this.logger.info('[CreditService] Periodic reconciliation stopped.');
    }
  }

  /**
   * Gracefully stops the credit service.
   * Waits for the worker to finish current processing before returning.
   * Call this before shutting down the application or during deploys.
   * @returns {Promise<void>}
   */
  async stop() {
    this.logger.info('[CreditService] Stopping service...');

    // Stop accepting new work
    this.stopPeriodicReconciliation();

    // Wait for worker to finish current event
    await this.stopCreditWorker();

    this.logger.info('[CreditService] Service stopped gracefully.');
  }

  /**
   * Reconciles stuck PENDING_CONFIRMATION deposits.
   * Delegates to EventWebhookProcessor if available.
   * @returns {Promise<{reconciled: number, stillStuck: number}>}
   */
  async reconcileStuckDeposits() {
    if (!this.eventWebhookProcessor) {
      this.logger.warn('[CreditService] Cannot reconcile - event webhook processor unavailable.');
      return { reconciled: 0, stillStuck: 0 };
    }
    return await this.eventWebhookProcessor.reconcileStuckDeposits();
  }

  /**
   * Checks for vault deployments that have been pending for too long and marks them as failed.
   */
  async checkStaleVaultDeployments() {
    return await this.referralVaultService.checkStaleDeployments();
  }

  /**
   * Acknowledges new deposit events by scanning for missed events.
   */
  async acknowledgeNewEvents() {
    return await this.eventReconciliationService.reconcileMissedEvents();
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
   * Handles a withdrawal webhook by enqueueing it.
   * @param {object} webhookPayload - The raw webhook payload
   * @returns {Promise<{success: boolean, message: string, eventId?: string}>}
   */
  async handleWithdrawalWebhookQueued(webhookPayload) {
    if (this.disableWebhookActions) {
      this.logger.warn('[CreditService] Ignoring withdrawal webhook because webhook-driven actions are disabled.');
      return { success: false, message: 'Webhook actions disabled in this environment.' };
    }

    if (!this.webhookEventQueueDb) {
      this.logger.error('[CreditService] Webhook event queue unavailable.');
      return { success: false, message: 'Webhook queue unavailable.' };
    }

    try {
      const result = await this.webhookEventQueueDb.enqueue('withdrawal_webhook', webhookPayload, {
        received_at: new Date().toISOString()
      });

      this.logger.debug(`[CreditService] Withdrawal webhook enqueued: ${result.insertedId}`);

      // Immediately trigger processing (event-driven, no polling)
      if (this.creditWorker) {
        this.creditWorker.triggerProcessing().catch(err => {
          this.logger.error('[CreditService] Error triggering worker:', err);
        });
      }

      return {
        success: true,
        message: 'Withdrawal webhook enqueued for processing',
        eventId: result.insertedId.toString()
      };
    } catch (error) {
      this.logger.error('[CreditService] Failed to enqueue withdrawal webhook:', error);
      return { success: false, message: `Failed to enqueue: ${error.message}` };
    }
  }

  /**
   * Processes all deposits that are in a 'PENDING_CONFIRMATION' or 'ERROR' state.
   */
  async processPendingConfirmations() {
    this.logger.debug(`[CreditService] Checking for deposits pending confirmation or in error state...`);
    const pendingDepositsAll = await this.creditLedgerDb.findProcessableEntries();
    const pendingDeposits = pendingDepositsAll.filter(d => d.deposit_type !== 'TOKEN_DONATION');

    if (pendingDeposits.length === 0) {
      this.logger.debug('[CreditService] No deposits are pending confirmation or in error state.');
      return;
    }

    this.logger.debug(`[CreditService] Found ${pendingDeposits.length} total deposits to process. Grouping by user and token...`);

    // Group deposits by a composite key of user address and token address.
    const groupedDeposits = new Map();
    for (const deposit of pendingDeposits) {
      const key = `${deposit.depositor_address}-${deposit.token_address}`;
      if (!groupedDeposits.has(key)) {
        groupedDeposits.set(key, []);
      }
      groupedDeposits.get(key).push(deposit);
    }

    this.logger.debug(`[CreditService] Processing ${groupedDeposits.size} unique user-token groups.`);

    for (const [groupKey, deposits] of groupedDeposits.entries()) {
      this.logger.debug(`[CreditService] >>> Processing group: ${groupKey}`);
      await this.depositConfirmationService.confirmDepositGroup(deposits);
      this.logger.debug(`[CreditService] <<< Finished processing group: ${groupKey}`);
    }
  }

  /**
   * Initiates a withdrawal request for a user.
   */
  async initiateWithdrawal(userAddress, tokenAddress, fundAddress = this.contractConfig.address) {
    return await this.withdrawalProcessorService.initiateWithdrawal(userAddress, tokenAddress, fundAddress);
  }

  /**
   * Handles a RescissionRequested event from the webhook.
   */
  async handleWithdrawalRequestWebhook(webhookPayload) {
    if (this.disableWebhookActions) {
      this.logger.warn('[CreditService] Ignoring withdrawal webhook because webhook-driven actions are disabled.');
      return { success: false, message: 'Webhook actions disabled in this environment.' };
    }
    this.logger.debug('[CreditService] Processing withdrawal request webhook...');

    const eventPayload = webhookPayload.payload || webhookPayload;

    if (eventPayload.type !== 'GRAPHQL' || !eventPayload.event?.data?.block?.logs) {
      this.logger.warn('[CreditService] Invalid webhook payload structure');
      return { success: false, message: 'Invalid payload structure' };
    }

    const logs = eventPayload.event.data.block.logs;
    const eventFragment = this.ethereumService.getEventFragment('RescissionRequested', this.contractConfig.abi);
    if (!eventFragment) {
      this.logger.error('[CreditService] RescissionRequested event fragment not found in ABI');
      return { success: false, message: 'Configuration error: ABI issue' };
    }

    const eventSignatureHash = this.ethereumService.getEventTopic(eventFragment);
    let processedCount = 0;

    for (const log of logs) {
      const { transaction, topics, data } = log;
      const { hash: transactionHash } = transaction;
      const blockNumber = (eventPayload.event && eventPayload.event.data && eventPayload.event.data.block && eventPayload.event.data.block.number) || null;

      if (topics[0] !== eventSignatureHash) {
        continue;
      }

      try {
        const existingRequest = await this.creditLedgerDb.findWithdrawalRequestByTxHash(transactionHash);
        if (existingRequest) {
          this.logger.debug(`[CreditService] Withdrawal request ${transactionHash} already processed`);
          continue;
        }

        const decodedLog = this.ethereumService.decodeEventLog(eventFragment, data, topics, this.contractConfig.abi);
        await this.withdrawalProcessorService.processWithdrawalRequest(decodedLog, transactionHash, blockNumber);
        processedCount++;
      } catch (error) {
        this.logger.error(`[CreditService] Error processing withdrawal request from webhook:`, error);
      }
    }

    return {
      success: true,
      message: `Processed ${processedCount} withdrawal requests`
    };
  }

  /**
   * Processes a pending withdrawal request.
   */
  async processWithdrawalRequest(requestTxHash) {
    return await this.withdrawalExecutionService.executeWithdrawal(requestTxHash);
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
            'contribute',
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
   * Gets the protocolEscrow balance for a specific token in the Foundation contract.
   */
  async getProtocolEscrowBalance(tokenAddress) {
    try {
      const custodyKey = getCustodyKey(this.contractConfig.address, tokenAddress);
      const packedAmount = await this.ethereumService.read(
        this.contractConfig.address,
        this.contractConfig.abi,
        'custody',
        custodyKey
      );
      const { userOwned, escrow } = splitCustodyAmount(packedAmount);
      return { userOwned, escrow, protocolEscrow: escrow };
    } catch (error) {
      this.logger.error(`[CreditService] Error getting protocolEscrow balance for token ${tokenAddress}:`, error);
      return { userOwned: 0n, escrow: 0n, protocolEscrow: 0n };
    }
  }

  /**
   * Checks if an address is the admin (owner of miladystation NFT #598).
   */
  async isAdminAddress(address) {
    return await this.adminOperationsService.isAdmin(address);
  }
}

module.exports = CreditService;
