#!/usr/bin/env node
const minimist = require('minimist');
const path = require('path');
const fsp = require('fs').promises;
const DatasetPacker = require('../../src/core/services/training/DatasetPacker');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const { getVastAIConfig } = require('../../src/config/vastai');
const { renderConfig } = require('./render-config');

const DEFAULT_TEMPLATE = path.resolve(__dirname, '../../roadmap/vastai-gpu-training/configs/flux-lora-ai-toolkit.yml');
const LOCAL_JOBS_BASE = path.resolve(process.cwd(), '.stationthis', 'jobs');

const args = minimist(process.argv.slice(2), {
  string: [
    'datasetDir',
    'job',
    'host',
    'user',
    'remoteDir',
    'key',
    'port',
    'template',
    'configOutput',
    'jobConfig',
    'stagingDir',
    'trigger',
    'modelName',
    'steps'
  ],
  alias: {
    d: 'datasetDir',
    j: 'job',
    h: 'host',
    u: 'user',
    r: 'remoteDir',
    k: 'key',
    p: 'port',
    t: 'template',
    w: 'trigger',
    n: 'modelName',
    s: 'steps'
  },
  default: {
    user: 'root'
  }
});

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function main() {
  if (!args.datasetDir) {
    throw new Error('Provide --dataset-dir pointing to the local dataset folder');
  }
  if (!args.host) {
    throw new Error('Provide --host for the remote VastAI instance');
  }

  const datasetDir = path.resolve(args.datasetDir);
  const datasetExists = await pathExists(datasetDir);
  if (!datasetExists) {
    throw new Error(`Dataset directory not found: ${datasetDir}`);
  }

  const jobId = args.job || `manual-${Date.now()}`;
  const remoteDir = args.remoteDir || `/opt/stationthis/jobs/${jobId}`;
  const steps = args.steps ? Number(args.steps) : 4000;
  if (Number.isNaN(steps)) {
    throw new Error('Provide a numeric value for --steps');
  }
  const triggerWord = args.trigger || jobId;
  const modelName = args.modelName || `${triggerWord}_fluxdev1_${steps}`;

  const config = getVastAIConfig();
  const sshKeyPath = args.key || config.sshKeyPath;
  if (!sshKeyPath) {
    throw new Error('Set --key or VASTAI_SSH_KEY_PATH for SSH authentication');
  }

  const stagingBase = path.resolve(args.stagingDir || LOCAL_JOBS_BASE);
  const localJobRoot = path.join(stagingBase, jobId);
  await ensureDir(localJobRoot);

  const packer = new DatasetPacker({ logger: console });
  const transferDir = path.join(localJobRoot, 'transfer');
  await ensureDir(transferDir);
  const { archivePath, manifestPath } = await packer.pack({
    jobId,
    datasetDir,
    outputDir: transferDir
  });

  const templatePath = path.resolve(args.template || DEFAULT_TEMPLATE);
  const configOutputPath = path.resolve(
    args.configOutput || path.join(localJobRoot, 'config', path.basename(templatePath))
  );
  await renderConfig({
    templatePath,
    outputPath: configOutputPath,
    variables: {
      JOB_ROOT: remoteDir,
      OUTPUT_DIR: `${remoteDir}/output`,
      DATASET_PATH: `${remoteDir}/dataset`,
      TRIGGER_WORD: triggerWord,
      MODEL_NAME: modelName,
      TRAIN_STEPS: String(steps)
    }
  });

  const jobConfigPath = args.jobConfig
    ? path.resolve(args.jobConfig)
    : path.join(localJobRoot, 'config', 'job.json');
  const hasJobJson = await pathExists(jobConfigPath);
  if (!hasJobJson) {
    console.warn(`job.json not found at ${jobConfigPath}. Continuing without uploading job metadata.`);
  }

  const ssh = new SshTransport({
    host: args.host,
    port: args.port ? Number(args.port) : 22,
    username: args.user,
    privateKeyPath: sshKeyPath,
    logger: console
  });

  await ssh.exec(
    `mkdir -p ${remoteDir} ${remoteDir}/config ${remoteDir}/dataset ${remoteDir}/logs ${remoteDir}/output ${remoteDir}/scripts`
  );

  const remoteArchivePath = `${remoteDir}/dataset.tar.gz`;
  await ssh.upload(archivePath, remoteArchivePath);
  await ssh.upload(manifestPath, `${remoteDir}/dataset_manifest.json`);
  await ssh.exec(
    `cd ${remoteDir} && rm -rf dataset && mkdir -p dataset && tar -xzf dataset.tar.gz -C dataset && rm -f dataset.tar.gz`
  );

  const remoteConfigPath = `${remoteDir}/config/${path.basename(configOutputPath)}`;
  await ssh.upload(configOutputPath, remoteConfigPath);
  if (hasJobJson) {
    await ssh.upload(jobConfigPath, `${remoteDir}/config/job.json`);
  }

  await ssh.exec(`printf '%s' '${remoteDir}' > ${remoteDir}/JOB_ROOT`);

  console.log('Remote job root ready:');
  console.log(`  Remote path : ${remoteDir}`);
  console.log(`  Dataset     : ${remoteDir}/dataset`);
  console.log(`  Config      : ${remoteConfigPath}`);
  if (hasJobJson) {
    console.log(`  Job JSON    : ${remoteDir}/config/job.json`);
  }
  console.log(`  Trigger word: ${triggerWord}`);
  console.log(`  Model name  : ${modelName}`);
}

main().catch((error) => {
  console.error('Dataset transfer failed:', error.message);
  process.exit(1);
});
