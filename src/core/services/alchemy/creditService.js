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
 * @description Manages the credit lifecycle, starting with deposit reconciliation.
 */
class CreditService {
  /**
   * @param {object} services - A container for required service instances.
   * @param {EthereumService} services.ethereumService - Instance of EthereumService.
   * @param {CreditLedgerDB} services.creditLedgerDb - Instance of CreditLedgerDB.
   * @param {SystemStateDB} services.systemStateDb - Instance of SystemStateDB.
   * @param {PriceFeedService} services.priceFeedService - Service for fetching token prices.
   * @param {TokenRiskEngine} services.tokenRiskEngine - Service for assessing collateral risk.
   * @param {object} config - Configuration object.
   * @param {string} config.creditVaultAddress - The address of the on-chain Credit Vault contract.
   * @param {Array} config.creditVaultAbi - The ABI of the Credit Vault contract.
   * @param {object} logger - A logger instance.
   */
  constructor(services, config, logger) {
    this.logger = logger || console;

    const { ethereumService, creditLedgerDb, systemStateDb, priceFeedService, tokenRiskEngine } = services;
    if (!ethereumService || !creditLedgerDb || !systemStateDb || !priceFeedService || !tokenRiskEngine) {
      throw new Error('CreditService: Missing one or more required services.');
    }
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.systemStateDb = systemStateDb;
    this.priceFeedService = priceFeedService;
    this.tokenRiskEngine = tokenRiskEngine;
    
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
   * STAGE 2: Processes all deposits that are in a 'PENDING_CONFIRMATION' state.
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
   * Private method to process a single pending confirmation.
   * This contains the logic previously in _processDeposit.
   * @param {object} deposit - The ledger entry document from the database.
   * @private
   */
  async _processSingleConfirmation(deposit) {
    const { deposit_tx_hash: transactionHash, deposit_log_index: logIndex, deposit_block_number: blockNumber, vault_account: vaultAccount, depositor_address: user, token_address: token, deposit_amount_wei } = deposit;
    const amount = ethers.getBigInt(deposit_amount_wei);

    this.logger.info(`[CreditService] Processing confirmation for tx ${transactionHash}`);
    
    // For now, we only care about native ETH deposits. This can be expanded.
    if (token.toLowerCase() !== NATIVE_ETH_ADDRESS.toLowerCase()) {
        this.logger.debug(`[CreditService] Skipping non-ETH deposit in tx ${transactionHash} for token ${token}.`);
        // TODO: Update status to 'SKIPPED' or similar?
        return;
    }

    try {
      // ON-CHAIN VERIFICATION VIA EVENT QUERY
      // We create a unique ID for the original deposit event to check if it's been confirmed.
      const uniqueEventArgs = [vaultAccount, user, token, amount];
      this.logger.info(`[CreditService] Verifying on-chain confirmation status for deposit: ${transactionHash}`);

      // Query for past CreditConfirmed events that match our deposit details
      const confirmedEvents = await this.ethereumService.getPastEvents(
        this.contractConfig.address,
        this.contractConfig.abi,
        'CreditConfirmed',
        blockNumber, // Start searching from the block of the deposit
        'latest',
        [vaultAccount, user, token] // Filter by indexed event params
      );
      
      const alreadyConfirmed = confirmedEvents.some(event => event.args.amount.toString() === amount.toString());

      if (alreadyConfirmed) {
          this.logger.warn(`[CreditService] Found CreditConfirmed event for deposit ${transactionHash}. Updating status and skipping transaction.`);
          const confirmedEvent = confirmedEvents.find(event => event.args.amount.toString() === amount.toString());
          await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'CONFIRMED', { 
            failure_reason: 'Confirmed in a previous run.',
            confirmation_tx_hash: confirmedEvent.transactionHash
          });
          return;
      }
      this.logger.info(`[CreditService] No 'CreditConfirmed' event found. Proceeding with processing.`);

      // --- Full validation logic from the old _processDeposit method ---
      this.logger.info(`[CreditService] Assessing collateral for token ${token}...`);
      const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount);

      if (!riskAssessment.isSafe) {
          this.logger.error(`[CreditService] Collateral assessment failed for tx ${transactionHash}. Reason: ${riskAssessment.reason}.`);
          await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'FAILED_RISK_ASSESSMENT', { failure_reason: riskAssessment.reason });
          return;
      }
      this.logger.info(`[CreditService] Collateral assessment passed for tx ${transactionHash}.`);

