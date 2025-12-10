#!/usr/bin/env node
const { VastAIClient } = require('../../src/core/services/vastai');
const { getVastAIConfig } = require('../../src/config/vastai');
const fs = require('fs');
const path = require('path');

async function main() {
  const config = getVastAIConfig();
  const client = new VastAIClient({ apiKey: config.apiKey, apiBaseUrl: config.apiBaseUrl, logger: console });
  const data = await client.listKeys();
  const keys = data?.keys || data?.data || [];

  let localKey = null;
  if (config.sshKeyPath && fs.existsSync(`${config.sshKeyPath}.pub`)) {
    localKey = fs.readFileSync(`${config.sshKeyPath}.pub`, 'utf8').trim();
  }

  keys.forEach((key, index) => {
    console.log(`#${index + 1}`);
    console.log(`  Key ID   : ${key.id}`);
    console.log(`  Label    : ${key.label || key.name || 'n/a'}`);
    console.log(`  Created  : ${key.created || key.created_at || 'n/a'}`);
    if (localKey && key.public_key === localKey) {
      console.log('  Matches local sandbox key ✅');
    }
    console.log('');
  });

  if (localKey && !keys.some((key) => key.public_key === localKey)) {
    console.warn('Local key not found in VastAI account. Upload via dashboard before provisioning.');
  }
}

main().catch((error) => {
  console.error('Failed to check VastAI keys:', error.message);
  process.exit(1);
});
