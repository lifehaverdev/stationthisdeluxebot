#!/usr/bin/env node
const minimist = require('minimist');
const path = require('path');
const os = require('os');
const fsp = require('fs').promises;
const { spawn } = require('child_process');
const DatasetPacker = require('../../src/core/services/training/DatasetPacker');
const { VastAIService } = require('../../src/core/services/vastai');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const { getVastAIConfig } = require('../../src/config/vastai');
const { renderConfig } = require('./render-config');

const DEFAULT_TEMPLATE = path.resolve(__dirname, '../../roadmap/vastai-gpu-training/configs/flux-lora-ai-toolkit.yml');
const LOCAL_JOBS_BASE = path.resolve(process.cwd(), '.stationthis', 'jobs');

const args = minimist(process.argv.slice(2), {
  string: [
    'datasetDir',
    'job',
    'template',
    'configOutput',
    'jobConfig',
    'stagingDir',
    'trigger',
    'modelName',
    'gpu',
    'region',
    'remoteDir',
    'maxPrice',
    'minVram',
    'steps',
    'disk',
    'bid',
    'key'
  ],
  boolean: ['exact', 'noShell'],
  alias: {
    d: 'datasetDir',
    j: 'job',
    g: 'gpu',
    r: 'region',
    t: 'template',
    s: 'steps',
    n: 'modelName',
    w: 'trigger',
    k: 'key'
  },
  default: {
    gpu: '4090'
  }
});

const legacyKeys = {
  datasetDir: 'dataset-dir',
  jobConfig: 'job-config',
  configOutput: 'config-output',
  stagingDir: 'staging-dir',
  modelName: 'model-name',
  remoteDir: 'remote-dir',
  maxPrice: 'max-price',
  minVram: 'min-vram',
  noShell: 'no-shell'
};

Object.entries(legacyKeys).forEach(([modernKey, legacyKey]) => {
  if (args[modernKey] === undefined && args[legacyKey] !== undefined) {
    args[modernKey] = args[legacyKey];
  }
});

function expandHome(p) {
  if (!p) return p;
  if (p === '~') {
    return os.homedir();
  }
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

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

function toNumber(value, label) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`Expected ${label} to be numeric`);
  }
  return num;
}

async function waitForRunningInstance(service, instanceId, { attempts = 60, intervalMs = 15000 } = {}) {
  if (!instanceId) {
    throw new Error('Unable to poll VastAI instance without an ID');
  }
  let attempt = 0;
  while (attempt < attempts) {
    const status = await service.getInstanceStatus(instanceId);
    console.log(
      `[VastAI] Instance ${status.instanceId} status=${status.status} ip=${status.publicIp || 'pending'} gpu=${status.gpuType}`
    );
    if (status.status === 'running' && status.publicIp) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    attempt += 1;
  }
  throw new Error('Instance did not become ready within the polling window');
}

