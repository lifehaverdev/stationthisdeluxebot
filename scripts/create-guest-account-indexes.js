/**
 * MongoDB Index Creation Script for Guest Accounts
 * 
 * Creates indexes on the userCore collection for guest account queries.
 * Run this script once to set up the indexes:
 * 
 * node scripts/create-guest-account-indexes.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'noema';

async function createGuestAccountIndexes() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const collection = db.collection('userCore');
    
    // Create indexes for guest account queries
    console.log('Creating indexes for guest accounts...');
    
    // Index for finding guest accounts by spellPaymentId
    await collection.createIndex(
      { 'guestMetadata.spellPaymentId': 1 },
      { name: 'guestMetadata_spellPaymentId_1', background: true }
    );
    console.log('✓ Created index on guestMetadata.spellPaymentId');
    
    // Index for finding guest accounts by transaction hash
    await collection.createIndex(
      { 'guestMetadata.txHash': 1 },
      { name: 'guestMetadata_txHash_1', background: true }
    );
    console.log('✓ Created index on guestMetadata.txHash');
    
    // Index for finding all guest accounts
    await collection.createIndex(
      { isGuest: 1 },
      { name: 'isGuest_1', background: true }
    );
    console.log('✓ Created index on isGuest');
    
    // Compound index for common query pattern: isGuest + spellPaymentId
    await collection.createIndex(
      { isGuest: 1, 'guestMetadata.spellPaymentId': 1 },
      { name: 'isGuest_1_guestMetadata_spellPaymentId_1', background: true }
    );
    console.log('✓ Created compound index on isGuest + guestMetadata.spellPaymentId');
    
    console.log('\n✅ All guest account indexes created successfully!');
    
  } catch (error) {
    console.error('Error creating indexes:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

// Run the script
createGuestAccountIndexes().catch(console.error);

