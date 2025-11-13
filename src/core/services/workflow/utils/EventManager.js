/**
 * EventManager - Utility for creating events via the internal API
 * 
 * Handles event creation for workflow execution tracking.
 */

/**
 * Creates an event via the internal API
 * @param {string} eventType - Type of event (e.g., 'spell_step_triggered')
 * @param {Object} context - Execution context
 * @param {Object} eventData - Additional event data
 * @param {Object} internalApiClient - Internal API client instance
 * @returns {Promise<{eventId: string}>} - Event ID from the API response
 */
async function createEvent(eventType, context, eventData, internalApiClient) {
    const eventPayload = {
        masterAccountId: context.masterAccountId,
        eventType: eventType,
        sourcePlatform: context.platform,
        eventData: eventData
    };

    const eventResponse = await internalApiClient.post('/internal/v1/data/events', eventPayload);
    const eventId = eventResponse.data._id;

    return { eventId };
}

module.exports = {
    createEvent
};

