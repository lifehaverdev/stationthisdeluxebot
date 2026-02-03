/**
 * x402 Payment Log Database
 *
 * Tracks used x402 payments for:
 * 1. Replay protection - prevent same payment signature being used twice
 * 2. Analytics - track x402 revenue, usage patterns
 * 3. Audit trail - who paid for what
 *
 * This is NOT a credit ledger. x402 one-off payments don't create accounts.
 */

const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

/**
 * @typedef {Object} X402PaymentRecord
 * @property {string} signature_hash - Hash of the payment signature (unique key)
 * @property {string} payer - Wallet address that signed the payment
 * @property {string} amount - Amount in atomic units
 * @property {string} asset - Token contract address
 * @property {string} network - CAIP-2 network ID
 * @property {string} pay_to - Receiver address (our Foundation)
 * @property {string} [tx_hash] - On-chain transaction hash (after settlement)
 * @property {string} tool_id - Tool that was executed
 * @property {string} [generation_id] - Generation ID if applicable
 * @property {string} [spell_id] - Spell ID if applicable
 * @property {number} cost_usd - Cost in USD
 * @property {number} paid_usd - Amount paid in USD
 * @property {string} status - 'VERIFIED' | 'SETTLED' | 'FAILED'
 * @property {Date} verified_at - When payment was verified
 * @property {Date} [settled_at] - When payment was settled on-chain
 * @property {Date} created_at
 */

