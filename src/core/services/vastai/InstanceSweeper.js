/**
 * InstanceSweeper - Orphan detection and cleanup for VastAI instances
 *
 * PURPOSE:
 *   Prevent runaway GPU costs by detecting and terminating orphaned instances.
 *   Runs periodically to catch cases where:
 *   - Worker crashed before terminating instance
 *   - Training completed/failed but termination failed
 *   - Instance running longer than max allowed time
 *   - Instance has no associated training record
 *
 * USAGE:
 *   const sweeper = new InstanceSweeper({ vastAIClient, trainingDb, logger });
 *   sweeper.start(); // Starts periodic sweeps
 *   sweeper.stop();  // Stops sweeper
 *   await sweeper.sweep(); // Manual one-time sweep
 */

class InstanceSweeper {
  constructor({
    vastAIClient,
    trainingDb,
    logger,
    sweepIntervalMs = 5 * 60 * 1000,  // 5 minutes default
    maxRuntimeMs = 4 * 60 * 60 * 1000, // 4 hours max runtime
    stuckThresholdMs = 2 * 60 * 60 * 1000, // 2 hours without update = stuck
    alertCallback = null, // Function to call for alerts
  } = {}) {
    if (!vastAIClient) throw new Error('InstanceSweeper requires vastAIClient');
    if (!trainingDb) throw new Error('InstanceSweeper requires trainingDb');

    this.vastAIClient = vastAIClient;
    this.trainingDb = trainingDb;
    this.logger = logger || console;
    this.sweepIntervalMs = sweepIntervalMs;
    this.maxRuntimeMs = maxRuntimeMs;
    this.stuckThresholdMs = stuckThresholdMs;
    this.alertCallback = alertCallback;

    this._intervalHandle = null;
    this._sweeping = false;
  }

  /**
   * Start the periodic sweeper
   */
  start() {
    if (this._intervalHandle) {
      this.logger.warn('[InstanceSweeper] Already running');
      return;
    }

    this.logger.info(`[InstanceSweeper] Starting (interval=${this.sweepIntervalMs}ms, maxRuntime=${this.maxRuntimeMs}ms)`);

    // Run immediately on start
    this.sweep().catch(err => {
      this.logger.error('[InstanceSweeper] Initial sweep failed:', err);
    });

    // Then run periodically
    this._intervalHandle = setInterval(() => {
      this.sweep().catch(err => {
        this.logger.error('[InstanceSweeper] Periodic sweep failed:', err);
      });
    }, this.sweepIntervalMs);
  }

