#!/usr/bin/env node
const minimist = require('minimist');
const path = require('path');
const fsp = require('fs').promises;
const SshTransport = require('../../src/core/services/remote/SshTransport');
const { getVastAIConfig } = require('../../src/config/vastai');

const args = minimist(process.argv.slice(2), {
  string: ['job', 'host', 'user', 'remoteDir', 'key', 'port', 'dest'],
  alias: {
    j: 'job',
    h: 'host',
    u: 'user',
    r: 'remoteDir',
    k: 'key',
    p: 'port',
    d: 'dest'
  },
  default: {
    user: 'root'
  }
});

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function main() {
  if (!args.host) {
    throw new Error('Provide --host for the VastAI instance you want to copy from');
  }

  const jobId = args.job || 'manual';
  const remoteDir = args.remoteDir || `/opt/stationthis/jobs/${jobId}`;
  const localBase = path.resolve(
    args.dest || path.join(process.cwd(), '.stationthis', 'jobs', jobId, 'pulled-dataset')
  );
  await ensureDir(localBase);

  const config = getVastAIConfig();
  const sshKeyPath = args.key || config.sshKeyPath;
  if (!sshKeyPath) {
    throw new Error('Set --key or VASTAI_SSH_KEY_PATH for SSH authentication');
  }

  const ssh = new SshTransport({
    host: args.host,
    port: args.port ? Number(args.port) : 22,
    username: args.user,
    privateKeyPath: sshKeyPath,
    logger: console
  });

  const remoteDatasetPath = `${remoteDir}/dataset`;
  await ssh.exec(`test -d ${remoteDatasetPath}`);

  await ssh.download(remoteDatasetPath, localBase, { recursive: true });
  const manifestLocalPath = path.join(localBase, 'dataset_manifest.json');
  await ssh.download(`${remoteDir}/dataset_manifest.json`, manifestLocalPath);

  console.log('Dataset pulled to:');
  console.log(`  ${path.join(localBase, 'dataset')}`);
  console.log(`  Manifest: ${manifestLocalPath}`);
}

main().catch((error) => {
  console.error('Dataset pull failed:', error.message);
  process.exit(1);
});
