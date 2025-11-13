const { BaseDB, ObjectId } = require('./BaseDB');
const { Decimal128 } = require('mongodb');

const COLLECTION_NAME = 'costs';

/**
 * CostsDB - Database service for cost entries
 * Tracks business expenses for accounting purposes
 */
class CostsDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      console.warn('[CostsDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new cost entry
   * @param {Object} costData - The cost entry data
   * @param {Date} costData.date - Date of the cost
   * @param {string} costData.category - Category ('infrastructure', 'third-party', 'development', 'marketing', 'other')
   * @param {string} costData.description - Description of the cost
   * @param {number|string} costData.amount - Amount in USD
   * @param {string} [costData.currency='USD'] - Currency code
   * @param {string} [costData.vendor] - Vendor name
   * @param {string} [costData.receiptUrl] - URL to receipt/document
   * @param {string[]} [costData.tags] - Tags for categorization
   * @param {string} costData.createdBy - Admin wallet address
   * @returns {Promise<Object>} The created cost entry
   */
  async createCostEntry(costData) {
    const dataToInsert = {
      date: costData.date instanceof Date ? costData.date : new Date(costData.date),
      category: costData.category,
      description: costData.description,
      amount: Decimal128.fromString(costData.amount.toString()),
      currency: costData.currency || 'USD',
      vendor: costData.vendor || null,
      receiptUrl: costData.receiptUrl || null,
      tags: costData.tags || [],
      createdBy: costData.createdBy,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return this.insertOne(dataToInsert);
  }

  /**
   * Finds cost entries with optional filters
   * @param {Object} filter - MongoDB filter
   * @param {Object} options - Query options (sort, limit, etc.)
   * @returns {Promise<Array>} Array of cost entries
   */
  async findCosts(filter = {}, options = {}) {
    return this.findMany(filter, options);
  }

  /**
   * Finds a cost entry by ID
   * @param {ObjectId|string} costId - The cost entry ID
   * @returns {Promise<Object|null>} The cost entry or null
   */
  async findCostById(costId) {
    const id = costId instanceof ObjectId ? costId : new ObjectId(costId);
    return this.findOne({ _id: id });
  }

  /**
   * Updates a cost entry
   * @param {ObjectId|string} costId - The cost entry ID
   * @param {Object} updateData - Fields to update
   * @returns {Promise<Object>} Update result
   */
  async updateCost(costId, updateData) {
    const id = costId instanceof ObjectId ? costId : new ObjectId(costId);
    const dataToUpdate = {
      ...updateData,
      updatedAt: new Date()
    };

    // Convert amount to Decimal128 if present
    if (dataToUpdate.amount !== undefined) {
      dataToUpdate.amount = Decimal128.fromString(dataToUpdate.amount.toString());
    }

    // Convert date to Date if present
    if (dataToUpdate.date !== undefined && !(dataToUpdate.date instanceof Date)) {
      dataToUpdate.date = new Date(dataToUpdate.date);
    }

    return this.updateOne({ _id: id }, { $set: dataToUpdate });
  }

  /**
   * Deletes a cost entry
   * @param {ObjectId|string} costId - The cost entry ID
   * @returns {Promise<Object>} Delete result
   */
  async deleteCost(costId) {
    const id = costId instanceof ObjectId ? costId : new ObjectId(costId);
    return this.deleteOne({ _id: id });
  }

  /**
   * Gets total costs by category for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Totals by category
   */
  async getTotalsByCategory(startDate, endDate) {
    const costs = await this.findMany({
      date: { $gte: startDate, $lte: endDate }
    });

    const totals = {};
    costs.forEach(cost => {
      const category = cost.category || 'other';
      if (!totals[category]) {
        totals[category] = {
          category,
          count: 0,
          total: Decimal128.fromString('0')
        };
      }
      totals[category].count += 1;
      totals[category].total = Decimal128.fromString(
        (parseFloat(totals[category].total.toString()) + parseFloat(cost.amount.toString())).toString()
      );
    });

    return Object.values(totals);
  }
}

module.exports = CostsDB;

