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
      adminActivityService 
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
    
    const { foundationAddress, foundationAbi } = config;
    if (!foundationAddress || !foundationAbi) {
      throw new Error('CreditService: Missing contract address or ABI in config.');
    }
    this.contractConfig = { address: foundationAddress, abi: foundationAbi };

    // Initialize extracted services
    this._initializeServices();

    this.logger.info(`[CreditService] Configured to use Foundation at address: ${this.contractConfig.address}`);
    this.logger.info('[CreditService] Initialized (refactored facade).');
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
      this.logger
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
      this.logger
    );

    // 12. Referral Vault Service
    this.referralVaultService = new ReferralVaultService(
      this.ethereumService,
      this.creditLedgerDb,
      this.saltMiningService,
      this.internalApiClient,
      this.depositNotificationService,
      this.contractConfig,
      this.logger
    );

    // 13. Event Webhook Processor
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
  }

  /**
   * Starts the service.
   * Runs the startup reconciliation for missed events and processes the pending queue.
   */
  async start() {
    this.logger.info('[CreditService] Starting service...');
    try {
      this.logger.info('[CreditService] Stage 1: Acknowledging new deposit events...');
      await this.acknowledgeNewEvents();
      this.logger.info('[CreditService] Stage 2: Processing pending confirmations...');
      await this.processPendingConfirmations();
      this.logger.info('[CreditService] Stage 3: Checking for stale vault deployments...');
      await this.checkStaleVaultDeployments();
      this.logger.info('[CreditService] Startup processing complete.');
    } catch (error) {
      this.logger.error('[CreditService] CRITICAL: Reconciliation or processing failed during startup.', error);
    }
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
   */
  async handleEventWebhook(webhookPayload) {
    return await this.eventWebhookProcessor.processWebhook(webhookPayload);
  }

  /**
   * Processes all deposits that are in a 'PENDING_CONFIRMATION' or 'ERROR' state.
   */
  async processPendingConfirmations() {
    this.logger.info(`[CreditService] Checking for deposits pending confirmation or in error state...`);
    const pendingDepositsAll = await this.creditLedgerDb.findProcessableEntries();
    const pendingDeposits = pendingDepositsAll.filter(d => d.deposit_type !== 'TOKEN_DONATION');

    if (pendingDeposits.length === 0) {
      this.logger.info('[CreditService] No deposits are pending confirmation or in error state.');
      return;
    }

    this.logger.info(`[CreditService] Found ${pendingDeposits.length} total deposits to process. Grouping by user and token...`);

    // Group deposits by a composite key of user address and token address.
    const groupedDeposits = new Map();
    for (const deposit of pendingDeposits) {
      const key = `${deposit.depositor_address}-${deposit.token_address}`;
      if (!groupedDeposits.has(key)) {
        groupedDeposits.set(key, []);
      }
      groupedDeposits.get(key).push(deposit);
    }

    this.logger.info(`[CreditService] Processing ${groupedDeposits.size} unique user-token groups.`);

    for (const [groupKey, deposits] of groupedDeposits.entries()) {
      this.logger.info(`[CreditService] >>> Processing group: ${groupKey}`);
      await this.depositConfirmationService.confirmDepositGroup(deposits);
      this.logger.info(`[CreditService] <<< Finished processing group: ${groupKey}`);
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
    this.logger.info('[CreditService] Processing withdrawal request webhook...');

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
          this.logger.info(`[CreditService] Withdrawal request ${transactionHash} already processed`);
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
            value: amount
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
    let spellMeta;
    try {
      const resp = await this.internalApiClient.get(`/internal/v1/data/spells/${spellId}`);
      spellMeta = resp.data;
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

