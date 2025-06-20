const CreditLedgerDB = require('../db/alchemy/creditLedgerDb');
const SystemStateDB = require('../db/alchemy/systemStateDb');
// const NoemaUserCoreDB = require('../db/noemaUserCoreDb'); // To be implemented
// const NoemaUserEconomyDB = require('../db/noemaUserEconomyDb'); // To be implemented

// This should be the actual block number of the contract deployment on the target chain.
const CONTRACT_DEPLOYMENT_BLOCK = 0; 

/**
 * @class CreditService
 * @description A high-level service containing the specific business logic for the credit vault.
 * This service implements the deposit and withdrawal flows, uses the EthereumService for on-chain
 * actions, queries price feeds, and manages the link between on-chain activity and off-chain user accounts.
 */
class CreditService {
  /**
   * @param {object} services - A container for required service instances.
   * @param {EthereumService} services.ethereumService - Instance of EthereumService.
   * @param {CreditLedgerDB} services.creditLedgerDb - Instance of CreditLedgerDB.
   * @param {SystemStateDB} services.systemStateDb - Instance of SystemStateDB.
   * @param {NoemaUserCoreDB} services.userCoreDb - Instance of NoemaUserCoreDB to find users.
   * @param {NoemaUserEconomyDB} services.userEconomyDb - Instance of NoemaUserEconomyDB to update credits.
   * @param {object} services.priceFeed - A price feed service/client.
   * @param {object} config - Configuration object.
   * @param {string} config.creditVaultAddress - The address of the on-chain Credit Vault contract.
   * @param {Array} config.creditVaultAbi - The ABI of the Credit Vault contract.
   * @param {object} logger - A logger instance.
   */
  constructor(services, config, logger) {
    this.logger = logger || console;

    const { ethereumService, creditLedgerDb, systemStateDb, userCoreDb, userEconomyDb, priceFeed } = services;
    if (!ethereumService || !creditLedgerDb || !systemStateDb || !userCoreDb || !userEconomyDb || !priceFeed) {
      throw new Error('CreditService: Missing one or more required services.');
    }
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.systemStateDb = systemStateDb;
    this.userCoreDb = userCoreDb;
    this.userEconomyDb = userEconomyDb;
    this.priceFeed = priceFeed;
    
    const { creditVaultAddress, creditVaultAbi } = config;
    if (!creditVaultAddress || !creditVaultAbi) {
        throw new Error('CreditService: Missing contract address or ABI in config.');
    }
    this.contractConfig = { address: creditVaultAddress, abi: creditVaultAbi };

    this.logger.info('[CreditService] Initialized.');
  }

  /**
   * Initializes the service by performing a startup reconciliation to process missed events.
   * This should be called once when the application starts.
   */
  async initialize() {
    this.logger.info('[CreditService] Starting reconciliation process...');
    const fromBlock = (await this.systemStateDb.getLastSyncedBlock(CONTRACT_DEPLOYMENT_BLOCK)) + 1;
    const toBlock = await this.ethereumService.getLatestBlock();

    if (fromBlock > toBlock) {
      this.logger.info(`[CreditService] No new blocks to sync. Last synced block: ${toBlock}`);
      return;
    }

    const pastDepositEvents = await this.ethereumService.getPastEvents(
      this.contractConfig.address,
      this.contractConfig.abi,
      'Deposit', // Assuming event name from contract is 'Deposit'
      fromBlock,
      toBlock,
    );

    this.logger.info(`[CreditService] Found ${pastDepositEvents.length} missed 'Deposit' events. Processing...`);

    for (const event of pastDepositEvents) {
      await this._processDeposit(event);
    }

    this.logger.info('[CreditService] Reconciliation process completed.');
    await this.systemStateDb.setLastSyncedBlock(toBlock);
  }

  /**
   * Handles a live deposit event received from an Alchemy webhook.
   * @param {object} eventData - The structured event data from the webhook.
   */
  async handleDepositEvent(eventData) {
    this.logger.info(`[CreditService] Received live 'Deposit' event webhook for tx: ${eventData.transactionHash}`);
    // NOTE: The structure of eventData from Alchemy needs to be parsed into
    // an ethers.js-like event object. This is a placeholder for that transformation.
    const mockEthersEvent = {
        transactionHash: eventData.transactionHash,
        logIndex: eventData.logIndex,
        blockNumber: parseInt(eventData.blockNumber, 16), // Webhook block numbers are hex
        args: {
            depositor: eventData.depositor, // Placeholder for actual path in webhook data
            amount: ethers.BigNumber.from(eventData.amount), // Placeholder path
        }
    };
    await this._processDeposit(mockEthersEvent);
  }

  /**
   * Private method containing the core logic for processing a deposit event.
   * This is used by both the startup reconciliation and the live webhook handler.
   * @param {ethers.EventLog} event - The ethers.js event log object.
   * @private
   */
  async _processDeposit(event) {
    const { transactionHash, logIndex, blockNumber, args } = event;
    const { depositor, amount } = args;

    this.logger.info(`[CreditService] Processing deposit from ${depositor} for amount ${amount.toString()} in tx ${transactionHash}`);

    try {
      // 1. Idempotency Check: Ensure we haven't processed this event before.
      const existingEntry = await this.creditLedgerDb.findLedgerEntryByTxHash(transactionHash);
      if (existingEntry) {
        this.logger.warn(`[CreditService] Deposit event for tx ${transactionHash} already processed. Skipping.`);
        return;
      }
      
      // 2. User Lookup (to be implemented)
      // const user = await this.userCoreDb.findUserByWallet(depositor);
      
      // 3. Price Feed (to be implemented)
      // const depositValueUsd = await this.priceFeed.getPriceInUsd(tokenAddress, amount);

      // 4. Create Ledger Entry
      await this.creditLedgerDb.createLedgerEntry({
        deposit_tx_hash: transactionHash,
        deposit_log_index: logIndex,
        deposit_block_number: blockNumber,
        masterAccountId: 'user.masterAccountId', // Placeholder
        depositor_address: depositor,
        deposit_amount_wei: amount.toString(),
        deposit_value_usd: 10.00, // Placeholder
      });

      // 5. Execute On-Chain Confirmation
      const receipt = await this.ethereumService.write(
          this.contractConfig.address,
          this.contractConfig.abi,
          'confirmCredit', // Placeholder for actual function name in contract
          depositor,
          // ...other args for confirmCredit
      );

      // 6. Update Ledger Status to CONFIRMED
      await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'CONFIRMED', receipt.transactionHash);

      // 7. Update User's Off-chain Credit Balance (to be implemented)
      // await this.userEconomyDb.addCredit(user.masterAccountId, depositValueUsd);
      
      this.logger.info(`[CreditService] Successfully processed and confirmed deposit for tx ${transactionHash}`);

    } catch (error) {
      this.logger.error(`[CreditService] Failed to process deposit for tx ${transactionHash}:`, error);
      await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'ERROR');
    } finally {
        // In reconciliation, we update the last synced block after each event
        // to ensure we don't re-process successful events if a later one fails.
        await this.systemStateDb.setLastSyncedBlock(blockNumber);
    }
  }
}

module.exports = CreditService; 