#!/usr/bin/env node
const minimist = require('minimist');
const path = require('path');
const DatasetPacker = require('../../src/core/services/training/DatasetPacker');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const { getVastAIConfig } = require('../../src/config/vastai');

const args = minimist(process.argv.slice(2), {
  string: ['datasetDir', 'job', 'host', 'user', 'remoteDir', 'key', 'port'],
  alias: {
    d: 'datasetDir',
    j: 'job',
    h: 'host',
    u: 'user',
    r: 'remoteDir',
    k: 'key',
    p: 'port'
  },
  default: {
    user: 'root'
  }
});

async function main() {
  if (!args.datasetDir) {
    throw new Error('Provide --dataset-dir pointing to the local dataset folder');
  }
  if (!args.host) {
    throw new Error('Provide --host for the remote VastAI instance');
  }

  const jobId = args.job || `manual-${Date.now()}`;
  const config = getVastAIConfig();
  const sshKeyPath = args.key || config.sshKeyPath;
  if (!sshKeyPath) {
    throw new Error('Set --key or VASTAI_SSH_KEY_PATH for SSH authentication');
  }

  const packer = new DatasetPacker({ logger: console });
  const { archivePath, manifestPath } = await packer.pack({
    jobId,
    datasetDir: path.resolve(args.datasetDir)
  });

  const remoteDir = args.remoteDir || `/opt/stationthis/jobs/${jobId}`;
  const ssh = new SshTransport({
    host: args.host,
    port: args.port ? Number(args.port) : 22,
    username: args.user,
    privateKeyPath: sshKeyPath,
    logger: console
  });

  await ssh.exec(`mkdir -p ${remoteDir} ${remoteDir}/dataset`);
  await ssh.upload(archivePath, `${remoteDir}/dataset.tar.gz`);
  await ssh.upload(manifestPath, `${remoteDir}/dataset_manifest.json`);
  await ssh.exec(`tar -xzf ${remoteDir}/dataset.tar.gz -C ${remoteDir}/dataset`);
  console.log(`Dataset pushed to ${remoteDir}/dataset`);
}

main().catch((error) => {
  console.error('Dataset transfer failed:', error.message);
  process.exit(1);
});
