const { BaseDB } = require('./BaseDB');

class CollectionDB extends BaseDB {
    constructor() {
        super('gallery');
    }

    async createCollection(collectionData) {
        return this.insertOne(collectionData);
    }

    async loadCollection(collectionId) {
        return this.findOne({ collectionId });
    }

    async getCollectionsByUserId(userId) {
        return this.findMany({ userId }, {
            sort: { initiated: -1 }  // Sort by creation date, newest first
        });
    }

    async deleteCollection(collectionId) {
        return this.deleteOne({ collectionId });
    }

    async saveStudio(studioData) {
        return this.updateOne(
            { collectionId: studioData.collectionId },
            studioData
        );
    }
}

module.exports = CollectionDB; 