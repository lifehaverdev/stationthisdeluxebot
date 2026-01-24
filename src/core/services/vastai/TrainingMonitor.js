/**
 * TrainingMonitor - Monitor and control active training jobs
 *
 * PURPOSE:
 *   Wrap an active training job to provide:
 *   - Polling-based status checks (for background monitoring)
 *   - Streaming mode (for real-time watching)
 *   - Stall detection with asymptotic analysis
 *   - Graceful termination orchestration
 *
 * USAGE:
 *   const monitor = new TrainingMonitor({
 *     ssh,
 *     jobInfo: { logFile, pidFile, outputDir },
 *     config: { gracePeriod: 15 * 60 * 1000 }
 *   });
 *
 *   // Polling mode
 *   const status = await monitor.poll();
 *
 *   // Streaming mode
 *   const stop = await monitor.startStreaming((update) => console.log(update));
 *   // Later: stop();
 *
 * MODES:
 *   - Polling: Periodic SSH + tail, stateless between calls, 60s default interval
 *   - Streaming: Persistent SSH with tail -f, real-time updates, needs reconnect logic
 */

const TrainingOutputParser = require('./TrainingOutputParser');
const StallDetector = require('./StallDetector');

class TrainingMonitor {
  constructor({
    ssh,
    jobInfo,
    config = {},
    logger
  } = {}) {
    if (!ssh) {
      throw new Error('TrainingMonitor requires an SshTransport instance');
    }
    if (!jobInfo?.logFile || !jobInfo?.pidFile) {
      throw new Error('TrainingMonitor requires jobInfo with logFile and pidFile');
    }

    this.ssh = ssh;
    this.jobInfo = {
      logFile: jobInfo.logFile,
      pidFile: jobInfo.pidFile,
      outputDir: jobInfo.outputDir || null,
      jobId: jobInfo.jobId || null,
      jobName: jobInfo.jobName || 'Training Job'
    };
    this.config = {
      pollInterval: config.pollInterval || 60 * 1000,
      tailLines: config.tailLines || 200,
      gracePeriod: config.gracePeriod || 15 * 60 * 1000,
      stallDetection: {
        enabled: config.stallDetection?.enabled !== false,
        minSamples: config.stallDetection?.minSamples || 4,
        etaConvergenceThreshold: config.stallDetection?.etaConvergenceThreshold || 0.5,
        speedDropThreshold: config.stallDetection?.speedDropThreshold || 0.5
      },
      ...config
    };
    this.logger = logger || console;

    // Initialize components
    this.parser = new TrainingOutputParser({ logger: this.logger });
    this.stallDetector = new StallDetector({
      minSamples: this.config.stallDetection.minSamples,
      etaConvergenceThreshold: this.config.stallDetection.etaConvergenceThreshold,
      speedDropThreshold: this.config.stallDetection.speedDropThreshold,
      gracePeriod: this.config.gracePeriod,
      logger: this.logger
    });

    // Accumulated state
    this.parsedState = this.parser.parse(''); // Initialize empty
    this.lastPollTime = null;
    this.streamingActive = false;
    this.streamProcess = null;
  }

  /**
   * Poll for current training status (one-shot check)
   *
   * @returns {Promise<TrainingStatus>}
   */
  async poll() {
    const isRunning = await this.isTrainingRunning();

    // Read recent log output
    let recentOutput = '';
    try {
      recentOutput = await this.ssh.exec(
        `tail -n ${this.config.tailLines} "${this.jobInfo.logFile}" 2>/dev/null || true`
      );
    } catch (err) {
      this.logger.warn(`[TrainingMonitor] Could not read log file: ${err.message}`);
    }

    // Parse and accumulate state
    const newParsed = this.parser.parse(recentOutput);
    this._updateParsedState(newParsed);

    // Record sample for stall detection
    if (this.config.stallDetection.enabled && newParsed.lastStep !== null) {
      this.stallDetector.recordSample({
        step: newParsed.lastStep,
        totalSteps: newParsed.totalSteps,
        eta: newParsed.estimatedTimeRemaining,
        stepsPerSecond: newParsed.stepsPerSecond
      });
    }

    // Analyze for stalls
    const stallAnalysis = this.config.stallDetection.enabled
      ? this.stallDetector.analyze()
      : { isStalling: false, recommendation: 'continue' };

    // Get checkpoint info
    const checkpoints = this.jobInfo.outputDir
      ? await this.listCheckpoints()
      : [];

    this.lastPollTime = Date.now();

    return {
      isRunning,
      parsed: this.parsedState,
      stallAnalysis,
      checkpoints,
      recentOutput,
      timestamp: this.lastPollTime
    };
  }

