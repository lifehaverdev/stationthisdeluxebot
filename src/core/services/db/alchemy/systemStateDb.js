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

  async getValue(key, defaultValue = null) {
    const doc = await this.findOne({ _id: key });
    return doc ? doc.value : defaultValue;
  }

  async setValue(key, value) {
    const filter = { _id: key };
    const update = { $set: { value } };
    const options = { upsert: true };
    return this.updateOne(filter, update, options);
  }

  /**
   * Retrieves the last block number that was successfully processed.
   */
  async getLastSyncedBlock(defaultValue = 0) {
    return this.getValue(LAST_SYNCED_BLOCK_KEY, defaultValue);
  }

  /**
   * Sets the last successfully processed block number.
   */
  async setLastSyncedBlock(blockNumber) {
    return this.setValue(LAST_SYNCED_BLOCK_KEY, blockNumber);
  }
}

module.exports = SystemStateDB; 