  /**
   * Stop the periodic sweeper
   */
  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
      this.logger.info('[InstanceSweeper] Stopped');
    }
  }

  /**
   * Perform a single sweep
   * @returns {Object} Sweep results
   */
  async sweep() {
    if (this._sweeping) {
      this.logger.debug('[InstanceSweeper] Sweep already in progress, skipping');
      return { skipped: true };
    }

    this._sweeping = true;
    const results = {
      instancesChecked: 0,
      terminated: [],
      errors: [],
      alerts: [],
    };

    try {
      // Step 1: Get all running VastAI instances
      const instancesResponse = await this.vastAIClient.listInstances();
      const instances = instancesResponse?.instances || [];
      const runningInstances = instances.filter(i =>
        i.actual_status === 'running' || i.actual_status === 'loading'
      );

      results.instancesChecked = runningInstances.length;

      if (runningInstances.length === 0) {
        this.logger.debug('[InstanceSweeper] No running instances found');
        return results;
      }

      this.logger.debug(`[InstanceSweeper] Found ${runningInstances.length} running instance(s)`);

      // Step 2: Get all active trainings from database
      const [orphanCandidates, stuckJobs] = await Promise.all([
        this.trainingDb.findOrphanCandidates(),
        this.trainingDb.findStuckJobs(this.stuckThresholdMs),
      ]);

      // Build a map of instance IDs to their training status
      const instanceToTraining = new Map();

      // Add orphan candidates (COMPLETED/FAILED but instance not terminated)
      for (const training of orphanCandidates) {
        if (training.vastaiInstanceId) {
          instanceToTraining.set(training.vastaiInstanceId, {
            training,
            reason: `Training ${training.status} but instance not terminated`,
          });
        }
      }

      // Add stuck jobs
      for (const training of stuckJobs) {
        if (training.vastaiInstanceId) {
          const existing = instanceToTraining.get(training.vastaiInstanceId);
          if (!existing) {
            instanceToTraining.set(training.vastaiInstanceId, {
              training,
              reason: `Training stuck in ${training.status} (no update in ${Math.round(this.stuckThresholdMs / 60000)}min)`,
            });
          }
        }
      }

      // Step 3: Check each running instance
      for (const instance of runningInstances) {
        const instanceId = String(instance.id);
        const startTime = instance.start_date ? new Date(instance.start_date * 1000) : null;
        const runtimeMs = startTime ? Date.now() - startTime.getTime() : 0;

        try {
          // Check if this instance has a known training issue
          const trainingInfo = instanceToTraining.get(instanceId);

          if (trainingInfo) {
            // Instance belongs to a completed/failed/stuck training - terminate it
            this.logger.warn(`[InstanceSweeper] Terminating orphan instance ${instanceId}: ${trainingInfo.reason}`);
            await this._terminateInstance(instanceId, trainingInfo.training._id, trainingInfo.reason);
            results.terminated.push({
              instanceId,
              reason: trainingInfo.reason,
              trainingId: trainingInfo.training._id.toString(),
            });
            continue;
          }

          // Check max runtime limit
          if (runtimeMs > this.maxRuntimeMs) {
            const runtimeHours = (runtimeMs / 3600000).toFixed(2);
            const maxHours = (this.maxRuntimeMs / 3600000).toFixed(1);
            const reason = `Instance exceeded max runtime (${runtimeHours}h > ${maxHours}h limit)`;

            this.logger.error(`[InstanceSweeper] ${reason} - instance ${instanceId}`);
            this._alert('MAX_RUNTIME_EXCEEDED', { instanceId, runtimeHours, maxHours });
            results.alerts.push({ type: 'MAX_RUNTIME_EXCEEDED', instanceId, runtimeHours });

            // Find associated training if any
            const training = await this._findTrainingByInstanceId(instanceId);

            await this._terminateInstance(instanceId, training?._id, reason);
            results.terminated.push({
              instanceId,
              reason,
              trainingId: training?._id?.toString() || null,
            });

            // Mark training as failed if found
            if (training) {
              await this.trainingDb.markFailed(training._id, reason);
            }
            continue;
          }

          // Check if instance has no associated training (true orphan)
          const training = await this._findTrainingByInstanceId(instanceId);
          if (!training) {
            const reason = 'Instance has no associated training record';
            this.logger.warn(`[InstanceSweeper] ${reason} - instance ${instanceId}`);
            this._alert('ORPHAN_INSTANCE', { instanceId, runtimeMs });
            results.alerts.push({ type: 'ORPHAN_INSTANCE', instanceId });

            // Give it 10 minutes grace period before terminating (might be newly provisioned)
            if (runtimeMs > 10 * 60 * 1000) {
              await this._terminateInstance(instanceId, null, reason);
              results.terminated.push({ instanceId, reason, trainingId: null });
            }
          }

        } catch (err) {
          this.logger.error(`[InstanceSweeper] Error processing instance ${instanceId}:`, err);
          results.errors.push({ instanceId, error: err.message });
        }
      }

      // Log summary
      if (results.terminated.length > 0) {
        this.logger.info(`[InstanceSweeper] Sweep complete: terminated ${results.terminated.length} instance(s)`);
      } else {
        this.logger.debug('[InstanceSweeper] Sweep complete: no instances terminated');
      }

      return results;

    } catch (err) {
      this.logger.error('[InstanceSweeper] Sweep failed:', err);
      results.errors.push({ error: err.message });
      throw err;
    } finally {
      this._sweeping = false;
    }
  }

  /**
   * Terminate an instance and update training record
   * @private
   */
  async _terminateInstance(instanceId, trainingId, reason) {
    try {
      await this.vastAIClient.deleteInstance(instanceId);
      this.logger.info(`[InstanceSweeper] Terminated instance ${instanceId}`);

      if (trainingId) {
        await this.trainingDb.markInstanceTerminated(trainingId);
      }
    } catch (err) {
      // Instance might already be terminated
      if (err.message?.includes('not found') || err.status === 404) {
        this.logger.info(`[InstanceSweeper] Instance ${instanceId} already terminated`);
        if (trainingId) {
          await this.trainingDb.markInstanceTerminated(trainingId);
        }
      } else {
        throw err;
      }
    }
  }

  /**
   * Find training by VastAI instance ID
   * @private
   */
  async _findTrainingByInstanceId(instanceId) {
    const trainings = await this.trainingDb.findMany({
      vastaiInstanceId: instanceId,
    }, { limit: 1 });
    return trainings[0] || null;
  }

  /**
   * Send an alert
   * @private
   */
  _alert(type, data) {
    if (this.alertCallback) {
      try {
        this.alertCallback(type, data);
      } catch (err) {
        this.logger.error('[InstanceSweeper] Alert callback failed:', err);
      }
    }
  }

  /**
   * Get current status (for health checks)
   */
  getStatus() {
    return {
      running: this._intervalHandle !== null,
      sweeping: this._sweeping,
      config: {
        sweepIntervalMs: this.sweepIntervalMs,
        maxRuntimeMs: this.maxRuntimeMs,
        stuckThresholdMs: this.stuckThresholdMs,
      },
    };
  }
}

module.exports = InstanceSweeper;
