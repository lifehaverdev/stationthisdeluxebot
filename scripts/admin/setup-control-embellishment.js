/**
 * Setup control image embellishment for createcontrolkontext spell
 *
 * Run with: node scripts/admin/setup-control-embellishment.js
 */
const { MongoClient } = require('mongodb');

async function main() {
  const spellIdentifier = process.argv[2] || 'createcontrolkontext';

  const client = new MongoClient(process.env.MONGO_PASS);
  await client.connect();
  const db = client.db('noema');

  // Find the spell by slug or name
  let spell = await db.collection('spells').findOne({ slug: spellIdentifier });
  if (!spell) {
    // Try finding by name
    spell = await db.collection('spells').findOne({ name: spellIdentifier });
  }
  if (!spell) {
    // Try finding by slug starting with the identifier
    spell = await db.collection('spells').findOne({ slug: { $regex: `^${spellIdentifier}` } });
  }
  if (!spell) {
    console.log(`Spell "${spellIdentifier}" not found`);
    await client.close();
    return;
  }

  console.log('Found spell:', spell.name, '(', spell.slug, ')');
  console.log('Current embellishment config:', spell.embellishment || 'none');

  // Set embellishment metadata
  // ComfyUI outputs: [{ type: 'image', data: { images: [{ url: '...' }] } }]
  const embellishment = {
    type: 'control',
    resultExtraction: {
      path: 'data.images[0].url',  // Path for ComfyUI image output format
      valueType: 'url'
    },
    requiredContext: ['imageUrl'],  // Requires the source image URL
    optionalContext: [],
    description: 'Generate control/canny edge images for KONTEXT concept training'
  };

  const result = await db.collection('spells').updateOne(
    { _id: spell._id },
    { $set: { embellishment } }
  );

  console.log('Updated spell embellishment config:', result.modifiedCount ? 'success' : 'no change');
  console.log('New config:', embellishment);

  await client.close();
  console.log('Done!');
}

main().catch(console.error);
