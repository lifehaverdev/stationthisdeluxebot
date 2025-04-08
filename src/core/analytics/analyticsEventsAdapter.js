/**
 * Analytics Events Adapter
 * 
 * A wrapper for AnalyticsEvents that:
 * 1. Uses SessionAdapter instead of direct lobby access
 * 2. Logs events to console instead of saving to the database
 * 3. Provides a drop-in replacement for the original AnalyticsEvents
 */

const { createSessionAdapter } = require('../session/adapter');
const { EVENT_TYPES } = require('../../db/models/analyticsEvents');

class AnalyticsEventsAdapter {
  /**
   * Creates a new AnalyticsEventsAdapter
   * @param {Object} options - Configuration options
   * @param {Object} options.sessionAdapter - The SessionAdapter instance
   * @param {boolean} [options.logToConsole=true] - Whether to log events to console
   * @param {Function} [options.logFunction] - Custom logging function
   */
  constructor(options) {
    this.sessionAdapter = options.sessionAdapter;
    this.logToConsole = options.logToConsole !== false;
    this.logFunction = options.logFunction || console.log;
    this.collectionsName = 'history'; // Mimic original implementation
  }

  /**
   * Log an event instead of saving to database
   * @param {Object} query - The query that would be used to find/update a document
   * @param {Object} event - The event data that would be saved
   * @param {Object} options - Options like upsert
   * @returns {Promise<Object>} - A mock response object
   * @private
   */
  async _logEvent(query, event, options = {}) {
    if (this.logToConsole) {
      this.logFunction('[AnalyticsEventsAdapter] Would save event:', {
        collection: this.collectionsName,
        query,
        event,
        options
      });
    }
    
    // Return a mock response similar to MongoDB
    return {
      acknowledged: true,
      modifiedCount: 1,
      upsertedId: options.upsert ? 'mock-id-' + Date.now() : null,
      upsertedCount: options.upsert ? 1 : 0,
      matchedCount: 1,
      // Include the event for testing/verification
      event
    };
  }

  /**
   * Proxy for the original updateOne method
   * @param {Object} query - MongoDB query
   * @param {Object} document - Document to save
   * @param {Object} options - MongoDB options
   * @returns {Promise<Object>} - Mock response
   */
  async updateOne(query, document, options = {}) {
    return this._logEvent(query, document, options);
  }

