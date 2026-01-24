#!/usr/bin/env node
/**
 * launch-session.js - VastAI GPU Training Session Launcher
 *
 * PURPOSE:
 *   One-shot CLI tool that provisions a VastAI GPU instance, uploads a dataset
 *   and training config, then optionally drops you into an interactive SSH session.
 *   This is a stepping stone toward automated training - useful for manual testing
 *   and validating the full provision→upload→execute flow.
 *
 * WHAT IT DOES:
 *   1. Searches VastAI for available GPU offers matching criteria
 *   2. Rents an instance (with retry logic for snatched offers)
 *   3. Waits for instance to be fully SSH-ready (multi-stage process)
 *   4. Packs local dataset into tarball with manifest
 *   5. Uploads dataset + training config via SCP
 *   6. Extracts dataset on remote machine
 *   7. Opens interactive SSH shell (unless --noShell)
 *
 * USAGE:
 *   ./run-with-env.sh node scripts/vastai/launch-session.js \
 *     --datasetDir .stationthis/datasets/mydata/ \
 *     --region US \
 *     --gpu 4090 \
 *     --steps 4000 \
 *     --trigger mytrigger
 *
 * KEY LEARNINGS (discovered through debugging):
 *   - VastAI API field names are inconsistent (see VastAIService.js comments)
 *   - SSH uses proxy hosts (ssh2.vast.ai) not direct IPs
 *   - Instance "running" != SSH ready; need TCP probe + auth delay
 *   - Popular offers get snatched; must retry multiple offers
 *   - SCP uses -P (uppercase) for port, SSH uses -p (lowercase)
 *
 * SEE ALSO:
 *   - src/core/services/vastai/notes/progress.md for debugging notes
 *   - src/core/services/vastai/VastAIService.js for API normalization
 *   - src/core/services/remote/SshTransport.js for SSH/SCP wrapper
 *   - src/core/services/vastai/configs/ for training config templates
 */
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

// Default ai-toolkit config template - lives with VastAI service
const DEFAULT_TEMPLATE = path.resolve(__dirname, '../../src/core/services/vastai/configs/flux-lora-ai-toolkit.yml');

// Local staging area for job artifacts before upload
const LOCAL_JOBS_BASE = path.resolve(process.cwd(), '.stationthis', 'jobs');

/**
 * CLI Arguments:
 *   --datasetDir, -d  : (required) Path to local dataset folder with images + .txt captions
 *   --job, -j         : Job ID (default: session-<timestamp>)
 *   --template, -t    : Path to ai-toolkit config template (default: flux-lora-ai-toolkit.yml)
 *   --configOutput    : Where to write rendered config locally
 *   --jobConfig       : Path to job.json if exists
 *   --stagingDir      : Local staging directory (default: .stationthis/jobs/)
 *   --trigger, -w     : Trigger word for LoRA (default: job ID)
 *   --modelName, -n   : Output model name (default: <trigger>_fluxdev1_<steps>)
 *   --gpu, -g         : GPU type filter (default: "4090")
 *   --region, -r      : Region filter (e.g., "US", "EU")
 *   --remoteDir       : Remote job root (default: /opt/stationthis/jobs/<jobId>)
 *   --maxPrice        : Max hourly price in USD
 *   --minVram         : Minimum VRAM in GB
 *   --steps, -s       : Training steps (default: 4000)
 *   --disk            : Disk space in GB for instance
 *   --bid             : Bid price for interruptible instances
 *   --key, -k         : Path to SSH private key (overrides VASTAI_SSH_KEY_PATH)
 *   --exact           : Use exact GPU match (not substring)
 *   --noShell         : Skip interactive shell at the end
 */
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

/**
 * Poll VastAI until instance reaches "running" state with an assigned IP.
 *
 * IMPORTANT: "running" status does NOT mean SSH is ready!
 * VastAI instances go through: QUEUED → PROVISIONING → running
 * Even after "running", SSH may not be available for 30-60+ seconds.
 *
 * @param {VastAIService} service - VastAI service instance
 * @param {string} instanceId - Instance ID to poll
 * @param {object} options - Polling options
 * @returns {object} Instance status with sshHost, sshPort, etc.
 */
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

/**
 * Wait for SSH port to accept TCP connections.
 *
 * CRITICAL TIMING NOTE:
 * VastAI SSH readiness has multiple stages:
 *   1. Instance status = "running" (doesn't mean SSH works)
 *   2. SSH port opens for TCP (this function detects this)
 *   3. SSH auth is ready (keys propagated) - can take 10-20 more seconds!
 *
 * After this function returns true, you should STILL wait ~15 seconds
 * before attempting SSH commands, or use retry logic on first command.
 *
 * We use raw TCP socket probe instead of ssh command to:
 *   - Avoid "Connection refused" noise in logs
 *   - Detect port availability faster than SSH handshake timeout
 *   - Not trigger SSH auth failures that could lock us out
 *
 * @param {string} host - SSH host (e.g., ssh2.vast.ai)
 * @param {number} port - SSH port (varies per instance)
 * @param {object} options - Polling options
 * @returns {boolean} true when port is open
 */
