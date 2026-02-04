#!/usr/bin/env node
/**
 * launch-training.js - VastAI Remote Training Launcher
 *
 * PURPOSE:
 *   Provision a VastAI GPU, upload dataset and config, then execute training.
 *   This extends launch-session.js to actually run training instead of dropping
 *   into an interactive shell.
 *
 * WHAT IT DOES:
 *   1. Provisions a VastAI GPU instance (with retry for snatched offers)
 *   2. Waits for SSH to be fully ready
 *   3. Uploads dataset tarball + training config
 *   4. (Optional) Creates HuggingFace repo + generates model card
 *   5. Starts training via ai-toolkit
 *   6. Captures and parses output for progress information
 *   7. Reports training results (success/failure, final loss, checkpoints)
 *   8. (Optional) Downloads artifacts and uploads to HuggingFace
 *
 * MODES:
 *   --foreground (default): Run training synchronously, stream output
 *   --background: Start training and exit immediately (use --status to check)
 *   --status: Check status of a running background training job
 *   --watch: Real-time monitoring with stall detection (use with --background)
 *
 * UPLOAD OPTIONS (mutually exclusive):
 *
 *   --hfUpload: Upload to HuggingFace (PUBLIC models)
 *     --hfOrg: HuggingFace organization (default: ms2stationthis)
 *     - Before training: Creates HF repo, generates README from dataset captions
 *     - After training: Uploads safetensors + samples to HF repo
 *     - Requires: HF_TOKEN env var, OPENAI_API for description generation (optional)
 *
 *   --r2Upload: Upload to Cloudflare R2 (PRIVATE models)
 *     - After training: Uploads safetensors to R2 via presigned URL
 *     - Model accessible at miladystation2.net but not publicly listed
 *     - Requires: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 *   If neither flag is set, training completes but model stays on remote instance
 *   (useful for testing or manual retrieval before termination)
 *
 * USAGE:
 *   # Start training (foreground, will wait for completion)
 *   ./run-with-env.sh node scripts/vastai/launch-training.js \
 *     --datasetDir .stationthis/datasets/mydata/ \
 *     --region US \
 *     --gpu 4090 \
 *     --steps 2000
 *
 *   # Training with auto HuggingFace upload
 *   ./run-with-env.sh node scripts/vastai/launch-training.js \
 *     --datasetDir .stationthis/datasets/mydata/ \
 *     --trigger pepe --modelName pepeflux \
 *     --steps 2000 --hfUpload
 *
 *   # Start in background and exit
 *   ./run-with-env.sh node scripts/vastai/launch-training.js \
 *     --datasetDir .stationthis/datasets/mydata/ \
 *     --background
 *
 *   # Check status of running job
 *   ./run-with-env.sh node scripts/vastai/launch-training.js \
 *     --status --instanceId 12345 --jobRoot /opt/stationthis/jobs/job-123
 *
 *   # Watch a running job with stall detection
 *   ./run-with-env.sh node scripts/vastai/launch-training.js \
 *     --watch --instanceId 12345 --jobRoot /opt/stationthis/jobs/job-123
 *
 * SEE ALSO:
 *   - src/core/services/vastai/TrainingRunner.js for training execution
 *   - src/core/services/vastai/TrainingOutputParser.js for log parsing
 *   - src/core/services/training/ModelCardGenerator.js for README generation
 *   - src/core/services/huggingface/HuggingFaceHubService.js for HF uploads
 *   - scripts/vastai/launch-session.js for the base provisioning flow
 */
const minimist = require('minimist');
const path = require('path');
const os = require('os');
const fsp = require('fs').promises;
const DatasetPacker = require('../../src/core/services/training/DatasetPacker');
const { VastAIService } = require('../../src/core/services/vastai');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const TrainingRunner = require('../../src/core/services/vastai/TrainingRunner');
const TrainingMonitor = require('../../src/core/services/vastai/TrainingMonitor');
const { getVastAIConfig } = require('../../src/config/vastai');
const { renderConfig } = require('./render-config');

// HuggingFace integration
const ModelCardGenerator = require('../../src/core/services/training/ModelCardGenerator');
const HuggingFaceHubService = require('../../src/core/services/huggingface/HuggingFaceHubService');
const OpenAIService = require('../../src/core/services/openai/openaiService');

// Cloudflare R2 integration (for private models)
const StorageService = require('../../src/core/services/storageService');

// Default ai-toolkit config templates
const DEFAULT_TEMPLATE = path.resolve(__dirname, '../../src/core/services/vastai/configs/flux-lora-24gb-aitoolkit.yaml');
const KONTEXT_TEMPLATE = path.resolve(__dirname, '../../src/core/services/vastai/configs/flux-kontext-24gb-aitoolkit.yaml');

// Default Docker image with ai-toolkit pre-installed (10.2GB, saves ~15min setup)
// Note: Docker image is "ostris/aitoolkit" (no hyphen), GitHub repo is "ai-toolkit" (hyphen)
const DEFAULT_IMAGE = 'ostris/aitoolkit';

// Local staging area for job artifacts (use /tmp in production, .stationthis in dev)
const LOCAL_JOBS_BASE = process.env.TRAINING_JOBS_DIR
  || path.resolve(os.tmpdir(), 'training', 'jobs');

const args = minimist(process.argv.slice(2), {
  string: [
    'datasetDir',
    'controlDir',    // KONTEXT concept mode: directory with control images
    'trainingMode',  // KONTEXT: 'style_subject' or 'concept'
    'baseModel',     // Model type: 'FLUX', 'KONTEXT', etc.
    'job',
    'template',
    'configOutput',
    'jobConfig',
    'stagingDir',
    'trigger',
    'modelName',
    'description',
    'gpu',
    'region',
    'remoteDir',
    'maxPrice',
    'minVram',
    'steps',
    'disk',
    'bid',
    'key',
    'instanceId',
    'jobRoot',
    'timeout',
    'image',
    'gracePeriod',
    'pollInterval',
    'sshTimeout',
    'hfOrg'
  ],
  boolean: ['exact', 'background', 'status', 'watch', 'noTerminate', 'dryRun', 'verbose', 'hfUpload', 'r2Upload'],
  alias: {
    d: 'datasetDir',
    j: 'job',
    g: 'gpu',
    r: 'region',
    t: 'template',
    s: 'steps',
    n: 'modelName',
    w: 'trigger',
    k: 'key',
    v: 'verbose'
  },
  default: {
    gpu: '4090',
    steps: '2000'
  }
});

// Legacy kebab-case support
const legacyKeys = {
  datasetDir: 'dataset-dir',
  jobConfig: 'job-config',
  configOutput: 'config-output',
  stagingDir: 'staging-dir',
  modelName: 'model-name',
  remoteDir: 'remote-dir',
  maxPrice: 'max-price',
  minVram: 'min-vram',
  noTerminate: 'no-terminate',
  dryRun: 'dry-run',
  instanceId: 'instance-id',
  jobRoot: 'job-root'
};

