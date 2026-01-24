/**
 * SshTransport - Lightweight wrapper for SSH/SCP operations
 *
 * USED BY: VastAI GPU rental system (src/core/services/vastai/)
 * SEE ALSO: src/core/services/vastai/notes/ for documentation
 *
 * Uses the system's ssh/scp binaries (not node ssh2 library) to:
 *   - Execute commands on remote hosts
 *   - Upload files via SCP
 *   - Download files via SCP
 *
 * IMPORTANT NOTES:
 *
 * 1. SSH vs SCP PORT FLAGS
 *    SSH uses lowercase -p for port: ssh -p 12345
 *    SCP uses UPPERCASE -P for port: scp -P 12345
 *    This is a common source of bugs! We have separate commonSshArgs and
 *    commonScpArgs getters to handle this correctly.
 *
 * 2. VASTAI SSH ROUTING
 *    VastAI routes SSH through proxy hosts (e.g., ssh2.vast.ai:12345)
 *    rather than direct IP connections. When using with VastAI, pass
 *    the sshHost (not publicIp) from the instance status.
 *
 * 3. HOST KEY CHECKING
 *    We disable strict host key checking since VastAI instances are
 *    ephemeral and we'd constantly be adding new keys. This is appropriate
 *    for rental compute but should be reconsidered for persistent servers.
 *
 * 4. STDIO HANDLING
 *    Commands run with stdio: 'inherit' by default, which streams output
 *    to the console. Pass { stdio: 'pipe' } to capture output instead.
 *
 * @example
 * const ssh = new SshTransport({
 *   host: 'ssh2.vast.ai',
 *   port: 12345,
 *   username: 'root',
 *   privateKeyPath: '/path/to/key'
 * });
 *
 * await ssh.exec('mkdir -p /opt/myapp');
 * await ssh.upload('./data.tar.gz', '/opt/myapp/data.tar.gz');
 * await ssh.download('/opt/myapp/output.log', './output.log');
 */
const fs = require('fs');
const { spawn } = require('child_process');

class SshTransport {
  constructor({ host, port = 22, username = 'root', privateKeyPath, logger } = {}) {
    if (!host) {
      throw new Error('SshTransport requires host');
    }
    if (!privateKeyPath) {
      throw new Error('SshTransport requires privateKeyPath');
    }
    if (!fs.existsSync(privateKeyPath)) {
      throw new Error(`SSH private key not found at ${privateKeyPath}`);
    }

    this.host = host;
    this.port = port;
    this.username = username;
    this.privateKeyPath = privateKeyPath;
    this.logger = logger || console;
  }

  get sshTarget() {
    return `${this.username}@${this.host}`;
  }

  get commonSshArgs() {
    return [
      '-i',
      this.privateKeyPath,
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-p',
      String(this.port)
    ];
  }

  get commonScpArgs() {
    return [
      '-i',
      this.privateKeyPath,
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-P',  // SCP uses uppercase -P for port
      String(this.port)
    ];
  }

  /**
   * Execute a command on the remote host
   *
   * @param {string} command - Command to execute
   * @param {object} options
   * @param {string} options.stdio - 'inherit' streams to console, 'pipe' captures output
   * @param {number} options.timeout - Timeout in milliseconds
   * @returns {Promise<string|undefined>} Output if stdio='pipe', undefined otherwise
   */
  exec(command, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [...this.commonSshArgs, this.sshTarget, command];
      this.logger.info(`[SSH] ${command}`);

      // Default to 'pipe' to capture output for programmatic use
      const stdio = options.stdio || 'pipe';
      const ssh = spawn('ssh', args, { stdio });

      let stdout = '';
      let stderr = '';

      if (stdio === 'pipe') {
        ssh.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        ssh.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      // Handle timeout if specified
      let timeoutId = null;
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          ssh.kill('SIGTERM');
          reject(new Error(`SSH command timed out after ${options.timeout}ms`));
        }, options.timeout);
      }

      ssh.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Log output if verbose
        if (stdout && this.logger.debug) {
          this.logger.debug(`[SSH stdout] ${stdout.substring(0, 500)}`);
        }

        if (code === 0) {
          // Return captured output if using pipe mode
          resolve(stdio === 'pipe' ? stdout : undefined);
        } else {
          const error = new Error(`SSH command failed with code ${code}`);
          error.code = code;
          error.output = stdout;
          error.stderr = stderr;
          reject(error);
        }
      });
      ssh.on('error', (err) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(err);
      });
    });
  }

  upload(localPath, remotePath, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [...this.commonScpArgs];
      if (options.recursive) {
        args.push('-r');
      }
      args.push(localPath, `${this.sshTarget}:${remotePath}`);
      this.logger.info(`[SCP] ${localPath} -> ${remotePath}`);
      const scp = spawn('scp', args, { stdio: options.stdio || 'inherit' });
      scp.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SCP failed with code ${code}`));
        }
      });
      scp.on('error', reject);
    });
  }

  download(remotePath, localPath, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [...this.commonScpArgs];
      if (options.recursive) {
        args.push('-r');
      }
      args.push(`${this.sshTarget}:${remotePath}`, localPath);
      this.logger.info(`[SCP] ${remotePath} -> ${localPath}`);
      const scp = spawn('scp', args, { stdio: options.stdio || 'inherit' });
      scp.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SCP download failed with code ${code}`));
        }
      });
      scp.on('error', reject);
    });
  }
}

module.exports = SshTransport;
