#!/usr/bin/env node
/**
 * Manually insert a trained LoRA model into loraModels DB.
 *
 * Usage: ./run-with-env.sh node scripts/vastai/insert-lora-model-manual.js
 *
 * For when training completed and HF/ComfyDeploy are set up,
 * but the loraModels record was never created.
 */
const LoRAModelsDB = require('../../src/core/services/db/loRAModelDb');

// ─── TRAINING DETAILS (edit these) ─────────────────────────────────────────
const TRAINING = {
  modelName: 'b0throps',
  triggerWord: 'b0throps',
  steps: 4000,
  baseModel: 'black-forest-labs/FLUX.1-dev',
  hfRepoId: 'ms2stationthis/b0throps',
  masterAccountId: '681a27d761a6acd963d084dd',
  trainingId: '697574feb67de72635bab861',
  durationSeconds: 9972,
  finalLoss: 0.3755,
};
// ────────────────────────────────────────────────────────────────────────────

(async () => {
  const db = new LoRAModelsDB(console);

  // Check if it already exists
  const existing = await db.findOne({
    'publishedTo.huggingfaceRepo': TRAINING.hfRepoId,
  });

  if (existing) {
    console.log(`Model already exists in loraModels: ${existing.slug} (_id: ${existing._id})`);
    console.log('Trigger words:', existing.triggerWords);
    console.log('No insert needed.');
    process.exit(0);
  }

  console.log('No existing record found. Creating loraModels entry...');

  const result = await db.createTrainedLoRAModel({
    modelName: TRAINING.modelName,
    triggerWord: TRAINING.triggerWord,
    steps: TRAINING.steps,
    baseModel: TRAINING.baseModel,
    hfRepoId: TRAINING.hfRepoId,
    trainingId: TRAINING.trainingId,
    trainingDuration: TRAINING.durationSeconds,
    finalLoss: TRAINING.finalLoss,
  }, TRAINING.masterAccountId);

  if (result) {
    console.log(`Created loraModels record:`);
    console.log(`  _id:          ${result._id}`);
    console.log(`  slug:         ${result.slug}`);
    console.log(`  name:         ${result.name}`);
    console.log(`  triggerWords: ${result.triggerWords}`);
    console.log(`  checkpoint:   ${result.checkpoint}`);
    console.log(`  hfRepo:       ${result.publishedTo?.huggingfaceRepo}`);
    console.log('\nModel should be usable after LoRA cache refresh or bot restart.');
  } else {
    console.error('createTrainedLoRAModel returned null — check logs above.');
    process.exit(1);
  }

  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
