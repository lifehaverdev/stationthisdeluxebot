/**
 * TrainingRunner - Executes and monitors training jobs on remote GPU instances
 *
 * PURPOSE:
 *   Start training on a provisioned VastAI instance, capture output, and parse
 *   progress information. This is the foundation for the monitoring system.
 *
 * USAGE:
 *   const runner = new TrainingRunner({ ssh, logger });
 *   const result = await runner.startTraining({
 *     configPath: '/opt/stationthis/jobs/job-123/config/flux-lora-ai-toolkit.yml',
 *     jobRoot: '/opt/stationthis/jobs/job-123',
 *     logFile: '/opt/stationthis/jobs/job-123/logs/training.log'
 *   });
 *
 * OUTPUT PARSING:
 *   The runner parses training output to extract:
 *   - Current step / total steps
 *   - Loss values
 *   - Learning rate (if reported)
 *   - Checkpoint saves
 *   - Errors and warnings
 *   - GPU utilization (if available)
 *
 * TRAINING MODES:
 *   - foreground: Run training synchronously, stream output (for testing)
 *   - background: Start training in background, return immediately (for monitoring)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SUPPORTED TRAINING FRAMEWORKS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Currently parsing patterns from:
 *   - Ostris AI-Toolkit (primary target)
 *   - Kohya SS
 *   - diffusers training scripts
 *
 * Each framework has different log formats. The parser uses regex patterns that
 * capture common structures. Add new patterns to TrainingOutputParser as needed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUTURE EXPANSION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * REAL-TIME MONITORING:
 *   - WebSocket push of progress updates
 *   - ETA calculation based on steps/second
 *   - Stall detection (no progress for N minutes)
 *   - Automatic checkpoint download during training
 *
 * ADVANCED PARSING:
 *   - Validation loss extraction
 *   - Sample image generation events
 *   - Memory usage tracking
 *   - Multi-GPU training progress
 *
 * ERROR RECOVERY:
 *   - CUDA OOM detection and batch size adjustment
 *   - NaN loss detection and learning rate adjustment
 *   - Checkpoint corruption detection
 *   - Automatic resume from last checkpoint
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const TrainingOutputParser = require('./TrainingOutputParser');

// Default training command template
// ostris/aitoolkit image has ai-toolkit at /app/ai-toolkit
// Base images with manual install have it at /workspace/ai-toolkit
// Uses python (not python3) as ostris image has it aliased
const DEFAULT_TRAIN_CMD = 'cd /app/ai-toolkit && python run.py';

class TrainingRunner {
  constructor({ ssh, logger, config = {} } = {}) {
    if (!ssh) {
      throw new Error('TrainingRunner requires an SshTransport instance');
    }
    this.ssh = ssh;
    this.logger = logger || console;
    this.config = {
      trainCommand: config.trainCommand || DEFAULT_TRAIN_CMD,
      defaultTimeout: config.defaultTimeout || 6 * 60 * 60 * 1000, // 6 hours
      ...config
    };
    this.parser = new TrainingOutputParser({ logger: this.logger });
  }

  /**
   * Start training in foreground mode (blocking, captures all output)
   *
   * Use this for testing and short training runs. Output is returned
   * when training completes or times out.
   *
   * @param {object} options
   * @param {string} options.configPath - Remote path to training config YAML
   * @param {string} options.jobRoot - Remote job root directory
   * @param {string} options.logFile - Remote path to write logs
   * @param {number} options.timeout - Max execution time in ms
   * @returns {Promise<TrainingResult>}
   */
  async startTraining({ configPath, jobRoot, logFile, timeout, extraEnv = {} }) {
    const effectiveTimeout = timeout || this.config.defaultTimeout;
    const logPath = logFile || `${jobRoot}/logs/training.log`;

    this.logger.debug(`[TrainingRunner] Starting training with config: ${configPath}`);
    this.logger.debug(`[TrainingRunner] Job root: ${jobRoot}`);
    this.logger.debug(`[TrainingRunner] Log file: ${logPath}`);

    // Ensure log directory exists
    await this.ssh.exec(`mkdir -p ${jobRoot}/logs`);

    // Build the training command
    // - Redirect stderr to stdout (2>&1) so we capture everything
    // - Tee to log file while also capturing stdout
    // - Set PYTHONUNBUFFERED for real-time output
    const trainCmd = this._buildTrainCommand(configPath, logPath, extraEnv);

    this.logger.debug(`[TrainingRunner] Executing: ${trainCmd}`);

    const startTime = Date.now();
    let output = '';
    let exitCode = null;
    let error = null;

    try {
      // Execute training command
      output = await this.ssh.exec(trainCmd, { timeout: effectiveTimeout });
      exitCode = 0;
    } catch (err) {
      error = err;
      output = err.output || err.message || '';

      // Try to extract exit code from error
      const codeMatch = err.message?.match(/code (\d+)/);
      exitCode = codeMatch ? parseInt(codeMatch[1], 10) : 1;

      // Log but don't throw yet - we want to parse whatever output we got
      this.logger.warn(`[TrainingRunner] Training command exited with code ${exitCode}`);
    }

    const duration = Date.now() - startTime;

    // Parse the output to extract progress information
    const parsed = this.parser.parse(output);

    // Build result object
    const result = {
      success: exitCode === 0,
      exitCode,
      duration,
      durationFormatted: this._formatDuration(duration),
      output,
      parsed,
      logFile: logPath,
      error: error ? error.message : null
    };

    // Log summary
    this._logSummary(result);

    return result;
  }

  /**
   * Start training in background mode (non-blocking)
   *
   * Starts training in a detached process and returns immediately.
   * Use getTrainingStatus() to poll for progress.
   *
   * @param {object} options
   * @param {string} options.configPath - Remote path to training config YAML
   * @param {string} options.jobRoot - Remote job root directory
   * @param {string} options.logFile - Remote path to write logs
   * @param {string} options.pidFile - Remote path to write PID file
   * @param {object} options.extraEnv - Extra environment variables to export
   * @returns {Promise<BackgroundTrainingInfo>}
   */
  async startTrainingBackground({ configPath, jobRoot, logFile, pidFile, extraEnv = {} }) {
    const logPath = logFile || `${jobRoot}/logs/training.log`;
    const pidPath = pidFile || `${jobRoot}/training.pid`;

    this.logger.debug(`[TrainingRunner] Starting background training with config: ${configPath}`);

    // Ensure directories exist
    await this.ssh.exec(`mkdir -p ${jobRoot}/logs`);

    // Build background command that:
    // 1. Runs training with nohup
    // 2. Redirects all output to log file
    // 3. Writes PID to file for later control
    // 4. Creates a status file that gets updated
    const trainCmd = this._buildBackgroundCommand(configPath, logPath, pidPath, jobRoot, extraEnv);

    this.logger.debug(`[TrainingRunner] Executing background command`);

    // SSH may not return even with nohup/disown due to inherited file descriptors.
    // Use a timeout as a safety net - if SSH doesn't return in 15s, the script
    // has started (cat/chmod takes <1s) and we can proceed to poll.
    try {
      await this.ssh.exec(trainCmd, { timeout: 15000 });
    } catch (err) {
      if (err.message && err.message.includes('timed out')) {
        this.logger.debug('[TrainingRunner] SSH channel held open (expected for background tasks), proceeding...');
      } else {
        throw err;
      }
    }

    // Give it a moment to start and write the PID
    await this._sleep(3000);

    // Read the PID
    let pid = null;
    try {
      const pidContent = await this.ssh.exec(`cat ${pidPath}`);
      pid = parseInt(pidContent.trim(), 10);
    } catch (err) {
      this.logger.warn(`[TrainingRunner] Could not read PID file: ${err.message}`);
    }

    // Verify process is running
    const isRunning = await this.isTrainingRunning(pidPath);

    return {
      started: true,
      pid,
      isRunning,
      logFile: logPath,
      pidFile: pidPath,
      statusFile: `${jobRoot}/training_status.json`
    };
  }

  /**
   * Get current training status from a background job
   *
   * @param {object} options
   * @param {string} options.logFile - Remote log file path
   * @param {string} options.pidFile - Remote PID file path
   * @param {string} options.statusFile - Remote status file path
   * @param {number} options.tailLines - Number of log lines to read (default: 100)
   * @returns {Promise<TrainingStatus>}
   */
  async getTrainingStatus({ logFile, pidFile, statusFile, tailLines = 100 }) {
    const isRunning = await this.isTrainingRunning(pidFile);

    // Read recent log output
    let recentOutput = '';
    try {
      recentOutput = await this.ssh.exec(`tail -n ${tailLines} ${logFile} 2>/dev/null || true`);
    } catch (err) {
      this.logger.warn(`[TrainingRunner] Could not read log file: ${err.message}`);
    }

    // Parse the recent output
    const parsed = this.parser.parse(recentOutput);

    // Try to read status file if it exists (written by training script)
    let statusData = null;
    if (statusFile) {
      try {
        const statusContent = await this.ssh.exec(`cat ${statusFile} 2>/dev/null || echo "{}"`);
        statusData = JSON.parse(statusContent);
      } catch (err) {
        // Status file might not exist yet
      }
    }

    return {
      isRunning,
      parsed,
      statusData,
      recentOutput
    };
  }

  /**
   * Check if training process is still running
   *
   * @param {string} pidFile - Remote path to PID file
   * @returns {Promise<boolean>}
   */
  async isTrainingRunning(pidFile) {
    try {
      const result = await this.ssh.exec(
        `if [ -f ${pidFile} ] && kill -0 $(cat ${pidFile}) 2>/dev/null; then echo "running"; else echo "stopped"; fi`
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
   * Stop a running background training job
   *
   * @param {string} pidFile - Remote path to PID file
   * @param {boolean} force - Use SIGKILL instead of SIGTERM
   * @returns {Promise<boolean>} true if stopped successfully
   */
  async stopTraining(pidFile, force = false) {
    const signal = force ? 'KILL' : 'TERM';

    try {
      await this.ssh.exec(
        `if [ -f ${pidFile} ]; then kill -${signal} $(cat ${pidFile}) 2>/dev/null; fi`
      );

      // Wait a moment and check if it stopped
      await this._sleep(2000);
      const stillRunning = await this.isTrainingRunning(pidFile);

      if (stillRunning && !force) {
        this.logger.warn('[TrainingRunner] Process did not stop with SIGTERM, trying SIGKILL');
        return this.stopTraining(pidFile, true);
      }

      return !stillRunning;
    } catch (err) {
      this.logger.error(`[TrainingRunner] Error stopping training: ${err.message}`);
      return false;
    }
  }

  /**
   * List checkpoint files in output directory
   *
   * @param {string} outputDir - Remote output directory path
   * @returns {Promise<CheckpointInfo[]>}
   */
  async listCheckpoints(outputDir) {
    try {
      // List safetensors files with timestamps
      const result = await this.ssh.exec(
        `find ${outputDir} -name "*.safetensors" -type f -exec ls -la {} \\; 2>/dev/null || true`
      );

      const checkpoints = [];
      const lines = result.split('\n').filter(Boolean);

      for (const line of lines) {
        // Parse ls -la output: permissions links user group size date time name
        const match = line.match(/(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\S+\s+\S+)\s+(.+)/);
        if (match) {
          checkpoints.push({
            path: match[7],
            size: parseInt(match[5], 10),
            sizeFormatted: this._formatBytes(parseInt(match[5], 10)),
            date: match[6],
            name: match[7].split('/').pop()
          });
        }
      }

      // Sort by name (usually includes step number)
      checkpoints.sort((a, b) => a.name.localeCompare(b.name));

      return checkpoints;
    } catch (err) {
      this.logger.warn(`[TrainingRunner] Error listing checkpoints: ${err.message}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  _buildTrainCommand(configPath, logPath, extraEnv = {}) {
    // Build command that:
    // 1. Exports any extra env vars (like HF_TOKEN)
    // 2. Sets PYTHONUNBUFFERED for real-time output
    // 3. Runs training command with config
    // 4. Tees output to both stdout and log file
    // 5. Merges stderr into stdout
    const envExports = Object.entries(extraEnv)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `export ${k}="${v}"`)
      .join(' && ');

    const envPrefix = envExports ? `${envExports} && ` : '';
    return `${envPrefix}PYTHONUNBUFFERED=1 ${this.config.trainCommand} "${configPath}" 2>&1 | tee "${logPath}"`;
  }

  /**
   * Pre-flight GPU check - verifies CUDA, GPU, and Accelerate are working before training
   * This catches bad VastAI instances early (driver issues, CUDA problems, accelerate issues)
   *
   * @returns {Promise<{ok: boolean, gpuName: string, cudaVersion: string, error: string}>}
   */
  async preflightGpuCheck() {
    this.logger.info('[TrainingRunner] Running pre-flight GPU check...');

    // Test PyTorch CUDA AND accelerate library (which ai-toolkit uses)
    const checkScript = `python3 -c "
import torch
import sys

if not torch.cuda.is_available():
    print('ERROR: CUDA not available')
    sys.exit(1)

try:
    # Quick GPU test - allocate and free small tensor
    device = torch.device('cuda:0')
    x = torch.zeros(1000, 1000, device=device)
    del x
    torch.cuda.empty_cache()

    gpu_name = torch.cuda.get_device_name(0)
    cuda_ver = torch.version.cuda

    # Also test accelerate library (ai-toolkit uses this)
    from accelerate import Accelerator
    acc = Accelerator()
    del acc

    print(f'OK: {gpu_name} | CUDA {cuda_ver}')
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
"`;

    try {
      const result = await this.ssh.exec(checkScript, { timeout: 30000 });
      const output = result.trim();

      if (output.startsWith('OK:')) {
        const match = output.match(/OK: (.+) \| CUDA (.+)/);
        this.logger.info(`[TrainingRunner] GPU check passed: ${output}`);
        return {
          ok: true,
          gpuName: match?.[1] || 'unknown',
          cudaVersion: match?.[2] || 'unknown',
          error: null
        };
      } else {
        this.logger.error(`[TrainingRunner] GPU check failed: ${output}`);
        return {
          ok: false,
          gpuName: null,
          cudaVersion: null,
          error: output
        };
      }
    } catch (err) {
      this.logger.error(`[TrainingRunner] GPU check error: ${err.message}`);
      return {
        ok: false,
        gpuName: null,
        cudaVersion: null,
        error: err.message
      };
    }
  }

  _buildBackgroundCommand(configPath, logPath, pidPath, jobRoot, extraEnv = {}) {
    // Build command that:
    // 1. Creates a wrapper script
    // 2. Runs training in background with nohup
    // 3. Writes PID to file
    // 4. Captures all output to log file
    const wrapperScript = `${jobRoot}/scripts/run_training.sh`;

    // Build environment variable exports
    const envExports = Object.entries(extraEnv)
      .map(([k, v]) => `export ${k}="${v}"`)
      .join('\n');

    const script = `#!/bin/bash
set -e
export PYTHONUNBUFFERED=1
${envExports}

# Start training and capture PID
# Note: trainCommand includes the cd to ai-toolkit directory
${this.config.trainCommand} "${configPath}" >> "${logPath}" 2>&1 &
TRAIN_PID=$!
echo $TRAIN_PID > "${pidPath}"

# Wait for training to complete
wait $TRAIN_PID
EXIT_CODE=$?

# Write completion status
echo "{\\"completed\\": true, \\"exitCode\\": $EXIT_CODE, \\"timestamp\\": \\"$(date -Iseconds)\\"}" > "${jobRoot}/training_status.json"

exit $EXIT_CODE
`;

    // Write the script and execute it fully detached from SSH session.
    // setsid creates a new session (new SID + process group + no controlling terminal),
    // which fully detaches from the SSH channel so SSH can close immediately.
    // nohup/disown is NOT sufficient because child processes inherit SSH pipe FDs.
    return `mkdir -p ${jobRoot}/scripts && cat > ${wrapperScript} << 'TRAINSCRIPT'
${script}
TRAINSCRIPT
chmod +x ${wrapperScript} && setsid ${wrapperScript} </dev/null >/dev/null 2>&1 &`;
  }

  _logSummary(result) {
    this.logger.info('─'.repeat(60));
    this.logger.info('[TrainingRunner] Training Summary');
    this.logger.info('─'.repeat(60));
    this.logger.info(`  Status:     ${result.success ? 'SUCCESS' : 'FAILED'}`);
    this.logger.info(`  Exit Code:  ${result.exitCode}`);
    this.logger.info(`  Duration:   ${result.durationFormatted}`);

    if (result.parsed.lastStep !== null) {
      const progress = result.parsed.totalSteps
        ? `${result.parsed.lastStep}/${result.parsed.totalSteps}`
        : `${result.parsed.lastStep}`;
      this.logger.info(`  Progress:   Step ${progress}`);
    }

    if (result.parsed.lastLoss !== null) {
      this.logger.info(`  Final Loss: ${result.parsed.lastLoss.toFixed(6)}`);
    }

    if (result.parsed.checkpointsSaved > 0) {
      this.logger.info(`  Checkpoints: ${result.parsed.checkpointsSaved} saved`);
    }

    if (result.parsed.errors.length > 0) {
      this.logger.info(`  Errors:     ${result.parsed.errors.length} detected`);
      result.parsed.errors.slice(0, 3).forEach(e => {
        this.logger.info(`    - ${e.substring(0, 80)}...`);
      });
    }

    this.logger.info('─'.repeat(60));
  }

  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
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

module.exports = TrainingRunner;
