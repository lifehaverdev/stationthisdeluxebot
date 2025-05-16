const fs = require('fs');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

// MongoDB connection string
const uri = process.env.MONGO_PASS;
const dbName = 'stationthisbot';

async function uploadLoras() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(dbName);
    const lorasCollection = db.collection('loras');

    // Read and parse the CSV
    const csvContent = fs.readFileSync('./db/data/enriched_loras.csv', 'utf8');
    const [header, ...lines] = csvContent.trim().split('\n');
    const headers = header.split(',').map(h => h.replace(/"/g, ''));

    // Transform CSV lines into documents
    const documents = lines.map(line => {
      const values = line.split(',').map(val => {
        // Remove quotes and handle empty values
        const cleaned = val.replace(/^"|"$/g, '');
        return cleaned === '' ? null : cleaned;
      });

      // Create base document from CSV values
      const doc = headers.reduce((obj, header, index) => {
        let value = values[index];

        // Parse JSON strings
        if (header === 'tagsJson' || header === 'cognatesJson') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            console.warn(`Failed to parse JSON for ${header} in row:`, line);
            value = header === 'tagsJson' ? {} : [];
          }
        }

        // Parse numbers
        if (header === 'default_weight' || header === 'gate' || header === 'uses') {
          value = parseFloat(value) || 0;
        }

        obj[header] = value;
        return obj;
      }, {});

      // Add additional fields
      return {
        ...doc,
        tags: doc.tagsJson,        // Rename tagsJson to tags
        cognates: doc.cognatesJson, // Rename cognatesJson to cognates
        disabled: false,           // New field
        rating: 0,                // New field
        triggerWords: doc.triggerWords.split('|').map(w => w.trim()).filter(w => w !== '#'), // Split trigger words into array
      };
    });

    // Remove old fields
    documents.forEach(doc => {
      delete doc.tagsJson;
      delete doc.cognatesJson;
    });

    // Insert all documents
    const result = await lorasCollection.insertMany(documents);
    console.log(`Successfully inserted ${result.insertedCount} documents`);

    // Create indexes
    await lorasCollection.createIndex({ lora_name: 1 }, { unique: true });
    await lorasCollection.createIndex({ type: 1 });
    await lorasCollection.createIndex({ disabled: 1 });
    await lorasCollection.createIndex({ version: 1 });
    await lorasCollection.createIndex({ uses: -1 });
    await lorasCollection.createIndex({ rating: -1 });

    console.log('Indexes created successfully');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

uploadLoras().catch(console.error);