  /**
   * Start streaming mode - real-time log updates
   *
   * @param {function} callback - Called on each update: (update) => void
   * @returns {Promise<function>} Stop function to end streaming
   */
  async startStreaming(callback) {
    if (this.streamingActive) {
      throw new Error('Streaming already active');
    }

    this.streamingActive = true;
    this.logger.info('[TrainingMonitor] Starting streaming mode');

    // Buffer for accumulating partial lines
    let lineBuffer = '';

    const processOutput = (data) => {
      lineBuffer += data;

      // Process complete lines
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        // Parse the line
        const parsed = this.parser.parse(line);
        this._updateParsedState(parsed);

        // Record sample for stall detection
        if (this.config.stallDetection.enabled && parsed.lastStep !== null) {
          this.stallDetector.recordSample({
            step: parsed.lastStep,
            totalSteps: parsed.totalSteps,
            eta: parsed.estimatedTimeRemaining,
            stepsPerSecond: parsed.stepsPerSecond
          });
        }

        // Build update object
        const update = {
          line,
          parsed: this.parsedState,
          stallAnalysis: this.config.stallDetection.enabled
            ? this.stallDetector.analyze()
            : null,
          timestamp: Date.now()
        };

        try {
          callback(update);
        } catch (err) {
          this.logger.error(`[TrainingMonitor] Callback error: ${err.message}`);
        }
      }
    };

    // Start tail -f via SSH
    // Note: This requires SshTransport to support streaming, which may need implementation
    try {
      const cmd = `tail -f "${this.jobInfo.logFile}" 2>/dev/null`;

      // Check if ssh supports execStream (streaming exec)
      if (typeof this.ssh.execStream === 'function') {
        this.streamProcess = await this.ssh.execStream(cmd, {
          onData: processOutput,
          onError: (err) => {
            this.logger.error(`[TrainingMonitor] Stream error: ${err.message}`);
          },
          onClose: () => {
            this.logger.info('[TrainingMonitor] Stream closed');
            this.streamingActive = false;
          }
        });
      } else {
        // Fallback: poll at high frequency to simulate streaming
        this.logger.warn('[TrainingMonitor] SSH streaming not available, falling back to fast polling');
        this._startFastPolling(callback);
      }
    } catch (err) {
      this.streamingActive = false;
      throw err;
    }

