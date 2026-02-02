#!/usr/bin/env node
/**
 * Admin script to set embellishment metadata on spells
 *
 * Usage:
 *   node scripts/admin/set-spell-embellishment.js <spellSlug> <configFile>
 *   node scripts/admin/set-spell-embellishment.js --list
 *   node scripts/admin/set-spell-embellishment.js --remove <spellSlug>
 *
 * Config file format (JSON):
 * {
 *   "type": "caption",
 *   "resultExtraction": {
 *     "path": "outputs[0].text",
 *     "valueType": "text"
 *   },
 *   "requiredContext": ["imageUrl"],
 *   "optionalContext": ["triggerWord"],
 *   "description": "Generates descriptive captions for images"
 * }
 */

const path = require('path');
const fs = require('fs');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage:
  node scripts/admin/set-spell-embellishment.js <spellSlug> <configFile>
  node scripts/admin/set-spell-embellishment.js --list [type]
  node scripts/admin/set-spell-embellishment.js --remove <spellSlug>

Examples:
  node scripts/admin/set-spell-embellishment.js joycaption ./caption-config.json
  node scripts/admin/set-spell-embellishment.js --list caption
  node scripts/admin/set-spell-embellishment.js --remove joycaption
    `);
    process.exit(0);
  }

  // Initialize DB
  const SpellsDB = require('../../src/core/services/db/spellsDb');
  const spellsDb = new SpellsDB(console);

  if (args[0] === '--list') {
    const type = args[1] || null;
    const spells = await spellsDb.findEmbellishmentSpells(type);

    console.log(`\nEmbellishment-capable spells${type ? ` (type: ${type})` : ''}:`);
    console.log('─'.repeat(60));

    if (spells.length === 0) {
      console.log('  (none found)');
    } else {
      for (const spell of spells) {
        console.log(`  ${spell.slug}`);
        console.log(`    Type: ${spell.embellishment.type}`);
        console.log(`    Extraction: ${spell.embellishment.resultExtraction.path} (${spell.embellishment.resultExtraction.valueType})`);
        console.log(`    Required: ${spell.embellishment.requiredContext.join(', ') || '(none)'}`);
        console.log('');
      }
    }

    process.exit(0);
  }

  if (args[0] === '--remove') {
    const spellSlug = args[1];
    if (!spellSlug) {
      console.error('Error: spellSlug required for --remove');
      process.exit(1);
    }

    const spell = await spellsDb.findBySlug(spellSlug);
    if (!spell) {
      console.error(`Error: Spell "${spellSlug}" not found`);
      process.exit(1);
    }

    await spellsDb.updateSpell(spell._id, { embellishment: null });
    console.log(`Removed embellishment metadata from spell: ${spellSlug}`);
    process.exit(0);
  }

  // Set embellishment metadata
  const [spellSlug, configFile] = args;

  if (!spellSlug || !configFile) {
    console.error('Error: Both spellSlug and configFile are required');
    process.exit(1);
  }

  // Find spell
  const spell = await spellsDb.findBySlug(spellSlug);
  if (!spell) {
    console.error(`Error: Spell "${spellSlug}" not found`);
    process.exit(1);
  }

  // Load config
  const configPath = path.resolve(configFile);
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Validate config
  const requiredFields = ['type', 'resultExtraction', 'requiredContext'];
  for (const field of requiredFields) {
    if (!config[field]) {
      console.error(`Error: Missing required field: ${field}`);
      process.exit(1);
    }
  }

  if (!config.resultExtraction.path || !config.resultExtraction.valueType) {
    console.error('Error: resultExtraction must have path and valueType');
    process.exit(1);
  }

  // Set metadata
  await spellsDb.setEmbellishmentMetadata(spell._id, config);

  console.log(`\nSet embellishment metadata for spell: ${spellSlug}`);
  console.log('─'.repeat(40));
  console.log(JSON.stringify(config, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
