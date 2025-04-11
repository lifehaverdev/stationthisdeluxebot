/**
 * Analytics Events Adapter
 * 
 * A wrapper for AnalyticsEvents that:
 * 1. Uses SessionAdapter instead of direct lobby access
 * 2. Logs events to console instead of saving to the database
 * 3. Provides a drop-in replacement for the original AnalyticsEvents
 */

const { createSessionAdapter } = require('../session/adapter');
const { EVENT_TYPES } = require('../../db/models/analyticsEventsRepository');

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
   * Track an error event
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {Promise<Object>} - Mock response
   */
  async trackError(error, context) {
    // Generate a unique run ID for the error
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    const userId = context.userId || (context.message?.from?.id || 0);
    const username = context.username || (context.message?.from?.username || 'unknown');
    
    const event = {
      type: EVENT_TYPES.ERROR,
      userId,
      username,
      timestamp: new Date(),
      data: {
        message: error.message,
        stack: error.stack,
        code: error.code,
        context
      },
      groupId: context.groupId || (context.message?.chat?.id < 0 ? context.message?.chat?.id : null),
      runId: context.runId || errorId
    };

    return this.updateOne(
      { runId: context.runId || errorId, type: EVENT_TYPES.ERROR },
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
      type: EVENT_TYPES.MENU_INTERACTION,
      userId: callbackQuery.from.id,
      username: callbackQuery.from.username,
      timestamp: new Date(),
      data: {
        action,
        isCustomAction: isCustom,
        data: callbackQuery.data,
        inlineMessageId: callbackQuery.inline_message_id || null,
        messageId: callbackQuery.message?.message_id,
        chatInstance: callbackQuery.chat_instance
      },
      groupId: callbackQuery.message?.chat.id < 0 ? callbackQuery.message?.chat.id : null,
      messageId: callbackQuery.message?.message_id
    };

    return this.updateOne(
      { messageId: callbackQuery.message?.message_id, type: EVENT_TYPES.MENU_INTERACTION },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a user join event
   * @param {number|string} userId - User ID
   * @param {string} username - Username
   * @param {boolean} isFirstTime - Whether it's the first time
   * @returns {Promise<Object>} - Mock response
   */
  async trackUserJoin(userId, username, isFirstTime = false) {
    const event = {
      type: EVENT_TYPES.USER_JOIN,
      userId,
      username,
      timestamp: new Date(),
      data: {
        isFirstTime,
        source: 'unknown'
      }
    };

    return this.updateOne(
      { userId, type: EVENT_TYPES.USER_JOIN },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a user leave event
   * @param {number|string} userId - User ID
   * @param {string} username - Username
   * @param {string} reason - Reason for leaving
   * @returns {Promise<Object>} - Mock response
   */
  async trackUserKick(userId, username, reason = 'inactivity') {
    // First check if we have a join record for the user
    const previousJoin = await this.sessionAdapter.query(
      async (db) => {
        return db.collection(this.collectionsName).findOne({
          userId,
          type: EVENT_TYPES.USER_JOIN
        });
      }
    );
    
    const event = {
      type: EVENT_TYPES.USER_LEAVE,
      userId,
      username,
      timestamp: new Date(),
      data: {
        reason,
        joinTimestamp: previousJoin?.timestamp || null,
        durationDays: previousJoin?.timestamp 
          ? Math.floor((Date.now() - new Date(previousJoin.timestamp).getTime()) / (1000 * 60 * 60 * 24))
          : null
      }
    };

    return this.updateOne(
      { userId, type: EVENT_TYPES.USER_LEAVE },
      event,
      { upsert: true }
    );
  }

  /**
   * Track a gatekeeping event
   * @param {Object} message - Message object
   * @param {string} reason - Reason for gatekeeping
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
        reason,
        chatType: message.chat.type,
        messageId: message.message_id,
        ...details
      },
      groupId: message.chat.id < 0 ? message.chat.id : null,
      messageId: message.message_id
    };

    return this.updateOne(
      { messageId: message.message_id, type: EVENT_TYPES.GATEKEEPING },
      event,
      { upsert: true }
    );
  }

  /**
   * Track an asset check event
   * @param {number|string} userId - User ID
   * @param {string} username - Username
   * @param {string} checkType - Check type
   * @param {boolean} result - Check result
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
        checkType,
        result,
        ...details
      }
    };

    return this.updateOne(
      { userId, type: EVENT_TYPES.ASSET_CHECK, 'data.checkType': checkType },
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
      type: EVENT_TYPES.ACCOUNT_ACTION,
      userId: message.from.id,
      username: message.from.username,
      timestamp: new Date(),
      data: {
        action,
        success,
        messageId: message.message_id,
        ...details
      },
      groupId: message.chat.id < 0 ? message.chat.id : null,
      messageId: message.message_id
    };

    return this.updateOne(
      { messageId: message.message_id, type: EVENT_TYPES.ACCOUNT_ACTION },
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
    const event = {
      type: EVENT_TYPES.VERIFICATION,
      userId: message.from.id,
      username: message.from.username,
      timestamp: new Date(),
      data: {
        success,
        messageId: message.message_id,
        ...details
      },
      groupId: message.chat.id < 0 ? message.chat.id : null,
      messageId: message.message_id
    };

    return this.updateOne(
      { messageId: message.message_id, type: EVENT_TYPES.VERIFICATION },
      event,
      { upsert: true }
    );
  }
}

/**
 * Create a new AnalyticsEventsAdapter
 * @param {Object} options - Options for the adapter
 * @returns {AnalyticsEventsAdapter} - The adapter instance
 */
function createAnalyticsEventsAdapter(options = {}) {
  // Create a session adapter if not provided
  const sessionAdapter = options.sessionAdapter || createSessionAdapter();
  
  return new AnalyticsEventsAdapter({
    sessionAdapter,
    ...options
  });
}

module.exports = {
  AnalyticsEventsAdapter,
  createAnalyticsEventsAdapter,
  EVENT_TYPES
}; 