const { BaseDB, ObjectId } = require('../BaseDB');

const CE_DB_NAME = 'noemaplane';

/**
 * Base class for all ChainEngine database collections.
 * Uses the 'noemaplane' database instead of 'noema' for isolation.
 */
class ChainEngineBaseDB extends BaseDB {
  constructor(collectionName) {
    super(collectionName);
    this.dbName = CE_DB_NAME;
  }
}

module.exports = { ChainEngineBaseDB, ObjectId, CE_DB_NAME };