async function waitForSsh(host, port, { attempts = 20, intervalMs = 5000 } = {}) {
  const net = require('net');
  for (let i = 0; i < attempts; i += 1) {
    const connected = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
    if (connected) {
      return true;
    }
    if (i < attempts - 1) {
      console.log(`[VastAI] Waiting for SSH to be ready... (${i + 1}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`SSH at ${host}:${port} did not become available`);
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

/**
 * Main execution flow:
 *
 *   ┌─────────────────────┐
 *   │ 1. Validate inputs  │ Check dataset exists, parse args
 *   └─────────┬───────────┘
 *             ▼
 *   ┌─────────────────────┐
 *   │ 2. Search offers    │ Find GPUs matching criteria (region, type, price)
 *   └─────────┬───────────┘
 *             ▼
 *   ┌─────────────────────┐
 *   │ 3. Provision        │ Try offers until one succeeds (handles snatching)
 *   └─────────┬───────────┘
 *             ▼
 *   ┌─────────────────────┐
 *   │ 4. Wait for ready   │ Poll until running, then TCP probe SSH port
 *   └─────────┬───────────┘
 *             ▼
 *   ┌─────────────────────┐
 *   │ 5. Pack dataset     │ Create tarball with images + manifest
 *   └─────────┬───────────┘
 *             ▼
 *   ┌─────────────────────┐
 *   │ 6. Upload & extract │ SCP files, extract on remote
 *   └─────────┬───────────┘
 *             ▼
 *   ┌─────────────────────┐
 *   │ 7. Interactive SSH  │ Drop into shell (unless --noShell)
 *   └─────────────────────┘
 */
async function main() {
  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Validate inputs and initialize service
  // ════════════════════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Search for available GPU offers
  // ════════════════════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 3: Provision instance (with retry for snatched offers)
  // ════════════════════════════════════════════════════════════════════════════
  // VastAI offers are first-come-first-served. Between searching and renting,
  // another user may grab the offer. We try up to 5 offers before giving up.
  const label = service.generateLabel({ jobId });
  let instance = null;
  let lastError = null;
  const maxOfferAttempts = Math.min(offers.length, 5);
  for (let i = 0; i < maxOfferAttempts; i += 1) {
    const offer = offers[i];
    console.log(`[VastAI] Trying offer ${offer.id} (${offer.gpuType} @ $${offer.hourlyUsd}/hr)...`);
    try {
      instance = await service.provisionInstance({
        offerId: offer.id,
        jobId,
        label,
        templateId: args.template,
        diskGb: args.disk ? toNumber(args.disk, '--disk') : undefined,
        priceUsdPerHour: args.bid ? toNumber(args.bid, '--bid') : undefined,
        gpuType: args.gpu
      });
      if (instance.instanceId) {
        console.log(`[VastAI] Successfully rented offer ${offer.id}`);
        break;
      }
    } catch (err) {
      lastError = err;
      const isUnavailable = err.message?.includes('no_such_ask') || err.message?.includes('not available');
      if (isUnavailable && i < maxOfferAttempts - 1) {
        console.log(`[VastAI] Offer ${offer.id} unavailable, trying next...`);
        continue;
      }
      throw err;
    }
  }

  if (!instance?.instanceId && lastError) {
    throw lastError;
  }

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

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 4: Wait for instance to be fully SSH-ready
  // ════════════════════════════════════════════════════════════════════════════
  // This is a multi-stage wait:
  //   1. Poll API until status="running" and IP assigned
  //   2. TCP probe until SSH port accepts connections
  //   3. Additional delay for SSH key propagation (VastAI quirk)
  const readyInstance = await waitForRunningInstance(service, instance.instanceId);

  // VastAI routes SSH through proxy hosts (e.g., ssh9.vast.ai:12345) rather than
  // direct IP. The sshHost field contains this proxy address. Direct IP may work
  // but is less reliable.
  const sshEndpoint = readyInstance.sshHost || readyInstance.publicIp;
  if (!sshEndpoint) {
    throw new Error('Provisioned instance is running but no SSH endpoint was assigned');
  }

  console.log(`[VastAI] Instance ready at ${sshEndpoint}:${readyInstance.sshPort || 22}`);

  // Wait for SSH port to accept TCP connections
  await waitForSsh(sshEndpoint, readyInstance.sshPort || 22);

  // CRITICAL: Even after SSH port opens, VastAI needs time to propagate the SSH key
  // to the instance. Without this delay, you get "Permission denied (publickey)".
  // 15 seconds is conservative but reliable. First SSH command also has retry logic.
  console.log('[VastAI] SSH port open, waiting for auth setup...');
  await new Promise((resolve) => setTimeout(resolve, 15000));
  console.log('[VastAI] SSH should be ready');

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 5: Pack dataset locally
  // ════════════════════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 6: Upload files and extract dataset on remote
  // ════════════════════════════════════════════════════════════════════════════
  const sshKeyPath = vastConfig.sshKeyPath;
  if (!sshKeyPath) {
    throw new Error('VASTAI_SSH_KEY_PATH is required to open SSH/SCP sessions');
  }

  const ssh = new SshTransport({
    host: sshEndpoint,
    port: readyInstance.sshPort || 22,
    username: readyInstance.sshUser || 'root',
    privateKeyPath: sshKeyPath,
    logger: console
  });

  // First SSH command may fail even after all our waiting, so we retry with backoff.
  // This handles the edge case where VastAI's key propagation takes longer than expected.
  const mkdirCmd = `mkdir -p ${remoteDir} ${remoteDir}/config ${remoteDir}/dataset ${remoteDir}/logs ${remoteDir}/output ${remoteDir}/scripts`;
  let sshSuccess = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await ssh.exec(mkdirCmd);
      sshSuccess = true;
      break;
    } catch (err) {
      const isAuthError = err.message?.includes('Permission denied') || err.message?.includes('code 255');
      if (isAuthError && attempt < 4) {
        const waitSec = (attempt + 1) * 10;
        console.log(`[VastAI] SSH auth failed, retrying in ${waitSec}s... (${attempt + 1}/5)`);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
        continue;
      }
      throw err;
    }
  }
  if (!sshSuccess) {
    throw new Error('SSH authentication failed after multiple retries');
  }

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
