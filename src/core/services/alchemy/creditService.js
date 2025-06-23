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
   * STAGE 2: Processes all deposits that are in a 'PENDING_CONFIRMATION' or 'ERROR' state.
   */
  async processPendingConfirmations() {
      this.logger.info(`[CreditService] Checking for deposits pending confirmation or in error state...`);
      const pendingDeposits = await this.creditLedgerDb.findProcessableEntries();

      if (pendingDeposits.length === 0) {
          this.logger.info('[CreditService] No deposits are pending confirmation or in error state.');
          return;
      }

      this.logger.info(`[CreditService] Found ${pendingDeposits.length} deposits to process. Processing...`);
      for (const deposit of pendingDeposits) {
          await this._processSingleConfirmation(deposit);
      }
  }

  /**
   * Processes a single pending confirmation, following the full validation and crediting flow.
   * @param {object} deposit - The ledger entry document from the database.
   * @private
   */
  async _processSingleConfirmation(deposit) {
    const { deposit_tx_hash: transactionHash, deposit_block_number: blockNumber, vault_account: vaultAccount, depositor_address: user, token_address: token } = deposit;
    const amount = ethers.getBigInt(deposit.deposit_amount_wei);
    this.logger.info(`[CreditService] Processing confirmation for tx ${transactionHash}`);

    if (token.toLowerCase() !== NATIVE_ETH_ADDRESS.toLowerCase()) {
        this.logger.debug(`[CreditService] Skipping non-ETH deposit in tx ${transactionHash} for token ${token}.`);
        return;
    }

    try {
        // 1. USER ACCOUNT VERIFICATION
        this.logger.info(`[CreditService] Step 1: Verifying user account for depositor ${user}...`);
        let masterAccountId;
        try {
            const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${user}`);
            masterAccountId = response.data.masterAccountId;
            this.logger.info(`[CreditService] User found. MasterAccountId: ${masterAccountId}`);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                this.logger.warn(`[CreditService] No user account found for address ${user}. Rejecting deposit.`);
                await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'REJECTED_UNKNOWN_USER', { failure_reason: 'No corresponding user account found for the depositor address.' });
            } else {
                this.logger.error(`[CreditService] Error looking up user by wallet: ${error.message}. Halting processing for this deposit.`);
                await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'ERROR', { failure_reason: 'Failed to lookup user due to an internal API error.', error_details: error.message });
            }
            return;
        }

        // 2. ON-CHAIN VERIFICATION
        this.logger.info(`[CreditService] Step 2: Verifying on-chain confirmation status for deposit...`);
        const confirmedEvents = await this.ethereumService.getPastEvents(this.contractConfig.address, this.contractConfig.abi, 'CreditConfirmed', blockNumber, 'latest', [vaultAccount, user, token]);
        const alreadyConfirmed = confirmedEvents.some(event => event.args.amount.toString() === amount.toString());
        if (alreadyConfirmed) {
            this.logger.warn(`[CreditService] Deposit ${transactionHash} already has a 'CreditConfirmed' event. Marking as confirmed and skipping.`);
            const confirmedEvent = confirmedEvents.find(event => event.args.amount.toString() === amount.toString());
            await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'CONFIRMED', { failure_reason: 'Confirmed in a previous run.', confirmation_tx_hash: confirmedEvent.transactionHash, master_account_id: masterAccountId });
            return;
        }

        // 3. COLLATERAL & PROFITABILITY CHECKS
        this.logger.info(`[CreditService] Step 3: Assessing collateral and profitability...`);
        const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount);
        if (!riskAssessment.isSafe) {
            await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'FAILED_RISK_ASSESSMENT', { failure_reason: riskAssessment.reason });
            return;
        }
        const priceInUsd = riskAssessment.price;
        const depositValueUsd = parseFloat(formatEther(amount)) * priceInUsd;
        
        const estimatedGasCostUsd = await this.ethereumService.estimateGasCostInUsd(this.contractConfig.address, this.contractConfig.abi, 'confirmCredit', vaultAccount, user, token, amount, 0, '0x');
        if (estimatedGasCostUsd >= depositValueUsd) {
            await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'REJECTED_UNPROFITABLE', { deposit_value_usd: depositValueUsd, failure_reason: `Estimated gas cost ($${estimatedGasCostUsd.toFixed(4)}) exceeded deposit value ($${depositValueUsd.toFixed(2)}).` });
            return;
        }

        // Calculate the fee in WEI to pass to the smart contract
        const estimatedGasCostEth = estimatedGasCostUsd / priceInUsd;
        // FIX: The calculated ETH cost can have more than 18 decimal places, which `parseEther` rejects.
        // Truncate the string representation to 18 decimal places to prevent an underflow error.
        const feeInWei = ethers.parseEther(estimatedGasCostEth.toFixed(18));

        // The amount to be credited to the user's escrow, which is the total deposit minus our fee.
        const escrowAmountForContract = amount - feeInWei;

        // Final safety check. This case should be prevented by the profitability check, but ensures we don't send invalid values.
        if (escrowAmountForContract < 0n) {
            this.logger.error(`[CreditService] Calculated escrow amount is negative. Fee (${feeInWei}) exceeds deposit (${amount}). Aborting.`);
            await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'REJECTED_UNPROFITABLE', { deposit_value_usd: depositValueUsd, failure_reason: `Fee exceeded deposit value.` });
            return;
        }

        // 4. EXECUTE ON-CHAIN CONFIRMATION
        this.logger.info(`[CreditService] Step 4: Sending on-chain credit confirmation for tx ${transactionHash}. Net Escrow: ${escrowAmountForContract}, Fee: ${feeInWei}`);
        const txResponse = await this.ethereumService.write(this.contractConfig.address, this.contractConfig.abi, 'confirmCredit', vaultAccount, user, token, escrowAmountForContract, feeInWei, '0x');
        
        // Log the hash immediately after sending
        this.logger.info(`[CreditService] Transaction sent. On-chain hash: ${txResponse.hash}. Waiting for confirmation...`);

        // Now, wait for the transaction to be confirmed.
        const confirmationReceipt = await this.ethereumService.waitForConfirmation(txResponse);

        // FIX: Add validation to ensure we have a valid receipt and transaction hash before proceeding.
        if (!confirmationReceipt || !confirmationReceipt.hash) {
            this.logger.error(`[CreditService] CRITICAL: On-chain transaction may have succeeded but we failed to receive a valid receipt. Manual verification required for original tx: ${transactionHash}`);
            await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'ERROR_INVALID_RECEIPT', {
                failure_reason: 'Transaction was sent but an invalid receipt was returned by the provider.'
            });
            return; // Halt processing
        }

        this.logger.info(`[CreditService] On-chain credit confirmation successful. Tx: ${confirmationReceipt.hash}`);

        const actualGasCostEth = confirmationReceipt.gasUsed * (confirmationReceipt.gasPrice || confirmationReceipt.effectiveGasPrice);
        const actualGasCostUsd = parseFloat(formatEther(actualGasCostEth)) * priceInUsd;
        const netDepositValueUsd = depositValueUsd - actualGasCostUsd;

        // 5. OFF-CHAIN CREDIT APPLICATION
        this.logger.info(`[CreditService] Step 5: Applying credit to user's off-chain account. Net value: $${netDepositValueUsd.toFixed(2)}.`);
        try {
            // FIX: The URL path was incorrect. It needs the full internal API prefix.
            await this.internalApiClient.post(`/internal/v1/data/users/${masterAccountId}/economy/credit`, {
                amountUsd: netDepositValueUsd,
                transactionType: 'ONCHAIN_DEPOSIT',
                description: `Credit from on-chain deposit. Confirmed in tx: ${confirmationReceipt.hash}`,
                externalTransactionId: confirmationReceipt.hash,
            });
            this.logger.info(`[CreditService] Successfully applied credit to masterAccountId ${masterAccountId}.`);
        } catch (error) {
            this.logger.error(`[CreditService] CRITICAL: Failed to apply off-chain credit for ${masterAccountId} after successful on-chain confirmation! Requires manual intervention. Error: ${error.message}`);
            // Update status to a special state indicating on-chain success but off-chain failure
            await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'NEEDS_MANUAL_CREDIT', {
                master_account_id: masterAccountId,
                confirmation_tx_hash: confirmationReceipt.hash,
                net_value_usd: netDepositValueUsd,
                failure_reason: 'Off-chain credit application failed via internal API.',
                error_details: error.message
            });
            return; // Halt further processing
        }
        
        // 6. FINAL LEDGER UPDATE
        this.logger.info(`[CreditService] Step 6: Finalizing ledger entry for tx ${transactionHash}.`);
        await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'CONFIRMED', {
            master_account_id: masterAccountId,
            deposit_value_usd: depositValueUsd,
            gas_cost_usd: actualGasCostUsd,
            net_value_usd: netDepositValueUsd,
            confirmation_tx_hash: confirmationReceipt.hash,
        });

        this.logger.info(`[CreditService] Successfully processed deposit for tx ${transactionHash}`);

    } catch (error) {
      const errorMessage = error.message || 'An unknown error occurred';
      this.logger.error(`[CreditService] Unhandled error during confirmation for original deposit tx ${transactionHash}.`);
      this.logger.error('[CreditService] --- DETAILED ERROR ---');
      this.logger.error(`[CreditService] Error Message: ${errorMessage}`);
      this.logger.error(`[CreditService] Error Code: ${error.code || 'N/A'}`);
      this.logger.error(`[CreditService] Error Stack:`, error.stack);
      this.logger.error('[CreditService] --- END DETAILED ERROR ---');

      await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'ERROR', { 
        failure_reason: 'An unexpected error occurred during processing.',
        error_details: errorMessage,
        error_stack: error.stack // Also save the stack to the DB
      });
    }
  }
}

module.exports = CreditService; 