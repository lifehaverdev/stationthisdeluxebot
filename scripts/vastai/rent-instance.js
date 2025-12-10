#!/usr/bin/env node
const minimist = require('minimist');
const { VastAIService } = require('../../src/core/services/vastai');

const fs = require('fs');

const args = minimist(process.argv.slice(2), {
  string: ['offer', 'template', 'gpu', 'job', 'instance', 'image', 'label', 'runtime', 'target', 'env', 'envFile', 'onstart', 'sort', 'region'],
  boolean: ['keep', 'stop', 'nowait', 'direct', 'desc', 'exact'],
  alias: {
    o: 'offer',
    t: 'template',
    g: 'gpu',
    j: 'job',
    d: 'disk',
    b: 'bid',
    i: 'instance',
    e: 'env',
    f: 'envFile',
    v: 'minVram',
    p: 'maxPrice',
    r: 'region'
  },
  default: {
    target: 'running'
  }
});

function parseEnvEntries(entries = []) {
  const env = {};
  entries.forEach((entry) => {
    if (!entry) return;
    const [key, ...rest] = entry.split('=');
    if (!key || !rest.length) return;
    env[key.trim()] = rest.join('=').trim();
  });
  return env;
}

function parseEnvFile(filePath) {
  if (!filePath) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    return JSON.parse(content);
  }
  const env = {};
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const [key, ...rest] = line.split('=');
      if (!key || !rest.length) return;
      env[key.trim()] = rest.join('=').trim();
    });
  return env;
}

function mergeEnv(cliEnv, fileEnv) {
  return {
    ...fileEnv,
    ...cliEnv
  };
}

async function pollStatus(service, instanceId) {
  let attempts = 0;
  while (attempts < 60) {
    const status = await service.getInstanceStatus(instanceId);
    console.log(
      `Status: ${status.status} | IP: ${status.publicIp || 'pending'} | GPU: ${status.gpuType} | Disk: ${status.diskGb} GB`
    );
    if (status.status === 'running') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 15000));
    attempts += 1;
  }
  throw new Error('Instance did not reach running state within timeout');
}

async function main() {
  const service = new VastAIService({ logger: console });

  if (args.instance) {
    const status = await service.getInstanceStatus(args.instance);
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  let offerId = args.offer;

  const fileEnv = args.envFile ? parseEnvFile(args.envFile) : {};
  const cliEnv = args.env
    ? parseEnvEntries(Array.isArray(args.env) ? args.env : [args.env])
    : {};
  const extraEnv = mergeEnv(cliEnv, fileEnv);

  if (!offerId) {
    const offers = await service.searchOffers({
      gpuType: args.gpu,
      minVramGb: args.minVram ? Number(args.minVram) : undefined,
      maxHourlyUsd: args.maxPrice ? Number(args.maxPrice) : undefined,
      sortBy: args.sort === 'reliability' ? 'reliability' : args.sort === 'vram' ? 'vramGb' : 'hourlyUsd',
      sortDirection: args.desc ? 'desc' : 'asc',
      useExactGpuMatch: args.exact,
      extra: {
        preferred_region: args.region,
        template_id: args.template
      }
    });
    if (!offers.length) {
      throw new Error('No suitable offers found. Adjust filters or specify --offer manually.');
    }
    offerId = offers[0].id;
    console.log(`[VastAI] Auto-selected offer ${offerId} (${offers[0].gpuType} @ ${offers[0].hourlyUsd}/hr)`);
  }

  const rentalLabel = args.label || `stationthis-cli-${Date.now()}`;

  const rental = await service.provisionInstance({
    offerId,
    jobId: args.job,
    templateId: args.template,
    gpuType: args.gpu,
    diskGb: args.disk ? Number(args.disk) : undefined,
    priceUsdPerHour: args.bid ? Number(args.bid) : undefined,
    image: args.image,
    extraEnv: Object.keys(extraEnv).length ? extraEnv : undefined,
    onstartCmd: args.onstart,
    label: rentalLabel,
    runtimeType: args.runtime,
    targetState: args.target,
    direct: args.direct || undefined
  });

  console.log('Provision requested:', rental.instanceId || 'pending');
  if (!args.nowait && rental.instanceId) {
    await pollStatus(service, rental.instanceId);
  } else if (!rental.instanceId) {
    console.log(`Instance ID unavailable yet. Check VastAI dashboard for label "${rentalLabel}".`);
  }

  if (args.keep) {
    console.log('Keeping instance alive. Remember to stop/delete manually.');
    return;
  }

  if (rental.instanceId) {
    await service.terminateInstance(rental.instanceId, { deleteInstance: !args.stop });
  } else {
    console.log('Skipping automatic termination because instance ID is unknown.');
  }
}

main().catch((error) => {
  console.error('VastAI rent-instance failed:', error.message);
  process.exit(1);
});
