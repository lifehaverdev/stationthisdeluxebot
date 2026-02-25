/**
 * EventManager - Utility for creating events via the internal API
 * 
 * Handles event creation for workflow execution tracking.
 */

/**
 * Creates an event via userEventsDb (in-process) or internalApiClient (fallback).
 * @param {string} eventType - Type of event (e.g., 'spell_step_triggered')
 * @param {Object} context - Execution context
 * @param {Object} eventData - Additional event data
 * @param {Object} transport - userEventsDb instance (has logEvent) or internalApiClient (fallback)
 * @returns {Promise<{eventId: string}>} - Event ID
 */
async function createEvent(eventType, context, eventData, transport) {
    const eventPayload = {
        masterAccountId: context.masterAccountId,
        eventType: eventType,
        sourcePlatform: context.platform,
        eventData: eventData
    };

    // Use direct DB if available (Phase 7a migration), fall back to HTTP
    if (transport && typeof transport.logEvent === 'function') {
        const { ObjectId } = require('mongodb');
        const newEvent = await transport.logEvent({
            masterAccountId: new ObjectId(context.masterAccountId),
            eventType,
            sourcePlatform: context.platform,
            eventData,
        });
        return { eventId: newEvent._id };
    }

    const eventResponse = await transport.post('/internal/v1/data/events', eventPayload);
    const eventId = eventResponse.data._id;

    return { eventId };
}

module.exports = {
    createEvent
};

