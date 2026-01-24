#!/usr/bin/env node
const { VastAIService } = require('../../src/core/services/vastai');
const svc = new VastAIService({ logger: console });

(async () => {
  // Broader search - any GPU with 24GB+ VRAM
  const offers = await svc.searchOffers({ minVramGb: 24 });

  const byRegion = {};
  const byGpu = {};
  offers.forEach(o => {
    const region = o.region || 'unknown';
    const gpu = o.gpuType || 'unknown';
    if (!byRegion[region]) byRegion[region] = [];
    if (!byGpu[gpu]) byGpu[gpu] = [];
    byRegion[region].push(o);
    byGpu[gpu].push(o);
  });

  console.log(`Total offers: ${offers.length}\n`);

  console.log('By region:');
  Object.entries(byRegion)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .forEach(([region, list]) => {
      const cheapest = Math.min(...list.map(o => o.hourlyUsd));
      console.log(`  ${region}: ${list.length} (from $${cheapest.toFixed(2)}/hr)`);
    });

  console.log('\nBy GPU:');
  Object.entries(byGpu)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .forEach(([gpu, list]) => {
      const cheapest = Math.min(...list.map(o => o.hourlyUsd));
      console.log(`  ${gpu}: ${list.length} (from $${cheapest.toFixed(2)}/hr)`);
    });
})();
