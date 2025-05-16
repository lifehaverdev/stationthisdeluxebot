const { BaseDB, ObjectId } = require('./BaseDB');
const { Decimal128 } = require('mongodb');

const COLLECTION_NAME = 'userEconomy';

class UserEconomyDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[UserEconomyDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new economy record for a user.
   * Typically called when a new user is created.
   * @param {ObjectId} masterAccountId - The master account ID of the user.
   * @param {number|string} [initialCredit=0] - Initial USD credit amount.
   * @param {number} [initialExp=0] - Initial experience points.
   * @returns {Promise<Object>} The created user economy document.
   */
  async createUserEconomyRecord(masterAccountId, initialCredit = 0, initialExp = 0, session = null) {
    const now = new Date();
    const dataToInsert = {
      masterAccountId: new ObjectId(masterAccountId),
      usdCredit: Decimal128.fromString(initialCredit.toString()),
      exp: BigInt(initialExp), // exp is long
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.insertOne(dataToInsert, false, undefined, session);
    if (result.insertedId) {
        return { _id: result.insertedId, ...dataToInsert };
    }
    return null;
  }

  /**
   * Finds the economy record for a user by their masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID of the user.
   * @param {object} options - Optional MongoDB find options (e.g., projection).
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Object|null>} The user economy document, or null if not found.
   */
  async findByMasterAccountId(masterAccountId, options = {}, session = null) {
    return this.findOne({ masterAccountId: new ObjectId(masterAccountId) }, options, undefined, session);
  }

  /**
   * Updates the USD credit for a user.
   * Can be used to add or subtract credits.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {number|string} amountChange - The amount to change credits by (positive to add, negative to subtract).
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Object>} The update result.
   */
  async updateUsdCredit(masterAccountId, amountChange, session = null) {
    const numericAmountChange = Decimal128.fromString(amountChange.toString());
    return this.updateOne(
      { masterAccountId: new ObjectId(masterAccountId) },
      {
        $inc: { usdCredit: numericAmountChange },
        $set: { updatedAt: new Date() }
      },
      {},
      false,
      undefined,
      session
    );
  }

  /**
   * Sets the USD credit for a user to a specific value.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {number|string} newCreditAmount - The new total credit amount.
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Object>} The update result.
   */
  async setUsdCredit(masterAccountId, newCreditAmount, session = null) {
    return this.updateOne(
      { masterAccountId: new ObjectId(masterAccountId) },
      {
        $set: {
            usdCredit: Decimal128.fromString(newCreditAmount.toString()),
            updatedAt: new Date()
        }
      },
      {},
      false,
      undefined,
      session
    );
  }

  /**
   * Updates the experience points (EXP) for a user.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {number} expChange - The amount of EXP to add (can be negative to subtract, though less common).
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Object>} The update result.
   */
  async updateExperience(masterAccountId, expChange, session = null) {
    return this.updateOne(
      { masterAccountId: new ObjectId(masterAccountId) },
      {
        $inc: { exp: BigInt(expChange) },
        $set: { updatedAt: new Date() }
      },
      {},
      false,
      undefined,
      session
    );
  }

  /**
   * Sets the experience points (EXP) for a user to a specific value.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {number} newExpAmount - The new total EXP.
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<Object>} The update result.
   */
  async setExperience(masterAccountId, newExpAmount, session = null) {
    return this.updateOne(
      { masterAccountId: new ObjectId(masterAccountId) },
      {
        $set: {
            exp: BigInt(newExpAmount),
            updatedAt: new Date()
        }
      },
      {},
      false,
      undefined,
      session
    );
  }

  /**
   * Gets the current balance (USD credit and EXP) for a user.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {ClientSession} session - Optional MongoDB session.
   * @returns {Promise<{usdCredit: Decimal128, exp: BigInt}|null>} Economy details or null.
   */
  async getBalance(masterAccountId, session = null) {
    if (!masterAccountId) {
        this.logger.error('[UserEconomyDB] masterAccountId is required to get balance.');
        return null;
    }
    const economyRecord = await this.findByMasterAccountId(masterAccountId, {}, session);
    if (economyRecord) {
      return {
        usdCredit: economyRecord.usdCredit,
        exp: economyRecord.exp,
      };
    }
    return null;
  }

  async updateBalance(masterAccountId, amountUsdChange, transactionDetails, session) {
    if (!masterAccountId || typeof amountUsdChange !== 'number') {
        this.logger.error('[UserEconomyDB] masterAccountId and a numeric amountUsdChange are required.');
        // Consider throwing an error or returning a more specific error object
        return { success: false, message: "masterAccountId and a numeric amountUsdChange are required." };
    }

    const masterObjectId = new ObjectId(masterAccountId);
    const changeAsDecimal = Decimal128.fromString(amountUsdChange.toString());

    const economyRecord = await this.findOne({ masterAccountId: masterObjectId }, {}, session);
    const currentBalance = economyRecord ? economyRecord.balanceUsd : Decimal128.fromString("0.00");
    const newBalance = Decimal128.fromString((parseFloat(currentBalance.toString()) + amountUsdChange).toFixed(10)); // Perform decimal arithmetic carefully

    if (!economyRecord) {
      // Create new economy record if it doesn't exist
      await this.insertOne({
        masterAccountId: masterObjectId,
        balanceUsd: newBalance,
        lastTransactionTimestamp: new Date(),
        transactionHistory: [transactionDetails] // Ensure transactionDetails is well-defined
      }, true, undefined, session); // Note: BaseDB insertOne doesn't directly use priority here
    } else {
      // Update existing record
      await this.updateOne(
        { masterAccountId: masterObjectId },
        {
          $set: { balanceUsd: newBalance, lastTransactionTimestamp: new Date() },
          $push: { transactionHistory: transactionDetails }
        },
        { upsert: false }, // Should not upsert if record was found
        true, // skipUpdatedAt
        undefined, // priority - BaseDB updateOne doesn't use it directly
        session
      );
    }
    return { success: true, newBalance: parseFloat(newBalance.toString()) };
  }

  // Additional methods for history, etc.
}

module.exports = UserEconomyDB; 