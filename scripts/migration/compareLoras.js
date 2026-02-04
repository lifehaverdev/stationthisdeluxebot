/**
 * compareLoras.js - Compare legacy loras to noema loraModels
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const lorasCol = legacyDb.collection('loras');
  const noemaDb = client.db('noema');
  const loraModelsCol = noemaDb.collection('loraModels');

  // Count legacy vs noema
  const legacyCount = await lorasCol.countDocuments({});
  const noemaCount = await loraModelsCol.countDocuments({});
  console.log('Legacy loras:', legacyCount);
  console.log('Noema loraModels:', noemaCount);

  // Find FLUX loras in legacy that aren't in noema
  const legacyFluxLoras = await lorasCol.find({ version: 'FLUX' }).toArray();
  console.log('\nLegacy FLUX loras:', legacyFluxLoras.length);

  const missingInNoema = [];
  for (const lora of legacyFluxLoras) {
    const exists = await loraModelsCol.findOne({
      $or: [
        { slug: lora.lora_name },
        { name: lora.lora_name },
        { slug: lora.lora_name.toLowerCase() },
      ]
    });
    if (!exists) {
      missingInNoema.push(lora.lora_name);
    }
  }

  console.log('\nFLUX loras missing in noema:', missingInNoema.length);
  console.log('Missing:', missingInNoema);

  await client.close();
})();
