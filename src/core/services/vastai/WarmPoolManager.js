/**
 * WarmPoolManager - GPU Instance Lifecycle Management
 *
 * Manages a warm pool of GPU instances with idle timeouts and automatic termination.
 * Tracks instance states through their lifecycle:
 *   PROVISIONING -> WARMING -> READY -> BUSY -> IDLE -> TERMINATING
 *
 * Key features:
 *   - Instance state tracking with metadata
 *   - Idle timers trigger automatic termination
 *   - Warmth extension resets idle timer based on request type
 *   - Pool state monitoring for observability
 *
 * @see src/config/vastaiService.js for configuration values
 */
const { getServiceConfig } = require('../../../config/vastaiService');

// Instance lifecycle states
const InstanceState = {
  PROVISIONING: 'PROVISIONING',
  WARMING: 'WARMING',
  READY: 'READY',
  BUSY: 'BUSY',
  IDLE: 'IDLE',
  TERMINATING: 'TERMINATING'
};

class WarmPoolManager {
  /**
   * @param {object} options
   * @param {object} options.logger - Logger instance
   * @param {object} options.vastaiService - VastAIService instance for provisioning/terminating
   * @param {object} [options.config] - Optional config overrides
   */
  constructor({ logger, vastaiService, config = {} }) {
    if (!logger) {
      throw new Error('WarmPoolManager requires a logger');
    }
    if (!vastaiService) {
      throw new Error('WarmPoolManager requires a vastaiService');
    }

    this.logger = logger;
    this.vastaiService = vastaiService;
    this.config = getServiceConfig(config);

    // instanceId -> { state, instanceType, lastActivity, hourlyRate, provisionedAt, jobContext, ... }
    this.instances = new Map();

    // instanceId -> setTimeout reference for idle termination
    this.idleTimers = new Map();

    // instanceId -> timer start timestamp (for calculating remaining time)
    this.idleTimerStarts = new Map();

    // instanceId -> timer duration in ms
    this.idleTimerDurations = new Map();
  }

  /**
   * Get the first available instance of a given type.
   * Returns READY or IDLE instances (preferring READY).
   *
   * @param {string} instanceType - The instance type to look for
   * @returns {object|null} Instance data or null if none available
   */
  getAvailableInstance(instanceType) {
    let readyInstance = null;
    let idleInstance = null;

    for (const [instanceId, instanceData] of this.instances) {
      if (instanceData.instanceType !== instanceType) {
        continue;
      }

      if (instanceData.state === InstanceState.READY) {
        readyInstance = { instanceId, ...instanceData };
        break; // Prefer READY, return immediately
      }

      if (instanceData.state === InstanceState.IDLE && !idleInstance) {
        idleInstance = { instanceId, ...instanceData };
        // Continue looking for READY instance
      }
    }

    return readyInstance || idleInstance || null;
  }

