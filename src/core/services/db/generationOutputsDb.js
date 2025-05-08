const { BaseDB, ObjectId } = require('./BaseDB');
// const { getCachedClient } = require('./utils/queue'); // Not needed here anymore

class GenerationOutputsDB extends BaseDB {
  constructor() { // Removed client parameter
    super('generationOutputs'); // Call super with only the collection name
  }

  /**
   * Creates a new generation output record.
   * @param {Object} outputData - The data for the new generation output.
   * @param {ObjectId} outputData.masterAccountId - FK to userCore._id.
   * @param {ObjectId} outputData.sessionId - FK to userSessions.sessionId.
   * @param {ObjectId} outputData.initiatingEventId - FK to userEvents.eventId.
   * @param {string} outputData.serviceName - Identifier for the generation service.
   * @param {string} outputData.status - Initial status (e.g., 'pending', 'processing').
   * @param {Object} [outputData.requestPayload] - Payload sent to the service.
   * @param {string} [outputData.platformSpecificRunId] - Optional ID from the external platform.
   * @param {Object} [outputData.metadata] - Additional metadata.
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
   * @param {Date} [updateData.responseTimestamp] - Timestamp of response.
   * @param {number} [updateData.durationMs] - Duration in milliseconds.
   * @param {Object} [updateData.responsePayload] - Response received from the service.
   * @param {Array<Object>} [updateData.artifactUrls] - URLs to generated artifacts.
   * @param {Object} [updateData.errorDetails] - Structured error details.
   * @param {Decimal128} [updateData.costUsd] - Cost of the generation.
   * @param {string} [updateData.platformSpecificRunId] - Updated external platform ID.
   * @param {Object} [updateData.metadata] - Additional metadata.
   * @returns {Promise<Object>} The update result.
   */
  async updateGenerationOutput(generationId, updateData) {
    const dataToUpdate = { ...updateData };
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
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of documents.
   */
  async findGenerationsByMasterAccount(masterAccountId, options = {}) {
    return this.findMany({ masterAccountId }, options);
  }

  /**
   * Finds generation outputs by sessionId.
   * @param {ObjectId} sessionId - The session ID.
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of documents.
   */
  async findGenerationsBySession(sessionId, options = {}) {
    return this.findMany({ sessionId }, options);
  }

    /**
   * Finds generation outputs by their status.
   * @param {string} status - The status to filter by (e.g., 'pending', 'success', 'failed').
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of documents.
   */
  async findGenerationsByStatus(status, options = {}) {
    return this.findMany({ status }, options);
  }
}

// const client = getCachedClient(); // Not needed here anymore
module.exports = new GenerationOutputsDB(); // Instantiate without client 