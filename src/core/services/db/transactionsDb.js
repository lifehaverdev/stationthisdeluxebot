const { BaseDB, ObjectId: BaseDBObjectId } = require('./BaseDB');
const { ObjectId: MongoObjectId, Decimal128 } = require('mongodb');

class TransactionsDB extends BaseDB {
  constructor() {
    super('transactions');
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
  async logTransaction(txData) {
    if (txData.amountUsd === undefined || txData.balanceBeforeUsd === undefined || txData.balanceAfterUsd === undefined) {
      throw new Error('amountUsd, balanceBeforeUsd, and balanceAfterUsd are required for logging a transaction.');
    }

    const dataToInsert = {
      ...txData,
      masterAccountId: new MongoObjectId(txData.masterAccountId),
      timestamp: txData.timestamp || new Date(),
      amountUsd: Decimal128.fromString(txData.amountUsd.toString()),
      balanceBeforeUsd: Decimal128.fromString(txData.balanceBeforeUsd.toString()),
      balanceAfterUsd: Decimal128.fromString(txData.balanceAfterUsd.toString()),
    };
    // Ensure relatedItems fields are ObjectIds if present
    if (dataToInsert.relatedItems) {
        if (dataToInsert.relatedItems.eventId) {
            dataToInsert.relatedItems.eventId = new MongoObjectId(dataToInsert.relatedItems.eventId);
        }
        if (dataToInsert.relatedItems.generationId) {
            dataToInsert.relatedItems.generationId = new MongoObjectId(dataToInsert.relatedItems.generationId);
        }
    }

    const result = await this.insertOne(dataToInsert);
    if (result.insertedId) {
        return { _id: result.insertedId, ...dataToInsert };
    }
    return null;
  }

  /**
   * Finds a transaction by its ID.
   * @param {ObjectId} transactionId - The ID of the transaction.
   * @returns {Promise<Object|null>} The transaction document, or null if not found.
   */
  async findTransactionById(transactionId) {
    return this.findOne({ _id: new MongoObjectId(transactionId) });
  }

  /**
   * Finds transactions by masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {Object} [options] - Query options (e.g., limit, sort: { timestamp: -1 }).
   * @returns {Promise<Array<Object>>} A list of transaction documents.
   */
  async findTransactionsByMasterAccount(masterAccountId, options = {}) {
    const defaultSort = { timestamp: -1 }; // Default to newest first
    const queryOptions = { ...options, sort: options.sort || defaultSort };
    return this.findMany({ masterAccountId: new MongoObjectId(masterAccountId) }, queryOptions);
  }

  /**
   * Finds transactions for a user by type.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {string} type - The transaction type.
   * @param {Object} [options] - Query options.
   * @returns {Promise<Array<Object>>} A list of transaction documents.
   */
  async findTransactionsByType(masterAccountId, type, options = {}) {
    const defaultSort = { timestamp: -1 };
    const queryOptions = { ...options, sort: options.sort || defaultSort };
    return this.findMany({ masterAccountId: new MongoObjectId(masterAccountId), type }, queryOptions);
  }

  /**
   * Finds transactions by a specific related item ID.
   * Example: find by relatedItems.generationId
   * @param {string} relatedItemPath - The path to the item ID (e.g., 'relatedItems.generationId').
   * @param {ObjectId} itemId - The ID of the related item.
   * @param {Object} [options] - Query options.
   * @returns {Promise<Array<Object>>} A list of transaction documents.
   */
  async findTransactionsByRelatedItem(relatedItemPath, itemId, options = {}) {
    const defaultSort = { timestamp: -1 };
    const queryOptions = { ...options, sort: options.sort || defaultSort };
    return this.findMany({ [relatedItemPath]: new MongoObjectId(itemId) }, queryOptions);
  }
}

module.exports = new TransactionsDB(); 