#!/usr/bin/env node
const minimist = require('minimist');
const { VastAIClient } = require('../../src/core/services/vastai');
const { getVastAIConfig } = require('../../src/config/vastai');

const args = minimist(process.argv.slice(2), {
  string: ['name'],
  alias: { n: 'name' }
});

async function main() {
  const config = getVastAIConfig();
  const client = new VastAIClient({
    apiKey: config.apiKey,
    apiBaseUrl: config.apiBaseUrl,
    logger: console
  });

  const data = await client.listTemplates();
  const templates = data?.templates || data?.data || [];
  const filtered = templates.filter((tpl) => {
    if (!args.name) {
      return true;
    }
    return tpl?.name?.toLowerCase().includes(args.name.toLowerCase());
  });

  if (!filtered.length) {
    console.log('No templates match the provided filter.');
    return;
  }

  filtered.forEach((tpl, index) => {
    console.log(`#${index + 1}`);
    console.log(`  Template ID  : ${tpl.id}`);
    console.log(`  Name         : ${tpl.name}`);
    console.log(`  GPU          : ${tpl.gpu_name ?? 'any'}`);
    console.log(`  Size (GB)    : ${tpl.disk ?? tpl.disk_gb ?? 'n/a'}`);
    console.log(`  Image        : ${tpl.image ?? tpl.image_url ?? 'n/a'}`);
    console.log(`  Description  : ${tpl.description ?? ''}`);
    console.log('');
  });
}

main().catch((error) => {
  console.error('Failed to list VastAI templates:', error.message);
  process.exit(1);
});
