/**
 * ServiceRunner - Dumb executor pattern for running jobs on GPU instances
 *
 * PURPOSE:
 *   Execute jobs on a provisioned VastAI instance via SSH. This class knows
 *   nothing about users, queues, or business logic - it just runs jobs and
 *   returns results.
 *
 * USAGE:
 *   const runner = new ServiceRunner({ logger, sshTransport });
 *   const result = await runner.executeJob(
 *     { _id: 'job-123', requestType: 'img2img', inputs: { ... } },
 *     { r2UploadUrl: 'https://...' }
 *   );
 *
 * JOB EXECUTION FLOW:
 *   1. Prepare job config (jobId, requestType, inputs, r2UploadUrl)
 *   2. Upload config to /tmp/jobs/{jobId}/config.json on instance
 *   3. Run: cd /workspace && python run_job.py --config /tmp/jobs/{jobId}/config.json
 *   4. Parse stdout as JSON for outputs
 *   5. Calculate gpuSeconds from execution time
 *   6. Return result
 *
 * INSTANCE REQUIREMENTS:
 *   - run_job.py must exist at /workspace/run_job.py
 *   - Python environment with required dependencies
 *   - run_job.py outputs JSON to stdout on success
 *
 * BILLING:
 *   gpuSeconds is always calculated and returned, even on failure,
 *   to allow billing for partial work.
 *
 * SEE ALSO:
 *   - src/core/services/remote/SshTransport.js - SSH/SCP operations
 *   - src/core/services/vastai/TrainingRunner.js - Training job execution
 */

class ServiceRunner {
  constructor({ logger, sshTransport } = {}) {
    if (!sshTransport) {
      throw new Error('ServiceRunner requires an sshTransport instance');
    }
    this.logger = logger || console;
    this.sshTransport = sshTransport;
  }

  /**
   * Execute a job on the remote instance
   *
   * @param {object} job - Job object with _id, requestType, inputs
   * @param {string} job._id - Unique job identifier
   * @param {string} job.requestType - Type of job (e.g., 'img2img', 'txt2img')
   * @param {object} job.inputs - Job-specific input parameters
   * @param {object} options - Execution options
   * @param {string} options.r2UploadUrl - Signed URL for result upload
   * @returns {Promise<JobResult>} Result with success, outputs, gpuSeconds, error
   */
  async executeJob(job, options = {}) {
    const { _id: jobId, requestType, inputs } = job;
    const { r2UploadUrl } = options;
    const configPath = `/tmp/jobs/${jobId}/config.json`;

    const startTime = Date.now();
    let gpuSeconds = 0;

    try {
      this.logger.info(`[ServiceRunner] Executing job ${jobId} (type: ${requestType})`);

      // Prepare job config
      const config = {
        jobId,
        requestType,
        inputs,
        r2UploadUrl
      };

      // Upload job config to instance
      await this._uploadJobConfig(configPath, config);

      // Run the job
      const output = await this._runJob(configPath);

      // Calculate gpuSeconds
      gpuSeconds = (Date.now() - startTime) / 1000;

      // Parse output as JSON
      let outputs;
      try {
        outputs = JSON.parse(output.trim());
      } catch (parseErr) {
        this.logger.warn(`[ServiceRunner] Failed to parse job output as JSON: ${parseErr.message}`);
        this.logger.warn(`[ServiceRunner] Raw output: ${output.substring(0, 500)}`);
        return {
          success: false,
          outputs: null,
          gpuSeconds,
          error: `Failed to parse job output: ${parseErr.message}`
        };
      }

      this.logger.info(`[ServiceRunner] Job ${jobId} completed successfully in ${gpuSeconds.toFixed(2)}s`);

      return {
        success: true,
        outputs,
        gpuSeconds,
        error: null
      };
    } catch (err) {
      // Calculate gpuSeconds even on failure
      gpuSeconds = (Date.now() - startTime) / 1000;

      this.logger.error(`[ServiceRunner] Job ${jobId} failed: ${err.message}`);

      return {
        success: false,
        outputs: null,
        gpuSeconds,
        error: err.message
      };
    }
  }

  /**
   * Upload a local file to the remote instance
   *
   * @param {string} localPath - Path to local file
   * @param {string} remotePath - Destination path on instance
   * @returns {Promise<void>}
   */
  async uploadInputs(localPath, remotePath) {
    try {
      this.logger.info(`[ServiceRunner] Uploading ${localPath} -> ${remotePath}`);
      await this.sshTransport.upload(localPath, remotePath);
    } catch (err) {
      this.logger.error(`[ServiceRunner] Upload failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Download a file from the remote instance
   *
   * @param {string} remotePath - Path on remote instance
   * @param {string} localPath - Destination path locally
   * @returns {Promise<void>}
   */
  async downloadResults(remotePath, localPath) {
    try {
      this.logger.info(`[ServiceRunner] Downloading ${remotePath} -> ${localPath}`);
      await this.sshTransport.download(remotePath, localPath);
    } catch (err) {
      this.logger.error(`[ServiceRunner] Download failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if the instance is healthy and SSH is working
   *
   * @returns {Promise<boolean>} true if healthy
   */
  async healthCheck() {
    try {
      const result = await this.sshTransport.exec('echo "ok"');
      // Check that we got "ok" back (may have banner noise)
      return result.includes('ok');
    } catch (err) {
      this.logger.warn(`[ServiceRunner] Health check failed: ${err.message}`);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE METHODS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Upload job configuration to the remote instance
   *
   * @param {string} remotePath - Destination path for config.json
   * @param {object} config - Configuration object to serialize
   * @returns {Promise<void>}
   * @private
   */
  async _uploadJobConfig(remotePath, config) {
    const dirPath = remotePath.substring(0, remotePath.lastIndexOf('/'));
    const configJson = JSON.stringify(config, null, 2);

    // Create directory and write config in one command
    // Use heredoc to handle special characters in JSON
    const cmd = `mkdir -p "${dirPath}" && cat > "${remotePath}" << 'CONFIGEOF'
${configJson}
CONFIGEOF`;

    try {
      await this.sshTransport.exec(cmd);
      this.logger.info(`[ServiceRunner] Uploaded job config to ${remotePath}`);
    } catch (err) {
      throw new Error(`Failed to upload job config: ${err.message}`);
    }
  }

  /**
   * Run the job script with the given config
   *
   * @param {string} configPath - Remote path to config.json
   * @returns {Promise<string>} stdout from job execution
   * @private
   */
  async _runJob(configPath) {
    const cmd = `cd /workspace && python run_job.py --config "${configPath}"`;

    try {
      const output = await this.sshTransport.exec(cmd);
      return output;
    } catch (err) {
      // Extract any useful output from the error
      const errOutput = err.output || err.stderr || '';
      if (errOutput) {
        this.logger.warn(`[ServiceRunner] Job output before failure: ${errOutput.substring(0, 500)}`);
      }
      throw new Error(`Job execution failed with code ${err.code || 'unknown'}: ${err.message}`);
    }
  }
}

module.exports = ServiceRunner;
