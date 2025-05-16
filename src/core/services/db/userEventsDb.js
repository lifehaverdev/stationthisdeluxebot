const { BaseDB, ObjectId } = require('./BaseDB');
// const { getCachedClient } = require('./utils/queue'); // Not needed here anymore

const COLLECTION_NAME = 'userEvents';

class UserEventsDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[UserEventsDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new user event.
   * @param {Object} eventDetails - The details of the event.
   * @param {ObjectId} eventDetails.masterAccountId - The master account ID of the user.
   * @param {ObjectId} eventDetails.sessionId - The session ID.
   * @param {string} eventDetails.eventType - The type of the event.
   * @param {string} eventDetails.sourcePlatform - The platform where the event originated.
   * @param {Object} [eventDetails.eventData] - Context-specific data for the event.
   * @param {Date} [eventDetails.timestamp] - Timestamp of the event, defaults to now.
   * @returns {Promise<Object>} The created event document.
   */
  async logEvent(eventDetails) {
    const dataToInsert = {
      ...eventDetails,
      timestamp: eventDetails.timestamp || new Date(),
    };
    // The schema defines eventId as required and primary key,
    // but typically MongoDB generates _id.
    // If eventId is meant to be the primary key (_id), BaseDB.create will handle it.
    // If eventId is a separate field that needs to be unique and generated here,
    // this would require a different approach (e.g. using ObjectId() and ensuring uniqueness).
    // For now, assuming _id will be the PK, and eventId is a field we can set or let MongoDB set if it's an ObjectId.
    // The schema shows eventId as "bsonType": "objectId", description: "Unique ID for the event (Primary Key)."
    // This implies it should be treated like _id. BaseDB's `create` method handles `_id` generation.
    // If `eventId` *must* be a field separate from `_id` but still the PK, the schema/BaseDB needs clarification.
    // Assuming for now `eventId` is synonymous with `_id` or BaseDB handles it.
    const result = await this.insertOne(dataToInsert);
    if (result.insertedId) {
        // Assuming eventId is meant to be the _id, so we mirror that.
        // If eventId is a different field, this structure might need adjustment.
        return { _id: result.insertedId, eventId: result.insertedId, ...dataToInsert };
    }
    return null;
  }

  /**
   * Finds an event by its ID.
   * @param {ObjectId} eventId - The ID of the event.
   * @returns {Promise<Object|null>} The event document, or null if not found.
   */
  async findEventById(eventId) {
    if (!eventId) {
        this.logger.error('[UserEventsDB] eventId is required to find an event.');
        return null;
    }
    return this.findOne({ _id: new ObjectId(eventId) });
  }

  /**
   * Finds events by masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of event documents.
   */
  async findEventsByMasterAccount(masterAccountId, options = {}) {
    if (!masterAccountId) {
        this.logger.error('[UserEventsDB] masterAccountId is required to find events.');
        return [];
    }
    return this.findMany({ masterAccountId: new ObjectId(masterAccountId) }, options);
  }

  /**
   * Finds events by sessionId.
   * @param {ObjectId} sessionId - The session ID.
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of event documents.
   */
  async findEventsBySession(sessionId, options = {}) {
    if (!sessionId) {
        this.logger.error('[UserEventsDB] sessionId is required to find events.');
        return [];
    }
    return this.findMany({ sessionId: new ObjectId(sessionId) }, options);
  }

  /**
   * Finds events by eventType.
   * @param {string} eventType - The type of the event.
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of event documents.
   */
  async findEventsByType(eventType, options = {}) {
    if (!eventType) {
        this.logger.error('[UserEventsDB] eventType is required to find events.');
        return [];
    }
    return this.findMany({ type: eventType }, options);
  }

  async recordEvent(eventData) {
    if (!eventData || !eventData.masterAccountId || !eventData.type) {
      this.logger.error('[UserEventsDB] recordEvent: masterAccountId and type are required.');
      return null;
    }
    const dataToInsert = {
      timestamp: new Date(),
      ...eventData,
      // Ensure masterAccountId is an ObjectId if it's passed as string
      masterAccountId: typeof eventData.masterAccountId === 'string' ? new ObjectId(eventData.masterAccountId) : eventData.masterAccountId,
      // Ensure sessionId is an ObjectId if it's passed and is a string
      sessionId: eventData.sessionId ? (typeof eventData.sessionId === 'string' ? new ObjectId(eventData.sessionId) : eventData.sessionId) : undefined,
    };
    // eventId will be handled by BaseDB as _id
    const result = await this.insertOne(dataToInsert);
    return result.insertedId ? { _id: result.insertedId, eventId: result.insertedId, ...dataToInsert } : null;
  }
}

// const client = getCachedClient(); // Not needed here anymore
module.exports = UserEventsDB; // Export the class 