#!/usr/bin/env node
const minimist = require('minimist');
const { VastAIService } = require('../../src/core/services/vastai');

const args = minimist(process.argv.slice(2), {
  string: ['gpu', 'region', 'template', 'sort', 'format'],
  alias: {
    g: 'gpu',
    v: 'minVram',
    p: 'maxPrice',
    r: 'region',
    t: 'template'
  },
  boolean: ['desc', 'exact'],
  default: {
    sort: 'price',
    format: 'id'
  }
});

async function main() {
  const service = new VastAIService({ logger: console });
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
    console.error('No offers match the provided filters.');
    process.exit(1);
  }

  const best = offers[0];
  if (args.format === 'json') {
    console.log(JSON.stringify(best, null, 2));
  } else if (args.format === 'full') {
    console.log(`# Best Offer`);
    console.log(`ID        : ${best.id}`);
    console.log(`GPU       : ${best.gpuType} (${best.vramGb} GB)`);
    console.log(`Price/hr  : ${best.hourlyUsd}`);
    console.log(`Region    : ${best.region || 'n/a'}`);
    console.log(`Reliab.   : ${best.reliability ?? 'n/a'}`);
  } else {
    console.log(best.id);
  }
}

main().catch((error) => {
  console.error('Failed to select VastAI offer:', error.message);
  process.exit(1);
});