  /**
   * Track a queue event
   * @param {Object} task - Task object
   * @param {string} eventType - Event type
   * @returns {Promise<Object>} - Mock response
   */
  async trackQueueEvent(task, eventType) {
    // Special handling for cook mode tasks
    if (task.promptObj.isCookMode) {
      const event = {
        type: EVENT_TYPES.QUEUE,
        userId: task.promptObj.userId,
        username: task.promptObj.username || 'unknown_user',
        timestamp: new Date(),
        data: {
          eventType,
          runId: task.run_id,
          queuePosition: task.waiting?.length || 0,
          waitingCount: task.waiting?.length || 0,
          queueCount: task.taskQueue?.length || 0,
          isCookMode: true,
          collectionId: task.promptObj.collectionId
        },
        // Skip group tracking for cook mode
        groupId: null
      };

      return this.updateOne(
        { runId: task.run_id, type: EVENT_TYPES.QUEUE },
        event,
        { upsert: true }
      );
    }

    // Original handling for regular tasks
    const queuePosition = eventType === 'enqueued' 
      ? (task.waiting?.length || 0)
      : (task.waiting?.findIndex(t => t.run_id === task.run_id) || -1);

    const event = {
      type: EVENT_TYPES.QUEUE,
      userId: task.promptObj.userId,
      username: task.promptObj.username,
      timestamp: new Date(),
      data: {
        eventType,
        runId: task.run_id,
        queuePosition: queuePosition >= 0 ? queuePosition : null,
        waitingCount: task.waiting?.length || 0,
        queueCount: task.taskQueue?.length || 0
      },
      groupId: task.message.chat.id < 0 ? task.message.chat.id : null
    };

    return this.updateOne(
      { runId: task.run_id, type: EVENT_TYPES.QUEUE },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a generation event
   * @param {Object} task - Task object
   * @param {Object} run - Run data
   * @param {string} status - Status string
   * @returns {Promise<Object>} - Mock response
   */
  async trackGeneration(task, run, status) {
    try {
      // Handle cook mode tasks differently
      if (task.promptObj.isCookMode) {
        const event = {
          type: EVENT_TYPES.GENERATION,
          userId: task.promptObj.userId,
          username: task.promptObj.username || 'unknown_user',
          timestamp: new Date(),
          data: {
            status,
            runId: task.run_id,
            isCookMode: true,
            collectionId: task.promptObj.collectionId
          }
        };

        return this.updateOne(
          { runId: task.run_id, type: EVENT_TYPES.GENERATION },
          event,
          { upsert: true }
        );
      }

      // Original handling for regular tasks
      const event = {
        type: EVENT_TYPES.GENERATION,
        userId: task.message.from.id,
        username: task.message.from.username,
        timestamp: new Date(),
        data: {
          status,
          runId: task.run_id
        },
        groupId: task.message.chat.id < 0 ? task.message.chat.id : null
      };

      return this.updateOne(
        { runId: task.run_id, type: EVENT_TYPES.GENERATION },
        event,
        { upsert: true }
      );
    } catch (error) {
      console.error('Error tracking generation:', error);
      return { error: error.message };
    }
  }

  /**
   * Track a command execution
   * @param {Object} message - Message object
   * @param {string} command - Command string
   * @param {boolean} isCustom - Whether it's a custom command
   * @returns {Promise<Object>} - Mock response
   */
  async trackCommand(message, command, isCustom = false) {
    const event = {
      type: EVENT_TYPES.COMMAND,
      userId: message.from.id,
      username: message.from.username,
      timestamp: new Date(),
      data: {
        command,
        isCustomCommand: isCustom,
        chatType: message.chat.type,
        messageThreadId: message.message_thread_id || null,
        hasArgs: message.text !== command,
        isReply: !!message.reply_to_message
      },
      groupId: message.chat.id < 0 ? message.chat.id : null
    };

    return this.updateOne(
      { runId: message.message_id, type: EVENT_TYPES.COMMAND },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a delivery event
   * @param {Object} task - Task object
   * @param {boolean} success - Whether delivery was successful
   * @param {Error} error - Error object if unsuccessful
   * @returns {Promise<Object>} - Mock response
   */
  async trackDeliveryEvent(task, success, error = null) {
    const event = {
      type: EVENT_TYPES.DELIVERY,
      userId: task.promptObj.userId,
      username: task.promptObj.username,
      timestamp: new Date(),
      data: {
        success,
        runId: task.run_id,
        error: error ? {
          message: error.message,
          code: error.code
        } : null,
        retryCount: task.deliveryFail || 0,
        totalTime: Date.now() - task.timestamp
      },
      groupId: task.message.chat.id < 0 ? task.message.chat.id : null
    };

    return this.updateOne(
      { runId: task.run_id, type: EVENT_TYPES.DELIVERY },
      event,
      { upsert: true }
    );
  }

  /**
   * Track an error
   * @param {Error} error - Error object
   * @param {Object} context - Context information
   * @returns {Promise<Object>} - Mock response
   */
  async trackError(error, context) {
    const event = {
      type: EVENT_TYPES.ERROR,
      timestamp: new Date(),
      data: {
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code
        },
        context
      }
    };

    return this.updateOne(
      { timestamp: event.timestamp, type: EVENT_TYPES.ERROR },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a menu interaction
   * @param {Object} callbackQuery - Callback query object
   * @param {string} action - Action string
   * @param {boolean} isCustom - Whether it's a custom action
   * @returns {Promise<Object>} - Mock response
   */
  async trackMenuInteraction(callbackQuery, action, isCustom = false) {
    const event = {
      type: EVENT_TYPES.MENU,
      userId: callbackQuery.from.id,
      username: callbackQuery.from.username,
      timestamp: new Date(),
      data: {
        action,
        isCustomAction: isCustom,
        chatType: callbackQuery.message.chat.type,
        messageThreadId: callbackQuery.message.message_thread_id || null,
        replyToMessage: !!callbackQuery.message.reply_to_message,
        callbackMessageId: callbackQuery.message.message_id
      },
      groupId: callbackQuery.message.chat.id < 0 ? callbackQuery.message.chat.id : null
    };

    return this.updateOne(
      { 
        runId: `${callbackQuery.message.message_id}_${callbackQuery.id}`, 
        type: EVENT_TYPES.MENU 
      },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a user join event
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @param {boolean} isFirstTime - Whether it's the first time
   * @returns {Promise<Object>} - Mock response
   */
  async trackUserJoin(userId, username, isFirstTime = false) {
    // Get user session data from SessionAdapter instead of direct lobby access
    const sessionData = await this.sessionAdapter.getUserSessionData(userId);
    
    const event = {
      type: EVENT_TYPES.USER_STATE,
      userId,
      username,
      timestamp: new Date(),
      data: {
        eventType: isFirstTime ? 'first_join' : 'check_in',
        kickedAt: sessionData?.kickedAt || null,
        verified: sessionData?.verified || false
      },
      groupId: null
    };

    return this.updateOne(
      { userId, type: EVENT_TYPES.USER_STATE, timestamp: event.timestamp },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a user kick event
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @param {string} reason - Reason for kick
   * @returns {Promise<Object>} - Mock response
   */
  async trackUserKick(userId, username, reason = 'inactivity') {
    // Get user session data from SessionAdapter instead of direct lobby access
    const sessionData = await this.sessionAdapter.getUserSessionData(userId);
    const lastTouch = sessionData?.lastTouch || Date.now();
    
    const event = {
      type: EVENT_TYPES.USER_STATE,
      userId,
      username,
      timestamp: new Date(),
      data: {
        eventType: 'kicked',
        reason,
        lastTouch,
        timeSinceLastTouch: Date.now() - lastTouch
      },
      groupId: null
    };

    return this.updateOne(
      { userId, type: EVENT_TYPES.USER_STATE, timestamp: event.timestamp },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a gatekeeping event
   * @param {Object} message - Message object
   * @param {string} reason - Reason string
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} - Mock response
   */
  async trackGatekeeping(message, reason, details = {}) {
    const event = {
      type: EVENT_TYPES.GATEKEEPING,
      userId: message.from.id,
      username: message.from.username,
      timestamp: new Date(),
      data: {
        eventType: reason,
        chatType: message.chat.type,
        ...details
      },
      groupId: message.chat.id < 0 ? message.chat.id : null
    };

    return this.updateOne(
      { 
        userId: message.from.id, 
        type: EVENT_TYPES.GATEKEEPING, 
        timestamp: event.timestamp 
      },
      event,
      { upsert: true }
    );
  }

  /**
   * Track an asset check event
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @param {string} checkType - Check type
   * @param {string} result - Result string
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} - Mock response
   */
  async trackAssetCheck(userId, username, checkType, result, details = {}) {
    const event = {
      type: EVENT_TYPES.ASSET_CHECK,
      userId,
      username,
      timestamp: new Date(),
      data: {
        eventType: checkType,
        result,
        ...details
      },
      groupId: null
    };

    return this.updateOne(
      { userId, type: EVENT_TYPES.ASSET_CHECK, timestamp: event.timestamp },
      event,
      { upsert: true }
    );
  }

  /**
   * Track an account action
   * @param {Object} message - Message object
   * @param {string} action - Action string
   * @param {boolean} success - Whether the action was successful
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} - Mock response
   */
  async trackAccountAction(message, action, success, details = {}) {
    const event = {
      type: EVENT_TYPES.ACCOUNT,
      userId: message.from.id,
      username: message.from.username,
      timestamp: new Date(),
      data: {
        action,
        success,
        ...details
      },
      groupId: null
    };

    return this.updateOne(
      { userId: message.from.id, type: EVENT_TYPES.ACCOUNT, timestamp: event.timestamp },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a verification event
   * @param {Object} message - Message object
   * @param {boolean} success - Whether verification was successful
   * @param {Object} details - Additional details
   * @returns {Promise<Object>} - Mock response
   */
  async trackVerification(message, success, details = {}) {
    // Get user session data from SessionAdapter instead of direct lobby access
    const sessionData = await this.sessionAdapter.getUserSessionData(message.from.id);
    
    const event = {
      type: EVENT_TYPES.VERIFICATION,
      userId: message.from.id,
      username: message.from.username,
      timestamp: new Date(),
      data: {
        success,
        wallet: sessionData?.wallet || null,
        ...details
      },
      groupId: null
    };

    return this.updateOne(
      { userId: message.from.id, type: EVENT_TYPES.VERIFICATION, timestamp: event.timestamp },
      event,
      { upsert: true }
    );
  }
}

/**
 * Create a new AnalyticsEventsAdapter
 * @param {Object} options - Configuration options
 * @returns {AnalyticsEventsAdapter} - New adapter instance
 */
function createAnalyticsEventsAdapter(options = {}) {
  // If no sessionAdapter is provided, create one
  const sessionAdapter = options.sessionAdapter || createSessionAdapter();
  
  return new AnalyticsEventsAdapter({
    ...options,
    sessionAdapter
  });
}

module.exports = {
  AnalyticsEventsAdapter,
  createAnalyticsEventsAdapter,
  EVENT_TYPES
}; 