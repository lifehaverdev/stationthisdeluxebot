const { BaseDB } = require('./BaseDB');
const { v4: uuidv4 } = require('uuid');

class CookCollectionsDB extends BaseDB {
  constructor(logger) {
    // Use new consolidated collection name. Keep legacy class name for backward compatibility.
    super('collections');
    this.logger = logger || console;
    // Align DB name with other services (noema by default)
    this.dbName = 'noema' || process.env.MONGO_DB_NAME || 'station';
  }

  /**
   * Create a new collection doc.
   */
  async createCollection({ name, description = '', userId, config = {} }) {
    const doc = {
      collectionId: uuidv4(),
      name,
      description,
      userId,
      config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.insertOne(doc);
    return doc;
  }

  async findByUser(userId) {
    return this.findMany({ userId }, { projection: { _id: 0 } });
  }

  async findById(collectionId) {
    return this.findOne({ collectionId }, { projection: { _id: 0 } });
  }

  async updateCollection(collectionId, update) {
    update.updatedAt = new Date();
    await this.updateOne({ collectionId }, { $set: update });
  }

  async deleteCollection(collectionId, userId) {
    const query = { collectionId };
    if (userId) query.userId = userId;
    await this.deleteOne(query);
  }
}

module.exports = CookCollectionsDB; 