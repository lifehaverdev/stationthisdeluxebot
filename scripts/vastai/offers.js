#!/usr/bin/env node
const minimist = require('minimist');
const { VastAIService } = require('../../src/core/services/vastai');

const args = minimist(process.argv.slice(2), {
  string: ['gpu', 'template', 'region', 'sort'],
  alias: {
    g: 'gpu',
    t: 'template',
    r: 'region',
    v: 'minVram',
    p: 'maxPrice',
    l: 'limit'
  },
  boolean: ['all', 'desc', 'exact'],
  default: { minVram: undefined, maxPrice: undefined, all: false, limit: 10, sort: 'price' }
});

async function main() {
  const service = new VastAIService({ logger: console });
  const offers = await service.searchOffers({
    gpuType: args.gpu,
    minVramGb: args.minVram ? Number(args.minVram) : undefined,
    maxHourlyUsd: args.maxPrice ? Number(args.maxPrice) : undefined,
    onlyVerified: args.all ? false : true,
    limit: args.limit ? Number(args.limit) : undefined,
    sortBy: args.sort === 'reliability' ? 'reliability' : args.sort === 'vram' ? 'vramGb' : 'hourlyUsd',
    sortDirection: args.desc ? 'desc' : 'asc',
    useExactGpuMatch: args.exact,
    extra: {
      preferred_region: args.region,
      template_id: args.template
    }
  });

  if (!offers.length) {
    console.log('No offers match the provided filters.');
    return;
  }

  offers.slice(0, Number(args.limit) || 10).forEach((offer, index) => {
    console.log(`#${index + 1}`);
    console.log(`  Offer ID     : ${offer.id}`);
    console.log(`  GPU          : ${offer.gpuType} (${offer.vramGb} GB)`);
    console.log(`  Hourly (USD) : ${offer.hourlyUsd}`);
    console.log(`  Region       : ${offer.region}`);
    console.log(`  Reliability  : ${offer.reliability ?? 'n/a'}`);
    console.log(`  Template ID  : ${offer.templateId ?? 'n/a'}`);
    console.log('');
  });
}

main().catch((error) => {
  console.error('Failed to list VastAI offers:', error.message);
  process.exit(1);
});
