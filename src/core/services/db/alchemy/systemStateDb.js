const { BaseDB } = require('../BaseDB');

const COLLECTION_NAME = 'system_state';
const LAST_SYNCED_BLOCK_KEY = 'last_synced_block';

class SystemStateDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[SystemStateDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Retrieves the last block number that was successfully processed.
   * @param {number} defaultValue - The value to return if no block number is found (e.g., contract deployment block).
   * @returns {Promise<number>} The last synced block number.
   */
  async getLastSyncedBlock(defaultValue = 0) {
    const doc = await this.findOne({ _id: LAST_SYNCED_BLOCK_KEY });
    return doc ? doc.value : defaultValue;
  }

  /**
   * Sets the last successfully processed block number.
   * This should be called after an event has been fully processed.
   * @param {number} blockNumber - The block number to save.
   * @returns {Promise<Object>} The result of the upsert operation.
   */
  async setLastSyncedBlock(blockNumber) {
    const filter = { _id: LAST_SYNCED_BLOCK_KEY };
    const update = { $set: { value: blockNumber } };
    const options = { upsert: true };
    return this.updateOne(filter, update, options);
  }
}

module.exports = SystemStateDB; 