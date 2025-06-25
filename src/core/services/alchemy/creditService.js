const { ethers, formatEther, keccak256, toUtf8Bytes } = require('ethers');
const CreditLedgerDB = require('../db/alchemy/creditLedgerDb');
const SystemStateDB = require('../db/alchemy/systemStateDb');
const { getCustodyKey, splitCustodyAmount } = require('./contractUtils');
// const NoemaUserCoreDB = require('../db/noemaUserCoreDb'); // To be implemented
// const NoemaUserEconomyDB = require('../db/noemaUserEconomyDb'); // To be implemented

// This should be the actual block number of the contract deployment on the target chain.
const CONTRACT_DEPLOYMENT_BLOCK = 8589453; 
// The address representing native ETH in contract events (typically the zero address).
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
// Conversion rate for USD to internal credit points.
const USD_TO_POINTS_CONVERSION_RATE = 0.000337;

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
   * @param {object} config - Configuration object.
   * @param {string} config.creditVaultAddress - The address of the on-chain Credit Vault contract.
   * @param {Array} config.creditVaultAbi - The ABI of the Credit Vault contract.
   * @param {object} logger - A logger instance.
   */
  constructor(services, config, logger) {
    this.logger = logger || console;

    const { ethereumService, creditLedgerDb, systemStateDb, priceFeedService, tokenRiskEngine, internalApiClient } = services;
    if (!ethereumService || !creditLedgerDb || !systemStateDb || !priceFeedService || !tokenRiskEngine || !internalApiClient) {
      throw new Error('CreditService: Missing one or more required services.');
    }
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.systemStateDb = systemStateDb;
    this.priceFeedService = priceFeedService;
    this.tokenRiskEngine = tokenRiskEngine;
    this.internalApiClient = internalApiClient;
    
    const { creditVaultAddress, creditVaultAbi } = config;
    if (!creditVaultAddress || !creditVaultAbi) {
        throw new Error('CreditService: Missing contract address or ABI in config.');
    }
    this.contractConfig = { address: creditVaultAddress, abi: creditVaultAbi };

    this.logger.info(`[CreditService] Configured to use CreditVault at address: ${this.contractConfig.address}`);
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
   * STAGE 1: Scans for and acknowledges any `DepositRecorded` events not yet in our database.
   */
  async acknowledgeNewEvents() {
    this.logger.info('[CreditService] Starting acknowledgment of new deposit events...');
    const fromBlock = (await this.systemStateDb.getLastSyncedBlock(CONTRACT_DEPLOYMENT_BLOCK)) + 1;
    const toBlock = await this.ethereumService.getLatestBlock();

    if (fromBlock > toBlock) {
      this.logger.info(`[CreditService] No new blocks to sync. Last synced block: ${toBlock}`);
      return;
    }

    this.logger.info(`[CreditService] Fetching 'DepositRecorded' events from block ${fromBlock} to ${toBlock}.`);
    const pastDepositEvents = await this.ethereumService.getPastEvents(
      this.contractConfig.address,
      this.contractConfig.abi,
      'DepositRecorded',
      fromBlock,
      toBlock,
    );

    this.logger.info(`[CreditService] Found ${pastDepositEvents.length} new 'DepositRecorded' events. Acknowledging...`);

    for (const event of pastDepositEvents) {
        const { transactionHash, logIndex, blockNumber, args } = event;
        let { vaultAccount } = args;
        const { user, token, amount } = args;

        // If vaultAccount is not in the event args, it's a deposit to the main vault.
        // In this case, the vaultAccount IS the main contract address.
        if (!vaultAccount || !ethers.isAddress(vaultAccount)) {
            this.logger.warn(`[CreditService] 'vaultAccount' not found or invalid in event args for tx ${transactionHash}. Assuming deposit to main vault.`);
            vaultAccount = this.contractConfig.address;
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
            vault_account: vaultAccount,
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
   * Handles a single DepositRecorded event received from an Alchemy webhook.
   * It acknowledges the event by creating a ledger entry and then immediately
   * triggers the confirmation processing pipeline.
   * @param {object} webhookPayload - The raw payload from the Alchemy webhook.
   * @returns {Promise<{success: boolean, message: string, detail: object|null}>}
   */
  async handleDepositEventWebhook(webhookPayload) {
    this.logger.info('[CreditService] Processing incoming Alchemy webhook...');

    // Handle cases where the relevant data might be nested inside a 'payload' property.
    const eventPayload = webhookPayload.payload || webhookPayload;

    if (eventPayload.type !== 'GRAPHQL' || !eventPayload.event?.data?.block?.logs) {
      this.logger.warn('[CreditService] Webhook payload is not a valid GraphQL block log notification or is malformed.', { payloadKeys: Object.keys(eventPayload || {}) });
      return { success: false, message: 'Invalid payload structure. Expected GraphQL block logs.', detail: null };
    }

    const logs = eventPayload.event.data.block.logs;
    this.logger.info(`[CreditService] Webhook contains ${logs.length} event logs to process.`);

    const eventFragment = this.ethereumService.getEventFragment('DepositRecorded', this.contractConfig.abi);
    if (!eventFragment) {
      this.logger.error("[CreditService] 'DepositRecorded' event fragment not found in ABI. Cannot process webhook.");
      return { success: false, message: "Server configuration error: ABI issue.", detail: null };
    }
    const eventSignatureHash = this.ethereumService.getEventTopic(eventFragment);
    let processedCount = 0;

    for (const log of logs) {
      const { transaction, topics, data, index: logIndex } = log;
      const { hash: transactionHash, blockNumber } = transaction;

      if (topics[0] !== eventSignatureHash) {
        this.logger.debug(`[CreditService] Skipping a log in tx ${transactionHash} as it's not a 'DepositRecorded' event.`);
        continue;
      }
      
      this.logger.info(`[CreditService] Found a 'DepositRecorded' event in tx: ${transactionHash}`);

      try {
        const existingEntry = await this.creditLedgerDb.findLedgerEntryByTxHash(transactionHash);
        if (existingEntry) {
          this.logger.info(`[CreditService] Skipping event for tx ${transactionHash} as it's already acknowledged.`);
          continue;
        }

        const decodedLog = this.ethereumService.decodeEventLog(eventFragment, data, topics, this.contractConfig.abi);
        let { vaultAccount, user, token, amount } = decodedLog;

        this.logger.info(`[CreditService] Decoded event data:`, { vaultAccount, user, token, amount: amount.toString(), transactionHash });

        if (!vaultAccount || !ethers.isAddress(vaultAccount)) {
          this.logger.warn(`[CreditService] 'vaultAccount' not found or invalid in webhook event for tx ${transactionHash}. Assuming deposit to main vault.`);
          vaultAccount = this.contractConfig.address;
        }

        await this.creditLedgerDb.createLedgerEntry({
          deposit_tx_hash: transactionHash,
          deposit_log_index: logIndex,
          deposit_block_number: blockNumber,
          vault_account: vaultAccount,
          depositor_address: user,
          token_address: token,
          deposit_amount_wei: amount.toString(),
          status: 'PENDING_CONFIRMATION',
        });

        this.logger.info(`[CreditService] Successfully acknowledged new deposit from webhook: ${transactionHash}`);
        processedCount++;

      } catch (error) {
        this.logger.error(`[CreditService] Error processing a specific log from webhook tx ${transactionHash}:`, error);
        // Continue to the next log, do not stop the loop
      }
    }

    if (processedCount > 0) {
      this.logger.info(`[CreditService] Acknowledged ${processedCount} new deposits. Triggering immediate processing of pending queue...`);
      await this.processPendingConfirmations();
      this.logger.info(`[CreditService] Immediate processing triggered by webhook is complete.`);
      return { success: true, message: `Webhook processed and acknowledged ${processedCount} new deposits.`, detail: null };
    } else {
      this.logger.info('[CreditService] Webhook processed, but no new, relevant events were found to acknowledge.');
      return { success: true, message: 'Webhook received, but no new events to process.', detail: null };
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

    this.logger.info(`[CreditService] Processing group (User: ${user}, Token: ${token}). Involves ${deposits.length} deposits.`);
    this.logger.debug(`[CreditService] Original deposit hashes in this group: ${originalTxHashes.join(', ')}`);

    try {
        // 0. READ `custody` state from contract to get the true total unconfirmed balance.
        this.logger.info(`[CreditService] Step 0: Reading unconfirmed balance from contract 'custody' state...`);
        const custodyKey = getCustodyKey(user, token);
        const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
        const { userOwned: amount } = splitCustodyAmount(custodyValue);

        if (amount === 0n) {
            this.logger.warn(`[CreditService] Contract reports 0 unconfirmed balance for this group. These deposits may have been confirmed in a previous run. Marking as stale.`);
            for (const deposit of deposits) {
                 await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'CONFIRMED', { failure_reason: 'Stale pending entry; contract unconfirmed balance was zero upon processing.' });
            }
            return;
        }
        this.logger.info(`[CreditService] Contract reports a total unconfirmed balance of ${formatEther(amount)} ETH for this group.`);

        // 1. USER ACCOUNT VERIFICATION
        this.logger.info(`[CreditService] Step 1: Verifying user account for depositor ${user}...`);
        let masterAccountId;
        try {
            const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${user}`);
            masterAccountId = response.data.masterAccountId;
            this.logger.info(`[CreditService] User found. MasterAccountId: ${masterAccountId}`);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                this.logger.warn(`[CreditService] No user account found for address ${user}. Rejecting deposit group.`);
                for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNKNOWN_USER', { failure_reason: 'No corresponding user account found.' });
            } else {
                this.logger.error(`[CreditService] Error looking up user for group.`, error);
                for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR', { failure_reason: 'Failed to lookup user due to an internal API error.', error_details: error.message });
            }
            return;
        }

        // 2. ON-CHAIN VERIFICATION is now implicitly handled by reading the `custody` state.

        // 3. COLLATERAL & PROFITABILITY CHECKS (on the total aggregated amount)
        this.logger.info(`[CreditService] Step 3: Assessing collateral and profitability for the total amount...`);
        const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount);
        if (!riskAssessment.isSafe) {
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'FAILED_RISK_ASSESSMENT', { failure_reason: riskAssessment.reason });
            return;
        }
        const priceInUsd = riskAssessment.price;
        const depositValueUsd = parseFloat(formatEther(amount)) * priceInUsd;
        
        const { vault_account: vaultAccount } = deposits[0];
        const estimatedGasCostUsd = await this.ethereumService.estimateGasCostInUsd(this.contractConfig.address, this.contractConfig.abi, 'confirmCredit', vaultAccount, user, token, amount, 0, '0x');
        
        if (estimatedGasCostUsd >= depositValueUsd) {
            const reason = { deposit_value_usd: depositValueUsd, failure_reason: `Estimated gas cost ($${estimatedGasCostUsd.toFixed(4)}) exceeded total unconfirmed deposit value ($${depositValueUsd.toFixed(2)}).` };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
            return;
        }

        const estimatedGasCostEth = estimatedGasCostUsd / priceInUsd;
        const feeInWei = ethers.parseEther(estimatedGasCostEth.toFixed(18));
        const escrowAmountForContract = amount - feeInWei;

        if (escrowAmountForContract < 0n) {
            const reason = { deposit_value_usd: depositValueUsd, failure_reason: `Fee exceeded total deposit value.` };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
            return;
        }

        // 4. EXECUTE ON-CHAIN CONFIRMATION (for the entire group)
        this.logger.info(`[CreditService] Step 4: Sending on-chain confirmation for user ${user}. Total Net Escrow: ${formatEther(escrowAmountForContract)} ETH, Fee: ${formatEther(feeInWei)} ETH`);
        const txResponse = await this.ethereumService.write(this.contractConfig.address, this.contractConfig.abi, 'confirmCredit', vaultAccount, user, token, escrowAmountForContract, feeInWei, '0x');
        this.logger.info(`[CreditService] Transaction sent. On-chain hash: ${txResponse.hash}. Waiting for confirmation...`);

        const confirmationReceipt = await this.ethereumService.waitForConfirmation(txResponse);
        if (!confirmationReceipt || !confirmationReceipt.hash) {
            this.logger.error(`[CreditService] CRITICAL: Failed to receive a valid receipt for group confirmation. Manual verification required for user: ${user}`);
            const reason = { failure_reason: 'Transaction sent but an invalid receipt was returned by the provider.' };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR_INVALID_RECEIPT', reason);
            return;
        }

        const confirmationTxHash = confirmationReceipt.hash;
        this.logger.info(`[CreditService] On-chain group confirmation successful. Tx: ${confirmationTxHash}`);

        // 5. OFF-CHAIN CREDIT APPLICATION (for the net value of the entire group)
        const actualGasCostEth = confirmationReceipt.gasUsed * (confirmationReceipt.gasPrice || confirmationReceipt.effectiveGasPrice);
        const actualGasCostUsd = parseFloat(formatEther(actualGasCostEth)) * priceInUsd;
        const netDepositValueUsd = depositValueUsd - actualGasCostUsd;

        this.logger.info(`[CreditService] Step 5: Applying credit to user's off-chain account. Net value: $${netDepositValueUsd.toFixed(2)}.`);
        try {
            await this.internalApiClient.post(`/internal/v1/data/users/${masterAccountId}/economy/credit`, {
                amountUsd: netDepositValueUsd,
                transactionType: 'ONCHAIN_DEPOSIT_BATCH',
                description: `Credit from batch of ${deposits.length} on-chain deposits. Confirmed in tx: ${confirmationTxHash}`,
                externalTransactionId: confirmationTxHash,
            });
            this.logger.info(`[CreditService] Successfully applied batch credit to masterAccountId ${masterAccountId}.`);
        } catch (error) {
            this.logger.error(`[CreditService] CRITICAL: Failed to apply off-chain credit for group confirmation! Requires manual intervention.`, error);
            const reason = { master_account_id: masterAccountId, confirmation_tx_hash: confirmationTxHash, net_value_usd: netDepositValueUsd, failure_reason: 'Off-chain credit application failed.', error_details: error.message };
            for (const deposit of deposits) await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'NEEDS_MANUAL_CREDIT', reason);
            return;
        }
        
        // 6. FINAL LEDGER UPDATE (for all deposits in the group)
        this.logger.info(`[CreditService] Step 6: Finalizing ${deposits.length} ledger entries for group.`);
        const finalStatus = {
            master_account_id: masterAccountId,
            deposit_value_usd: depositValueUsd,
            gas_cost_usd: actualGasCostUsd,
            net_value_usd: netDepositValueUsd,
            confirmation_tx_hash: confirmationTxHash,
        };
        for (const deposit of deposits) {
            await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'CONFIRMED', finalStatus);
        }

        this.logger.info(`[CreditService] Successfully processed deposit group for user ${user} and token ${token}`);

    } catch (error) {
      const errorMessage = error.message || 'An unknown error occurred';
      this.logger.error(`[CreditService] Unhandled error during confirmation for group (User: ${user}, Token: ${token}).`, error);

      const reason = { failure_reason: 'An unexpected error occurred during group processing.', error_details: errorMessage, error_stack: error.stack };
      for (const deposit of deposits) {
         await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR', reason);
      }
    }
  }
}

module.exports = CreditService; 