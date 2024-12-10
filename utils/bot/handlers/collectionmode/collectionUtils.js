const { studio } = require('../../bot');
const { loadCollection } = require('../../../../db/mongodb');

async function getOrLoadCollection(userId, collectionId) {
    console.log('userId',userId,'collectionId',collectionId)
    if (studio[userId]?.[collectionId]) {
        console.log(`Using cached collection data for user ${userId}, collection ${collectionId}`);
        return studio[userId][collectionId];
    }

    console.log(`Loading collection data for user ${userId}, collection ${collectionId} from database...`);
    const collectionData = await loadCollection(collectionId);

    if (!collectionData) {
        throw new Error(`collection data not found for ID ${collectionId}`);
    }

    // Initialize studio for the user if necessary
    if (!studio[userId]) {
        studio[userId] = {};
    }

    // Cache the loaded data in the namespaced studio
    studio[userId][collectionId] = collectionData;
    console.log('collection data loaded and cached in studio',studio[userId][collectionId])
    return collectionData;
}


function calculateCompletionPercentage(collectionData) {
    const { config } = collectionData;
    const traitTypes = config.traitTypes;

    // Handle the case where there are no trait types yet
    if (traitTypes.length === 0) {
        return 0; // 0% completion if no trait types are defined
    }

    // Calculate completion as a percentage based on the number of trait types
    const maxTraitTypes = 10; // 10 trait types means 100% completion
    const currentTraitTypes = traitTypes.length;

    // Calculate the percentage
    const completionPercentage = Math.min((currentTraitTypes / maxTraitTypes) * 100, 100);

    return completionPercentage;
}

module.exports = {
    getOrLoadCollection,
    calculateCompletionPercentage
}