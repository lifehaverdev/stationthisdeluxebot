const readline = require('readline');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_PASS;
const dbName = process.env.BOT_NAME || 'stationthisbot';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function updateLoraTags() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('loras');
    
    // Get all FLUX LoRAs
    const loras = await collection.find({
      version: 'FLUX',
      disabled: false
    }).toArray();

    for (const lora of loras) {
      console.log('\n========================================');
      console.log(`Processing LoRA: ${lora.lora_name}`);
      console.log(`Type: ${lora.type}`);
      console.log(`Current tags: ${JSON.stringify(lora.tags || {}, null, 2)}`);
      console.log('========================================\n');

      // Initialize tags if they don't exist
      const updatedTags = {
        ...(lora.tags || {}),
        [lora.type]: true  // Ensure main type is always tagged
      };

      // Ask for additional tags
      let addingTags = true;
      while (addingTags) {
        const addTag = await question('Would you like to add an additional tag? (y/n): ');
        if (addTag.toLowerCase() !== 'y') {
          addingTags = false;
          continue;
        }

        const tag = await question('Enter tag: ');
        updatedTags[tag.toLowerCase()] = true;
      }

      // Update the database
      await collection.updateOne(
        { lora_name: lora.lora_name },
        { $set: { tags: updatedTags } }
      );
      
      console.log(`Updated tags for ${lora.lora_name}`);
    }

    console.log('\nTag update complete!');

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
    rl.close();
  }
}

updateLoraTags().catch(console.error);