/**
 * Generation Domain Models
 * Defines request and response structures for the generation system
 */

/**
 * Generation type enum
 * @readonly
 * @enum {string}
 */
const GenerationType = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  TEXT: 'text'
};

/**
 * Generation model enum
 * @readonly
 * @enum {string}
 */
const GenerationModel = {
  DEFAULT: 'DEFAULT',
  MS3: 'MS3',
  MS3_3: 'MS3.3',
  SDXL: 'SDXL',
  SD2: 'SD2'
};

/**
 * Generation Request
 * Represents a request to generate content
 */
class GenerationRequest {
  /**
   * @param {Object} data - Request data
   * @param {string} data.userId - User ID requesting the generation
   * @param {string} [data.type='DEFAULT'] - Generation type (DEFAULT, MS3, MS3.3, etc.)
   * @param {string} [data.prompt=''] - Generation prompt
   * @param {string} [data.negativePrompt=''] - Negative prompt
   * @param {Object} [data.settings={}] - Generation settings
   * @param {Array<string>} [data.inputImages=[]] - Input images for img2img or variations
   * @param {string} [data.chatId=''] - Chat ID if from a chat
   * @param {string} [data.messageId=''] - Message ID if from a chat
   * @param {Object} [data.metadata={}] - Additional metadata
   */
  constructor(data = {}) {
    // Extract userId from different possible locations
    this.userId = data.userId || 
                 (data.user && data.user.id) || // Extract from user.id if available
                 (data.userContext && data.userContext.userId) || // Or from userContext
                 (data.context && data.context.userId) || // Or from context
                 '';
                 
    this.type = data.type || 'DEFAULT';
    this.prompt = data.prompt || '';
    this.negativePrompt = data.negativePrompt || '';
    this.settings = {
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
      seed: -1,
      batch: 1,
      checkpoint: 'zavychromaxl_v60',
      sampler: 'DPM++ 2M Karras',
      strength: 0.6,
      ...(data.settings || {})
    };
    this.inputImages = data.inputImages || [];
    this.chatId = data.chatId || '';
    this.messageId = data.messageId || '';
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date();
  }

  /**
   * Get cost for this generation
   * @returns {number} - Point cost
   */
  getCost() {
    // Basic cost by model type
    let cost = 100; // Default
    
    if (this.type === 'MS3.3') {
      cost = 1000;
    } else if (this.type === 'MS3') {
      cost = 500;
    }
    
    // Adjust by batch size
    cost *= (this.settings.batch || 1);
    
    return cost;
  }

