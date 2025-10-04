// fix_spell_step_order.js – one-off migration to reorder mislabeled caption spells
// Usage:
//   MONGO_URI="mongodb://localhost:27017/station" node scripts/migration/fix_spell_step_order.js
//
// The script will:
// 1. Connect to MongoDB via MONGO_URI env var
// 2. For the hard-coded list of spell _ids (update as needed), ensure their steps array is ordered:
//      JoyCaption → String Primitive → ChatGPT
//   For the SDXL variant, Tag → String Primitive (no ChatGPT)
// 3. Only reorders the existing steps; ids remain unchanged, so connections keep working.
// 4. Prints before/after step sequences and a summary.

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_PASS;
if (!MONGO_URI) {
  console.error('Missing MONGO_URI env var');
  process.exit(1);
}

const DB_NAME = 'noema';

// --- CONFIG – update these IDs/slugs as needed --------------------------------
const SPELL_FIXES = [
  {
    id: '68e01958eb26adaf366d5326', // stylecaption
    desiredOrder: ['joycaption', 'string-primitive', 'chatgpt-free'],
  },
  {
    id: '68e01a3eeb26adaf366d532d', // subjectcaption
    desiredOrder: ['joycaption', 'string-primitive', 'chatgpt-free'],
  },
  {
    id: '68e01f779c4c3492e4f9c361', // xlcaption
    desiredOrder: ['comfy-97721080eade4b057eae589a1435045aca04c882598f794915100d4634a2c909', 'string-primitive'],
  },
];
// ------------------------------------------------------------------------------

(async function main() {
  const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
  await client.connect();
  const db = client.db(DB_NAME);
  const spells = db.collection('spells');

  let updated = 0;
  for (const fix of SPELL_FIXES) {
    const spell = await spells.findOne({ _id: new ObjectId(fix.id) });
    if (!spell) {
      console.warn(`Spell ${fix.id} not found – skipping.`);
      continue;
    }

    const currentOrder = spell.steps.map(s => s.toolIdentifier);
    const alreadyCorrect = arraysEqual(currentOrder, fix.desiredOrder);
    if (alreadyCorrect) {
      console.log(`Spell ${spell.name} already in desired order.`);
      continue;
    }

    // Build new ordered list by reading existing steps and sorting by desiredOrder index
    const orderMap = new Map(fix.desiredOrder.map((t, idx) => [t, idx]));
    const reordered = [...spell.steps].sort((a, b) => (orderMap.get(a.toolIdentifier) ?? 99) - (orderMap.get(b.toolIdentifier) ?? 99));

    await spells.updateOne({ _id: spell._id }, { $set: { steps: reordered, updatedAt: new Date() } });
    console.log(`Updated ${spell.name}. Old order: ${currentOrder.join(' → ')} | New order: ${reordered.map(s => s.toolIdentifier).join(' → ')}`);
    updated += 1;
  }

  console.log(`\nDone. ${updated} spell(s) fixed.`);
  await client.close();
})();

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
