require('dotenv').config();
const CollectionDB = require('../db/models/collection');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

async function cloneCollection(originalCollectionId) {
    if (!originalCollectionId) {
        console.error('Usage: node scripts/cloneCollection.js <originalCollectionId>');
        process.exit(1);
    }

    try {
        const collectionDB = new CollectionDB();

        console.log(`Attempting to load collection: ${originalCollectionId}`);
        const originalCollection = await collectionDB.loadCollection(parseInt(originalCollectionId));

        if (!originalCollection) {
            console.error(`Collection with ID "${originalCollectionId}" not found.`);
            return;
        }

        console.log('Found original collection. Cloning...');

        const clonedCollectionData = { ...originalCollection };
        delete clonedCollectionData._id; // Remove the original's _id to get a new one on insert

        const newCollectionId = `CLONE-${uuidv4()}`;
        clonedCollectionData.collectionId = newCollectionId;

        if (clonedCollectionData.name) {
            clonedCollectionData.name = `${clonedCollectionData.name} [CLONE]`;
        } else {
            clonedCollectionData.name = `Clone of ${originalCollectionId}`;
        }
        clonedCollectionData.clonedFrom = originalCollectionId;
        clonedCollectionData.initiated = new Date(); // Use current date for the clone

        await collectionDB.createCollection(clonedCollectionData);
        console.log(`New collection created with ID: ${newCollectionId}`);

        const clonedCollectionForExport = await collectionDB.loadCollection(newCollectionId);
        if (!clonedCollectionForExport) {
            console.error('Could not retrieve the newly created collection for export.');
            return;
        }

        const outputDir = path.join(__dirname, '..', 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const filePath = path.join(outputDir, `${newCollectionId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(clonedCollectionForExport, null, 2));

        console.log(`Cloned collection exported to ${filePath}`);

    } catch (error) {
        console.error('Error cloning collection:', error);
    } 
}

const originalCollectionId = process.argv[2];
cloneCollection(originalCollectionId); 