async function openShell(ssh) {
  return new Promise((resolve, reject) => {
    const args = [...ssh.commonSshArgs, ssh.sshTarget];
    console.log('\n[local] Opening interactive SSH session (Ctrl-D to exit)...\n');
    const child = spawn('ssh', args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SSH session ended with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  if (!args.datasetDir) {
    throw new Error('Provide --dataset-dir pointing to the local dataset folder');
  }

  const overrides = args.key ? { sshKeyPath: path.resolve(expandHome(args.key)) } : {};
  const vastConfig = getVastAIConfig(overrides);
  const service = new VastAIService({ logger: console, config: overrides });

  const datasetDir = path.resolve(expandHome(args.datasetDir));
  const datasetExists = await pathExists(datasetDir);
  if (!datasetExists) {
    throw new Error(`Dataset directory not found: ${datasetDir}`);
  }

  const jobId = args.job || `session-${Date.now()}`;
  const remoteDir = args.remoteDir || `/opt/stationthis/jobs/${jobId}`;
  const steps = args.steps ? toNumber(args.steps, '--steps') : 4000;
  const triggerWord = args.trigger || jobId;
  const modelName = args.modelName || `${triggerWord}_fluxdev1_${steps}`;

  console.log(`[VastAI] Searching offers for GPU ${args.gpu || '4090'}...`);
  const offers = await service.searchOffers({
    gpuType: args.gpu,
    region: args.region,
    minVramGb: args.minVram ? toNumber(args.minVram, '--min-vram') : undefined,
    maxHourlyUsd: args.maxPrice ? toNumber(args.maxPrice, '--max-price') : undefined,
    useExactGpuMatch: args.exact
  });
  if (!offers.length) {
    throw new Error('No matching VastAI offers found. Adjust GPU filters.');
  }
  const offer = offers[0];
  console.log(`[VastAI] Renting offer ${offer.id} (${offer.gpuType} @ $${offer.hourlyUsd}/hr)`);
  const label = service.generateLabel({ jobId });

  let instance = await service.provisionInstance({
    offerId: offer.id,
    jobId,
    label,
    templateId: args.template,
    diskGb: args.disk ? toNumber(args.disk, '--disk') : undefined,
    priceUsdPerHour: args.bid ? toNumber(args.bid, '--bid') : undefined,
    gpuType: args.gpu
  });

  if (!instance.instanceId) {
    console.warn(`[VastAI] Provision response lacked instance ID. Retrying lookup via label ${label}...`);
    const lookupAttempts = 12;
    for (let i = 0; i < lookupAttempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const fallback = await service.findInstanceByLabel(label);
      if (fallback?.instanceId) {
        instance = fallback;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (!instance.instanceId) {
      throw new Error('Unable to poll VastAI instance without an ID');
    }
  }

  const readyInstance = await waitForRunningInstance(service, instance.instanceId);
  if (!readyInstance.publicIp) {
    throw new Error('Provisioned instance is running but no public IP was assigned');
  }

  console.log(`[VastAI] Instance ready at ${readyInstance.publicIp}:${readyInstance.sshPort || 22}`);

  const stagingBase = path.resolve(expandHome(args.stagingDir || LOCAL_JOBS_BASE));
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

  const templatePath = path.resolve(expandHome(args.template || DEFAULT_TEMPLATE));
  const configOutputPath = path.resolve(
    expandHome(args.configOutput || path.join(localJobRoot, 'config', path.basename(templatePath)))
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
    ? path.resolve(expandHome(args.jobConfig))
    : path.join(localJobRoot, 'config', 'job.json');
  const hasJobJson = await pathExists(jobConfigPath);
  if (!hasJobJson) {
    console.warn(`job.json not found at ${jobConfigPath}. Continuing without uploading job metadata.`);
  }

  const sshKeyPath = vastConfig.sshKeyPath;
  if (!sshKeyPath) {
    throw new Error('VASTAI_SSH_KEY_PATH is required to open SSH/SCP sessions');
  }

  const ssh = new SshTransport({
    host: readyInstance.publicIp,
    port: readyInstance.sshPort || 22,
    username: readyInstance.sshUser || 'root',
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

  console.log('\nRemote job root ready:');
  console.log(`  Instance    : ${readyInstance.instanceId}`);
  console.log(`  Remote path : ${remoteDir}`);
  console.log(`  Dataset     : ${remoteDir}/dataset`);
  console.log(`  Config      : ${remoteConfigPath}`);
  if (hasJobJson) {
    console.log(`  Job JSON    : ${remoteDir}/config/job.json`);
  }
  console.log(`  Trigger word: ${triggerWord}`);
  console.log(`  Model name  : ${modelName}`);

  if (args.noShell) {
    console.log('\nSkipping interactive shell (requested via --no-shell).');
    return;
  }

  await openShell(ssh);
}

main().catch((error) => {
  console.error('launch-session failed:', error.message);
  process.exit(1);
});