Object.entries(legacyKeys).forEach(([modernKey, legacyKey]) => {
  if (args[modernKey] === undefined && args[legacyKey] !== undefined) {
    args[modernKey] = args[legacyKey];
  }
});

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
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

function log(msg) {
  console.log(`[launch-training] ${msg}`);
}

function logVerbose(msg) {
  if (args.verbose) {
    console.log(`[launch-training] ${msg}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PROVISIONING HELPERS (reused from launch-session.js)
// ════════════════════════════════════════════════════════════════════════════════

async function waitForRunningInstance(service, instanceId, { attempts = 60, intervalMs = 15000 } = {}) {
  if (!instanceId) {
    throw new Error('Unable to poll VastAI instance without an ID');
  }
  let attempt = 0;
  while (attempt < attempts) {
    const status = await service.getInstanceStatus(instanceId);
    log(`Instance ${status.instanceId} status=${status.status} ip=${status.publicIp || 'pending'} gpu=${status.gpuType}`);
    if (status.status === 'running' && status.publicIp) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    attempt += 1;
  }
  throw new Error('Instance did not become ready within the polling window');
}

async function waitForSsh(host, port, { attempts = 60, intervalMs = 5000 } = {}) {
  const net = require('net');
  for (let i = 0; i < attempts; i += 1) {
    const connected = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });
    if (connected) return true;
    if (i < attempts - 1) {
      log(`Waiting for SSH to be ready... (${i + 1}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`SSH at ${host}:${port} did not become available`);
}

// ════════════════════════════════════════════════════════════════════════════════
// STATUS CHECK MODE
// ════════════════════════════════════════════════════════════════════════════════

async function checkStatus() {
  if (!args.instanceId || !args.jobRoot) {
    throw new Error('--status requires --instanceId and --jobRoot');
  }

  const overrides = args.key ? { sshKeyPath: path.resolve(expandHome(args.key)) } : {};
  const vastConfig = getVastAIConfig(overrides);
  const service = new VastAIService({ logger: console, config: overrides });

  // Get instance status
  const instance = await service.getInstanceStatus(args.instanceId);
  log(`Instance ${instance.instanceId}: status=${instance.status}, gpu=${instance.gpuType}`);

  if (instance.status !== 'running') {
    log('Instance is not running');
    return;
  }

  // Connect via SSH
  const sshEndpoint = instance.sshHost || instance.publicIp;
  const ssh = new SshTransport({
    host: sshEndpoint,
    port: instance.sshPort || 22,
    username: instance.sshUser || 'root',
    privateKeyPath: vastConfig.sshKeyPath,
    logger: args.verbose ? console : null
  });

  const runner = new TrainingRunner({ ssh, logger: console });
  const jobRoot = args.jobRoot;

  const status = await runner.getTrainingStatus({
    logFile: `${jobRoot}/logs/training.log`,
    pidFile: `${jobRoot}/training.pid`,
    statusFile: `${jobRoot}/training_status.json`,
    tailLines: 50
  });

  console.log('\n' + '═'.repeat(60));
  console.log('  TRAINING STATUS');
  console.log('═'.repeat(60));
  console.log(`  Running:    ${status.isRunning ? 'YES' : 'NO'}`);

  if (status.parsed.lastStep !== null) {
    const progress = status.parsed.totalSteps
      ? `${status.parsed.lastStep}/${status.parsed.totalSteps} (${status.parsed.progressPercent?.toFixed(1)}%)`
      : `${status.parsed.lastStep}`;
    console.log(`  Progress:   Step ${progress}`);
  }

  if (status.parsed.lastLoss !== null) {
    console.log(`  Last Loss:  ${status.parsed.lastLoss.toFixed(6)}`);
  }

  if (status.parsed.stepsPerSecond !== null) {
    console.log(`  Speed:      ${status.parsed.stepsPerSecond.toFixed(2)} steps/sec`);
  }

  if (status.parsed.estimatedTimeRemaining !== null) {
    const eta = status.parsed.estimatedTimeRemaining;
    const hours = Math.floor(eta / 3600);
    const mins = Math.floor((eta % 3600) / 60);
    console.log(`  ETA:        ${hours}h ${mins}m`);
  }

  if (status.parsed.checkpointsSaved > 0) {
    console.log(`  Checkpoints: ${status.parsed.checkpointsSaved} saved`);
  }

  if (status.parsed.errors.length > 0) {
    console.log(`  Errors:     ${status.parsed.errors.length} detected`);
  }

  console.log('═'.repeat(60) + '\n');

  // Show recent output if verbose
  if (args.verbose && status.recentOutput) {
    console.log('Recent output:');
    console.log('─'.repeat(60));
    console.log(status.recentOutput);
    console.log('─'.repeat(60));
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// WATCH MODE - Real-time monitoring with stall detection
// ════════════════════════════════════════════════════════════════════════════════

async function watchJob() {
  if (!args.instanceId || !args.jobRoot) {
    throw new Error('--watch requires --instanceId and --jobRoot');
  }

  const overrides = args.key ? { sshKeyPath: path.resolve(expandHome(args.key)) } : {};
  const vastConfig = getVastAIConfig(overrides);
  const service = new VastAIService({ logger: console, config: overrides });

  // Get instance status
  const instance = await service.getInstanceStatus(args.instanceId);
  log(`Instance ${instance.instanceId}: status=${instance.status}, gpu=${instance.gpuType}`);

  if (instance.status !== 'running') {
    log('Instance is not running');
    return;
  }

  // Connect via SSH
  const sshEndpoint = instance.sshHost || instance.publicIp;
  const ssh = new SshTransport({
    host: sshEndpoint,
    port: instance.sshPort || 22,
    username: instance.sshUser || 'root',
    privateKeyPath: vastConfig.sshKeyPath,
    logger: args.verbose ? console : null
  });

  const jobRoot = args.jobRoot;
  const gracePeriod = args.gracePeriod ? toNumber(args.gracePeriod, '--gracePeriod') * 60 * 1000 : 15 * 60 * 1000;
  const pollInterval = args.pollInterval ? toNumber(args.pollInterval, '--pollInterval') * 1000 : 30 * 1000;

  const monitor = new TrainingMonitor({
    ssh,
    jobInfo: {
      logFile: `${jobRoot}/logs/training.log`,
      pidFile: `${jobRoot}/training.pid`,
      outputDir: `${jobRoot}/output`,
      jobId: args.job || 'unknown',
      jobName: args.modelName || 'Training Job'
    },
    config: {
      gracePeriod,
      pollInterval,
      stallDetection: { enabled: true }
    },
    logger: console
  });

  log(`Starting watch mode (poll every ${pollInterval / 1000}s, grace period ${gracePeriod / 60000}m)`);
  log('Press Ctrl+C to stop watching\n');

  let lastStep = null;
  let stallWarningShown = false;

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nStopping watch mode...');
    process.exit(0);
  });

  // Polling loop
  while (true) {
    try {
      const status = await monitor.poll();

      // Clear screen and show status
      console.clear();
      console.log('═'.repeat(60));
      console.log('  TRAINING MONITOR (--watch mode)');
      console.log('═'.repeat(60));
      console.log(`  Instance:   ${args.instanceId}`);
      console.log(`  Running:    ${status.isRunning ? '✓ YES' : '✗ NO'}`);

      if (status.parsed.lastStep !== null) {
        const progress = status.parsed.totalSteps
          ? `${status.parsed.lastStep}/${status.parsed.totalSteps} (${status.parsed.progressPercent?.toFixed(1)}%)`
          : `${status.parsed.lastStep}`;
        console.log(`  Progress:   Step ${progress}`);
        lastStep = status.parsed.lastStep;
      }

      if (status.parsed.lastLoss !== null) {
        console.log(`  Loss:       ${status.parsed.lastLoss.toFixed(6)}`);
      }

      if (status.parsed.stepsPerSecond !== null) {
        console.log(`  Speed:      ${status.parsed.stepsPerSecond.toFixed(2)} steps/sec`);
      }

      if (status.parsed.estimatedTimeRemaining !== null) {
        const eta = status.parsed.estimatedTimeRemaining;
        const hours = Math.floor(eta / 3600);
        const mins = Math.floor((eta % 3600) / 60);
        console.log(`  ETA:        ${hours}h ${mins}m`);
      }

      if (status.checkpoints.length > 0) {
        const latest = status.checkpoints[status.checkpoints.length - 1];
        console.log(`  Checkpoints: ${status.checkpoints.length} (latest: ${latest.name})`);
      }

      // Stall detection status
      console.log('─'.repeat(60));
      if (status.stallAnalysis.isStalling) {
        const graceMins = Math.round((status.stallAnalysis.gracePeriodRemaining || 0) / 60000);
        console.log(`  ⚠️  STALL DETECTED: ${status.stallAnalysis.reason}`);
        console.log(`  ⏱️  Grace period: ${graceMins} minutes remaining`);

        if (status.stallAnalysis.gracePeriodExpired) {
          console.log(`  🛑 GRACE PERIOD EXPIRED - recommend termination`);
        }
        stallWarningShown = true;
      } else if (stallWarningShown) {
        console.log(`  ✓ Training recovered from stall`);
        stallWarningShown = false;
      } else {
        console.log(`  ✓ Training healthy`);
      }

      console.log('═'.repeat(60));
      console.log(`  Last update: ${new Date().toLocaleTimeString()}`);
      console.log(`  Press Ctrl+C to stop watching`);

      // Check if training completed
      if (!status.isRunning) {
        console.log('\n  Training process has stopped.');
        break;
      }

      // Wait for next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (err) {
      console.error(`\nPoll error: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN TRAINING FLOW
// ════════════════════════════════════════════════════════════════════════════════

async function main() {
  // Handle status check mode
  if (args.status) {
    return checkStatus();
  }

  // Handle watch mode
  if (args.watch) {
    return watchJob();
  }

  // Validate inputs
  if (!args.datasetDir) {
    throw new Error('Provide --datasetDir pointing to the local dataset folder');
  }

  // Validate upload options are mutually exclusive
  if (args.hfUpload && args.r2Upload) {
    throw new Error('--hfUpload and --r2Upload are mutually exclusive. Choose one upload destination.');
  }

  // Validate R2 env vars if --r2Upload is specified
  if (args.r2Upload) {
    const requiredR2Vars = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
    const missingVars = requiredR2Vars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      throw new Error(`--r2Upload requires these environment variables: ${missingVars.join(', ')}`);
    }
    log('R2 credentials found, will upload model to Cloudflare after training');
  }

  const overrides = args.key ? { sshKeyPath: path.resolve(expandHome(args.key)) } : {};
  const vastConfig = getVastAIConfig(overrides);
  const service = new VastAIService({ logger: console, config: overrides });

  // Debug: log which SSH key we're using
  log(`SSH key path: ${vastConfig.sshKeyPath}`);
  try {
    const pubKeyContent = require('fs').readFileSync(`${vastConfig.sshKeyPath}.pub`, 'utf8').trim();
    const keyFingerprint = require('crypto')
      .createHash('sha256')
      .update(pubKeyContent)
      .digest('hex')
      .slice(0, 16);
    log(`SSH public key fingerprint: ${keyFingerprint}...`);
    log(`SSH public key type: ${pubKeyContent.split(' ')[0]}`);
  } catch (keyErr) {
    log(`WARNING: Could not read SSH public key: ${keyErr.message}`);
  }

  const datasetDir = path.resolve(expandHome(args.datasetDir));
  if (!(await pathExists(datasetDir))) {
    throw new Error(`Dataset directory not found: ${datasetDir}`);
  }

  const jobId = args.job || `training-${Date.now()}`;
  const remoteDir = args.remoteDir || `/opt/stationthis/jobs/${jobId}`;
  const steps = toNumber(args.steps, '--steps') || 2000;
  const triggerWord = args.trigger || jobId;
  const modelName = args.modelName || `${triggerWord}_fluxdev1_${steps}`;
  const timeout = args.timeout ? toNumber(args.timeout, '--timeout') * 1000 : undefined;

  log(`Job ID: ${jobId}`);
  log(`Dataset: ${datasetDir}`);
  log(`Steps: ${steps}`);
  log(`Trigger: ${triggerWord}`);

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 1 & 2: Search, provision GPU, and wait for SSH (with retry on SSH failure)
  // ────────────────────────────────────────────────────────────────────────────

  // GPU types to try in order of preference (24GB+ cards suitable for FLUX training)
  // If exact match is requested, only try the specified GPU
  const GPU_FALLBACK_ORDER = args.exact
    ? [args.gpu]
    : [args.gpu, '4090', '3090', 'A5000', 'A6000', 'L40', 'A40'].filter((v, i, a) => a.indexOf(v) === i);

  log(`Will try GPUs in order: ${GPU_FALLBACK_ORDER.join(' → ')}`);

  let offers = [];
  let selectedGpuType = null;

  for (const gpuType of GPU_FALLBACK_ORDER) {
    log(`Searching offers for GPU ${gpuType}...`);
    const searchResults = await service.searchOffers({
      gpuType,
      region: args.region,
      minVramGb: args.minVram ? toNumber(args.minVram, '--min-vram') : 22, // At least 22GB for FLUX
      maxHourlyUsd: args.maxPrice ? toNumber(args.maxPrice, '--max-price') : undefined,
      useExactGpuMatch: false // Always fuzzy match within GPU type
    });

    if (searchResults.length > 0) {
      offers = searchResults;
      selectedGpuType = gpuType;
      log(`Found ${offers.length} offers for ${gpuType}`);
      break;
    }
    log(`No offers available for ${gpuType}, trying next...`);
  }

  if (!offers.length) {
    throw new Error(`No matching VastAI offers found. Tried: ${GPU_FALLBACK_ORDER.join(', ')}. Try a different region or wait for availability.`);
  }

  log(`Selected GPU type: ${selectedGpuType} (${offers.length} offers available)`);

  // Build extra environment variables to pass to the instance
  const extraEnv = {};
  if (process.env.HF_TOKEN) {
    extraEnv.HF_TOKEN = process.env.HF_TOKEN;
    log('HF_TOKEN found in environment, will be passed to instance');
  } else {
    log('WARNING: No HF_TOKEN found - gated models (FLUX.1-dev) will fail');
  }

  // Use ostris/ai-toolkit image by default (pre-installed, saves ~15 min)
  const image = args.image || DEFAULT_IMAGE;
  log(`Using image: ${image}`);

  // Default 5 min SSH timeout (60 attempts × 5s), configurable via --sshTimeout (in minutes)
  const sshTimeoutMin = args.sshTimeout ? toNumber(args.sshTimeout, '--sshTimeout') : 5;
  const sshAttempts = Math.ceil((sshTimeoutMin * 60) / 5);

  // Try up to 3 different offers, retrying on SSH failure
  const maxFullRetries = Math.min(offers.length, 3);
  let selectedOffer = null;
  let instance = null;
  let readyInstance = null;
  let lastError = null;
  const triedOfferIds = new Set();

  for (let retry = 0; retry < maxFullRetries; retry++) {
    // Find next untried offer
    const offer = offers.find(o => !triedOfferIds.has(o.id));
    if (!offer) {
      log('No more untried offers available');
      break;
    }
    triedOfferIds.add(offer.id);

    log(`\n[Attempt ${retry + 1}/${maxFullRetries}] Trying offer ${offer.id}:`);
    log(`  GPU: ${offer.gpuType} | VRAM: ${offer.vramGb}GB | Fraction: ${offer.gpuFrac} | Price: $${offer.hourlyUsd}/hr | Region: ${offer.region || 'unknown'}`);

    try {
      // Provision instance
      const label = service.generateLabel({ jobId: `${jobId}-${retry}` });
      instance = await service.provisionInstance({
        offerId: offer.id,
        jobId,
        label,
        image,
        extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
        diskGb: args.disk ? toNumber(args.disk, '--disk') : undefined,
        priceUsdPerHour: args.bid ? toNumber(args.bid, '--bid') : undefined,
        gpuType: offer.gpuType // Use the actual GPU type from the selected offer
      });

      if (!instance?.instanceId) {
        log(`Provision response lacked instance ID, trying lookup...`);
        for (let i = 0; i < 12; i++) {
          const fallback = await service.findInstanceByLabel(label);
          if (fallback?.instanceId) {
            instance = fallback;
            break;
          }
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      if (!instance?.instanceId) {
        throw new Error('Failed to get instance ID after provisioning');
      }

      log(`Successfully rented offer ${offer.id}, instance ${instance.instanceId}`);

      // Wait for instance to be running
      readyInstance = await waitForRunningInstance(service, instance.instanceId);
      const sshEndpoint = readyInstance.sshHost || readyInstance.publicIp;
      if (!sshEndpoint) {
        throw new Error('Instance running but no SSH endpoint assigned');
      }

      log(`Instance ${instance.instanceId} status=${readyInstance.status || 'running'} ip=${sshEndpoint} gpu=${readyInstance.gpuType || offer.gpuType}`);
      log(`Instance ready at ${sshEndpoint}:${readyInstance.sshPort || 22}`);

      // Explicitly attach SSH key (some images don't pick it up from initial payload)
      log('Attaching SSH key to instance...');
      try {
        await service.attachSshKey(instance.instanceId);
        log('SSH key attached');
      } catch (keyErr) {
        log(`Warning: SSH key attach failed (may already be set): ${keyErr.message}`);
      }

      // Wait for SSH port to be open
      await waitForSsh(sshEndpoint, readyInstance.sshPort || 22, { attempts: sshAttempts });

      log('SSH port open, verifying auth...');

      // Actually verify SSH auth works (not just port open)
      // VastAI can take 30-90+ seconds after port opens for key to be ready
      const sshTestAttempts = 12; // 12 attempts × 10s = 2 minutes
      let sshVerified = false;
      for (let sshTry = 0; sshTry < sshTestAttempts; sshTry++) {
        try {
          // Quick SSH test with short timeout
          const testSsh = new SshTransport({
            host: sshEndpoint,
            port: readyInstance.sshPort || 22,
            username: readyInstance.sshUser || 'root',
            privateKeyPath: vastConfig.sshKeyPath,
            logger: null // Quiet for test
          });
          await testSsh.exec('echo ok', { timeout: 10000 });
          sshVerified = true;
          log('SSH auth verified');
          break;
        } catch (sshErr) {
          if (sshTry < sshTestAttempts - 1) {
            log(`SSH auth not ready (${sshTry + 1}/${sshTestAttempts}), waiting 10s...`);
            await new Promise(r => setTimeout(r, 10000));
          }
        }
      }

      if (!sshVerified) {
        throw new Error('SSH auth verification failed after 2 minutes');
      }

      // Success! Record the offer we used
      selectedOffer = offer;
      break;

    } catch (err) {
      lastError = err;
      const isProvisionError = err.message?.includes('no_such_ask') || err.message?.includes('not available');
      const isSshError = err.message?.includes('SSH') ||
                         err.message?.includes('did not become available') ||
                         err.message?.includes('auth verification failed');

      if (isSshError && instance?.instanceId) {
        log(`SSH failed for instance ${instance.instanceId}: ${err.message}`);
        log(`Terminating and trying next offer...`);
        try {
          await service.terminateInstance(instance.instanceId);
          log(`Instance ${instance.instanceId} terminated`);
        } catch (termErr) {
          log(`Warning: Failed to terminate instance ${instance.instanceId}: ${termErr.message}`);
        }
        instance = null;
        readyInstance = null;
        continue; // Try next offer
      }

      if (isProvisionError && retry < maxFullRetries - 1) {
        log(`Offer ${offer.id} unavailable, trying next...`);
        continue;
      }

      // Unexpected error - bail out
      throw err;
    }
  }

  if (!selectedOffer || !readyInstance) {
    throw lastError || new Error(`Failed to provision working instance after ${maxFullRetries} attempts. Try different GPU or region.`);
  }

  // Track provisioned instance for cleanup on unexpected errors
  _provisionedInstanceId = readyInstance.instanceId;
  _vastService = service;

  // Extract SSH endpoint (prefer proxy host over direct IP)
  const sshEndpoint = readyInstance.sshHost || readyInstance.publicIp;

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 3: Pack and upload dataset + config
  // ────────────────────────────────────────────────────────────────────────────
  const stagingBase = path.resolve(expandHome(args.stagingDir || LOCAL_JOBS_BASE));
  const localJobRoot = path.join(stagingBase, jobId);
  await ensureDir(localJobRoot);

  const packer = new DatasetPacker({ logger: args.verbose ? console : null });
  const transferDir = path.join(localJobRoot, 'transfer');
  await ensureDir(transferDir);

  // Wait for dataset download to complete (signaled by .ready marker file)
  const readyMarkerPath = path.join(datasetDir, '.ready');
  log('Waiting for dataset download to complete...');
  const maxWaitMs = 5 * 60 * 1000; // 5 minutes max wait
  const pollIntervalMs = 1000;
  const waitStart = Date.now();
  while (true) {
    try {
      await fsp.access(readyMarkerPath);
      const markerContent = JSON.parse(await fsp.readFile(readyMarkerPath, 'utf-8'));
      log(`Dataset ready: ${markerContent.imageCount} images, ${markerContent.captionCount} captions`);
      break;
    } catch (err) {
      if (Date.now() - waitStart > maxWaitMs) {
        throw new Error('Timeout waiting for dataset download to complete');
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
  }

  log('Packing dataset...');
  const { archivePath, manifestPath } = await packer.pack({
    jobId,
    datasetDir,
    outputDir: transferDir
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 3.5: HuggingFace pre-training setup (if enabled)
  // ────────────────────────────────────────────────────────────────────────────
  let hfRepoId = null;
  let samplePrompts = [];
  const hfOrg = args.hfOrg || 'ms2stationthis';

  if (args.hfUpload) {
    log('HuggingFace upload enabled - generating model card...');

    // Read manifest to extract captions
    const manifestContent = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));
    let captions = ModelCardGenerator.extractCaptionsFromManifest(manifestContent);

    // Fallback: read captions directly from dataset .txt files if manifest doesn't have them
    if (captions.length === 0) {
      log('Manifest has no captions, reading from .txt files...');
      const datasetFiles = await fsp.readdir(datasetDir);
      const txtFiles = datasetFiles.filter(f => f.endsWith('.txt'));
      for (const txtFile of txtFiles) {
        try {
          const content = await fsp.readFile(path.join(datasetDir, txtFile), 'utf-8');
          if (content.trim()) {
            captions.push(content.trim());
          }
        } catch (err) {
          // Skip unreadable files
        }
      }
    }
    log(`Found ${captions.length} captions for model card`);

    if (captions.length === 0) {
      log('WARNING: No captions found - model card will have generic description');
    }

    // Initialize services
    const openaiService = new OpenAIService({ logger: args.verbose ? console : null });
    const hfService = new HuggingFaceHubService({
      defaultOrg: hfOrg,
      logger: args.verbose ? console : null
    });

    // Extract actual training config values from the YAML template
    const configTemplatePath = path.resolve(expandHome(args.template || DEFAULT_TEMPLATE));
    const trainingConfig = ModelCardGenerator.extractTrainingConfig(configTemplatePath);
    log(`Extracted training config: rank=${trainingConfig.loraRank || '?'}, alpha=${trainingConfig.loraAlpha || '?'}, optimizer=${trainingConfig.optimizer || '?'}, lr=${trainingConfig.learningRate || '?'}`);

    // Generate model card
    const cardGenerator = new ModelCardGenerator({
      openaiService,
      logger: args.verbose ? console : null
    });

    try {
      const cardResult = await cardGenerator.generate({
        modelName,
        triggerWord,
        trainingSteps: steps,
        captions,
        description: args.description,  // User-provided description (optional)
        hfOrg,
        trainingConfig,
        baseModel: args.baseModel,  // 'FLUX', 'KONTEXT', 'SDXL', etc.
        trainingMode: args.trainingMode,  // 'style_subject' or 'concept' for KONTEXT
      });

      samplePrompts = cardResult.samplePrompts;
      log(`Generated model card with ${samplePrompts.length} sample prompts`);

      // Create HuggingFace repo and upload README
      const { repoId, url, created } = await hfService.createRepoWithReadme({
        name: modelName,
        readme: cardResult.readme,
        org: hfOrg
      });

      hfRepoId = repoId;
      log(`HuggingFace repo ${created ? 'created' : 'exists'}: ${url}`);
    } catch (err) {
      log(`WARNING: HuggingFace pre-setup failed: ${err.message}`);
      log('Training will continue, but HF upload may need manual completion');
    }
  }

  // Build sample prompts YAML for config injection
  let samplePromptsYaml = '';
  if (samplePrompts.length > 0) {
    samplePromptsYaml = samplePrompts.map(p => `          - "${p.replace(/"/g, '\\"')}"`).join('\n');
  } else {
    // Fallback prompts if no captions available
    samplePromptsYaml = `          - "${triggerWord}, portrait, soft lighting, detailed"
          - "${triggerWord}, artistic composition, high quality"`;
  }

  // Select template based on baseModel
  let defaultTemplate = DEFAULT_TEMPLATE;
  if (args.baseModel === 'KONTEXT') {
    defaultTemplate = KONTEXT_TEMPLATE;
    log(`Using KONTEXT template for training mode: ${args.trainingMode || 'style_subject'}`);
  }

  const templatePath = path.resolve(expandHome(args.template || defaultTemplate));
  const configOutputPath = path.resolve(
    expandHome(args.configOutput || path.join(localJobRoot, 'config', path.basename(templatePath)))
  );

  // Sample at the final step (steps - 1 for 0-indexed training)
  // With skip_first_sample: true, this ensures samples only at the trained model
  const sampleEvery = Math.max(1, steps - 1);

  // For KONTEXT concept mode, include control_path line
  let controlPathLine = '#          control_path: ""  # Not used for style_subject mode';
  if (args.baseModel === 'KONTEXT' && args.trainingMode === 'concept' && args.controlDir) {
    controlPathLine = `          control_path: "${remoteDir}/control"`;
    log(`KONTEXT concept mode: control images will be at ${remoteDir}/control`);
  }

  await renderConfig({
    templatePath,
    outputPath: configOutputPath,
    variables: {
      JOB_ROOT: remoteDir,
      OUTPUT_DIR: `${remoteDir}/output`,
      DATASET_PATH: `${remoteDir}/dataset`,
      TRIGGER_WORD: triggerWord,
      MODEL_NAME: modelName,
      TRAIN_STEPS: String(steps),
      SAMPLE_EVERY: String(sampleEvery),
      SAMPLE_PROMPTS: samplePromptsYaml,
      CONTROL_PATH_LINE: controlPathLine
    }
  });

  const sshKeyPath = vastConfig.sshKeyPath;
  if (!sshKeyPath) {
    throw new Error('VASTAI_SSH_KEY_PATH is required for SSH/SCP sessions');
  }

  const ssh = new SshTransport({
    host: sshEndpoint,
    port: readyInstance.sshPort || 22,
    username: readyInstance.sshUser || 'root',
    privateKeyPath: sshKeyPath,
    logger: args.verbose ? console : null
  });

  // Create remote directories with retry
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
        log(`SSH auth failed, retrying in ${waitSec}s... (${attempt + 1}/5)`);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
        continue;
      }
      throw err;
    }
  }
  if (!sshSuccess) {
    throw new Error('SSH authentication failed after multiple retries');
  }

  log('Uploading dataset...');
  const remoteArchivePath = `${remoteDir}/dataset.tar.gz`;
  await ssh.upload(archivePath, remoteArchivePath);
  await ssh.upload(manifestPath, `${remoteDir}/dataset_manifest.json`);

  log('Extracting dataset on remote...');
  await ssh.exec(
    `cd ${remoteDir} && rm -rf dataset && mkdir -p dataset && tar -xzf dataset.tar.gz -C dataset && rm -f dataset.tar.gz`
  );

  // Upload control images for KONTEXT concept mode
  if (args.baseModel === 'KONTEXT' && args.trainingMode === 'concept' && args.controlDir) {
    const fsp = require('fs').promises;
    const controlExists = await fsp.access(args.controlDir).then(() => true).catch(() => false);

    if (controlExists) {
      log('Packing control images for KONTEXT concept mode...');
      const { archivePath: controlArchivePath } = await packer.pack({
        jobId: `${jobId}-control`,
        datasetDir: args.controlDir,
        outputDir: transferDir,
        archiveName: 'control.tar.gz',
        manifestName: 'control_manifest.json'
      });

      log('Uploading control images...');
      const remoteControlArchivePath = `${remoteDir}/control.tar.gz`;
      await ssh.upload(controlArchivePath, remoteControlArchivePath);

      log('Extracting control images on remote...');
      await ssh.exec(
        `cd ${remoteDir} && rm -rf control && mkdir -p control && tar -xzf control.tar.gz -C control && rm -f control.tar.gz`
      );
      log('Control images uploaded successfully');
    } else {
      log(`Warning: Control directory not found at ${args.controlDir}`);
    }
  }

  log('Uploading config...');
  const remoteConfigPath = `${remoteDir}/config/${path.basename(configOutputPath)}`;
  await ssh.upload(configOutputPath, remoteConfigPath);
  await ssh.exec(`printf '%s' '${remoteDir}' > ${remoteDir}/JOB_ROOT`);

  // Signal that dataset is uploaded - parent process can clean up local temp
  console.log('DATASET_UPLOADED');

  console.log('\n' + '═'.repeat(60));
  console.log('  JOB SETUP COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Instance:    ${readyInstance.instanceId}`);
  console.log(`  GPU:         ${readyInstance.gpuType}`);
  console.log(`  Remote path: ${remoteDir}`);
  console.log(`  Config:      ${remoteConfigPath}`);
  console.log(`  Trigger:     ${triggerWord}`);
  console.log(`  Steps:       ${steps}`);
  if (hfRepoId) {
    console.log(`  HF Repo:     https://huggingface.co/${hfRepoId}`);
  } else if (args.r2Upload) {
    console.log(`  Upload:      Cloudflare R2 (private)`);
  }
  console.log('═'.repeat(60) + '\n');

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 4: Execute training
  // ────────────────────────────────────────────────────────────────────────────
  if (args.dryRun) {
    log('Dry run mode - skipping training execution');
    log(`To start training manually: ssh to instance and run:`);
    log(`  cd /workspace/ai-toolkit && python run.py "${remoteConfigPath}"`);
    return;
  }

  const runner = new TrainingRunner({ ssh, logger: console });

  if (args.background) {
    // Start in background mode
    log('Starting training in background mode...');
    const bgInfo = await runner.startTrainingBackground({
      configPath: remoteConfigPath,
      jobRoot: remoteDir,
      extraEnv  // Pass HF_TOKEN and other env vars to training script
    });

    console.log('\n' + '═'.repeat(60));
    console.log('  BACKGROUND TRAINING STARTED');
    console.log('═'.repeat(60));
    console.log(`  PID:        ${bgInfo.pid}`);
    console.log(`  Running:    ${bgInfo.isRunning ? 'YES' : 'NO'}`);
    console.log(`  Log file:   ${bgInfo.logFile}`);
    console.log(`  PID file:   ${bgInfo.pidFile}`);
    console.log('');
    console.log('  To check status:');
    console.log(`    node scripts/vastai/launch-training.js --status \\`);
    console.log(`      --instanceId ${readyInstance.instanceId} \\`);
    console.log(`      --jobRoot ${remoteDir}`);
    console.log('═'.repeat(60) + '\n');

  } else {
    // Foreground mode with progress polling
    // Start in background, then poll for progress updates
    log('Starting training with progress monitoring...');
    log('This will poll for progress every 10 seconds.');
    console.log('');

    // Start training in background
    const bgInfo = await runner.startTrainingBackground({
      configPath: remoteConfigPath,
      jobRoot: remoteDir,
      extraEnv
    });

    // Result and polling state - declared here so early-completion can set it
    let result = { success: false, parsed: {}, duration: 0 };
    let earlyComplete = false;

    if (!bgInfo.isRunning) {
      // Training might have already completed (e.g. if SSH was slow to return)
      // Check the status file before declaring failure
      const earlyStatus = await runner.getTrainingStatus({
        logFile: bgInfo.logFile,
        pidFile: bgInfo.pidFile,
        statusFile: bgInfo.statusFile,
        tailLines: 50
      });

      if (earlyStatus.statusData?.completed && earlyStatus.statusData.exitCode === 0) {
        log('Training already completed (SSH returned late). Proceeding to upload.');
        const duration = earlyStatus.statusData.durationSeconds || 0;
        result = {
          success: true,
          exitCode: 0,
          duration: duration * 1000,
          durationFormatted: formatDuration(duration * 1000),
          parsed: earlyStatus.parsed,
          logFile: bgInfo.logFile,
        };
        earlyComplete = true;
      } else {
        throw new Error('Training failed to start in background mode');
      }
    } else {
      log(`Training started (PID: ${bgInfo.pid})`);
    }

    // Poll for progress until training completes (skip if already done)
    const POLL_INTERVAL_MS = 300000; // 5 minutes
    const startTime = Date.now();
    let lastStep = 0;
    let pollCount = 0;

    while (!earlyComplete) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      pollCount++;

      let status;
      try {
        status = await runner.getTrainingStatus({
          logFile: bgInfo.logFile,
          pidFile: bgInfo.pidFile,
          statusFile: bgInfo.statusFile,
          tailLines: 50
        });
      } catch (pollErr) {
        log(`Poll #${pollCount} failed (${pollErr.message}), will retry...`);
        continue;
      }

      // Output progress in a format TrainingJobProcessor can parse
      if (status.parsed.lastStep && status.parsed.lastStep !== lastStep) {
        const progress = status.parsed.totalSteps
          ? Math.round((status.parsed.lastStep / status.parsed.totalSteps) * 100)
          : 0;
        const loss = status.parsed.lastLoss ? status.parsed.lastLoss.toFixed(4) : 'N/A';
        let eta = 'calculating...';
        if (status.parsed.estimatedTimeRemaining) {
          const etaHours = Math.floor(status.parsed.estimatedTimeRemaining / 3600);
          const etaMins = Math.floor((status.parsed.estimatedTimeRemaining % 3600) / 60);
          eta = etaHours > 0 ? `${etaHours}h ${etaMins}m` : `${etaMins}m`;
        }

        // Output in format that TrainingOutputParser and TrainingJobProcessor can pick up
        // This mimics the tqdm output format
        console.log(`${modelName}: ${progress}%|${'█'.repeat(Math.floor(progress/5))}${'░'.repeat(20-Math.floor(progress/5))}| ${status.parsed.lastStep}/${status.parsed.totalSteps || '?'} [ETA: ${eta}, loss: ${loss}]`);

        lastStep = status.parsed.lastStep;
      } else {
        // Heartbeat so we know polling is alive during startup/model download
        const elapsed = formatDuration(Date.now() - startTime);
        log(`Poll #${pollCount} (${elapsed}) - ${status.isRunning ? 'training running, no new steps yet' : 'process not detected'}`);
      }

      // Check if training completed
      if (!status.isRunning) {
        const duration = Date.now() - startTime;

        // Read final status
        const finalStatus = await runner.getTrainingStatus({
          logFile: bgInfo.logFile,
          pidFile: bgInfo.pidFile,
          statusFile: bgInfo.statusFile,
          tailLines: 200
        });

        // Check if it completed successfully
        let exitCode = 1;
        if (finalStatus.statusData?.completed) {
          exitCode = finalStatus.statusData.exitCode || 0;
        }

        result = {
          success: exitCode === 0,
          exitCode,
          duration,
          durationFormatted: formatDuration(duration),
          parsed: finalStatus.parsed,
          logFile: bgInfo.logFile,
          error: exitCode !== 0 ? `Training exited with code ${exitCode}` : null
        };

        break;
      }

      // Check for timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > timeout) {
        log('Training timed out, stopping...');
        await runner.stopTraining(bgInfo.pidFile);
        result = {
          success: false,
          exitCode: -1,
          duration: elapsed,
          durationFormatted: formatDuration(elapsed),
          parsed: status.parsed,
          logFile: bgInfo.logFile,
          error: 'Training timed out'
        };
        break;
      }
    }

    // Helper to format duration
    function formatDuration(ms) {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
      if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
      return `${seconds}s`;
    }

    // List checkpoints
    const checkpoints = await runner.listCheckpoints(`${remoteDir}/output`);
    if (checkpoints.length > 0) {
      console.log('\nCheckpoint files:');
      checkpoints.forEach(ckpt => {
        console.log(`  ${ckpt.name} (${ckpt.sizeFormatted})`);
      });
    }

    // Calculate training cost
    const durationSeconds = result.duration / 1000;
    const durationHours = durationSeconds / 3600;
    const gpuHourlyRate = selectedOffer?.hourlyUsd || 0;
    const trainingCost = gpuHourlyRate * durationHours;

    // Final summary
    console.log('\n' + '═'.repeat(60));
    console.log('  TRAINING COMPLETE');
    console.log('═'.repeat(60));
    console.log(`  Status:     ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`  Duration:   ${result.durationFormatted}`);

    if (result.parsed.lastStep !== null) {
      const progress = result.parsed.totalSteps
        ? `${result.parsed.lastStep}/${result.parsed.totalSteps}`
        : `${result.parsed.lastStep}`;
      console.log(`  Final step: ${progress}`);
    }

    if (result.parsed.lastLoss !== null) {
      console.log(`  Final loss: ${result.parsed.lastLoss.toFixed(6)}`);
    }

    console.log(`  Checkpoints: ${checkpoints.length} files`);
    console.log(`  Instance:   ${readyInstance.instanceId}`);

    // Cost breakdown
    if (gpuHourlyRate > 0) {
      console.log(`  GPU:        ${selectedOffer.gpuType} @ $${gpuHourlyRate.toFixed(2)}/hr`);
      console.log(`  Cost:       $${trainingCost.toFixed(4)} (${durationHours.toFixed(3)} hrs)`);
    }

    if (!args.noTerminate && result.success) {
      console.log('');
      console.log('  Instance will be terminated unless --noTerminate was set.');
    }
    console.log('═'.repeat(60) + '\n');

    // ────────────────────────────────────────────────────────────────────────────
    // PHASE 5: Upload to HuggingFace directly from remote (if enabled)
    // Large files need LFS, so we use huggingface-cli on the remote instance
    // ────────────────────────────────────────────────────────────────────────────
    let hfModelUrl = null;
    if (result.success && hfRepoId) {
      log('Uploading model to HuggingFace (from remote instance)...');

      try {
        // Find the final safetensors file
        const finalModel = checkpoints.find(c => c.name === `${modelName}.safetensors`);
        if (!finalModel) {
          log('WARNING: Final model file not found - skipping HF upload');
        } else {
          const remoteSafetensors = `${remoteDir}/output/${modelName}/${modelName}.safetensors`;
          const remoteSamplesDir = `${remoteDir}/output/${modelName}/samples`;

          // Upload safetensors using huggingface-cli (handles LFS automatically)
          log(`Uploading ${finalModel.name} (${finalModel.sizeFormatted}) to HuggingFace...`);
          const uploadCmd = `export HF_TOKEN="${extraEnv.HF_TOKEN}" && huggingface-cli upload ${hfRepoId} "${remoteSafetensors}" "${modelName}.safetensors" --commit-message "Upload trained model"`;
          await ssh.exec(uploadCmd, { timeout: 300000 }); // 5 min timeout for upload

          // Model uploaded - set URL immediately so nothing downstream can block it
          hfModelUrl = `https://huggingface.co/${hfRepoId}`;

          // Upload samples if they exist (ai-toolkit creates samples/step_N/*.png)
          log('Looking for sample images...');
          // Debug: show output directory structure
          const outputDir = `${remoteDir}/output`;
          const lsCmd = `ls -laR ${outputDir} 2>/dev/null | head -100`;
          const lsOutput = await ssh.exec(lsCmd);
          logVerbose(`Output directory structure:\n${lsOutput}`);

          // Search entire output directory for samples (ai-toolkit may put them in different locations)
          const findSamplesCmd = `find ${outputDir} -name "*.png" -o -name "*.jpg" 2>/dev/null | sort`;
          const sampleFilesRaw = await ssh.exec(findSamplesCmd);
          const sampleFiles = sampleFilesRaw.trim().split('\n').filter(f => f && (f.endsWith('.png') || f.endsWith('.jpg')));
          logVerbose(`Sample search in ${outputDir}: found ${sampleFiles.length} image files`);
          if (sampleFiles.length > 0) {
            logVerbose(`Sample files: ${sampleFiles.join(', ')}`);
          }

          let uploadedSampleCount = 0;
          if (sampleFiles.length > 0) {
            log(`Found ${sampleFiles.length} sample images, preparing for upload...`);

            // Create staging folder with consistently named files (matching README grid)
            const stagingDir = `${remoteDir}/samples_upload`;
            await ssh.exec(`rm -rf ${stagingDir} && mkdir -p ${stagingDir}`);

            // Copy and rename each file (max 4 for 2x2 grid)
            // Preserve original extension (ai-toolkit generates JPG)
            const maxSamples = Math.min(sampleFiles.length, 4);
            for (let i = 0; i < maxSamples; i++) {
              const src = sampleFiles[i];
              const ext = path.extname(src) || '.jpg';
              const dst = `${stagingDir}/sample_${String(i).padStart(3, '0')}${ext}`;
              await ssh.exec(`cp "${src}" "${dst}"`);
              logVerbose(`Staged sample: ${path.basename(src)} -> sample_${String(i).padStart(3, '0')}${ext}`);
            }

            // Upload the staging folder
            log(`Uploading ${maxSamples} sample images to HuggingFace...`);
            const uploadSamplesCmd = `export HF_TOKEN="${extraEnv.HF_TOKEN}" && huggingface-cli upload ${hfRepoId} "${stagingDir}" samples --commit-message "Upload sample images"`;
            await ssh.exec(uploadSamplesCmd, { timeout: 120000 });
            uploadedSampleCount = maxSamples;
          } else {
            log('No sample images found (sampling may be disabled in config)');
          }

          const uploaded = [modelName + '.safetensors'];
          if (uploadedSampleCount > 0) uploaded.push(`${uploadedSampleCount} samples`);

          log(`Uploaded to HuggingFace: ${uploaded.join(', ')}`);

          console.log('\n' + '═'.repeat(60));
          console.log('  HUGGINGFACE UPLOAD COMPLETE');
          console.log('═'.repeat(60));
          console.log(`  Model URL:  ${hfModelUrl}`);
          console.log(`  Files:      ${uploaded.join(', ')}`);
          console.log('═'.repeat(60) + '\n');
        }
      } catch (err) {
        log(`WARNING: HuggingFace upload failed: ${err.message}`);
        log('Model remains on remote instance - can upload manually before termination');
      }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // PHASE 5B: Upload to Cloudflare R2 directly from remote (for private models)
    // Uses presigned URL so remote instance can PUT directly to R2
    // ────────────────────────────────────────────────────────────────────────────
    let r2ModelUrl = null;
    if (result.success && args.r2Upload && !hfRepoId) {
      log('Uploading model to Cloudflare R2 (from remote instance)...');

      try {
        // Initialize StorageService
        const storageService = new StorageService(console);

        // Find the final safetensors file
        const finalModel = checkpoints.find(c => c.name === `${modelName}.safetensors`);
        if (!finalModel) {
          log('WARNING: Final model file not found - skipping R2 upload');
        } else {
          const remoteSafetensors = `${remoteDir}/output/${modelName}/${modelName}.safetensors`;
          const r2Filename = `${modelName}.safetensors`;

          // Generate presigned upload URL (1 hour expiry)
          log(`Generating presigned URL for ${r2Filename}...`);
          const { signedUrl, permanentUrl } = await storageService.generateSignedUploadUrl(
            'training',  // userId folder
            r2Filename,
            'application/octet-stream'
          );

          // Upload using curl on the remote instance
          log(`Uploading ${finalModel.name} (${finalModel.sizeFormatted}) to R2...`);
          const uploadCmd = `curl -X PUT -H "Content-Type: application/octet-stream" --upload-file "${remoteSafetensors}" "${signedUrl}"`;
          await ssh.exec(uploadCmd, { timeout: 600000 }); // 10 min timeout for large files

          r2ModelUrl = permanentUrl;
          log(`Uploaded to Cloudflare R2: ${r2ModelUrl}`);

          console.log('\n' + '═'.repeat(60));
          console.log('  CLOUDFLARE R2 UPLOAD COMPLETE');
          console.log('═'.repeat(60));
          console.log(`  Model URL:  ${r2ModelUrl}`);
          console.log(`  File:       ${r2Filename}`);
          console.log('═'.repeat(60) + '\n');
        }
      } catch (err) {
        log(`WARNING: Cloudflare R2 upload failed: ${err.message}`);
        log('Model remains on remote instance - can upload manually before termination');
      }
    }

    // Terminate instance if training succeeded and not in noTerminate mode
    if (!args.noTerminate && result.success) {
      log('Terminating instance...');
      try {
        await service.terminateInstance(readyInstance.instanceId);
        log('Instance terminated successfully');
        _provisionedInstanceId = null; // Clear so error handler doesn't double-terminate
      } catch (err) {
        log(`Warning: Failed to terminate instance: ${err.message}`);
        log(`You may need to manually terminate instance ${readyInstance.instanceId}`);
      }
    } else if (!result.success) {
      log('Training failed - instance NOT terminated for debugging');
      log(`Instance ID: ${readyInstance.instanceId}`);
      log(`SSH: ssh -p ${readyInstance.sshPort} root@${sshEndpoint}`);
      log(`Log: ${remoteDir}/logs/training.log`);
      _provisionedInstanceId = null; // Clear - intentionally leaving for debugging
    } else if (args.noTerminate) {
      log('--noTerminate set, instance left running for manual inspection');
      _provisionedInstanceId = null; // Clear - intentionally leaving
    }

    // Final result with model URL
    if (hfModelUrl) {
      console.log('\n🎉 Training complete! Model available at:');
      console.log(`   ${hfModelUrl}\n`);
    } else if (r2ModelUrl) {
      console.log('\n🎉 Training complete! Model uploaded to R2:');
      console.log(`   ${r2ModelUrl}\n`);
    }

    // Output structured result for programmatic use (e.g., by TrainingFinalizationService)
    // This JSON block can be parsed by the worker/caller
    const trainingResult = {
      success: result.success,
      modelName,
      triggerWord,
      steps: parseInt(args.steps) || 2000,
      baseModel: 'black-forest-labs/FLUX.1-dev',

      // Upload destinations
      hfRepoId: hfRepoId || null,
      hfModelUrl: hfModelUrl || null,
      r2ModelUrl: r2ModelUrl || null,

      // Cost tracking
      gpuType: selectedOffer?.gpuType || null,
      gpuHourlyRate: gpuHourlyRate || 0,
      durationSeconds,
      trainingCost,

      // Training metrics
      finalStep: result.parsed.lastStep,
      totalSteps: result.parsed.totalSteps,
      finalLoss: result.parsed.lastLoss,

      // Instance info
      instanceId: readyInstance.instanceId,
      jobId
    };

    console.log('\n--- TRAINING_RESULT_JSON ---');
    console.log(JSON.stringify(trainingResult, null, 2));
    console.log('--- END_TRAINING_RESULT_JSON ---\n');
  }
}

// Track provisioned instance for cleanup on unexpected errors
let _provisionedInstanceId = null;
let _vastService = null;

main().catch(async (error) => {
  console.error('launch-training failed:', error.message);
  if (args.verbose) {
    console.error(error.stack);
  }

  // Cleanup orphaned instance if we provisioned one but failed later
  if (_provisionedInstanceId && _vastService) {
    console.error(`Cleaning up orphaned instance ${_provisionedInstanceId}...`);
    try {
      await _vastService.terminateInstance(_provisionedInstanceId);
      console.error(`Instance ${_provisionedInstanceId} terminated`);
    } catch (cleanupErr) {
      console.error(`WARNING: Failed to cleanup instance ${_provisionedInstanceId}: ${cleanupErr.message}`);
      console.error(`You may need to manually terminate this instance via VastAI dashboard`);
    }
  }

  process.exit(1);
});
