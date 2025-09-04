const { BaseDB, ObjectId } = require('./BaseDB');
const crypto = require('crypto');

/**
 * @class WorkspacesDB
 *
 * Schema (Mongo):
 * {
 *   _id: ObjectId,
 *   slug: String,           // unique shareable id (8-12 chars)
 *   ownerId: ObjectId|null, // null for anonymous
 *   name: String,
 *   visibility: 'public'|'private',
 *   snapshot: {
 *     connections: Array,
 *     toolWindows: Array
 *   },
 *   sizeBytes: Number,
 *   version: Number,        // schema versioning for migrations
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */
class WorkspacesDB extends BaseDB {
  constructor(logger) {
    super('workspaces');
    this.logger = logger || console;
    // current schema version
    this.schemaVersion = 1;
  }

  /** Generate random slug */
  _generateSlug() {
    return crypto.randomBytes(4).toString('hex'); // 8-char hex
  }

  /**
   * Create a workspace document.
   * @param {Object} params
   * @param {Object} params.snapshot – { connections, toolWindows }
   * @param {String} [params.name]
   * @param {String} [params.ownerId]
   * @param {'public'|'private'} [params.visibility]
   * @returns {Promise<{_id:ObjectId,slug:string}>}
   */
  async createWorkspace({ snapshot, name = '', ownerId = null, visibility = 'public' } = {}) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('snapshot is required');
    }

    const slug = this._generateSlug();
    const now = new Date();
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));

    const doc = {
      slug,
      ownerId: ownerId ? new ObjectId(ownerId) : null,
      name,
      visibility,
      snapshot,
      sizeBytes: bytes,
      version: this.schemaVersion,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.insertOne(doc);
    return { _id: result.insertedId, slug };
  }

  async findBySlug(slug) {
    return this.findOne({ slug });
  }

  async updateSnapshot(slug, snapshot, requesterId = null) {
    const ws = await this.findBySlug(slug);
    if (!ws) throw new Error('Workspace not found');
    if (ws.ownerId && requesterId && ws.ownerId.toString() !== requesterId.toString()) {
      throw new Error('Forbidden');
    }
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));
    return this.updateOne({ slug }, {
      $set: { snapshot, sizeBytes: bytes, updatedAt: new Date() }
    });
  }

  async listWorkspacesByOwner(ownerId, { limit = 50, skip = 0 } = {}) {
    return this.findMany({ ownerId: new ObjectId(ownerId) }, { limit, skip, sort: { updatedAt: -1 } });
  }

  async deleteWorkspace(slug, requesterId) {
    const filt = { slug };
    if (requesterId) filt.ownerId = new ObjectId(requesterId);
    return this.deleteOne(filt);
  }
}

module.exports = WorkspacesDB;
