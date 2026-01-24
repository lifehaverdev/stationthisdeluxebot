#!/usr/bin/env node
/**
 * validate-dataset.js - Dataset Validation CLI
 *
 * PURPOSE:
 *   Validate a dataset directory before packing and uploading for training.
 *   Catches issues early to avoid wasting GPU rental time on bad data.
 *
 * USAGE:
 *   ./run-with-env.sh node scripts/vastai/validate-dataset.js --datasetDir .stationthis/datasets/mydata/
 *   node scripts/vastai/validate-dataset.js -d ~/datasets/project1 --minImages 20
 *
 * EXIT CODES:
 *   0 - Dataset is valid
 *   1 - Dataset is invalid (errors found)
 *   2 - Script error (bad arguments, directory not found, etc.)
 *
 * SEE ALSO:
 *   - src/core/services/training/DatasetValidator.js for validation logic and future expansion ideas
 *   - scripts/vastai/launch-session.js for the full training workflow
 */
const minimist = require('minimist');
const path = require('path');
const os = require('os');
const DatasetValidator = require('../../src/core/services/training/DatasetValidator');

const args = minimist(process.argv.slice(2), {
  string: ['datasetDir', 'minImages'],
  boolean: ['json', 'quiet'],
  alias: {
    d: 'datasetDir',
    m: 'minImages',
    q: 'quiet'
  }
});

// Support legacy kebab-case
if (!args.datasetDir && args['dataset-dir']) {
  args.datasetDir = args['dataset-dir'];
}
if (!args.minImages && args['min-images']) {
  args.minImages = args['min-images'];
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function printUsage() {
  console.log(`
Dataset Validator - Check datasets before training

USAGE:
  node scripts/vastai/validate-dataset.js --datasetDir <path> [options]

OPTIONS:
  --datasetDir, -d  Path to dataset directory (required)
  --minImages, -m   Minimum required images (default: 10)
  --json            Output results as JSON
  --quiet, -q       Only output errors (suppresses info/warnings)

EXAMPLES:
  # Basic validation
  node scripts/vastai/validate-dataset.js -d .stationthis/datasets/myproject/

  # Require 20+ images
  node scripts/vastai/validate-dataset.js -d ~/datasets/faces --minImages 20

  # JSON output for scripting
  node scripts/vastai/validate-dataset.js -d ./data --json

VALIDATION RULES:
  Required (fails validation):
    - At least 10 images (or --minImages value)
    - Caption .txt files must have matching image files (no orphans)

  Warnings (passes but flags issues):
    - Images without captions (captions recommended but not required)

EXIT CODES:
  0 = Valid, 1 = Invalid, 2 = Script error
`);
}

async function main() {
  if (!args.datasetDir) {
    printUsage();
    process.exit(2);
  }

  const datasetDir = path.resolve(expandHome(args.datasetDir));
  const minImages = args.minImages ? parseInt(args.minImages, 10) : undefined;

  if (minImages !== undefined && (Number.isNaN(minImages) || minImages < 1)) {
    console.error('Error: --minImages must be a positive integer');
    process.exit(2);
  }

  // Use a quiet logger if --quiet or --json flag is set
  const logger = (args.quiet || args.json) ? null : console;
  const validator = new DatasetValidator({ logger });

  const result = await validator.validate(datasetDir, { minImages });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!args.quiet) {
    console.log('');
    console.log('═'.repeat(60));
    console.log(result.valid ? '  DATASET VALID' : '  DATASET INVALID');
    console.log('═'.repeat(60));

    if (result.stats) {
      console.log('');
      console.log('Statistics:');
      console.log(`  Images:     ${result.stats.imageCount}`);
      console.log(`  Captions:   ${result.stats.captionCount}`);
      console.log(`  Paired:     ${result.stats.pairedCount}`);

      if (Object.keys(result.stats.imageExtensions).length > 0) {
        const extStr = Object.entries(result.stats.imageExtensions)
          .map(([ext, count]) => `${ext}: ${count}`)
          .join(', ');
        console.log(`  Extensions: ${extStr}`);
      }
    }

    if (result.errors.length > 0) {
      console.log('');
      console.log('Errors:');
      result.errors.forEach((e) => console.log(`  - ${e}`));
    }

    if (result.warnings.length > 0) {
      console.log('');
      console.log('Warnings:');
      result.warnings.forEach((w) => console.log(`  - ${w}`));
    }

    console.log('');
  }

  process.exit(result.valid ? 0 : 1);
}

main().catch((err) => {
  console.error('Script error:', err.message);
  process.exit(2);
});
