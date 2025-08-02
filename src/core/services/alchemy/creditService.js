const { ethers, formatEther, keccak256, toUtf8Bytes } = require('ethers');
const CreditLedgerDB = require('../db/alchemy/creditLedgerDb');
const SystemStateDB = require('../db/alchemy/systemStateDb');
const { getCustodyKey, splitCustodyAmount } = require('./contractUtils');
const WalletLinkingRequestDB = require('../db/walletLinkingRequestDb');
const WalletLinkingService = require('../walletLinkingService');
const { getFundingRate, getDecimals, DEFAULT_FUNDING_RATE } = require('./tokenConfig');
// const NoemaUserCoreDB = require('../db/noemaUserCoreDb'); // To be implemented
// const NoemaUserEconomyDB = require('../db/noemaUserEconomyDb'); // To be implemented

// This should be the actual block number of the contract deployment on the target chain.
const CONTRACT_DEPLOYMENT_BLOCK = 8589453; 
// The address representing native ETH in contract events (typically the zero address).
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
// Conversion rate for USD to internal credit points.
const USD_TO_POINTS_CONVERSION_RATE = 0.000337;

// --- In-memory cache for recently processed tx hashes (debounce duplicate webhook processing) ---
const RECENT_TX_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const recentProcessedTxHashes = new Map(); // txHash -> timestamp

// --- In-memory lock for currently processing user-token groups ---
const processingGroups = new Set(); // groupKey -> true

function addTxToCache(txHash) {
  recentProcessedTxHashes.set(txHash, Date.now());
}

function isTxInCache(txHash) {
  const ts = recentProcessedTxHashes.get(txHash);
  if (!ts) return false;
  if (Date.now() - ts > RECENT_TX_CACHE_TTL_MS) {
    recentProcessedTxHashes.delete(txHash);
    return false;
  }
  return true;
}

function cleanupTxCache() {
  const now = Date.now();
  for (const [txHash, ts] of recentProcessedTxHashes.entries()) {
    if (now - ts > RECENT_TX_CACHE_TTL_MS) {
      recentProcessedTxHashes.delete(txHash);
    }
  }
}
setInterval(cleanupTxCache, 60 * 1000); // Clean up every minute

function getGroupKey(user, token) {
  return user.toLowerCase() + '-' + token.toLowerCase();
}