      const priceInUsd = riskAssessment.price;
      if (!priceInUsd || priceInUsd <= 0) {
          this.logger.error(`[CreditService] Could not retrieve a valid price for token ${token} in tx ${transactionHash}.`);
          await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'ERROR', { failure_reason: 'Invalid price retrieved.' });
          return;
      }

      const amountInNative = formatEther(amount);
      const depositValueUsd = parseFloat(amountInNative) * priceInUsd;
      
      this.logger.info(`[CreditService] Performing pre-flight gas profitability check...`);
      try {
        const estimatedGasCostUsd = await this.ethereumService.estimateGasCostInUsd(
          this.contractConfig.address,
          this.contractConfig.abi,
          'confirmCredit',
          vaultAccount,
          user,
          token,
          amount,
          0,      // fee
          '0x'    // metadata
        );

        if (estimatedGasCostUsd >= depositValueUsd) {
          this.logger.warn(`[CreditService] Deposit for tx ${transactionHash} is not profitable. Rejecting.`);
          await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'REJECTED_UNPROFITABLE', {
              deposit_value_usd: depositValueUsd,
              failure_reason: `Estimated gas cost ($${estimatedGasCostUsd.toFixed(4)}) exceeded deposit value ($${depositValueUsd.toFixed(2)}).`
          });
          return;
        }
      } catch (error) {
        const errorMessage = error.message || 'An unknown error occurred';
        this.logger.error(`[CreditService] Gas estimation failed for tx ${transactionHash}: ${errorMessage}`, { error: error.stack });
        
        const failureReason = "Gas estimation failed, transaction would revert.";
        const detailedError = `The operator wallet may not be an authorized 'backend' on the CreditVault contract. Raw Error: ${errorMessage}`;
        
        await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'ERROR', { 
          failure_reason: failureReason,
          error_details: detailedError
        });
        return; // Stop processing this deposit
      }
      
      this.logger.info(`[CreditService] Gas profitability check passed.`);
      
      this.logger.info(`[CreditService] Executing on-chain credit confirmation for tx ${transactionHash}...`);
      
      const confirmationReceipt = await this.ethereumService.write(
          this.contractConfig.address,
          this.contractConfig.abi,
          'confirmCredit',
          vaultAccount,
          user,
          token,
          amount,
          0,      // fee
          '0x'    // metadata
      );
      
      this.logger.info(`[CreditService] On-chain credit confirmation successful. Tx: ${confirmationReceipt.transactionHash}`);

      const actualGasUsed = confirmationReceipt.gasUsed;
      const effectiveGasPrice = confirmationReceipt.gasPrice || confirmationReceipt.effectiveGasPrice;
      const actualGasCostEth = actualGasUsed * effectiveGasPrice;
      const actualGasCostUsd = parseFloat(formatEther(actualGasCostEth)) * priceInUsd;
      const netDepositValueUsd = depositValueUsd - actualGasCostUsd;
      const creditPoints = netDepositValueUsd > 0 ? (netDepositValueUsd / USD_TO_POINTS_CONVERSION_RATE) : 0;
      
      this.logger.info(`[CreditService] Debited gas cost. Net value: $${netDepositValueUsd.toFixed(2)}. Awarding ${creditPoints.toFixed(0)} points.`);
      
      await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'CONFIRMED', {
        deposit_event_name: 'DepositRecorded',
        deposit_value_usd: depositValueUsd,
        gas_cost_usd: actualGasCostUsd,
        net_value_usd: netDepositValueUsd,
        credit_points_awarded: creditPoints,
        confirmation_tx_hash: confirmationReceipt.transactionHash,
      });

      this.logger.info(`[CreditService] Successfully recorded and confirmed deposit for tx ${transactionHash}`);

    } catch (error) {
      const errorMessage = error.message || 'An unknown error occurred';
      this.logger.error(`[CreditService] Gas estimation failed for tx ${transactionHash}: ${errorMessage}`, { error: error.stack });

      // If gas estimation fails, it means the transaction would revert.
      // This is not a profitability issue, but a fundamental problem with the transaction.
      // Let's mark it as an error and log the details.
      const failureReason = "Gas estimation failed, transaction would revert.";
      const detailedError = `The operator wallet may not be an authorized 'backend' on the CreditVault contract. Raw Error: ${errorMessage}`;
      
      await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'ERROR', { 
        rejectionReason: failureReason,
        errorDetails: detailedError
      });
    }
  }
}

module.exports = CreditService; 