const { ethers, formatEther } = require('ethers');
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

    // DEBUG: Forcing reconciliation logic to run from the constructor
    // to bypass issues with the start() method call in app.js.
    (async () => {
        try {
            this.logger.info('[CreditService] Starting service directly from constructor for debug...');
            this.logger.warn('[CreditService] Clearing credit ledger for testing...');
            await this.creditLedgerDb.clearCollection();
            this.logger.warn('[CreditService] Clearing system state for testing...');
            await this.systemStateDb.clearCollection();
            this.logger.info('[CreditService] Credit ledger and system state cleared.');
            await this.reconcileMissedEvents();
        } catch (error) {
            this.logger.error('[CreditService] CRITICAL: Reconciliation process failed during constructor startup.', error);
        }
    })();
  }

  /**
   * Starts the service.
   * Clears the ledger for testing, then runs the startup reconciliation for missed events.
   */
  async start() {
    this.logger.warn('[CreditService] start() method is currently bypassed for debugging. Reconciliation logic is running from the constructor.');
    // The original logic is now in the constructor.
  }

  /**
   * Scans for and processes any `DepositRecorded` events missed since the last run.
   */
  async reconcileMissedEvents() {
    this.logger.info('[CreditService] Starting reconciliation of missed deposit events...');
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

    this.logger.info(`[CreditService] Found ${pastDepositEvents.length} missed 'DepositRecorded' events. Processing...`);

    for (const event of pastDepositEvents) {
      await this._processDeposit(event);
    }

    this.logger.info('[CreditService] Reconciliation process completed.');
    await this.systemStateDb.setLastSyncedBlock(toBlock);
  }

  /**
   * Private method to process a single deposit event.
   * @param {ethers.EventLog} event - The ethers.js event log object.
   * @private
   */
  async _processDeposit(event) {
    const { transactionHash, logIndex, blockNumber, args } = event;
    const { vaultAccount, user, token, amount } = args;

    // For now, we only care about native ETH deposits.
    if (token.toLowerCase() !== NATIVE_ETH_ADDRESS.toLowerCase()) {
        this.logger.debug(`[CreditService] Skipping non-ETH deposit in tx ${transactionHash} for token ${token}.`);
        return;
    }

    this.logger.info(`[CreditService] Processing ETH deposit from ${user} for amount ${amount.toString()} in tx ${transactionHash}`);

    try {
      const existingEntry = await this.creditLedgerDb.findLedgerEntryByTxHash(transactionHash);
      if (existingEntry) {
        this.logger.warn(`[CreditService] Deposit event for tx ${transactionHash} already processed. Skipping.`);
        return;
      }
      
      this.logger.info(`[CreditService] Assessing collateral for token ${token}...`);
      const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount);

      if (!riskAssessment.isSafe) {
          this.logger.error(`[CreditService] Collateral assessment failed for tx ${transactionHash}. Reason: ${riskAssessment.reason}. Halting processing for this deposit.`);
          // Optionally, create a ledger entry with 'FAILED' status
          await this.creditLedgerDb.createLedgerEntry({
              deposit_tx_hash: transactionHash,
              deposit_log_index: logIndex,
              deposit_block_number: blockNumber,
              depositor_address: user,
              token_address: token,
              deposit_amount_wei: amount.toString(),
              status: 'FAILED_RISK_ASSESSMENT',
              failure_reason: riskAssessment.reason,
          });
          return;
      }
      this.logger.info(`[CreditService] Collateral assessment passed for tx ${transactionHash}.`);

      const priceInUsd = riskAssessment.price;
      if (!priceInUsd || priceInUsd <= 0) {
          this.logger.error(`[CreditService] Could not retrieve a valid price for token ${token} from risk assessment in tx ${transactionHash}.`);
          return;
      }

      const amountInNative = formatEther(amount);
      const depositValueUsd = parseFloat(amountInNative) * priceInUsd;
      const creditPoints = depositValueUsd / USD_TO_POINTS_CONVERSION_RATE;

      this.logger.info(`[CreditService] Deposit value: $${depositValueUsd.toFixed(2)} (Amount: ${amountInNative} ETH, Price: $${priceInUsd}). Awarding ${creditPoints.toFixed(0)} points.`);
      
      // --- DIAGNOSTIC: Read escrow state before confirming ---
      try {
        const custodyKey = getCustodyKey(user, token);
        this.logger.info(`[CreditService] DIAGNOSTIC: Reading custody for key ${custodyKey} in vault ${vaultAccount}`);
        const packedBalance = await this.ethereumService.read(
            this.contractConfig.address,
            this.contractConfig.abi,
            'custody',
            vaultAccount,
            custodyKey
        );
        const { userOwned, escrow } = splitCustodyAmount(packedBalance);
        this.logger.info(`[CreditService] DIAGNOSTIC: On-chain balance is: userOwned=${userOwned.toString()}, escrow=${escrow.toString()}`);
        this.logger.info(`[CreditService] DIAGNOSTIC: Comparing with event amount: ${amount.toString()}`);
      } catch (diagError) {
          this.logger.error('[CreditService] DIAGNOSTIC: Failed to read custody state.', diagError);
      }
      // --- END DIAGNOSTIC ---
      
      this.logger.info(`[CreditService] Executing on-chain credit confirmation for tx ${transactionHash}...`);
      
      const confirmationReceipt = await this.ethereumService.write(
          this.contractConfig.address,
          this.contractConfig.abi,
          'confirmCredit',
          vaultAccount,
          user,
          token,
          amount,
          0, // fee
          '0x' // metadata
      );
      
      this.logger.info(`[CreditService] On-chain credit confirmation successful. Tx: ${confirmationReceipt.transactionHash}`);

      await this.creditLedgerDb.createLedgerEntry({
        deposit_tx_hash: transactionHash,
        deposit_log_index: logIndex,
        deposit_block_number: blockNumber,
        deposit_event_name: 'DepositRecorded',
        depositor_address: user,
        token_address: token,
        deposit_amount_wei: amount.toString(),
        deposit_value_usd: depositValueUsd,
        credit_points_awarded: creditPoints,
        confirmation_tx_hash: confirmationReceipt.transactionHash,
        status: 'CONFIRMED', 
      });

      this.logger.info(`[CreditService] Successfully recorded and confirmed deposit for tx ${transactionHash}`);

    } catch (error) {
      this.logger.error(`[CreditService] Failed to process deposit for tx ${transactionHash}:`, error);
      // Here you might want to create a ledger entry with 'ERROR' status
      // to avoid retrying a transaction that will consistently fail.
      await this.creditLedgerDb.createLedgerEntry({
          deposit_tx_hash: transactionHash,
          logIndex,
          blockNumber,
          status: 'ERROR',
          failure_reason: error.message,
      }).catch(dbError => {
          this.logger.error(`[CreditService] CRITICAL: Failed to even write error state to DB for tx ${transactionHash}`, dbError);
      });
    }
  }
}

module.exports = CreditService; 