/**
 * @class CreditService
 * @description Manages the credit lifecycle, from event detection to off-chain accounting.
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
   * @param {object} config - Configuration object.
   * @param {string} config.foundationAddress - The address of the on-chain Foundation contract.
   * @param {Array} config.foundationAbi - The ABI of the Foundation contract.
   * @param {object} logger - A logger instance.
   */
  constructor(services, config, logger) {
    this.logger = logger || console;

    const { ethereumService, creditLedgerDb, systemStateDb, priceFeedService, tokenRiskEngine, internalApiClient, userCoreDb, walletLinkingRequestDb, walletLinkingService, saltMiningService, webSocketService } = services;
    if (!ethereumService || !creditLedgerDb || !systemStateDb || !priceFeedService || !tokenRiskEngine || !internalApiClient || !userCoreDb || !walletLinkingRequestDb || !walletLinkingService || !saltMiningService || !webSocketService) {
      throw new Error('CreditService: Missing one or more required services.');
    }
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
    
    const { foundationAddress, foundationAbi } = config;
    if (!foundationAddress || !foundationAbi) {
        throw new Error('CreditService: Missing contract address or ABI in config.');
    }
    this.contractConfig = { address: foundationAddress, abi: foundationAbi };

    this.logger.info(`[CreditService] Configured to use Foundation at address: ${this.contractConfig.address}`);
    this.logger.info('[CreditService] Initialized.');

    // The start() method is now the primary entry point.
    // The constructor no longer runs the reconciliation logic directly.
  }

  /**
   * Starts the service.
   * Runs the startup reconciliation for missed events and processes the pending queue.
   */
  async start() {
    this.logger.info('[CreditService] Starting service...');
    try {
        // No longer clearing collections on startup to maintain state.
        this.logger.info('[CreditService] Stage 1: Acknowledging new deposit events...');
        await this.acknowledgeNewEvents();
        this.logger.info('[CreditService] Stage 2: Processing pending confirmations...');
        await this.processPendingConfirmations();
        this.logger.info('[CreditService] Startup processing complete.');
    } catch (error) {
        this.logger.error('[CreditService] CRITICAL: Reconciliation or processing failed during startup.', error);
    }
  }

  /**
   * STAGE 1: Scans for and acknowledges any `ContributionRecorded` events not yet in our database.
   */
  async acknowledgeNewEvents() {
    this.logger.info('[CreditService] Starting acknowledgment of new deposit events...');
    const fromBlock = (await this.systemStateDb.getLastSyncedBlock(CONTRACT_DEPLOYMENT_BLOCK)) + 1;
    const toBlock = await this.ethereumService.getLatestBlock();

    if (fromBlock > toBlock) {
      this.logger.info(`[CreditService] No new blocks to sync. Last synced block: ${toBlock}`);
      return;
    }

    this.logger.info(`[CreditService] Fetching 'ContributionRecorded' events from block ${fromBlock} to ${toBlock}.`);
    const pastDepositEvents = await this.ethereumService.getPastEvents(
      this.contractConfig.address,
      this.contractConfig.abi,
      'ContributionRecorded',
      fromBlock,
      toBlock,
    );

    this.logger.info(`[CreditService] Found ${pastDepositEvents.length} new 'ContributionRecorded' events. Acknowledging...`);

    for (const event of pastDepositEvents) {
        const { transactionHash, logIndex, blockNumber, args } = event;
        let { fundAddress } = args;
        const { user, token, amount } = args;

        // --- MAGIC AMOUNT WALLET LINKING ---
        const wasHandledByLinking = await this._handleMagicAmountLinking(user, token, amount.toString());
        if (wasHandledByLinking) {
            this.logger.info(`[CreditService] Deposit from tx ${transactionHash} was a magic amount and has been fully processed. Skipping credit ledger entry.`);
            continue; // Skip to the next event.
        }
        // --- END MAGIC AMOUNT ---

        // If fundAddress is not in the event args, it's a deposit to the main vault.
        // In this case, the fundAddress IS the main contract address.
        if (!fundAddress || !ethers.isAddress(fundAddress)) {
            this.logger.warn(`[CreditService] 'fundAddress' not found or invalid in event args for tx ${transactionHash}. Assuming deposit to main vault.`);
            fundAddress = this.contractConfig.address;
        }

        const existingEntry = await this.creditLedgerDb.findLedgerEntryByTxHash(transactionHash);
        if (existingEntry) {
            this.logger.debug(`[CreditService] Skipping event for tx ${transactionHash} as it's already acknowledged.`);
            continue;
    }

        this.logger.info(`[CreditService] Acknowledging new deposit: ${transactionHash}`);
        await this.creditLedgerDb.createLedgerEntry({
            deposit_tx_hash: transactionHash,
            deposit_log_index: logIndex,
            deposit_block_number: blockNumber,
            vault_account: fundAddress, // Stays vault_account in DB for now
            depositor_address: user,
            token_address: token,
            deposit_amount_wei: amount.toString(),
            status: 'PENDING_CONFIRMATION', // Initial status
        });
    }

    this.logger.info('[CreditService] Event acknowledgment process completed.');
    await this.systemStateDb.setLastSyncedBlock(toBlock);
  }

  /**
   * Handles all events received from an Alchemy webhook.
   * This is the main entry point for processing blockchain events.
   * @param {object} webhookPayload - The raw payload from the Alchemy webhook.
   * @returns {Promise<{success: boolean, message: string, detail: object|null}>}
   */
  async handleEventWebhook(webhookPayload) {
    this.logger.info('[CreditService] Processing incoming Alchemy webhook...');

    // Handle cases where the relevant data might be nested inside a 'payload' property
    const eventPayload = webhookPayload.payload || webhookPayload;

    if (eventPayload.type !== 'GRAPHQL' || !eventPayload.event?.data?.block?.logs) {
        this.logger.warn('[CreditService] Webhook payload is not a valid GraphQL block log notification or is malformed.', { payloadKeys: Object.keys(eventPayload || {}) });
        return { success: false, message: 'Invalid payload structure. Expected GraphQL block logs.', detail: null };
    }

    const logs = eventPayload.event.data.block.logs;
    this.logger.info(`[CreditService] Webhook contains ${logs.length} event logs to process.`);

    // Get event fragments for all events we're interested in
    const depositEventFragment = this.ethereumService.getEventFragment('ContributionRecorded', this.contractConfig.abi);
    const withdrawalEventFragment = this.ethereumService.getEventFragment('RescissionRequested', this.contractConfig.abi);
    const vaultCreatedEventFragment = this.ethereumService.getEventFragment('FundChartered', this.contractConfig.abi); 
    // const nftDepositEventFragment = this.ethereumService.getEventFragment('NFTDepositRecorded', this.contractConfig.abi);

    if (!depositEventFragment || !withdrawalEventFragment || !vaultCreatedEventFragment ) {//|| !nftDepositEventFragment) {
        this.logger.error("[CreditService] Event fragments not found in ABI. Cannot process webhook.");
        return { success: false, message: "Server configuration error: ABI issue.", detail: null };
    }

    const depositEventHash = this.ethereumService.getEventTopic(depositEventFragment);
    const withdrawalEventHash = this.ethereumService.getEventTopic(withdrawalEventFragment);
    const vaultCreatedEventHash = this.ethereumService.getEventTopic(vaultCreatedEventFragment); 
    //const nftDepositEventHash = this.ethereumService.getEventTopic(nftDepositEventFragment);

    let processedDeposits = 0;
    let processedWithdrawals = 0;
    let processedVaultCreations = 0;
    //let processedNftDeposits = 0;

    for (const log of logs) {
        const { transaction, topics, data, index: logIndex } = log;
        const { hash: transactionHash, blockNumber } = transaction;

        // --- Debounce duplicate webhook processing ---
        if (isTxInCache(transactionHash)) {
          this.logger.info(`[CreditService] Skipping duplicate webhook event for tx ${transactionHash} (recently processed)`);
          continue;
        }

        try {
            if (topics[0] === depositEventHash) {
                // Process deposit event
                const decodedLog = this.ethereumService.decodeEventLog(depositEventFragment, data, topics, this.contractConfig.abi);
                await this._processDepositEvent(decodedLog, transactionHash, blockNumber, logIndex);
                processedDeposits++;
            // } else if (topics[0] === nftDepositEventHash) {
            //     // Process NFT deposit event
            //     const decodedLog = this.ethereumService.decodeEventLog(nftDepositEventFragment, data, topics, this.contractConfig.abi);
            //     await this._processNftDepositEvent(decodedLog, transactionHash, blockNumber, logIndex);
            //     processedNftDeposits++;
            // }
            } else if (topics[0] === withdrawalEventHash) {
                // Process withdrawal event
                const decodedLog = this.ethereumService.decodeEventLog(withdrawalEventFragment, data, topics, this.contractConfig.abi);
                await this._processWithdrawalEvent(decodedLog, transactionHash, blockNumber);
                processedWithdrawals++;
            } else if (topics[0] === vaultCreatedEventHash) {
                // Process vault creation event
                const decodedLog = this.ethereumService.decodeEventLog(vaultCreatedEventFragment, data, topics, this.contractConfig.abi);
                // CORRECTED: Use `fundAddress` from FundChartered event
                await this.finalizeVaultDeployment(transactionHash, decodedLog.fundAddress);
                processedVaultCreations++;
            }
        } catch (error) {
            this.logger.error(`[CreditService] Error processing event from tx ${transactionHash}:`, error);
            // Continue processing other logs
        }
    }

    // If any events were processed, trigger the processing pipeline
    if (processedDeposits > 0) {
        this.logger.info(`[CreditService] Triggering processing of pending deposits...`);
        await this.processPendingConfirmations();
    }

    return {
        success: true,
        message: `Processed ${processedDeposits} deposits, ${processedVaultCreations} vault creations, and ${processedWithdrawals} withdrawals.`,
        detail: { processedDeposits, processedWithdrawals, processedVaultCreations }
    };
  }

  /**
   * Internal helper to process a single deposit event
   * @private
   */
  async _processDepositEvent(decodedLog, transactionHash, blockNumber, logIndex) {
    let { fundAddress, user, token, amount } = decodedLog;

    // Check for existing entry
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/ledger/entries/${transactionHash}`);
      if (response.data.entry) {
        this.logger.info(`[CreditService] Skipping deposit event for tx ${transactionHash} as it's already acknowledged.`);
        return;
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
      // 404 means entry doesn't exist, continue processing
    }

    // Handle magic amount linking
    const wasHandledByLinking = await this._handleMagicAmountLinking(user, token, amount.toString());
    if (wasHandledByLinking) {
      this.logger.info(`[CreditService] Deposit from tx ${transactionHash} was a magic amount and has been fully processed.`);
      return;
    }

    // Validate vault account
    if (!fundAddress || !ethers.isAddress(fundAddress)) {
      this.logger.warn(`[CreditService] 'fundAddress' not found or invalid in event for tx ${transactionHash}. Assuming deposit to main vault.`);
      fundAddress = this.contractConfig.address;
    }

    // Create ledger entry through internal API
    await this.internalApiClient.post('/internal/v1/data/ledger/entries', {
      deposit_tx_hash: transactionHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: fundAddress, // Stays vault_account in DB for now
      depositor_address: user,
      token_address: token,
      deposit_amount_wei: amount.toString()
    });

    this.logger.info(`[CreditService] Successfully acknowledged new deposit from webhook: ${transactionHash}`);
  }

  /**
   * Internal helper to process a single NFT deposit event
   * @private
   */
//   async _processNftDepositEvent(decodedLog, transactionHash, blockNumber, logIndex) {
//       const { user, collection, tokenId } = decodedLog;
//       const normalizedAddress = collection.toLowerCase();
      
//       this.logger.info(`[CreditService] Processing NFT Deposit from tx ${transactionHash}: User ${user}, Collection ${collection}, TokenID ${tokenId}`);
      
//       const existingEntry = await this.creditLedgerDb.findLedgerEntryByTxHash(transactionHash);
//       if (existingEntry) {
//           this.logger.debug(`[CreditService] Skipping NFT deposit event for tx ${transactionHash} as it's already acknowledged.`);
//           return;
//       }
      