    // Return stop function
    return () => {
      this.stopStreaming();
    };
  }

  /**
   * Stop streaming mode
   */
  stopStreaming() {
    if (!this.streamingActive) return;

    this.logger.info('[TrainingMonitor] Stopping streaming mode');
    this.streamingActive = false;

    if (this.streamProcess) {
      try {
        this.streamProcess.kill?.();
        this.streamProcess.destroy?.();
      } catch (err) {
        // Ignore cleanup errors
      }
      this.streamProcess = null;
    }

    if (this._fastPollInterval) {
      clearInterval(this._fastPollInterval);
      this._fastPollInterval = null;
    }
  }

  /**
   * Check if training process is still running
   *
   * @returns {Promise<boolean>}
   */
  async isTrainingRunning() {
    try {
      const result = await this.ssh.exec(
        `if [ -f "${this.jobInfo.pidFile}" ] && kill -0 $(cat "${this.jobInfo.pidFile}") 2>/dev/null; then echo "running"; else echo "stopped"; fi`
      );
      // Check for "running" in output - SSH may include banners/welcome messages
      // Look at the last non-empty line to handle SSH banner noise
      const lines = result.trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1]?.trim() || '';
      return lastLine === 'running';
    } catch (err) {
      return false;
    }
  }

  /**
   * Stop the training process
   *
   * @param {boolean} force - Use SIGKILL instead of SIGTERM
   * @returns {Promise<boolean>} true if stopped successfully
   */
  async stopTraining(force = false) {
    const signal = force ? 'KILL' : 'TERM';
    this.logger.info(`[TrainingMonitor] Stopping training with SIG${signal}`);

    try {
      await this.ssh.exec(
        `if [ -f "${this.jobInfo.pidFile}" ]; then kill -${signal} $(cat "${this.jobInfo.pidFile}") 2>/dev/null; fi`
      );

      // Wait and check
      await this._sleep(3000);
      const stillRunning = await this.isTrainingRunning();

      if (stillRunning && !force) {
        this.logger.warn('[TrainingMonitor] Process did not stop with SIGTERM, trying SIGKILL');
        return this.stopTraining(true);
      }

      return !stillRunning;
    } catch (err) {
      this.logger.error(`[TrainingMonitor] Error stopping training: ${err.message}`);
      return false;
    }
  }

  /**
   * List checkpoint files in output directory
   *
   * @returns {Promise<CheckpointInfo[]>}
   */
  async listCheckpoints() {
    if (!this.jobInfo.outputDir) {
      return [];
    }

    try {
      const result = await this.ssh.exec(
        `find "${this.jobInfo.outputDir}" -name "*.safetensors" -type f -exec ls -la {} \\; 2>/dev/null || true`
      );

      const checkpoints = [];
      const lines = result.split('\n').filter(Boolean);

      for (const line of lines) {
        const match = line.match(/(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\S+\s+\S+)\s+(.+)/);
        if (match) {
          const path = match[7];
          const name = path.split('/').pop();

          // Try to extract step number from filename
          const stepMatch = name.match(/(\d+)\.safetensors$/);
          const step = stepMatch ? parseInt(stepMatch[1], 10) : null;

          checkpoints.push({
            path,
            name,
            step,
            size: parseInt(match[5], 10),
            sizeFormatted: this._formatBytes(parseInt(match[5], 10)),
            date: match[6]
          });
        }
      }

      // Sort by step number (or name if no step)
      checkpoints.sort((a, b) => {
        if (a.step !== null && b.step !== null) return a.step - b.step;
        return a.name.localeCompare(b.name);
      });

      return checkpoints;
    } catch (err) {
      this.logger.warn(`[TrainingMonitor] Error listing checkpoints: ${err.message}`);
      return [];
    }
  }

  /**
   * Get the latest checkpoint
   *
   * @returns {Promise<CheckpointInfo|null>}
   */
  async getLatestCheckpoint() {
    const checkpoints = await this.listCheckpoints();
    return checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
  }

  /**
   * Get current state summary
   */
  getState() {
    return {
      jobInfo: this.jobInfo,
      parsedState: this.parsedState,
      stallDetectorState: this.stallDetector.getState(),
      lastPollTime: this.lastPollTime,
      streamingActive: this.streamingActive
    };
  }

  /**
   * Reset monitor state (for reuse with new job)
   */
  reset() {
    this.parsedState = this.parser.parse('');
    this.stallDetector.reset();
    this.lastPollTime = null;
    this.stopStreaming();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  _updateParsedState(newParsed) {
    // Merge new parsed data with accumulated state
    this.parsedState = {
      ...this.parsedState,
      lastStep: newParsed.lastStep ?? this.parsedState.lastStep,
      totalSteps: newParsed.totalSteps ?? this.parsedState.totalSteps,
      progressPercent: newParsed.progressPercent ?? this.parsedState.progressPercent,
      lastLoss: newParsed.lastLoss ?? this.parsedState.lastLoss,
      lossHistory: [...this.parsedState.lossHistory, ...newParsed.lossHistory],
      lastLearningRate: newParsed.lastLearningRate ?? this.parsedState.lastLearningRate,
      checkpointsSaved: this.parsedState.checkpointsSaved + newParsed.checkpointsSaved,
      checkpointPaths: [...new Set([...this.parsedState.checkpointPaths, ...newParsed.checkpointPaths])],
      errors: [...new Set([...this.parsedState.errors, ...newParsed.errors])],
      warnings: [...new Set([...this.parsedState.warnings, ...newParsed.warnings])],
      gpuUtilization: newParsed.gpuUtilization ?? this.parsedState.gpuUtilization,
      memoryUsage: newParsed.memoryUsage ?? this.parsedState.memoryUsage,
      samplesGenerated: this.parsedState.samplesGenerated + newParsed.samplesGenerated,
      stepsPerSecond: newParsed.stepsPerSecond ?? this.parsedState.stepsPerSecond,
      estimatedTimeRemaining: newParsed.estimatedTimeRemaining ?? this.parsedState.estimatedTimeRemaining
    };

    // Limit history arrays to prevent unbounded growth
    if (this.parsedState.lossHistory.length > 1000) {
      this.parsedState.lossHistory = this.parsedState.lossHistory.slice(-500);
    }
    if (this.parsedState.errors.length > 100) {
      this.parsedState.errors = this.parsedState.errors.slice(-50);
    }
    if (this.parsedState.warnings.length > 100) {
      this.parsedState.warnings = this.parsedState.warnings.slice(-50);
    }
  }

  _startFastPolling(callback) {
    let lastReadPosition = 0;

    this._fastPollInterval = setInterval(async () => {
      if (!this.streamingActive) {
        clearInterval(this._fastPollInterval);
        return;
      }

      try {
        // Read new content since last position
        const result = await this.ssh.exec(
          `tail -c +${lastReadPosition + 1} "${this.jobInfo.logFile}" 2>/dev/null | head -c 10000 || true`
        );

        if (result) {
          lastReadPosition += result.length;

          const lines = result.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;

            const parsed = this.parser.parse(line);
            this._updateParsedState(parsed);

            if (this.config.stallDetection.enabled && parsed.lastStep !== null) {
              this.stallDetector.recordSample({
                step: parsed.lastStep,
                totalSteps: parsed.totalSteps,
                eta: parsed.estimatedTimeRemaining,
                stepsPerSecond: parsed.stepsPerSecond
              });
            }

            callback({
              line,
              parsed: this.parsedState,
              stallAnalysis: this.config.stallDetection.enabled
                ? this.stallDetector.analyze()
                : null,
              timestamp: Date.now()
            });
          }
        }
      } catch (err) {
        this.logger.warn(`[TrainingMonitor] Fast poll error: ${err.message}`);
      }
    }, 2000); // 2 second interval for "streaming" fallback
  }

  _formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TrainingMonitor;
