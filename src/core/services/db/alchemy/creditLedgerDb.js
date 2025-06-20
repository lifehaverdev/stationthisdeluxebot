const { BaseDB, ObjectId } = require('../BaseDB');

const COLLECTION_NAME = 'credit_ledger';

class CreditLedgerDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[CreditLedgerDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new entry in the credit ledger.
   * This should be called when a new on-chain deposit event is detected.
   * @param {object} entryDetails - The details of the ledger entry.
   * @param {string} entryDetails.deposit_tx_hash - The hash of the deposit transaction.
   * @param {number} entryDetails.deposit_log_index - The log index of the deposit event.
   * @param {number} entryDetails.deposit_block_number - The block number of the deposit.
   * @param {string} entryDetails.deposit_contract_address - Address of the contract that received the deposit.
   * @param {string} entryDetails.deposit_contract_type - Type of contract ('MAIN_VAULT' or 'REFERRAL_VAULT').
   * @param {string} entryDetails.deposit_event_name - Name of the event ('Deposit' or 'AccountDeposit').
   * @param {ObjectId} entryDetails.masterAccountId - The master account ID of the user.
   * @param {string} entryDetails.depositor_address - The wallet address that made the deposit.
   * @param {string|null} entryDetails.referrer_address - The address of the referrer, if applicable.
   * @param {string} entryDetails.deposit_amount_wei - The raw amount of tokens deposited.
   * @returns {Promise<Object>} The result of the insertion.
   */
  async createLedgerEntry(entryDetails) {
    const dataToInsert = {
      ...entryDetails,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return this.insertOne(dataToInsert);
  }

  /**
   * Updates the status of a ledger entry.
   * Typically used to move an entry from PENDING_CONFIRMATION to CONFIRMED.
   * @param {string} depositTxHash - The hash of the original deposit transaction.
   * @param {string} status - The new status (e.g., 'CONFIRMED', 'FAILED').
   * @param {string} [confirmationTxHash] - The hash of the bot's confirmation transaction.
   * @returns {Promise<Object>} The result of the update operation.
   */
  async updateLedgerStatus(depositTxHash, status, confirmationTxHash) {
    const filter = { deposit_tx_hash: depositTxHash };
    const update = {
      $set: {
        status,
        updatedAt: new Date(),
      },
    };
    if (confirmationTxHash) {
      update.$set.confirmation_tx_hash = confirmationTxHash;
    }
    return this.updateOne(filter, update);
  }

  /**
   * Finds a ledger entry by the original deposit transaction hash.
   * @param {string} depositTxHash - The hash of the deposit transaction.
   * @returns {Promise<Object|null>} The ledger entry document, or null if not found.
   */
  async findLedgerEntryByTxHash(depositTxHash) {
    return this.findOne({ deposit_tx_hash: depositTxHash });
  }

  /**
   * Finds all ledger entries that are pending confirmation.
   * Useful for reconciliation or retrying failed confirmations.
   * @returns {Promise<Array<Object>>} A list of pending ledger entries.
   */
  async findPendingEntries() {
    return this.findMany({ status: 'PENDING_CONFIRMATION' });
  }
}

module.exports = CreditLedgerDB; 