class X402PaymentLogDB extends BaseDB {
  constructor(logger) {
    super('x402_payment_log');
    if (!logger) {
      console.warn('[X402PaymentLogDB] Logger instance was not provided. Falling back to console.');
      this.logger = console;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Ensure indexes exist
   */
  async ensureIndexes() {
    try {
      const client = await getCachedClient();
      const collection = client.db(this.dbName).collection(this.collectionName);

      await collection.createIndexes([
        { key: { signature_hash: 1 }, unique: true, name: 'signature_hash_unique_idx' },
        { key: { payer: 1 }, name: 'payer_idx', background: true },
        { key: { tx_hash: 1 }, sparse: true, name: 'tx_hash_idx', background: true },
        { key: { status: 1, created_at: -1 }, name: 'status_created_idx', background: true },
        { key: { created_at: -1 }, name: 'created_at_idx', background: true },
        { key: { settled_at: -1 }, sparse: true, name: 'settled_at_idx', background: true }
      ]);

      this.logger.info('[X402PaymentLogDB] Indexes ensured');
    } catch (error) {
      this.logger.error('[X402PaymentLogDB] Failed to ensure indexes:', error);
      throw error;
    }
  }

  /**
   * Check if a payment signature has already been used
   * Used for replay protection BEFORE verification
   *
   * @param {string} signatureHash - Hash of the payment signature
   * @returns {Promise<boolean>} True if already used
   */
  async isSignatureUsed(signatureHash) {
    const existing = await this.findOne(
      { signature_hash: signatureHash },
      { projection: { _id: 1 } }
    );
    return !!existing;
  }

  /**
   * Record a verified payment (before settlement)
   *
   * @param {Object} payment
   * @returns {Promise<Object>} Insert result
   */
  async recordVerified(payment) {
    const record = {
      signature_hash: payment.signatureHash,
      payer: payment.payer,
      amount: payment.amount,
      asset: payment.asset,
      network: payment.network,
      pay_to: payment.payTo,
      tool_id: payment.toolId,
      generation_id: payment.generationId || null,
      spell_id: payment.spellId || null,
      cost_usd: payment.costUsd,
      paid_usd: payment.paidUsd,
      status: 'VERIFIED',
      verified_at: new Date(),
      created_at: new Date()
    };

    const result = await this.insertOne(record);

    this.logger.info('[X402PaymentLogDB] Payment recorded (verified)', {
      signatureHash: payment.signatureHash.slice(0, 16) + '...',
      payer: payment.payer,
      toolId: payment.toolId
    });

    return result;
  }

  /**
   * Update payment record after successful settlement
   *
   * @param {string} signatureHash - Payment signature hash
   * @param {string} txHash - On-chain transaction hash
   * @returns {Promise<Object>} Update result
   */
  async recordSettled(signatureHash, txHash) {
    const result = await this.updateOne(
      { signature_hash: signatureHash },
      {
        $set: {
          status: 'SETTLED',
          tx_hash: txHash,
          settled_at: new Date()
        }
      }
    );

    this.logger.info('[X402PaymentLogDB] Payment settled', {
      signatureHash: signatureHash.slice(0, 16) + '...',
      txHash
    });

    return result;
  }

  /**
   * Mark payment as failed (settlement failed after verification)
   *
   * @param {string} signatureHash - Payment signature hash
   * @param {string} reason - Failure reason
   * @returns {Promise<Object>} Update result
   */
  async recordFailed(signatureHash, reason) {
    const result = await this.updateOne(
      { signature_hash: signatureHash },
      {
        $set: {
          status: 'FAILED',
          failure_reason: reason,
          failed_at: new Date()
        }
      }
    );

    this.logger.warn('[X402PaymentLogDB] Payment failed', {
      signatureHash: signatureHash.slice(0, 16) + '...',
      reason
    });

    return result;
  }

  /**
   * Find payment by signature hash
   *
   * @param {string} signatureHash
   * @returns {Promise<Object|null>}
   */
  async findBySignatureHash(signatureHash) {
    return this.findOne({ signature_hash: signatureHash });
  }

  /**
   * Find payment by transaction hash
   *
   * @param {string} txHash
   * @returns {Promise<Object|null>}
   */
  async findByTxHash(txHash) {
    return this.findOne({ tx_hash: txHash });
  }

  /**
   * Get payments by payer address
   *
   * @param {string} payer - Wallet address
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {number} [options.skip=0]
   * @returns {Promise<Array>}
   */
  async findByPayer(payer, options = {}) {
    const { limit = 50, skip = 0 } = options;
    return this.findMany(
      { payer: payer.toLowerCase() },
      { sort: { created_at: -1 }, skip, limit }
    );
  }

  /**
   * Get aggregate stats for a time period
   *
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<Object>}
   */
  async getStats(startDate, endDate) {
    const pipeline = [
      {
        $match: {
          created_at: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total_usd: { $sum: '$paid_usd' }
        }
      }
    ];

    const results = await this.aggregate(pipeline);

    // Transform to friendly format
    const stats = {
      verified: { count: 0, totalUsd: 0 },
      settled: { count: 0, totalUsd: 0 },
      failed: { count: 0, totalUsd: 0 }
    };

    for (const row of results) {
      const key = row._id.toLowerCase();
      if (stats[key]) {
        stats[key].count = row.count;
        stats[key].totalUsd = row.total_usd;
      }
    }

    return stats;
  }

  /**
   * Get revenue by day for a time period
   *
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<Array>}
   */
  async getRevenueByDay(startDate, endDate) {
    const pipeline = [
      {
        $match: {
          status: 'SETTLED',
          settled_at: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$settled_at' }
          },
          count: { $sum: 1 },
          total_usd: { $sum: '$paid_usd' }
        }
      },
      { $sort: { _id: 1 } }
    ];

    return this.aggregate(pipeline);
  }

  /**
   * Get top payers for a time period
   *
   * @param {Date} startDate
   * @param {Date} endDate
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async getTopPayers(startDate, endDate, limit = 10) {
    const pipeline = [
      {
        $match: {
          status: 'SETTLED',
          settled_at: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$payer',
          count: { $sum: 1 },
          total_usd: { $sum: '$paid_usd' }
        }
      },
      { $sort: { total_usd: -1 } },
      { $limit: limit }
    ];

    return this.aggregate(pipeline);
  }
}

module.exports = X402PaymentLogDB;
