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

  exec(command, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [...this.commonSshArgs, this.sshTarget, command];
      this.logger.info(`[SSH] ${command}`);
      const ssh = spawn('ssh', args, { stdio: options.stdio || 'inherit' });
      ssh.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SSH command failed with code ${code}`));
        }
      });
      ssh.on('error', reject);
    });
  }

  upload(localPath, remotePath, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [...this.commonSshArgs];
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
      const args = [...this.commonSshArgs];
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