  /**
   * Request a new instance be provisioned.
   * Adds to tracking immediately in PROVISIONING state.
   *
   * @param {string} instanceType - Type of instance to provision
   * @param {object} jobContext - Context for provisioning (offerId, image, etc.)
   * @returns {Promise<object>} Instance data from VastAI
   */
  async requestInstance(instanceType, jobContext = {}) {
    this.logger.info(`[WarmPoolManager] Requesting new instance of type: ${instanceType}`);

    // Generate a temporary tracking ID until we get the real one
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Track immediately in PROVISIONING state
    this.instances.set(tempId, {
      state: InstanceState.PROVISIONING,
      instanceType,
      lastActivity: Date.now(),
      provisionedAt: Date.now(),
      hourlyRate: jobContext.offer?.hourlyUsd || null,
      jobContext
    });

    try {
      // Provision via vastaiService
      const instanceData = await this.vastaiService.provisionInstance(jobContext);

      if (!instanceData?.instanceId) {
        // Remove temp tracking if provision failed to return an ID
        this.instances.delete(tempId);
        this.logger.error('[WarmPoolManager] Provisioning returned no instanceId');
        return instanceData;
      }

      // Move tracking from temp ID to real ID
      const trackingData = this.instances.get(tempId);
      this.instances.delete(tempId);

      this.instances.set(instanceData.instanceId, {
        ...trackingData,
        state: InstanceState.WARMING,
        hourlyRate: instanceData.hourlyUsd || trackingData.hourlyRate,
        vastaiData: instanceData
      });

      this.logger.info(`[WarmPoolManager] Instance ${instanceData.instanceId} provisioned, now WARMING`);

      return {
        instanceId: instanceData.instanceId,
        ...this.instances.get(instanceData.instanceId),
        vastaiData: instanceData
      };
    } catch (error) {
      // Clean up temp tracking on failure
      this.instances.delete(tempId);
      this.logger.error(`[WarmPoolManager] Failed to provision instance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transition instance to READY state.
   * Called when instance is fully warmed up and ready to accept work.
   *
   * @param {string} instanceId - Instance ID to mark ready
   * @returns {boolean} True if state was updated
   */
  markReady(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      this.logger.warn(`[WarmPoolManager] markReady: Unknown instance ${instanceId}`);
      return false;
    }

    const validFromStates = [InstanceState.PROVISIONING, InstanceState.WARMING];
    if (!validFromStates.includes(instance.state)) {
      this.logger.warn(`[WarmPoolManager] markReady: Invalid state transition from ${instance.state} for ${instanceId}`);
      return false;
    }

    instance.state = InstanceState.READY;
    instance.lastActivity = Date.now();
    this.logger.debug(`[WarmPoolManager] Instance ${instanceId} is now READY`);
    return true;
  }

  /**
   * Transition instance to BUSY state.
   * Clears any idle timer since instance is actively processing.
   *
   * @param {string} instanceId - Instance ID to mark busy
   * @returns {boolean} True if state was updated
   */
  markBusy(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      this.logger.warn(`[WarmPoolManager] markBusy: Unknown instance ${instanceId}`);
      return false;
    }

    const validFromStates = [InstanceState.READY, InstanceState.IDLE];
    if (!validFromStates.includes(instance.state)) {
      this.logger.warn(`[WarmPoolManager] markBusy: Invalid state transition from ${instance.state} for ${instanceId}`);
      return false;
    }

    // Clear any existing idle timer
    this._clearIdleTimer(instanceId);

    instance.state = InstanceState.BUSY;
    instance.lastActivity = Date.now();
    this.logger.debug(`[WarmPoolManager] Instance ${instanceId} is now BUSY`);
    return true;
  }

  /**
   * Transition instance to IDLE state and start idle timer.
   * Timer duration is calculated based on config and warmth tier for request type.
   *
   * @param {string} instanceId - Instance ID to mark idle
   * @param {string} [requestType] - Type of request that just completed (for warmth bonus)
   * @returns {boolean} True if state was updated
   */
  markIdle(instanceId, requestType = null) {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      this.logger.warn(`[WarmPoolManager] markIdle: Unknown instance ${instanceId}`);
      return false;
    }

    const validFromStates = [InstanceState.READY, InstanceState.BUSY];
    if (!validFromStates.includes(instance.state)) {
      this.logger.warn(`[WarmPoolManager] markIdle: Invalid state transition from ${instance.state} for ${instanceId}`);
      return false;
    }

    // Clear any existing idle timer
    this._clearIdleTimer(instanceId);

    instance.state = InstanceState.IDLE;
    instance.lastActivity = Date.now();

    // Calculate idle timeout with warmth bonus
    const timeoutMs = this._calculateIdleTimeout(requestType);
    this._startIdleTimer(instanceId, timeoutMs);

    this.logger.debug(`[WarmPoolManager] Instance ${instanceId} is now IDLE, timeout in ${timeoutMs / 1000}s`);
    return true;
  }

  /**
   * Extend warmth by resetting the idle timer.
   * Used when a request comes in that doesn't fully use the instance but should keep it warm.
   *
   * @param {string} instanceId - Instance ID to extend warmth for
   * @param {string} [requestType] - Type of request (for warmth bonus calculation)
   * @returns {boolean} True if timer was reset
   */
  extendWarmth(instanceId, requestType = null) {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      this.logger.warn(`[WarmPoolManager] extendWarmth: Unknown instance ${instanceId}`);
      return false;
    }

    if (instance.state !== InstanceState.IDLE) {
      // Only extend warmth for IDLE instances
      this.logger.debug(`[WarmPoolManager] extendWarmth: Instance ${instanceId} is ${instance.state}, not IDLE`);
      return false;
    }

    // Clear existing timer and start new one
    this._clearIdleTimer(instanceId);
    const timeoutMs = this._calculateIdleTimeout(requestType);
    this._startIdleTimer(instanceId, timeoutMs);

    instance.lastActivity = Date.now();
    this.logger.debug(`[WarmPoolManager] Extended warmth for ${instanceId}, new timeout in ${timeoutMs / 1000}s`);
    return true;
  }

  /**
   * Terminate an instance via vastaiService and remove from tracking.
   *
   * @param {string} instanceId - Instance ID to terminate
   * @returns {Promise<boolean>} True if termination was successful
   */
  async terminateInstance(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      this.logger.warn(`[WarmPoolManager] terminateInstance: Unknown instance ${instanceId}`);
      return false;
    }

    // Prevent double termination
    if (instance.state === InstanceState.TERMINATING) {
      this.logger.debug(`[WarmPoolManager] Instance ${instanceId} already terminating`);
      return true;
    }

    // Mark as terminating
    instance.state = InstanceState.TERMINATING;
    this._clearIdleTimer(instanceId);

    this.logger.info(`[WarmPoolManager] Terminating instance ${instanceId}`);

    try {
      await this.vastaiService.terminateInstance(instanceId);
      this.instances.delete(instanceId);
      this.logger.info(`[WarmPoolManager] Instance ${instanceId} terminated and removed from pool`);
      return true;
    } catch (error) {
      this.logger.error(`[WarmPoolManager] Failed to terminate instance ${instanceId}: ${error.message}`);
      // Keep in tracking with TERMINATING state for retry
      return false;
    }
  }

  /**
   * Get current pool state for monitoring.
   *
   * @returns {object} Pool state summary
   */
  getPoolState() {
    const byState = {};
    const byType = {};
    const instances = [];

    for (const [instanceId, data] of this.instances) {
      // Count by state
      byState[data.state] = (byState[data.state] || 0) + 1;

      // Count by type
      byType[data.instanceType] = (byType[data.instanceType] || 0) + 1;

      // Build instance list
      instances.push({
        instanceId,
        state: data.state,
        instanceType: data.instanceType,
        hourlyRate: data.hourlyRate,
        lastActivity: data.lastActivity,
        provisionedAt: data.provisionedAt,
        idleTimeRemaining: this._getIdleTimeRemaining(instanceId)
      });
    }

    return {
      total: this.instances.size,
      byState,
      byType,
      instances
    };
  }

  /**
   * Get total instance count.
   *
   * @returns {number} Total number of tracked instances
   */
  getInstanceCount() {
    return this.instances.size;
  }

  /**
   * Gracefully shutdown by terminating all instances.
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info(`[WarmPoolManager] Shutting down, terminating ${this.instances.size} instances`);

    const terminationPromises = [];
    for (const instanceId of this.instances.keys()) {
      terminationPromises.push(this.terminateInstance(instanceId));
    }

    const results = await Promise.allSettled(terminationPromises);
    const failed = results.filter((r) => r.status === 'rejected' || r.value === false);

    if (failed.length > 0) {
      this.logger.warn(`[WarmPoolManager] ${failed.length} instances failed to terminate during shutdown`);
    }

    this.logger.info('[WarmPoolManager] Shutdown complete');
  }

  // =====================
  // Private Methods
  // =====================

  /**
   * Calculate idle timeout based on config and request type warmth tier.
   *
   * @param {string} [requestType] - Type of request for warmth bonus
   * @returns {number} Timeout in milliseconds
   * @private
   */
  _calculateIdleTimeout(requestType) {
    const baseTimeoutSec = this.config.idleTimeoutBase;
    const maxTimeoutSec = this.config.idleTimeoutMax;
    const warmthTiers = this.config.warmthTiers || {};

    const warmthBonus = requestType && warmthTiers[requestType]
      ? warmthTiers[requestType]
      : 0;

    const totalTimeoutSec = Math.min(baseTimeoutSec + warmthBonus, maxTimeoutSec);

    return totalTimeoutSec * 1000; // Convert to ms
  }

  /**
   * Start idle timer for automatic termination.
   *
   * @param {string} instanceId - Instance ID
   * @param {number} timeoutMs - Timeout in milliseconds
   * @private
   */
  _startIdleTimer(instanceId, timeoutMs) {
    const timer = setTimeout(async () => {
      this.logger.debug(`[WarmPoolManager] Idle timeout reached for ${instanceId}, terminating`);
      await this.terminateInstance(instanceId);
    }, timeoutMs);

    this.idleTimers.set(instanceId, timer);
    this.idleTimerStarts.set(instanceId, Date.now());
    this.idleTimerDurations.set(instanceId, timeoutMs);
  }

  /**
   * Clear existing idle timer for an instance.
   *
   * @param {string} instanceId - Instance ID
   * @private
   */
  _clearIdleTimer(instanceId) {
    const timer = this.idleTimers.get(instanceId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(instanceId);
      this.idleTimerStarts.delete(instanceId);
      this.idleTimerDurations.delete(instanceId);
    }
  }

  /**
   * Get remaining time on idle timer.
   *
   * @param {string} instanceId - Instance ID
   * @returns {number|null} Milliseconds remaining or null if no timer
   * @private
   */
  _getIdleTimeRemaining(instanceId) {
    const startTime = this.idleTimerStarts.get(instanceId);
    const duration = this.idleTimerDurations.get(instanceId);

    if (startTime === undefined || duration === undefined) {
      return null;
    }

    const elapsed = Date.now() - startTime;
    const remaining = duration - elapsed;

    return Math.max(0, remaining);
  }
}

// Export class and state enum
module.exports = WarmPoolManager;
module.exports.InstanceState = InstanceState;
