const EventEmitter = require('events');

/**
 * A dedicated event emitter for handling notification-related events across the application.
 * This is instantiated once and used as a singleton to ensure a single channel of communication.
 */
class NotificationEvents extends EventEmitter {}

module.exports = new NotificationEvents(); 