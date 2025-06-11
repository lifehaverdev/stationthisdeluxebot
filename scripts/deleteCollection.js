require('dotenv').config();
const StudioDB = require('../db/models/studio');

(async () => {
    const collectionId = 9351423251993; //AnimiliaCorp
    const studioDB = new StudioDB();

    try {
        // Find all documents with the specified collectionId
        const documents = await studioDB.findMany({ collectionId });
        console.log(`Found ${documents.length} documents to delete.`);

        // Delete each document
        for (const doc of documents) {
            await studioDB.deleteOne({ _id: doc._id });
            console.log(`Deleted document with ID: ${doc._id}`);
        }

        console.log('All documents deleted successfully.');
    } catch (error) {
        console.error('Error deleting documents:', error);
    }
})(); 