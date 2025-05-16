const { BaseDB } = require('./BaseDB');

class CollectionDB extends BaseDB {
    constructor() {
        super('gallery');
    }

    async createCollection(collectionData) {
        return this.updateOne(
            { collectionId: collectionData.collectionId },
            collectionData,
            { upsert: true }
        );
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

    /**
     * Get collections shared with a specific user
     * @param {string} userId - User ID to find shared collections for
     * @returns {Promise<Array>} - List of shared collections
     */
    async getSharedCollectionsByUserId(userId) {
        return this.findMany({ 
            'shares.userId': userId 
        }, {
            sort: { initiated: -1 }
        });
    }

    /**
     * Get collection by share token
     * @param {string} shareToken - Share token
     * @returns {Promise<Object>} - Collection data
     */
    async getCollectionByShareToken(shareToken) {
        return this.findOne({ 
            'shareLinks.token': shareToken 
        });
    }

    /**
     * Add share to a collection
     * @param {string} collectionId - Collection ID
     * @param {Object} shareData - Share data to add
     * @returns {Promise<boolean>} - Success status
     */
    async addShareToCollection(collectionId, shareData) {
        return this.updateOne(
            { collectionId },
            { $push: { shares: shareData } }
        );
    }

    /**
     * Remove share from a collection
     * @param {string} collectionId - Collection ID
     * @param {string} targetUserId - User ID to remove share for
     * @returns {Promise<boolean>} - Success status
     */
    async removeShareFromCollection(collectionId, targetUserId) {
        return this.updateOne(
            { collectionId },
            { $pull: { shares: { userId: targetUserId } } }
        );
    }

    /**
     * Add share link to a collection
     * @param {string} collectionId - Collection ID
     * @param {Object} shareLinkData - Share link data to add
     * @returns {Promise<boolean>} - Success status
     */
    async addShareLinkToCollection(collectionId, shareLinkData) {
        return this.updateOne(
            { collectionId },
            { $push: { shareLinks: shareLinkData } }
        );
    }

    /**
     * Remove share link from a collection
     * @param {string} collectionId - Collection ID
     * @param {string} shareToken - Share token to remove
     * @returns {Promise<boolean>} - Success status
     */
    async removeShareLinkFromCollection(collectionId, shareToken) {
        return this.updateOne(
            { collectionId },
            { $pull: { shareLinks: { token: shareToken } } }
        );
    }
}

module.exports = CollectionDB; 