  /**
   * Validate the request
   * @returns {Object} - Validation result {isValid, errors}
   */
  validate() {
    const errors = [];
    
    // Required fields
    if (!this.userId) {
      errors.push('User ID is required');
    }
    
    // Settings validation
    if (this.settings) {
      if (this.settings.width < 256 || this.settings.width > 2048) {
        errors.push('Width must be between 256 and 2048');
      }
      
      if (this.settings.height < 256 || this.settings.height > 2048) {
        errors.push('Height must be between 256 and 2048');
      }
      
      if (this.settings.steps < 1 || this.settings.steps > 150) {
        errors.push('Steps must be between 1 and 150');
      }
      
      if (this.settings.batch < 1 || this.settings.batch > 4) {
        errors.push('Batch must be between 1 and 4');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert to a plain object
   * @returns {Object} - Plain object
   */
  toJSON() {
    return {
      userId: this.userId,
      type: this.type,
      prompt: this.prompt,
      negativePrompt: this.negativePrompt,
      settings: this.settings,
      inputImages: this.inputImages,
      chatId: this.chatId,
      messageId: this.messageId,
      metadata: this.metadata,
      createdAt: this.createdAt
    };
  }

  /**
   * Create a GenerationRequest from a plain object
   * @param {Object} data - Plain object
   * @returns {GenerationRequest} - GenerationRequest instance
   */
  static fromJSON(data) {
    return new GenerationRequest(data);
  }
}

/**
 * Generation Response
 * Represents a response from a generation request
 */
class GenerationResponse {
  /**
   * @param {Object} data - Response data
   * @param {string} data.requestId - ID of the original request
   * @param {string} data.userId - User ID that requested the generation
   * @param {Array<string>} [data.outputs=[]] - Output image paths/URLs
   * @param {boolean} [data.success=false] - Whether the generation was successful
   * @param {string} [data.error=''] - Error message if generation failed
   * @param {Object} [data.metadata={}] - Additional metadata (seeds, etc.)
   * @param {number} [data.processingTime=0] - Processing time in milliseconds
   */
  constructor(data = {}) {
    this.requestId = data.requestId || '';
    this.userId = data.userId || '';
    this.outputs = data.outputs || [];
    this.success = data.success || false;
    this.error = data.error || '';
    this.metadata = data.metadata || {};
    this.processingTime = data.processingTime || 0;
    this.completedAt = data.completedAt || new Date();
  }

  /**
   * Check if the generation was successful
   * @returns {boolean} - Whether the generation was successful
   */
  isSuccessful() {
    return this.success && this.outputs.length > 0;
  }

  /**
   * Get the first output
   * @returns {string|null} - First output or null if none
   */
  getFirstOutput() {
    return this.outputs.length > 0 ? this.outputs[0] : null;
  }

  /**
   * Convert to a plain object
   * @returns {Object} - Plain object
   */
  toJSON() {
    return {
      requestId: this.requestId,
      userId: this.userId,
      outputs: this.outputs,
      success: this.success,
      error: this.error,
      metadata: this.metadata,
      processingTime: this.processingTime,
      completedAt: this.completedAt
    };
  }

  /**
   * Create a GenerationResponse from a plain object
   * @param {Object} data - Plain object
   * @returns {GenerationResponse} - GenerationResponse instance
   */
  static fromJSON(data) {
    return new GenerationResponse(data);
  }
}

/**
 * Generation Status
 * @readonly
 * @enum {string}
 */
const GenerationStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Generation Task
 * Represents a generation task in the system
 */
class GenerationTask {
  /**
   * @param {Object} data - Task data
   * @param {string} data.taskId - Unique task ID
   * @param {string} data.userId - User ID that requested the generation
   * @param {GenerationRequest|Object} data.request - Generation request
   * @param {GenerationStatus} [data.status=GenerationStatus.PENDING] - Task status
   * @param {GenerationResponse|null} [data.response=null] - Generation response
   * @param {Date} [data.createdAt=new Date()] - Creation timestamp
   * @param {Date|null} [data.startedAt=null] - Processing start timestamp
   * @param {Date|null} [data.completedAt=null] - Completion timestamp
   */
  constructor(data = {}) {
    this.taskId = data.taskId || '';
    this.userId = data.userId || '';
    this.request = data.request instanceof GenerationRequest 
      ? data.request
      : new GenerationRequest(data.request || {});
    this.status = data.status || GenerationStatus.PENDING;
    this.response = data.response instanceof GenerationResponse
      ? data.response
      : data.response ? new GenerationResponse(data.response) : null;
    this.createdAt = data.createdAt || new Date();
    this.startedAt = data.startedAt || null;
    this.completedAt = data.completedAt || null;
  }

  /**
   * Get the processing time in milliseconds
   * @returns {number} - Processing time
   */
  getProcessingTime() {
    if (!this.startedAt) {
      return 0;
    }
    
    const endTime = this.completedAt || new Date();
    return endTime - this.startedAt;
  }

  /**
   * Mark task as processing
   * @returns {GenerationTask} - This instance for chaining
   */
  markAsProcessing() {
    this.status = GenerationStatus.PROCESSING;
    this.startedAt = new Date();
    return this;
  }

  /**
   * Mark task as completed
   * @param {GenerationResponse|Object} response - Generation response
   * @returns {GenerationTask} - This instance for chaining
   */
  markAsCompleted(response) {
    this.status = GenerationStatus.COMPLETED;
    this.completedAt = new Date();
    this.response = response instanceof GenerationResponse
      ? response
      : new GenerationResponse(response);
    return this;
  }

  /**
   * Mark task as failed
   * @param {string} error - Error message
   * @returns {GenerationTask} - This instance for chaining
   */
  markAsFailed(error) {
    this.status = GenerationStatus.FAILED;
    this.completedAt = new Date();
    this.response = new GenerationResponse({
      requestId: this.taskId,
      userId: this.userId,
      success: false,
      error,
      completedAt: this.completedAt
    });
    return this;
  }

  /**
   * Mark task as cancelled
   * @returns {GenerationTask} - This instance for chaining
   */
  markAsCancelled() {
    this.status = GenerationStatus.CANCELLED;
    this.completedAt = new Date();
    return this;
  }

  /**
   * Convert to a plain object
   * @returns {Object} - Plain object
   */
  toJSON() {
    return {
      taskId: this.taskId,
      userId: this.userId,
      request: this.request.toJSON(),
      status: this.status,
      response: this.response ? this.response.toJSON() : null,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt
    };
  }

  /**
   * Create a GenerationTask from a plain object
   * @param {Object} data - Plain object
   * @returns {GenerationTask} - GenerationTask instance
   */
  static fromJSON(data) {
    return new GenerationTask(data);
  }
}

module.exports = {
  GenerationRequest,
  GenerationResponse,
  GenerationTask,
  GenerationStatus,
  GenerationType,
  GenerationModel
}; 