require('dotenv').config();
const fs = require('fs');
const path = require('path');
const CollectionDB = require('../db/models/collection');

async function overwriteCollection(collectionId, filePath) {
    if (!collectionId || !filePath) {
        console.error('Usage: node scripts/overwriteCollection.js <collectionId> <filePath>');
        process.exit(1);
    }

    try {
        const absolutePath = path.resolve(filePath);
        if (!fs.existsSync(absolutePath)) {
            console.error(`Error: File not found at ${absolutePath}`);
            process.exit(1);
        }

        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        const collectionData = JSON.parse(fileContent);

        // Basic validation
        if (typeof collectionData !== 'object' || collectionData === null || !collectionData.collectionId) {
            console.error('Error: Invalid JSON format. The file must contain a valid collection object with a "collectionId" property.');
            process.exit(1);
        }
        
        const targetCollectionId = parseInt(collectionId, 10);
        if (isNaN(targetCollectionId)) {
            console.error('Error: Invalid collectionId. It must be a number.');
            process.exit(1);
        }

        const collectionDB = new CollectionDB();

        console.log(`Checking for existing collection with ID: ${targetCollectionId}`);
        const existingCollection = await collectionDB.loadCollection(targetCollectionId);

        if (!existingCollection) {
            console.error(`Error: Collection with ID "${targetCollectionId}" not found.`);
            return;
        }

        console.log(`Found existing collection. Overwriting with data from ${filePath}`);
        
        // Prepare data for update
        const dataToUpdate = { ...collectionData };
        delete dataToUpdate._id; // Ensure we don't try to overwrite the immutable _id
        dataToUpdate.collectionId = targetCollectionId; // Set the collectionId to the target

        // The createCollection method uses updateOne with upsert, which is perfect for overwriting.
        const result = await collectionDB.createCollection(dataToUpdate);

        if (result.matchedCount > 0) {
            console.log(`Successfully overwrote collection with ID: ${targetCollectionId}`);
        } else {
            console.error(`Failed to overwrite collection with ID: ${targetCollectionId}.`);
        }

    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error('Error: Invalid JSON in file.', error);
        } else {
            console.error('An unexpected error occurred:', error);
        }
    }
}

const collectionId = process.argv[2];
const filePath = process.argv[3];
overwriteCollection(collectionId, filePath); 