const { ethers } = require('ethers');
const CreditLedgerDB = require('../db/alchemy/creditLedgerDb');
const SystemStateDB = require('../db/alchemy/systemStateDb');
// const NoemaUserCoreDB = require('../db/noemaUserCoreDb'); // To be implemented
// const NoemaUserEconomyDB = require('../db/noemaUserEconomyDb'); // To be implemented

// This should be the actual block number of the contract deployment on the target chain.
const CONTRACT_DEPLOYMENT_BLOCK = 0; 
// The address representing native ETH in contract events (typically the zero address).
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

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
   * @param {object} config - Configuration object.
   * @param {string} config.creditVaultAddress - The address of the on-chain Credit Vault contract.
   * @param {Array} config.creditVaultAbi - The ABI of the Credit Vault contract.
   * @param {object} logger - A logger instance.
   */
  constructor(services, config, logger) {
    this.logger = logger || console;

    const { ethereumService, creditLedgerDb, systemStateDb, priceFeedService } = services;
    if (!ethereumService || !creditLedgerDb || !systemStateDb || !priceFeedService) {
      throw new Error('CreditService: Missing one or more required services.');
    }
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.systemStateDb = systemStateDb;
    this.priceFeedService = priceFeedService;
    
    const { creditVaultAddress, creditVaultAbi } = config;
    if (!creditVaultAddress || !creditVaultAbi) {
        throw new Error('CreditService: Missing contract address or ABI in config.');
    }
    this.contractConfig = { address: creditVaultAddress, abi: creditVaultAbi };

    this.logger.info('[CreditService] Initialized.');
  }

  /**
   * Starts the service.
   * Clears the ledger for testing, then runs the startup reconciliation for missed events.
   */
  async start() {
    this.logger.info('[CreditService] Starting service...');

    // Clear the database for testing purposes on startup.
    this.logger.warn('[CreditService] Clearing credit ledger for testing...');
    await this.creditLedgerDb.clearCollection();
    this.logger.info('[CreditService] Credit ledger cleared.');

    await this.reconcileMissedEvents();
  }

  /**
   * Scans for and processes any `DepositRecorded` events missed since the last run.
   */
  async reconcileMissedEvents() {
    this.logger.info('[CreditService] Starting reconciliation of missed deposit events...');
    const fromBlock = (await this.systemStateDb.getLastSyncedBlock(CONTRACT_DEPLOYMENT_BLOCK)) + 1;
    const toBlock = await this.ethereumService.getLatestBlockNumber();

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
    const { user, token, amount } = args;

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
      
      const ethPrice = await this.priceFeedService.getEthPrice();
      const amountInEth = ethers.utils.formatEther(amount);
      const depositValueUsd = parseFloat(amountInEth) * ethPrice.usd;

      this.logger.info(`[CreditService] ETH deposit value: $${depositValueUsd.toFixed(2)} (Amount: ${amountInEth} ETH, Price: $${ethPrice.usd})`);

      await this.creditLedgerDb.createLedgerEntry({
        deposit_tx_hash: transactionHash,
        deposit_log_index: logIndex,
        deposit_block_number: blockNumber,
        deposit_event_name: 'DepositRecorded',
        depositor_address: user,
        token_address: token,
        deposit_amount_wei: amount.toString(),
        deposit_value_usd: depositValueUsd,
        status: 'RECONCILED', // A simple status for reconciled events
      });

      this.logger.info(`[CreditService] Successfully recorded reconciled deposit for tx ${transactionHash}`);

    } catch (error) {
      this.logger.error(`[CreditService] Failed to process deposit for tx ${transactionHash}:`, error);
      // We do not update the ledger status to ERROR here, as the entry was never created.
      // The overall sync will fail and retry on the next startup.
    }
  }
}

module.exports = CreditService; 