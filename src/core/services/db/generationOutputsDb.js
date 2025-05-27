const { BaseDB, ObjectId } = require('./BaseDB');
// const { getCachedClient } = require('./utils/queue'); // Not needed here anymore

class GenerationOutputsDB extends BaseDB {
  constructor(logger) { 
    super('generationOutputs');
    if (!logger) {
      console.warn('[GenerationOutputsDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console; 
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new generation output record.
   * @param {Object} outputData - The data for the new generation output.
   * @param {ObjectId} outputData.masterAccountId - FK to userCore._id.
   * @param {ObjectId} outputData.sessionId - FK to userSessions.sessionId.
   * @param {ObjectId} outputData.initiatingEventId - FK to userEvents.eventId.
   * @param {string} outputData.serviceName - Identifier for the generation service.
   * @param {string} outputData.status - Initial status (e.g., 'pending', 'processing').
   * @param {string} outputData.notificationPlatform - Platform for notifications (e.g., 'telegram', 'discord', 'none').
   * @param {string} outputData.deliveryStatus - Initial delivery status (e.g., 'pending', 'skipped', 'none').
   * @param {Object} [outputData.requestPayload] - Payload sent to the service.
   * @param {string} [outputData.platformSpecificRunId] - Optional ID from the external platform.
   * @param {Object} [outputData.metadata] - Additional metadata.
   * @param {Object} [outputData.metadata.notificationContext] - Context for the notification (e.g., { chatId, userId, messageId }).
   * @param {Date} [outputData.requestTimestamp] - Timestamp of request, defaults to now.
   * @returns {Promise<Object>} The created generation output document.
   */
  async createGenerationOutput(outputData) {
    const dataToInsert = {
      // generationId will be handled by BaseDB as _id
      requestTimestamp: new Date(),
      ...outputData,
      // Ensure required fields from schema have defaults or are passed in
      status: outputData.status || 'pending', // Default initial status
    };
    const result = await this.insertOne(dataToInsert);
    if (result.insertedId) {
        // Assuming generationId is the _id, so we mirror that.
        return { _id: result.insertedId, generationId: result.insertedId, ...dataToInsert };
    }
    return null;
  }

  /**
   * Finds a generation output by its ID (generationId, which is _id).
   * @param {ObjectId} generationId - The ID of the generation output.
   * @returns {Promise<Object|null>} The document, or null if not found.
   */
  async findGenerationById(generationId) {
    return this.findOne({ _id: generationId });
  }

  /**
   * Updates a generation output record.
   * @param {ObjectId} generationId - The ID of the generation output to update.
   * @param {Object} updateData - The data to update.
   * @param {string} [updateData.status] - New status.
   * @param {string} [updateData.deliveryStatus] - Updated delivery status (e.g., 'sent', 'failed').
   * @param {Date} [updateData.deliveryTimestamp] - Timestamp of successful delivery.
   * @param {string} [updateData.deliveryError] - Error message if delivery failed.
   * @param {number} [updateData.deliveryAttempts] - Number of delivery attempts.
   * @param {Date} [updateData.responseTimestamp] - Timestamp of response.
   * @param {number} [updateData.durationMs] - Duration in milliseconds.
   * @param {Object} [updateData.responsePayload] - Response received from the service.
   * @param {Array<Object>} [updateData.artifactUrls] - URLs to generated artifacts.
   * @param {Object} [updateData.errorDetails] - Structured error details.
   * @param {Decimal128} [updateData.costUsd] - Cost of the generation.
   * @param {string} [updateData.platformSpecificRunId] - Updated external platform ID.
   * @param {Object} [updateData.metadata] - Additional metadata.
   * @param {Object} [updateData.ratings] - Ratings for the generation.
   * @returns {Promise<Object>} The update result.
   */
  async updateGenerationOutput(generationId, updateData) {
    const dataToUpdate = { ...updateData };
    if (updateData.ratings) {
      // Ensure ratings is an object with arrays for each rating type
      const currentRatings = await this.findGenerationById(generationId);
      const ratings = currentRatings.ratings || { beautiful: [], funny: [], sad: [] };

      // Remove the user from all rating categories
      for (const key in ratings) {
        ratings[key] = ratings[key].filter(id => id.toString() !== updateData.masterAccountId.toString());
      }

      // Add the user to the new rating category
      if (!ratings[updateData.ratingType].includes(updateData.masterAccountId)) {
        ratings[updateData.ratingType].push(updateData.masterAccountId);
      }

      dataToUpdate.ratings = ratings;
    }
    if (updateData.status && (updateData.status === 'success' || updateData.status === 'failed' || updateData.status === 'cancelled_by_user' || updateData.status === 'timeout')) {
        dataToUpdate.responseTimestamp = updateData.responseTimestamp || new Date();
        // durationMs should ideally be calculated based on requestTimestamp stored in DB
        // For simplicity here, if not provided, it won't be set by this basic update.
        // A more sophisticated approach would fetch the record, calculate duration, then update.
    }
    return this.updateOne({ _id: generationId }, dataToUpdate);
  }

  /**
   * Finds generation outputs by masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @returns {Promise<Array<Object>>} A list of documents.
   */
  async findGenerationsByMasterAccount(masterAccountId, options = {}) {
    return this.findMany({ masterAccountId });
  }

  /**
   * Finds generation outputs by sessionId.
   * @param {ObjectId} sessionId - The session ID.
   * @returns {Promise<Array<Object>>} A list of documents.
   */
  async findGenerationsBySession(sessionId, options = {}) {
    return this.findMany({ sessionId });
  }

    /**
   * Finds generation outputs by their status.
   * @param {string} status - The status to filter by (e.g., 'pending', 'success', 'failed').
   * @returns {Promise<Array<Object>>} A list of documents.
   */
  async findGenerationsByStatus(status, options = {}) {
    return this.findMany({ status });
  }

  /**
   * Finds generation outputs based on a flexible query filter.
   * @param {Object} filter - MongoDB query filter object.
   * @param {Object} [options] - MongoDB query options (e.g., sort, limit, skip).
   * @returns {Promise<Array<Object>>} A list of documents matching the filter.
   */
  async findGenerations(filter, options = {}) {
    this.logger.debug(`[GenerationOutputsDB] findGenerations called with filter: ${JSON.stringify(filter)}, options: ${JSON.stringify(options)}`);
    return this.findMany(filter, options);
  }

  /**
   * Retrieves the most frequently used tools (services) for a given masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID of the user.
   * @param {number} [limit=4] - The maximum number of tools to return.
   * @returns {Promise<Array<Object>>} A promise that resolves to an array of objects,
   * where each object is of the form { toolId: string, usageCount: number }.
   * Returns an empty array if no tools are found or in case of an error.
   */
  async getMostFrequentlyUsedToolsByMasterAccountId(masterAccountId, limit = 4) {
    if (!masterAccountId) {
      this.logger.error('[GenerationOutputsDB] masterAccountId is required to get most frequently used tools.');
      return [];
    }
    if (!ObjectId.isValid(masterAccountId)) {
        this.logger.error(`[GenerationOutputsDB] Invalid masterAccountId format: ${masterAccountId}`);
        return [];
    }

    const pipeline = [
      {
        $match: { masterAccountId: new ObjectId(masterAccountId) }
      },
      {
        $group: {
          _id: "$serviceName", // Group by the tool/service name
          usageCount: { $sum: 1 } // Count occurrences
        }
      },
      {
        $sort: { usageCount: -1 } // Sort by count in descending order
      },
      {
        $limit: parseInt(limit, 10) || 4 // Limit the number of results
      },
      {
        $project: {
          _id: 0, // Exclude the default _id field from the group stage
          toolId: "$_id", // Rename _id (which is serviceName) to toolId
          usageCount: 1 // Include usageCount
        }
      }
    ];

    try {
      this.logger.debug(`[GenerationOutputsDB] Executing aggregation for most frequent tools for MAID ${masterAccountId} with limit ${limit}: ${JSON.stringify(pipeline)}`);
      const results = await this.aggregate(pipeline);
      this.logger.info(`[GenerationOutputsDB] Found ${results.length} frequently used tool(s) for MAID ${masterAccountId}`);
      return results;
    } catch (error) {
      this.logger.error(`[GenerationOutputsDB] Error aggregating most frequently used tools for MAID ${masterAccountId}: ${error.message}`, error);
      return []; // Return empty array on error
    }
  }
}

// const client = getCachedClient(); // Not needed here anymore
module.exports = GenerationOutputsDB; // Export the class 