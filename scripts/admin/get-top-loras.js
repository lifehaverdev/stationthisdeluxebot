#!/usr/bin/env node
/**
 * Get top LoRAs by usage count from live database
 * Usage: node scripts/admin/get-top-loras.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/stationthisdeluxebot';

async function getTopLoras() {
  const client = new MongoClient(DB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db('noema');
    const collection = db.collection('loraModels');

    // Get top 50 public LoRAs by usageCount
    const loras = await collection.find({
      visibility: 'public',
      'moderation.status': { $in: ['approved', null] }
    })
    .sort({ usageCount: -1 })
    .limit(50)
    .project({
      name: 1,
      slug: 1,
      usageCount: 1,
      checkpoint: 1,
      modelType: 1,
      triggerWords: 1,
      description: 1,
      tags: 1
    })
    .toArray();

    console.log('\n--- TOP 50 LORAS BY USAGE ---\n');
    console.log('| # | Name | Uses | Checkpoint | Type | Trigger |');
    console.log('|---|------|------|------------|------|---------|');

    loras.forEach((lora, i) => {
      const trigger = (lora.triggerWords || []).slice(0, 2).join(', ') || 'N/A';
      const type = lora.modelType || 'unknown';
      console.log(`| ${i + 1} | ${lora.name} | ${lora.usageCount || 0} | ${lora.checkpoint || 'unknown'} | ${type} | ${trigger} |`);
    });

    // Also output as JSON for easier parsing
    console.log('\n--- JSON OUTPUT ---\n');
    console.log(JSON.stringify(loras.map((l, i) => ({
      rank: i + 1,
      name: l.name,
      slug: l.slug,
      uses: l.usageCount || 0,
      checkpoint: l.checkpoint,
      type: l.modelType,
      triggers: l.triggerWords,
      description: l.description
    })), null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

getTopLoras();
