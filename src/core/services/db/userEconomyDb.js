const { BaseDB, ObjectId: BaseDBObjectId } = require('./BaseDB');
const { ObjectId, Decimal128 } = require('mongodb');

class UserEconomyDB extends BaseDB {
  constructor(logger) {
    super('userEconomy');
    if (!logger) {
      console.warn('[UserEconomyDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console; 
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
   * @returns {Promise<Object|null>} The user economy document, or null if not found.
   */
  async findByMasterAccountId(masterAccountId, session = null) {
    return this.findOne({ masterAccountId: new ObjectId(masterAccountId) }, undefined, session);
  }

  /**
   * Updates the USD credit for a user.
   * Can be used to add or subtract credits.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {number|string} amountChange - The amount to change credits by (positive to add, negative to subtract).
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
   * @returns {Promise<{usdCredit: Decimal128, exp: BigInt}|null>} Economy details or null.
   */
  async getBalance(masterAccountId, session = null) {
    const economyRecord = await this.findByMasterAccountId(masterAccountId, session);
    if (economyRecord) {
      return {
        usdCredit: economyRecord.usdCredit,
        exp: economyRecord.exp,
      };
    }
    return null;
  }
}

module.exports = UserEconomyDB; 