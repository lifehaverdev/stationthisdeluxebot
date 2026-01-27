#!/usr/bin/env node
/**
 * Manually finalize a completed training job.
 * Creates LoRA model record in DB + registers with ComfyUI Deploy.
 *
 * Usage: ./run-with-env.sh node scripts/vastai/finalize-training-manual.js
 *
 * Reads training details from the constants below - edit before running.
 */
const { MongoClient, ObjectId } = require('mongodb');
const https = require('https');

// ─── TRAINING DETAILS (edit these) ─────────────────────────────────────────
const TRAINING = {
  modelName: 'b0throps',
  triggerWord: 'b0throps',
  steps: 4000,
  baseModel: 'black-forest-labs/FLUX.1-dev',
  hfRepoId: 'ms2stationthis/b0throps',
  masterAccountId: '681a27d761a6acd963d084dd',
  trainingJobId: '697574feb67de72635bab861',
  durationSeconds: 9972,
  finalLoss: 0.3755,
};
// ────────────────────────────────────────────────────────────────────────────

const uri = process.env.MONGO_PASS;
const comfyDeployApiKey = process.env.COMFY_DEPLOY_API_KEY;

if (!uri) {
  console.error('No MONGO_PASS found in env');
  process.exit(1);
}

function comfyDeployUpload(payload, apiKey) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.comfydeploy.com',
      path: '/api/volume/model',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('noema');

  const {
    modelName, triggerWord, steps, baseModel, hfRepoId,
    masterAccountId, trainingJobId, durationSeconds, finalLoss
  } = TRAINING;

  // ── Step 1: Check if model already exists ──────────────────────────────
  const existing = await db.collection('loramodels').findOne({
    'publishedTo.huggingfaceRepo': hfRepoId,
  });

  if (existing) {
    console.log(`Model already exists in DB: ${existing.slug} (${existing._id})`);
    console.log('Skipping DB insert, proceeding to ComfyUI Deploy...');
  }

  let modelDoc = existing;

  if (!existing) {
    // ── Step 2: Create LoRA model record ───────────────────────────────
    const now = new Date();
    const slugBase = modelName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, '-');
    const uniqueSlug = `${slugBase}-${new ObjectId().toHexString().substring(0, 6)}`;

    const previewImages = [
      `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_000.jpg`,
      `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_001.jpg`,
      `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_002.jpg`,
      `https://huggingface.co/${hfRepoId}/resolve/main/samples/sample_003.jpg`,
    ];

    const doc = {
      name: modelName,
      description: `Trained LoRA model with trigger word: ${triggerWord}`,
      triggerWords: [triggerWord],
      checkpoint: 'FLUX',
      tags: [
        { tag: 'trained', source: 'training' },
        { tag: 'flux', source: 'training' },
      ],
      previewImages,
      defaultWeight: 1.0,
      slug: uniqueSlug,
      permissionType: 'public',
      visibility: 'public',
      usageCount: 0,
      createdBy: new ObjectId(masterAccountId),
      ownedBy: new ObjectId(masterAccountId),
      trainedFrom: {
        trainingId: new ObjectId(trainingJobId),
        tool: 'ai-toolkit',
        steps,
        baseModel,
        duration: durationSeconds,
        finalLoss,
        trainedAt: now,
      },
      publishedTo: {
        huggingfaceRepo: hfRepoId,
        huggingfaceUrl: `https://huggingface.co/${hfRepoId}`,
        modelFileUrl: `https://huggingface.co/${hfRepoId}/resolve/main/${modelName}.safetensors`,
        uploadedAt: now,
      },
      moderation: {
        status: 'approved',
        flagged: false,
        requestedBy: new ObjectId(masterAccountId),
        requestedAt: now,
        reviewedBy: 'AUTO_APPROVED_TRAINING',
        reviewedAt: now,
        issues: [],
      },
      cognates: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection('loramodels').insertOne(doc);
    modelDoc = { _id: result.insertedId, ...doc };
    console.log(`Created LoRA model: ${uniqueSlug} (${result.insertedId})`);
  }

  // ── Step 3: Register with ComfyUI Deploy ─────────────────────────────
  if (!comfyDeployApiKey) {
    console.log('No COMFY_DEPLOY_API_KEY found, skipping ComfyUI Deploy registration');
  } else {
    const directUrl = `https://huggingface.co/${hfRepoId}/resolve/main/${modelName}.safetensors`;
    const filename = `${modelDoc.slug}.safetensors`;

    console.log(`Registering with ComfyUI Deploy...`);
    console.log(`  Source: ${directUrl}`);
    console.log(`  Target: loras/${filename}`);

    const response = await comfyDeployUpload({
      source: 'link',
      folderPath: 'loras',
      filename,
      downloadLink: directUrl,
    }, comfyDeployApiKey);

    console.log(`ComfyUI Deploy response: ${response.status}`, response.data);

    if (response.status === 200 || response.status === 201) {
      const comfyDeployId = response.data?.id || response.data?.fileId || null;

      await db.collection('loramodels').updateOne(
        { _id: modelDoc._id },
        {
          $set: {
            'publishedTo.comfyDeployId': comfyDeployId,
            'publishedTo.comfyDeployPath': `loras/${filename}`,
            'publishedTo.comfyDeployUploadedAt': new Date(),
          }
        }
      );
      console.log(`ComfyUI Deploy registered: ${comfyDeployId}`);
    } else {
      console.error('ComfyUI Deploy registration failed');
    }
  }

  // ── Step 4: Update training job status ───────────────────────────────
  const jobUpdate = await db.collection('trainingJobs').updateOne(
    { _id: new ObjectId(trainingJobId) },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
        'result.hfModelUrl': `https://huggingface.co/${hfRepoId}`,
        'result.loraModelId': modelDoc._id,
        'result.loraSlug': modelDoc.slug,
      }
    }
  );
  console.log(`Training job updated: ${jobUpdate.modifiedCount ? 'OK' : 'NOT FOUND'}`);

  console.log('\nDone! Model should be available via trigger word:', triggerWord);
  console.log('Note: LoRA trigger map cache will refresh on next bot restart or cache TTL expiry');

  await client.close();
  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
