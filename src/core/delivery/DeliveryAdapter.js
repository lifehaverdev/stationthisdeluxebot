/**
 * DeliveryAdapter Interface
 * 
 * Platform-agnostic interface for delivering media content to users.
 * This abstraction allows workflows to deliver content without coupling
 * to specific platform implementations.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');
const { EventEmitter } = require('events');

/**
 * Base DeliveryAdapter class
 * Defines the interface for platform-specific media delivery
 */
class DeliveryAdapter extends EventEmitter {
  /**
   * Create a new DeliveryAdapter instance
   * @param {Object} options - Adapter options
   * @param {string} options.platform - Platform identifier (e.g., 'telegram', 'web')
   */
  constructor(options = {}) {
    super();
    
    if (!options.platform) {
      throw new Error('Platform identifier is required for DeliveryAdapter');
    }
    
    this.platform = options.platform;
  }

  /**
   * Deliver media content to a user
   * @param {Object} options - Delivery options
   * @param {Object} options.platformContext - Platform-specific context (e.g., chatId, threadId)
   * @param {Object} options.mediaPayload - Media content to deliver
   * @param {string} options.mediaPayload.url - Media URL
   * @param {string} options.mediaPayload.type - Media type ('image', 'gif', 'video', etc.)
   * @param {string} [options.mediaPayload.caption] - Optional caption for the media
   * @param {Object} [options.mediaPayload.metadata] - Additional metadata
   * @param {Object} [options.user] - User information
   * @param {string} options.user.id - User ID
   * @param {Object} [options.taskInfo] - Generation task information
   * @returns {Promise<Object>} Delivery result
   * @throws {AppError} If delivery fails
   */
  async deliverMedia({ platformContext, mediaPayload, user, taskInfo }) {
    throw new AppError('Method not implemented', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'DELIVERY_METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Deliver an error message
   * @param {Object} options - Delivery options
   * @param {Object} options.platformContext - Platform-specific context
   * @param {Object} options.error - Error object or message
   * @param {Object} [options.user] - User information
   * @param {Object} [options.taskInfo] - Task information
   * @returns {Promise<Object>} Delivery result
   */
  async deliverErrorMessage({ platformContext, error, user, taskInfo }) {
    throw new AppError('Method not implemented', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'DELIVERY_METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Deliver a status update
   * @param {Object} options - Delivery options
   * @param {Object} options.platformContext - Platform-specific context
   * @param {string} options.status - Status message
   * @param {number} [options.progress] - Progress percentage (0-100)
   * @param {Object} [options.user] - User information
   * @param {Object} [options.taskInfo] - Task information
   * @returns {Promise<Object>} Delivery result
   */
  async deliverStatusUpdate({ platformContext, status, progress, user, taskInfo }) {
    throw new AppError('Method not implemented', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'DELIVERY_METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Creates a stub delivery adapter that logs but doesn't actually deliver
   * @param {string} platform - Platform identifier
   * @returns {DeliveryAdapter} Stub adapter instance
   */
  static createStubAdapter(platform = 'stub') {
    return new StubDeliveryAdapter({ platform });
  }
}

/**
 * Stub implementation of DeliveryAdapter for testing and development
 */
class StubDeliveryAdapter extends DeliveryAdapter {
  /**
   * @inheritdoc
   */
  async deliverMedia({ platformContext, mediaPayload, user, taskInfo }) {
    console.log(`[StubDeliveryAdapter] Delivering ${mediaPayload.type} to ${user?.id || 'unknown user'}`);
    
    // Emit event for tracking
    this.emit('media:delivered', {
      platform: this.platform,
      userId: user?.id,
      mediaType: mediaPayload.type,
      url: mediaPayload.url,
      taskId: taskInfo?.taskId,
      timestamp: Date.now()
    });
    
    return {
      success: true,
      platform: this.platform,
      mediaType: mediaPayload.type,
      delivered: true
    };
  }

  /**
   * @inheritdoc
   */
  async deliverErrorMessage({ platformContext, error, user, taskInfo }) {
    console.log(`[StubDeliveryAdapter] Delivering error to ${user?.id || 'unknown user'}: ${error.message || error}`);
    
    // Emit event for tracking
    this.emit('error:delivered', {
      platform: this.platform,
      userId: user?.id,
      error: error.message || String(error),
      taskId: taskInfo?.taskId,
      timestamp: Date.now()
    });
    
    return {
      success: true,
      platform: this.platform,
      delivered: true
    };
  }

  /**
   * @inheritdoc
   */
  async deliverStatusUpdate({ platformContext, status, progress, user, taskInfo }) {
    console.log(`[StubDeliveryAdapter] Delivering status update to ${user?.id || 'unknown user'}: ${status} (${progress || 0}%)`);
    
    // Emit event for tracking
    this.emit('status:delivered', {
      platform: this.platform,
      userId: user?.id,
      status,
      progress,
      taskId: taskInfo?.taskId,
      timestamp: Date.now()
    });
    
    return {
      success: true,
      platform: this.platform,
      delivered: true
    };
  }
}

module.exports = {
  DeliveryAdapter,
  StubDeliveryAdapter
}; 