//       const masterAccountId = await this.walletLinkingService.getMasterAccountIdForWallet(user);
//       if (!masterAccountId) {
//           this.logger.warn(`[CreditService] No user account found for NFT depositor address ${user}. Cannot credit NFT deposit.`);
//           // Create a rejected entry for audit purposes
//           await this.creditLedgerDb.createLedgerEntry({
//               deposit_tx_hash: transactionHash, deposit_log_index: logIndex, deposit_block_number: blockNumber, depositor_address: user,
//               token_address: collection, token_id: tokenId, status: 'REJECTED_UNKNOWN_USER', failure_reason: 'No corresponding user account found for the depositor address.'
//           });
//           return;
//       }
      
//       let usdValue = 0;
//       let fundingRate = 0;
//       let collectionName = 'Unknown';
      
//       const trustedInfo = TRUSTED_NFT_COLLECTIONS[normalizedAddress];
      
//       if (trustedInfo) {
//           collectionName = trustedInfo.name;
//           fundingRate = trustedInfo.fundingRate;
//           usdValue = await this.services.nftPriceService.getFloorPriceInUsd(normalizedAddress);
//           this.logger.info(`[CreditService] Trusted collection '${collectionName}' found. Using boosted funding rate: ${fundingRate}. Floor price: $${usdValue}`);
//       } else {
//           fundingRate = BASELINE_NFT_FUNDING_RATE;
//           usdValue = await this.services.nftPriceService.getFloorPriceInUsd(normalizedAddress);
//           this.logger.info(`[CreditService] Non-trusted collection. Using baseline funding rate: ${fundingRate}. Floor price: $${usdValue}`);
//       }
      
//       if (!usdValue || usdValue <= 0) {
//           this.logger.warn(`[CreditService] No valid floor price found for NFT collection ${collection}. Rejecting deposit.`);
//           await this.creditLedgerDb.createLedgerEntry({
//               deposit_tx_hash: transactionHash, deposit_log_index: logIndex, deposit_block_number: blockNumber, depositor_address: user,
//               token_address: collection, token_id: tokenId, status: 'REJECTED_NO_FLOOR_PRICE', failure_reason: 'Collection has no detectable floor price.'
//           });
//           return;
//       }
      
//       const userCreditedUsd = usdValue * fundingRate;
//       const pointsCredited = Math.floor(userCreditedUsd / USD_TO_POINTS_CONVERSION_RATE);
      
//       const ledgerEntry = {
//           deposit_tx_hash: transactionHash,
//           deposit_log_index: logIndex,
//           deposit_block_number: blockNumber,
//           master_account_id: masterAccountId,
//           depositor_address: user,
//           token_address: collection,
//           token_id: tokenId.toString(),
//           deposit_type: 'NFT',
//           status: 'CONFIRMED',
//           gross_deposit_usd: usdValue,
//           funding_rate_applied: fundingRate,
//           user_credited_usd: userCreditedUsd,
//           points_credited: pointsCredited,
//           points_remaining: pointsCredited,
//           collection_name: collectionName,
//       };
      
