const { BaseDB, ObjectId } = require('./BaseDB');
// const { getCachedClient } = require('./utils/queue'); // Not needed here anymore

class UserEventsDB extends BaseDB {
  constructor() { // Removed client parameter
    super('userEvents'); // Call super with only the collection name
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
    // Assuming eventId is the _id field.
    return this.findOne({ _id: eventId });
  }

  /**
   * Finds events by masterAccountId.
   * @param {ObjectId} masterAccountId - The master account ID.
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of event documents.
   */
  async findEventsByMasterAccount(masterAccountId, options = {}) {
    return this.findMany({ masterAccountId }, options);
  }

  /**
   * Finds events by sessionId.
   * @param {ObjectId} sessionId - The session ID.
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of event documents.
   */
  async findEventsBySession(sessionId, options = {}) {
    return this.findMany({ sessionId }, options);
  }

  /**
   * Finds events by eventType.
   * @param {string} eventType - The type of the event.
   * @param {Object} [options] - Query options (e.g., limit, sort).
   * @returns {Promise<Array<Object>>} A list of event documents.
   */
  async findEventsByType(eventType, options = {}) {
    return this.findMany({ eventType }, options);
  }
}

// const client = getCachedClient(); // Not needed here anymore
module.exports = new UserEventsDB(); // Instantiate without client 