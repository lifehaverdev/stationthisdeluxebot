const { BaseDB, ObjectId } = require('./BaseDB');
const { Decimal128 } = require('mongodb');

const COLLECTION_NAME = 'transactions';

class TransactionsDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[TransactionsDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Logs a new transaction.
   * IMPORTANT: balanceBeforeUsd and balanceAfterUsd must be calculated and provided
   * by the calling service, often in coordination with UserEconomyDB.
   * @param {Object} txData - The data for the new transaction.
   * @param {ObjectId} txData.masterAccountId - User's master account ID.
   * @param {string} txData.type - Type of transaction (e.g., 'debit', 'credit', 'generation_cost').
   * @param {string} txData.description - Human-readable description.
   * @param {string|number} txData.amountUsd - Transaction amount (use string for Decimal128).
   * @param {string|number} txData.balanceBeforeUsd - User's balance before this transaction.
   * @param {string|number} txData.balanceAfterUsd - User's balance after this transaction.
   * @param {Date} [txData.timestamp] - Timestamp of the transaction, defaults to now.
   * @param {Object} [txData.relatedItems] - Object linking to other records (e.g., eventId, generationId).
   * @param {string} [txData.externalTransactionId] - Optional ID from an external system.
   * @param {Object} [txData.metadata] - Other relevant metadata.
   * @returns {Promise<Object>} The created transaction document.
   */
  async logTransaction(txData, session = null) {
    if (txData.amountUsd === undefined || txData.balanceBeforeUsd === undefined || txData.balanceAfterUsd === undefined) {
      this.logger.error('[TransactionsDB] amountUsd, balanceBeforeUsd, and balanceAfterUsd are required for logging a transaction.');
      return null;
    }

    const dataToInsert = {
      ...txData,
      masterAccountId: new ObjectId(txData.masterAccountId),
      timestamp: txData.timestamp || new Date(),
      amountUsd: Decimal128.fromString(txData.amountUsd.toString()),
      balanceBeforeUsd: Decimal128.fromString(txData.balanceBeforeUsd.toString()),
      balanceAfterUsd: Decimal128.fromString(txData.balanceAfterUsd.toString()),
    };
    // Ensure relatedItems fields are ObjectIds if present
    if (dataToInsert.relatedItems) {
        if (dataToInsert.relatedItems.eventId) {
            dataToInsert.relatedItems.eventId = new ObjectId(dataToInsert.relatedItems.eventId);
        }
        if (dataToInsert.relatedItems.generationId) {
            dataToInsert.relatedItems.generationId = new ObjectId(dataToInsert.relatedItems.generationId);
        }
    }

    const result = await this.insertOne(dataToInsert, false, undefined, session);
    if (result.insertedId) {
        return { _id: result.insertedId, ...dataToInsert };
    }
    return null;
  }

  /**
   * Finds a transaction by its ID.
   * @param {ObjectId} transactionId - The ID of the transaction.
   * @param {object} options - Optional MongoDB find options (e.g., projection).
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Object|null>} The transaction document, or null if not found.
   */
  async findTransactionById(transactionId, options = {}, session = null) {
    if (!transactionId) {
        this.logger.error('[TransactionsDB] transactionId is required to find a transaction.');
        return null;
    }
    return this.findOne({ _id: new ObjectId(transactionId) }, options, undefined, session);
  }

  /**
   * Finds transactions by masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {Object} [options] - Query options (e.g., limit, sort: { timestamp: -1 }).
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Array<Object>>} A list of transaction documents.
   */
  async findTransactionsByMasterAccount(masterAccountId, options = {}, session = null) {
    if (!masterAccountId) {
        this.logger.error('[TransactionsDB] masterAccountId is required to find transactions.');
        return [];
    }
    const defaultSort = { timestamp: -1 }; // Default to newest first
    const queryOptions = { ...options, sort: options.sort || defaultSort };
    return this.findMany({ masterAccountId: new ObjectId(masterAccountId) }, queryOptions, undefined, session);
  }

  /**
   * Finds transactions for a user by type.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} type - The transaction type.
   * @param {Object} [options] - Query options.
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Array<Object>>} A list of transaction documents.
   */
  async findTransactionsByType(masterAccountId, type, options = {}, session = null) {
    if (!masterAccountId) {
        this.logger.error('[TransactionsDB] masterAccountId is required to find transactions.');
        return [];
    }
    const defaultSort = { timestamp: -1 };
    const queryOptions = { ...options, sort: options.sort || defaultSort };
    return this.findMany({ masterAccountId: new ObjectId(masterAccountId), type }, queryOptions, undefined, session);
  }

  /**
   * Finds transactions by a specific related item ID.
   * Example: find by relatedItems.generationId
   * @param {string} relatedItemPath - The path to the item ID (e.g., 'relatedItems.generationId').
   * @param {ObjectId} itemId - The ID of the related item.
   * @param {Object} [options] - Query options.
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Array<Object>>} A list of transaction documents.
   */
  async findTransactionsByRelatedItem(relatedItemPath, itemId, options = {}, session = null) {
    if (!relatedItemPath || !itemId) {
        this.logger.error('[TransactionsDB] relatedItemPath and itemId are required.');
        return [];
    }
    const defaultSort = { timestamp: -1 };
    const queryOptions = { ...options, sort: options.sort || defaultSort };
    return this.findMany({ [relatedItemPath]: new ObjectId(itemId) }, queryOptions, undefined, session);
  }

  async findTransactionsByRelatedEntity(entityType, entityId, options = {}) {
    if (!entityType || !entityId) {
        this.logger.error('[TransactionsDB] entityType and entityId are required.');
        return [];
    }
    return this.findMany({ relatedEntityType: entityType, relatedEntityId: new ObjectId(entityId) }, options);
  }
}

module.exports = TransactionsDB; 