//       await this.creditLedgerDb.createLedgerEntry(ledgerEntry);
//       this.logger.info(`[CreditService] Successfully credited ${pointsCredited} points for NFT deposit from ${collectionName} (ID: ${tokenId}) to user ${masterAccountId}.`);
//   }

  /**
   * Internal helper to process a single withdrawal event
   * @private
   */
  async _processWithdrawalEvent(decodedLog, transactionHash, blockNumber) {
    const { fundAddress, user: userAddress, token: tokenAddress } = decodedLog;

    // Check for existing request through internal API
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/ledger/withdrawals/${transactionHash}`);
      if (response.data.request) {
        this.logger.info(`[CreditService] Withdrawal request ${transactionHash} already processed`);
        return;
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
      // 404 means request doesn't exist, continue processing
    }

    // Get user's master account ID
    let masterAccountId;
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${userAddress}`);
      masterAccountId = response.data.masterAccountId;
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`[CreditService] No user account found for address ${userAddress}`);
        return;
      }
      throw error;
    }

    // Get current collateral amount
    const custodyKey = getCustodyKey(userAddress, tokenAddress);
    const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
    const { userOwned: collateralAmount } = splitCustodyAmount(custodyValue);

    // Create withdrawal request through internal API
    await this.internalApiClient.post('/internal/v1/data/ledger/withdrawals', {
      request_tx_hash: transactionHash,
      request_block_number: blockNumber,
      vault_account: fundAddress, // Stays vault_account in DB for now
      user_address: userAddress,
      token_address: tokenAddress,
      master_account_id: masterAccountId,
      collateral_amount_wei: collateralAmount.toString()
    });

    // Trigger immediate processing
    await this.processWithdrawalRequest(transactionHash);
  }

  /**
   * Sends a WebSocket notification for deposit-related events.
   * @private
   */
  _sendDepositNotification(masterAccountId, status, payload) {
    if (this.webSocketService) {
        this.webSocketService.sendToUser(masterAccountId, {
            type: 'pointsDepositUpdate',
            payload: { status, ...payload }
        });
        this.logger.info(`[CreditService] Sent pointsDepositUpdate (${status}) WebSocket notification to user ${masterAccountId}`);
    }
  }

  /**
   * STAGE 2: Processes all deposits that are in a 'PENDING_CONFIRMATION' or 'ERROR' state
   * by grouping them by user and token to perform a single, aggregate confirmation.
   */
  async processPendingConfirmations() {
      this.logger.info(`[CreditService] Checking for deposits pending confirmation or in error state...`);
      const pendingDeposits = await this.creditLedgerDb.findProcessableEntries();

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
          // The new group processing logic replaces the old single-item processing.
          await this._processConfirmationGroup(deposits);
          this.logger.info(`[CreditService] <<< Finished processing group: ${groupKey}`);
      }
  }

  /**
   * Processes a single group of pending deposits for a unique user-token pair.
   * It reads the total unconfirmed balance from the contract and confirms it in a single transaction.
   * @param {Array<object>} deposits - An array of ledger entry documents for the same user and token.
   * @private
   */
  async _processConfirmationGroup(deposits) {
    // All deposits in this group share the same user and token.
    const { depositor_address: user, token_address: token } = deposits[0];
    const originalTxHashes = deposits.map(d => d.deposit_tx_hash);
    const groupKey = getGroupKey(user, token);

    // --- Group-level processing lock ---
    if (processingGroups.has(groupKey)) {
      this.logger.info(`[CreditService] Group ${groupKey} is already being processed. Skipping.`);
      return;
    }
    processingGroups.add(groupKey);

    try {
      // --- Debounce duplicate confirmation for this group ---
      let allInCache = originalTxHashes.every(isTxInCache);
      if (allInCache) {
        this.logger.info(`[CreditService] Skipping confirmation for group (User: ${user}, Token: ${token}) because all txs are recently processed.`);
        return;
      }

      this.logger.info(`[CreditService] Processing group (User: ${user}, Token: ${token}). Involves ${deposits.length} deposits.`);
      this.logger.debug(`[CreditService] Original deposit hashes in this group: ${originalTxHashes.join(', ')}`);

        // 0. READ `custody` state from contract to get the true total unconfirmed balance.
        this.logger.info(`[CreditService] Step 0: Reading unconfirmed balance from contract 'custody' state...`);
        const custodyKey = getCustodyKey(user, token);
        const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
        const { userOwned: amount } = splitCustodyAmount(custodyValue);

        if (amount === 0n) {
            this.logger.warn(`[CreditService] Contract reports 0 unconfirmed balance for this group. These deposits may have been confirmed in a previous run. Marking as stale.`);
            for (const deposit of deposits) {
                 await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'CONFIRMED', { failure_reason: 'Stale pending entry; contract unconfirmed balance was zero upon processing.' });
                 addTxToCache(deposit.deposit_tx_hash);
            }
            return;
        }
        this.logger.info(`[CreditService] Contract reports a total unconfirmed balance of ${formatEther(amount)} ETH for this group.`);

        // 1. DYNAMIC FUNDING RATE
        this.logger.info(`[CreditService] Step 1: Applying dynamic funding rate for token ${token}...`);
        // Move riskAssessment and priceInUsd assignment up
        const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount);
        if (!riskAssessment.isSafe) {
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'FAILED_RISK_ASSESSMENT', { failure_reason: riskAssessment.reason });
            this._sendDepositNotification(masterAccountId, 'failed', { reason: riskAssessment.reason, originalTxHashes });
            return;
        }
        const priceInUsd = riskAssessment.price;
        const fundingRate = getFundingRate(token);
        const grossDepositUsd = parseFloat(formatEther(amount)) * priceInUsd;
        const adjustedGrossDepositUsd = grossDepositUsd * fundingRate;
        this.logger.info(`[CreditService] Original Value: $${grossDepositUsd.toFixed(2)}, Rate: ${fundingRate}, Adjusted Value: $${adjustedGrossDepositUsd.toFixed(2)}.`);

        // 2. USER ACCOUNT VERIFICATION
        this.logger.info(`[CreditService] Step 2: Verifying user account for depositor ${user}...`);
        let masterAccountId;
        try {
            const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${user}`);
            masterAccountId = response.data.masterAccountId;
            this.logger.info(`[CreditService] User found. MasterAccountId: ${masterAccountId}`);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                this.logger.warn(`[CreditService] No user account found for address ${user}. Rejecting deposit group.`);
                for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNKNOWN_USER', { failure_reason: 'No corresponding user account found.' });
                // Cannot notify user as we don't know their masterAccountId
            } else {
                this.logger.error(`[CreditService] Error looking up user for group.`, error);
                for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR', { failure_reason: 'Failed to lookup user due to an internal API error.', error_details: error.message });
                // Cannot notify user if lookup fails
            }
            return;
        }

        // 3. COLLATERAL & PROFITABILITY CHECKS (on the total aggregated amount)
        this.logger.info(`[CreditService] Step 3: Assessing collateral and profitability for the total amount...`);
        // const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount);
        // if (!riskAssessment.isSafe) {
        //     for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'FAILED_RISK_ASSESSMENT', { failure_reason: riskAssessment.reason });
        //     return;
        // }
        // const priceInUsd = riskAssessment.price;
        const depositValueUsd = adjustedGrossDepositUsd;
        
        const { vault_account: vaultAccount } = deposits[0];

        // --- REFERRAL LOGIC ---
        let referralRewardUsd = 0;
        let referrerMasterAccountId = null;
        const isDefaultVault = vaultAccount.toLowerCase() === this.contractConfig.address.toLowerCase();

        if (!isDefaultVault) {
            this.logger.info(`[CreditService] Deposit made to a non-default vault: ${vaultAccount}. Checking for referral info...`);
            const referralVault = await this.creditLedgerDb.findReferralVaultByAddress(vaultAccount);
            if (referralVault && referralVault.master_account_id) {
                referrerMasterAccountId = referralVault.master_account_id.toString();
                // 5% reward of the total gross deposit value
                referralRewardUsd = grossDepositUsd * 0.05; 
                this.logger.info(`[CreditService] Referral vault found for owner ${referrerMasterAccountId}. Calculated reward: $${referralRewardUsd.toFixed(4)} from gross value.`);
            } else {
                this.logger.warn(`[CreditService] A non-default vault was used (${vaultAccount}), but no matching referral account was found.`);
            }
        }
        // --- END REFERRAL LOGIC ---
        const fundAddress = vaultAccount;
        // Note: The fee passed to commit is the platform's total fee, including gas reimbursement and any markup.
        const estimatedGasCostUsd = await this.ethereumService.estimateGasCostInUsd(this.contractConfig.address, this.contractConfig.abi, 'commit', fundAddress, user, token, amount, 0, '0x');
        
        if (estimatedGasCostUsd >= depositValueUsd) {
            const reason = { deposit_value_usd: depositValueUsd, failure_reason: `Estimated gas cost ($${estimatedGasCostUsd.toFixed(4)}) exceeded total unconfirmed deposit value ($${depositValueUsd.toFixed(2)}).` };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
            this._sendDepositNotification(masterAccountId, 'failed', { reason: reason.failure_reason, originalTxHashes });
            return;
        }

        // Calculate protocol fee based on estimated net deposit value
        // const estimatedNetDepositUsd = depositValueUsd - estimatedGasCostUsd;
        // const protocolFeeUsd = estimatedNetDepositUsd * PROTOCOL_MARKUP_RATE;
        // const protocolFeeEth = protocolFeeUsd / priceInUsd;
        // const protocolFeeWei = ethers.parseEther(protocolFeeEth.toFixed(18));
        // const estimatedGasCostEth = estimatedGasCostUsd / priceInUsd;
        // const gasFeeInWei = ethers.parseEther(estimatedGasCostEth.toFixed(18));
        // const totalFeeInWei = gasFeeInWei + protocolFeeWei;
        // const escrowAmountForContract = amount - totalFeeInWei;
        //
        // if (escrowAmountForContract < 0n) {
        //     const reason = { deposit_value_usd: depositValueUsd, failure_reason: `Total fees (gas + markup) exceeded total deposit value.` };
        //     for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
        //     return;
        // }
        //
        // 4. EXECUTE ON-CHAIN CONFIRMATION (for the entire group)
        //
        // --- REWRITE FEE LOGIC: Only use gas fee, no protocol markup ---
        const estimatedGasCostEth = estimatedGasCostUsd / priceInUsd;
        const gasFeeInWei = ethers.parseEther(estimatedGasCostEth.toFixed(18));
        const escrowAmountForContract = amount - gasFeeInWei;
        if (escrowAmountForContract < 0n) {
            const reason = { deposit_value_usd: depositValueUsd, failure_reason: `Total fees (gas) exceeded total deposit value.` };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
            this._sendDepositNotification(masterAccountId, 'failed', { reason: reason.failure_reason, originalTxHashes });
            return;
        }
        this.logger.info(`[CreditService] Step 4: Sending on-chain confirmation for user ${user}. Total Net Escrow: ${parseFloat(formatEther(escrowAmountForContract)).toFixed(6)} ETH, Total Fee: ${parseFloat(formatEther(gasFeeInWei)).toFixed(6)} ETH`);
        const txResponse = await this.ethereumService.write(this.contractConfig.address, this.contractConfig.abi, 'commit', fundAddress, user, token, escrowAmountForContract, gasFeeInWei, '0x');
        this.logger.info(`[CreditService] Transaction sent. On-chain hash: ${txResponse.hash}. Waiting for confirmation...`);

        const confirmationReceipt = await this.ethereumService.waitForConfirmation(txResponse);
        if (!confirmationReceipt || !confirmationReceipt.hash) {
            this.logger.error(`[CreditService] CRITICAL: Failed to receive a valid receipt for group confirmation. Manual verification required for user: ${user}`);
            const reason = { failure_reason: 'Transaction sent but an invalid receipt was returned by the provider.' };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR_INVALID_RECEIPT', reason);
            this._sendDepositNotification(masterAccountId, 'failed', { reason: reason.failure_reason, originalTxHashes });
            return;
        }

        const confirmationTxHash = confirmationReceipt.hash;
        this.logger.info(`[CreditService] On-chain group confirmation successful. Tx: ${confirmationTxHash}`);

        // 5. OFF-CHAIN CREDIT APPLICATION (for the net value of the entire group)
        const actualGasCostEth = confirmationReceipt.gasUsed * (confirmationReceipt.gasPrice || confirmationReceipt.effectiveGasPrice);
        const actualGasCostUsd = parseFloat(formatEther(actualGasCostEth)) * priceInUsd;
        // All calculations are now based on the funding-rate-adjusted value
        const netAdjustedDepositUsd = adjustedGrossDepositUsd - actualGasCostUsd;
        if (netAdjustedDepositUsd < 0) {
            this.logger.warn(`[CreditService] Adjusted deposit value for group is negative after gas costs. Rejecting as unprofitable. Net adjusted value: ${netAdjustedDepositUsd}`);
            const reason = { failure_reason: `Adjusted deposit value was less than gas cost.`, original_deposit_usd: depositValueUsd, adjusted_deposit_usd: adjustedGrossDepositUsd, gas_cost_usd: actualGasCostUsd };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
            this._sendDepositNotification(masterAccountId, 'failed', { reason: reason.failure_reason, originalTxHashes });
            return;
        }
        // --- REMOVE MARKUP: userCreditedUsd is just netAdjustedDepositUsd ---
        const userCreditedUsd = netAdjustedDepositUsd;
        // --- END MARKUP REMOVAL ---
        
        // The referral reward is deducted from the platform's share (the funding rate cut)
        const platformCutUsd = grossDepositUsd * (1 - fundingRate);
        const finalReferralPayoutUsd = Math.min(platformCutUsd, referralRewardUsd); // Cannot pay out more than the platform's total cut
        const netProtocolProfitUsd = platformCutUsd - finalReferralPayoutUsd;
        
        this.logger.info(`[CreditService] Step 5: Applying credit to user's off-chain account. Adj. Gross: $${adjustedGrossDepositUsd.toFixed(2)}, Gas: $${actualGasCostUsd.toFixed(2)}, Adj. Net: $${netAdjustedDepositUsd.toFixed(2)}, User Credit: $${userCreditedUsd.toFixed(2)}.`);
        // Remove markup from accounting details log
        this.logger.info(`[CreditService] Accounting Details -> Platform Cut: $${platformCutUsd.toFixed(4)}, Referral Payout: $${finalReferralPayoutUsd.toFixed(4)}, Net Protocol Profit: $${netProtocolProfitUsd.toFixed(4)}`);

        // --- Point Calculation for Per-Deposit Tracking ---
        const points_credited = Math.floor(userCreditedUsd / USD_TO_POINTS_CONVERSION_RATE);
        const points_remaining = points_credited; // Initially, remaining equals credited

        this.logger.info(`[CreditService] Point Calculation -> User Credited USD: $${userCreditedUsd.toFixed(2)}, Points Credited: ${points_credited}`);
        
        // --- Process Referral Payout ---
        if (referrerMasterAccountId && finalReferralPayoutUsd > 0) {
            try {
                this.logger.info(`[CreditService] Crediting referrer ${referrerMasterAccountId} with $${finalReferralPayoutUsd.toFixed(4)}.`);
                await this.internalApiClient.post(`/internal/v1/data/users/${referrerMasterAccountId}/economy/credit`, {
                    amountUsd: finalReferralPayoutUsd,
                    transactionType: 'REFERRAL_DEPOSIT_REWARD',
                    description: `Referral reward from deposit by user ${user} to vault ${vaultAccount}.`,
                    externalTransactionId: confirmationTxHash,
                    metadata: {
                        funding_rate: fundingRate,
                        original_deposit_usd: depositValueUsd,
                        adjusted_deposit_usd: adjustedGrossDepositUsd
                    }
                });

                const depositAmountWei = amount.toString();
                const rewardInEth = finalReferralPayoutUsd / priceInUsd;
                const rewardInWei = ethers.parseEther(rewardInEth.toFixed(18)).toString();
                await this.creditLedgerDb.updateReferralVaultStats(vaultAccount, depositAmountWei, rewardInWei);
                this.logger.info(`[CreditService] Successfully credited referrer and updated vault stats for ${vaultAccount}.`);

            } catch (error) {
                this.logger.error(`[CreditService] CRITICAL: Failed to credit referral reward for vault ${vaultAccount} and referrer ${referrerMasterAccountId}. Requires manual intervention.`, error);
                // This failure is logged but does not stop the original depositor from being credited.
            }
        }
        // --- End Referral Payout ---
        
        // 6. FINAL LEDGER UPDATE (for all deposits in the group)
        this.logger.info(`[CreditService] Step 6: Finalizing ${deposits.length} ledger entries for group.`);
        const finalStatus = {
            master_account_id: masterAccountId,
            deposit_type: 'TOKEN',
            gross_deposit_usd: depositValueUsd,
            funding_rate_applied: fundingRate,
            adjusted_gross_deposit_usd: adjustedGrossDepositUsd,
            gas_cost_usd: actualGasCostUsd,
            net_adjusted_deposit_usd: netAdjustedDepositUsd,
            user_credited_usd: userCreditedUsd,
            points_credited,
            points_remaining,
            referral_payout_usd: finalReferralPayoutUsd,
            net_protocol_profit_usd: netProtocolProfitUsd,
            referrer_master_account_id: referrerMasterAccountId,
            confirmation_tx_hash: confirmationTxHash,
        };

        for (const deposit of deposits) {
            await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'CONFIRMED', finalStatus);
            addTxToCache(deposit.deposit_tx_hash);
        }

        this.logger.info(`[CreditService] Successfully processed deposit group for user ${user} and token ${token}`);

        // --- WEBSOCKET NOTIFICATION ---
        this._sendDepositNotification(masterAccountId, 'confirmed', { ...finalStatus, originalTxHashes });
        // --- END WEBSOCKET NOTIFICATION ---

    } catch (error) {
      const errorMessage = error.message || 'An unknown error occurred';
      this.logger.error(`[CreditService] Unhandled error during confirmation for group (User: ${user}, Token: ${token}).`, error);

      const reason = { failure_reason: 'An unexpected error occurred during group processing.', error_details: errorMessage, error_stack: error.stack };
      for (const deposit of deposits) {
         await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR', reason);
         addTxToCache(deposit.deposit_tx_hash);
      }
      // Send failure notification if we know who the user is
      if (masterAccountId) {
          this._sendDepositNotification(masterAccountId, 'failed', { reason: errorMessage, originalTxHashes });
      }
    } finally {
      // --- Always release group lock ---
      processingGroups.delete(groupKey);
    }
  }

  /**
   * Checks if a deposit corresponds to a pending "magic amount" wallet linking request.
   * If it matches, it links the wallet to the user account and completes the request.
   * @param {string} depositorAddress - The address that made the deposit.
   * @param {string} tokenAddress - The token contract address.
   * @param {string} amountWei - The amount deposited, in Wei.
   * @private
   */
  async _handleMagicAmountLinking(depositorAddress, tokenAddress, amountWei) {
    try {
        const linkingRequest = await this.walletLinkingRequestDb.findPendingRequestByAmount(amountWei, tokenAddress);

        if (linkingRequest) {
            this.logger.info(`[CreditService] Detected "Magic Amount" deposit for wallet linking. Request ID: ${linkingRequest._id}`);
            
            const { _id: requestId, master_account_id: masterAccountId } = linkingRequest;

            // Add the wallet to the user's core document
            await this.userCoreDb.addWallet(masterAccountId, {
                address: depositorAddress,
                verified: true,
                tag: 'magic-link-deposit',
                linkedAt: new Date(),
            });

            // Mark the linking request as completed in the DB
            await this.walletLinkingRequestDb.updateRequestStatus(requestId, 'COMPLETED', {
                linked_wallet_address: depositorAddress
            });

            // Trigger the service to generate and cache the API key
            await this.walletLinkingService.completeLinkingAndGenerateFirstApiKey(masterAccountId, requestId);

            this.logger.info(`[CreditService] Successfully linked wallet ${depositorAddress} to master account ${masterAccountId}. Key generation triggered.`);
            return true; // Indicate that the deposit was handled.
        }
        return false; // No matching request found.
    } catch (error) {
        this.logger.error(`[CreditService] Error during magic amount linking check for address ${depositorAddress}:`, error);
        // We don't re-throw, as this shouldn't block the main credit processing flow.
        return false;
    }
  }

  /**
   * Initiates a withdrawal request for a user.
   * This is called when a user requests to withdraw their collateral through the UI.
   * @param {string} userAddress - The Ethereum address of the user requesting withdrawal
   * @param {string} tokenAddress - The token contract address to withdraw
   * @param {string} [params.fundAddress] - The fund address (optional, defaults to main vault)
   * @returns {Promise<{success: boolean, message: string, txHash?: string}>}
   */
  async initiateWithdrawal(userAddress, tokenAddress, fundAddress = this.contractConfig.address) {
    this.logger.info(`[CreditService] Processing withdrawal request for user ${userAddress} and token ${tokenAddress}`);

    try {
        // 1. Verify user account exists
        let masterAccountId;
        try {
            const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${userAddress}`);
            masterAccountId = response.data.masterAccountId;
            this.logger.info(`[CreditService] User found. MasterAccountId: ${masterAccountId}`);
        } catch (error) {
            if (error.response?.status === 404) {
                return { success: false, message: 'No user account found for this address.' };
            }
            throw error;
        }

        // 2. Get user's current credit balance and collateral value
        const custodyKey = getCustodyKey(userAddress, tokenAddress);
        const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
        const { userOwned: collateralAmount } = splitCustodyAmount(custodyValue);

        if (collateralAmount === 0n) {
            return { success: false, message: 'No collateral found for withdrawal.' };
        }

        // 3. Record the withdrawal request on-chain
        this.logger.info(`[CreditService] Recording withdrawal request on-chain for user ${userAddress}`);
        const txResponse = await this.ethereumService.write(
            this.contractConfig.address,
            this.contractConfig.abi,
            'recordRescissionRequest',
            userAddress,
            tokenAddress
        );

        // Wait for confirmation
        const receipt = await this.ethereumService.waitForConfirmation(txResponse);
        if (!receipt || !receipt.hash) {
            throw new Error('Failed to get valid receipt for withdrawal request transaction');
        }

        // Create withdrawal request entry in ledger
        await this.creditLedgerDb.createWithdrawalRequest({
            request_tx_hash: receipt.hash,
            request_block_number: receipt.blockNumber,
            vault_account: fundAddress, // Stays vault_account for now
            user_address: userAddress,
            token_address: tokenAddress,
            master_account_id: masterAccountId,
            status: 'PENDING_PROCESSING',
            collateral_amount_wei: collateralAmount.toString()
        });

        return {
            success: true,
            message: 'Withdrawal request recorded successfully.',
            txHash: receipt.hash
        };

    } catch (error) {
        this.logger.error(`[CreditService] Error processing withdrawal request:`, error);
        throw error;
    }
  }

  /**
   * Handles a RescissionRequested event from the webhook.
   * @param {object} webhookPayload - The webhook payload from Alchemy
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async handleWithdrawalRequestWebhook(webhookPayload) {
    this.logger.info('[CreditService] Processing withdrawal request webhook...');

    const eventPayload = webhookPayload.payload || webhookPayload;

    if (eventPayload.type !== 'GRAPHQL' || !eventPayload.event?.data?.block?.logs) {
        this.logger.warn('[WebhookService] Invalid webhook payload structure');
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
        const { transaction, topics, data, index: logIndex } = log;
        const { hash: transactionHash, blockNumber } = transaction;

        if (topics[0] !== eventSignatureHash) {
            continue;
        }

        try {
            // Check if we've already processed this request
            const existingRequest = await this.creditLedgerDb.findWithdrawalRequestByTxHash(transactionHash);
            if (existingRequest) {
                this.logger.info(`[CreditService] Withdrawal request ${transactionHash} already processed`);
                continue;
            }

            const decodedLog = this.ethereumService.decodeEventLog(eventFragment, data, topics, this.contractConfig.abi);
            const { fundAddress, user: userAddress, token: tokenAddress } = decodedLog;

            // Get user's master account ID
            let masterAccountId;
            try {
                const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${userAddress}`);
                masterAccountId = response.data.masterAccountId;
            } catch (error) {
                if (error.response?.status === 404) {
                    this.logger.warn(`[CreditService] No user account found for address ${userAddress}`);
                    continue;
                }
                throw error;
            }

            // Get current collateral amount
            const custodyKey = getCustodyKey(userAddress, tokenAddress);
            const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
            const { userOwned: collateralAmount } = splitCustodyAmount(custodyValue);

            // Create withdrawal request entry
            await this.creditLedgerDb.createWithdrawalRequest({
                request_tx_hash: transactionHash,
                request_block_number: blockNumber,
                vault_account: fundAddress,
                user_address: userAddress,
                token_address: tokenAddress,
                master_account_id: masterAccountId,
                status: 'PENDING_PROCESSING',
                collateral_amount_wei: collateralAmount.toString()
            });

            processedCount++;
            
            // Trigger processing immediately
            await this.processWithdrawalRequest(transactionHash);

        } catch (error) {
            this.logger.error(`[CreditService] Error processing withdrawal request from webhook:`, error);
            // Continue processing other logs
        }
    }

    return {
        success: true,
        message: `Processed ${processedCount} withdrawal requests`
    };
  }

  /**
   * Processes a pending withdrawal request.
   * @param {string} requestTxHash - The transaction hash of the withdrawal request
   * @returns {Promise<void>}
   */
  async processWithdrawalRequest(requestTxHash) {
    this.logger.info(`[CreditService] Processing withdrawal request ${requestTxHash}`);

    const request = await this.creditLedgerDb.findWithdrawalRequestByTxHash(requestTxHash);
    if (!request) {
        throw new Error(`Withdrawal request ${requestTxHash} not found`);
    }

    if (request.status !== 'PENDING_PROCESSING') {
        this.logger.info(`[CreditService] Request ${requestTxHash} is not in PENDING_PROCESSING state`);
        return;
    }

    try {
        const { user_address: userAddress, token_address: tokenAddress, vault_account: fundAddress, collateral_amount_wei: collateralAmountWei } = request;

        // 1. Get current token price for fee calculation
        const riskAssessment = await this.tokenRiskEngine.assessCollateral(tokenAddress, BigInt(collateralAmountWei));
        if (!riskAssessment.isSafe) {
            await this.creditLedgerDb.updateWithdrawalRequestStatus(requestTxHash, 'FAILED', {
                failure_reason: 'Token risk assessment failed',
                error_details: riskAssessment.reason
            });
            return;
        }

        // 2. Calculate withdrawal amount and fee
        const estimatedGasCostUsd = await this.ethereumService.estimateGasCostInUsd(
            this.contractConfig.address,
            this.contractConfig.abi,
            'remit',
            userAddress,
            tokenAddress,
            collateralAmountWei,
            0,
            '0x'
        );

        const withdrawalValueUsd = parseFloat(formatEther(BigInt(collateralAmountWei))) * riskAssessment.price;
        if (estimatedGasCostUsd >= withdrawalValueUsd) {
            await this.creditLedgerDb.updateWithdrawalRequestStatus(requestTxHash, 'REJECTED_UNPROFITABLE', {
                failure_reason: `Gas cost (${estimatedGasCostUsd} USD) exceeds withdrawal value (${withdrawalValueUsd} USD)`
            });
            return;
        }

        const estimatedGasCostEth = estimatedGasCostUsd / riskAssessment.price;
        const feeInWei = ethers.parseEther(estimatedGasCostEth.toFixed(18));
        const withdrawalAmount = BigInt(collateralAmountWei) - feeInWei;

        if (withdrawalAmount <= 0n) {
            await this.creditLedgerDb.updateWithdrawalRequestStatus(requestTxHash, 'REJECTED_UNPROFITABLE', {
                failure_reason: 'Fee would exceed withdrawal amount'
            });
            return;
        }

        // 3. Execute withdrawal
        this.logger.info(`[CreditService] Executing withdrawal for ${userAddress}. Amount: ${formatEther(withdrawalAmount)} ETH, Fee: ${formatEther(feeInWei)} ETH`);
        const txResponse = await this.ethereumService.write(
            this.contractConfig.address,
            this.contractConfig.abi,
            'remit',
            userAddress,
            tokenAddress,
            withdrawalAmount,
            feeInWei,
            '0x'
        );

        const receipt = await this.ethereumService.waitForConfirmation(txResponse);
        if (!receipt || !receipt.hash) {
            throw new Error('Failed to get valid receipt for withdrawal transaction');
        }

        // 4. Update request status
        await this.creditLedgerDb.updateWithdrawalRequestStatus(requestTxHash, 'COMPLETED', {
            withdrawal_tx_hash: receipt.hash,
            withdrawal_amount_wei: withdrawalAmount.toString(),
            fee_wei: feeInWei.toString(),
            withdrawal_value_usd: withdrawalValueUsd,
            gas_cost_usd: estimatedGasCostUsd
        });

        this.logger.info(`[CreditService] Successfully processed withdrawal request ${requestTxHash}`);

    } catch (error) {
        this.logger.error(`[CreditService] Error processing withdrawal request:`, error);
        await this.creditLedgerDb.updateWithdrawalRequestStatus(requestTxHash, 'ERROR', {
            failure_reason: error.message,
            error_details: error.stack
        });
        throw error;
    }
  }

  /**
   * Creates a new referral vault account for a user with a vanity address starting with 0x1152
   * @param {string} ownerAddress - The address that will own the vault
   * @returns {Promise<{vaultAddress: string, salt: string}>}
   */
  async createReferralVault(ownerAddress) {
    this.logger.info(`[CreditService] Creating referral vault for owner ${ownerAddress}`);

    try {
        // 1. Verify user account and wallet ownership
        let masterAccountId;
        try {
            const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${ownerAddress}`);
            masterAccountId = response.data.masterAccountId;
            this.logger.info(`[CreditService] Found user account ${masterAccountId} for wallet ${ownerAddress}`);
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error('No user account found for this wallet address. The wallet must be linked to a user account first.');
            }
            throw error;
        }

        // 2. Check if user already has too many vaults
        const vaultsResponse = await this.internalApiClient.get(`/internal/v1/data/ledger/vaults/by-master-account/${masterAccountId}`);
        const existingVaults = vaultsResponse.data.vaults;
        // Vault limit removed: users can create unlimited vaults

        // 3. Get a pre-mined salt that will generate a vanity address
        const { salt, predictedAddress } = await this.saltMiningService.getSalt(ownerAddress);
        this.logger.info(`[CreditService] Found valid salt for vanity address ${predictedAddress}`);

        // 4. Create the vault account using the mined salt
        const txResponse = await this.ethereumService.write(
            this.contractConfig.address,
            this.contractConfig.abi,
            'charterFund',
            ownerAddress,
            salt
        );

        const receipt = await this.ethereumService.waitForConfirmation(txResponse);
        if (!receipt || !receipt.hash) {
            throw new Error('Failed to get valid receipt for vault creation');
        }

        // 5. Verify the created vault address matches our prediction
        const logs = receipt.logs.filter(log => {
            try {
                const parsedLog = this.ethereumService.decodeEventLog(
                    'FundChartered',
                    log.data,
                    log.topics,
                    this.contractConfig.abi
                );
                return parsedLog.accountAddress === predictedAddress;
            } catch {
                return false;
            }
        });

        if (logs.length === 0) {
            throw new Error('Vault creation transaction succeeded but no matching FundChartered event found');
        }

        const vaultAddress = predictedAddress;
        
        // 6. Record the vault through internal API
        await this.internalApiClient.post('/internal/v1/data/ledger/vaults', {
            vault_address: vaultAddress,
            owner_address: ownerAddress,
            master_account_id: masterAccountId,
            creation_tx_hash: receipt.hash,
            salt: ethers.hexlify(salt)
        });
        
        this.logger.info(`[CreditService] Successfully created referral vault at ${vaultAddress} for user ${masterAccountId}`);
        
        return {
            vaultAddress,
            salt: ethers.hexlify(salt)
        };

    } catch (error) {
        this.logger.error(`[CreditService] Failed to create referral vault for ${ownerAddress}:`, error);
        throw error;
    }
  }

  /**
   * Estimates the gas cost in USD for a deposit transaction (ETH, ERC20, or NFT).
   * @param {object} params - The parameters for the deposit.
   * @param {string} params.type - 'token' or 'nft'.
   * @param {string} params.assetAddress - The token or NFT contract address.
   * @param {string} params.amount - The amount in smallest unit (for tokens).
   * @param {string} params.userWalletAddress - The user's wallet address.
   * @param {string} [params.tokenId] - The NFT tokenId (for NFTs).
   * @returns {Promise<number>} Estimated gas cost in USD.
   */
  async estimateDepositGasCostInUsd({ type, assetAddress, amount, userWalletAddress, tokenId }) {
    const { address: vaultAddress, abi: vaultAbi } = this.contractConfig;
    try {
      if (type === 'token') {
        // ETH deposit: estimate a value transfer (no calldata)
        if (assetAddress === '0x0000000000000000000000000000000000000000') {
          // For ETH, estimate a simple transfer to the vault
          // ethers.js doesn't estimate gas for plain value transfers directly, so use provider.estimateGas
          const tx = {
            to: vaultAddress,
            from: userWalletAddress,
            value: amount
          };
          const gasEstimate = await this.ethereumService.getProvider().estimateGas(tx);
          const gasPrice = (await this.ethereumService.getProvider().getFeeData()).gasPrice;
          const ethPriceUsd = await this.priceFeedService.getPriceInUsd(assetAddress);
          const estimatedCostUsd = parseFloat(formatEther(gasEstimate * gasPrice)) * ethPriceUsd;
          return estimatedCostUsd;
        } else {
          // ERC20: estimate deposit(assetAddress, amount)
          // Use deposit (not depositFor) for quote
          return await this.ethereumService.estimateGasCostInUsd(
            vaultAddress,
            vaultAbi,
            'contribute',
            assetAddress,
            amount
          );
        }
      } else if (type === 'nft') {
        // NFT: estimate safeTransferFrom(user, vault, tokenId)
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
   * @param {object} details - The details for deployment.
   * @param {ObjectId} details.masterAccountId
   * @param {string} details.ownerAddress
   * @param {string} details.vaultName
   * @param {string} details.salt
   * @param {string} details.predictedAddress
   * @returns {Promise<Object>} The newly created vault document.
   */
  async deployReferralVault(details) {
    this.logger.info('[CreditService] Initiating on-chain referral vault deployment with details:', { details });
    const { masterAccountId, ownerAddress, vaultName, salt, predictedAddress } = details;

    try {
      this.logger.info('[CreditService] Sending transaction to ethereumService.write with params:', {
        contractAddress: this.contractConfig.address,
        functionName: 'charterFund',
        ownerAddress,
        salt
      });

      // 1. Send the transaction via the operator wallet using the 'write' method
      const txResponse = await this.ethereumService.write(
        this.contractConfig.address,
        this.contractConfig.abi,
        'charterFund',
        ownerAddress,
        salt
      );

      this.logger.info(`[CreditService] Vault deployment transaction sent successfully. Hash: ${txResponse.hash}`, {
        txHash: txResponse.hash,
        owner: ownerAddress,
        predictedAddress: predictedAddress,
      });

      // 3. Create the initial database record with a 'PENDING_DEPLOYMENT' status
      const newVaultData = {
        master_account_id: masterAccountId,
        vault_name: vaultName,
        owner_address: ownerAddress,
        vault_address: predictedAddress, // We store the predicted address
        salt: salt,
        deployment_tx_hash: txResponse.hash,
        created_at: new Date(),
        status: 'PENDING_DEPLOYMENT',
      };

      const savedVault = await this.creditLedgerDb.createReferralVault(newVaultData);

      this.logger.info('[CreditService] Vault record created with pending status.', { savedVault });

      // We don't wait for confirmation here. A separate process will listen for the
      // `VaultCreated` event and update the status to 'ACTIVE'.
      return savedVault;

    } catch (error) {
      this.logger.error(`[CreditService] On-chain vault deployment failed for owner ${ownerAddress}.`, {
        error: error.message,
        stack: error.stack,
      });
      // Optionally, create a DB record with 'FAILED' status
      // For now, re-throw to let the caller handle it.
      this.logger.error('[CreditService] Error during vault deployment transaction:', { 
        errorMessage: error.message,
        errorStack: error.stack,
        details 
      });
      throw new Error('Failed to send vault deployment transaction.');
    }
  }

  /**
   * Finalizes a vault deployment after the on-chain transaction is confirmed.
   * @param {string} txHash - The deployment transaction hash.
   * @param {string} vaultAddress - The actual address of the created vault from the event.
   */
  async finalizeVaultDeployment(txHash, vaultAddress) {
    this.logger.info(`[CreditService] Finalizing vault deployment for tx: ${txHash}`);

    const vault = await this.creditLedgerDb.findReferralVaultByTxHash(txHash);

    if (!vault) {
      this.logger.error(`[CreditService] Could not find a pending vault for tx hash: ${txHash}. This may be a race condition or an orphan event.`);
      return;
    }

    if (vault.status === 'ACTIVE') {
      this.logger.warn(`[CreditService] Vault for tx ${txHash} is already active. Ignoring event.`);
      return;
    }

    // It's good practice to verify the address from the event matches the predicted one
    if (vault.vault_address.toLowerCase() !== vaultAddress.toLowerCase()) {
      this.logger.error(`[CreditService] Mismatch between predicted vault address (${vault.vault_address}) and on-chain address (${vaultAddress}) for tx ${txHash}. Manual review needed.`);
      // Update status to 'ERROR' or something similar
      await this.creditLedgerDb.updateReferralVaultStatus(vault._id, 'ADDRESS_MISMATCH');
      // --- WEBSOCKET NOTIFICATION ---
      if (this.webSocketService) {
          this.webSocketService.sendToUser(vault.master_account_id, {
              type: 'referralVaultUpdate',
              payload: {
                  status: 'failed',
                  reason: 'Address mismatch during deployment verification.',
                  txHash: vault.deployment_tx_hash
              }
          });
      }
      // --- END WEBSOCKET NOTIFICATION ---
      return;
    }
    
    await this.creditLedgerDb.updateReferralVaultStatus(vault._id, 'ACTIVE');

    this.logger.info(`[CreditService] Successfully activated vault ${vaultAddress} (ID: ${vault._id})`);

    // --- WEBSOCKET NOTIFICATION ---
    if (this.webSocketService) {
        this.webSocketService.sendToUser(vault.master_account_id, {
            type: 'referralVaultUpdate',
            payload: {
                status: 'active',
                vaultAddress: vault.vault_address,
                vaultName: vault.vault_name,
                txHash: vault.deployment_tx_hash,
            }
        });
        this.logger.info(`[CreditService] Sent referralVaultUpdate WebSocket notification to user ${vault.master_account_id}`);
    }
    // --- END WEBSOCKET NOTIFICATION ---
  }

  /**
   * Charges a user for spell execution by deducting points from their confirmed deposits.
   * Also forwards the creator share via routeReferralOrCreatorShare.
   * @param {string|ObjectId} payerAccountId - The masterAccountId paying for the spell.
   * @param {string|ObjectId} spellId - The spell being executed.
   * @param {{ totalCostPts:number }} quote - The quote returned by SpellsService.quoteSpell().
   * @param {number} [creatorSharePct=0.7] - Percentage of points to forward to creator/referral vault.
   * @returns {Promise<{ creditTxId:string, pointsCharged:number }>}
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
   * @param {string|ObjectId} creatorAccountId
   * @param {number} points
   * @param {object} meta - Additional metadata to store on reward entry.
   */
  async routeReferralOrCreatorShare(creatorAccountId, points, meta = {}) {
    if (points <= 0) return;
    try {
        // Check for referral vaults
        const vaults = await this.creditLedgerDb.findReferralVaultsByMasterAccount(creatorAccountId);
        const targetAccountId = creatorAccountId; // For now we credit creator directly
        const description = vaults.length > 0
            ? `Creator share routed (${points} pts) via referral vault.`
            : `Creator share credited directly (${points} pts).`;

        await this.creditLedgerDb.createRewardCreditEntry({
            masterAccountId: targetAccountId,
            points,
            rewardType: 'SPELL_CREATOR_SHARE',
            description,
            relatedItems: meta,
        });
    } catch (err) {
        this.logger.error('[CreditService] routeReferralOrCreatorShare failed:', err);
    }
  }
}

module.exports = CreditService; 