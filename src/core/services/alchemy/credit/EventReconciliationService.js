/**
 * EventReconciliationService
 * 
 * Handles startup reconciliation of missed events and event acknowledgment.
 * Scans for missed blockchain events and acknowledges them in the database.
 */
const { ethers } = require('ethers');
const { getCustodyKey } = require('../contractUtils');

// This should be the actual block number of the contract deployment on the target chain.
const CONTRACT_DEPLOYMENT_BLOCK = 8589453;

class EventReconciliationService {
  constructor(ethereumService, systemStateDb, creditLedgerDb, magicAmountLinkingService, contractConfig, logger) {
    this.ethereumService = ethereumService;
    this.systemStateDb = systemStateDb;
    this.creditLedgerDb = creditLedgerDb;
    this.magicAmountLinkingService = magicAmountLinkingService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Acknowledges new deposit events by scanning for missed events.
   * This is called during startup to catch any events that were missed.
   * @returns {Promise<void>}
   */
  async reconcileMissedEvents() {
    this.logger.debug('[EventReconciliationService] Starting acknowledgment of new deposit events...');
    const fromBlock = (await this.systemStateDb.getLastSyncedBlock(CONTRACT_DEPLOYMENT_BLOCK)) + 1;
    const toBlock = await this.ethereumService.getLatestBlock();

    if (fromBlock > toBlock) {
      this.logger.debug(`[EventReconciliationService] No new blocks to sync. Last synced block: ${toBlock}`);
      return;
    }

    this.logger.debug(`[EventReconciliationService] Fetching 'ContributionRecorded' events from block ${fromBlock} to ${toBlock}.`);
    const pastDepositEvents = await this.ethereumService.getPastEvents(
      this.contractConfig.address,
      this.contractConfig.abi,
      'ContributionRecorded',
      fromBlock,
      toBlock,
    );

    this.logger.debug(`[EventReconciliationService] Found ${pastDepositEvents.length} new 'ContributionRecorded' events. Acknowledging...`);

    for (const event of pastDepositEvents) {
      await this.acknowledgeEvent(event);
    }

    this.logger.debug('[EventReconciliationService] Event acknowledgment process completed.');
    await this.systemStateDb.setLastSyncedBlock(toBlock);
  }

  /**
   * Acknowledges a single event by creating a ledger entry.
   * @param {object} event - The blockchain event object
   * @returns {Promise<void>}
   */
  async acknowledgeEvent(event) {
    const { transactionHash, logIndex, blockNumber, args } = event;
    // Normalize transaction hash to lowercase for consistency
    const normalizedTxHash = transactionHash.toLowerCase();
    let { fundAddress } = args;
    const { user, token, amount } = args;

    // --- MAGIC AMOUNT WALLET LINKING ---
    if (this.magicAmountLinkingService) {
      const wasHandledByLinking = await this.magicAmountLinkingService.checkMagicAmount(user, token, amount.toString());
      if (wasHandledByLinking) {
        this.logger.debug(`[EventReconciliationService] Deposit from tx ${normalizedTxHash} was a magic amount and has been fully processed. Skipping credit ledger entry.`);
        return; // Skip to the next event.
      }
    }
    // --- END MAGIC AMOUNT ---

    // If fundAddress is not in the event args, it's a deposit to the main vault.
    // In this case, the fundAddress IS the main contract address.
    if (!fundAddress || !ethers.isAddress(fundAddress)) {
      this.logger.warn(`[EventReconciliationService] 'fundAddress' not found or invalid in event args for tx ${normalizedTxHash}. Assuming deposit to main vault.`);
      fundAddress = this.contractConfig.address;
    }

    const existingEntry = await this.creditLedgerDb.findLedgerEntryByTxHash(normalizedTxHash);
    if (existingEntry) {
      this.logger.debug(`[EventReconciliationService] Skipping event for tx ${normalizedTxHash} as it's already acknowledged.`);
      return;
    }

    this.logger.debug(`[EventReconciliationService] Acknowledging new deposit: ${normalizedTxHash}`);
    await this.creditLedgerDb.createLedgerEntry({
      deposit_tx_hash: normalizedTxHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: fundAddress, // Stays vault_account in DB for now
      depositor_address: user,
      token_address: token,
      deposit_amount_wei: amount.toString(),
      status: 'PENDING_CONFIRMATION', // Initial status
    });
  }
}

module.exports = EventReconciliationService;

