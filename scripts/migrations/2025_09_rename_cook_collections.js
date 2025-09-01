#!/usr/bin/env node
/* Rename Mongo collection cook_collections -> collections */
const { MongoClient } = require('mongodb');
(async () => {
  const uri = process.env.MONGO_PASS || 'mongodb://localhost:27017';
  const client = await MongoClient.connect(uri);
  const dbName = 'noema' || process.env.MONGO_DB_NAME || 'station';
  const db = client.db(dbName);
  const oldName='cook_collections';
  const newName='collections';
  const exists = await db.listCollections({ name:newName }).hasNext();
  if(exists){console.log(`[migration] '${newName}' already exists – skipping rename`);await client.close();return;}
  await db.collection(oldName).rename(newName);
  console.log(`[migration] Renamed ${oldName} -> ${newName}`);
  await client.close();
})();
