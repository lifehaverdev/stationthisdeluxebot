const { BaseDB, ObjectId } = require('./BaseDB');
const crypto = require('crypto');

/**
 * @class WorkspacesDB
 *
 * Schema (Mongo):
 * {
 *   _id: ObjectId,
 *   slug: String,              // unique shareable id (8-12 chars)
 *   ownerId: ObjectId|null,    // null for anonymous
 *   walletAddress: String|null, // lowercase wallet address; enables per-wallet workspaces
 *   name: String,
 *   visibility: 'public'|'private',
 *   snapshot: {
 *     connections: Array,
 *     toolWindows: Array
 *   },
 *   sizeBytes: Number,
 *   version: Number,           // schema versioning for migrations
 *   origin: {                  // set when forked from another workspace
 *     slug: String,            // original workspace slug
 *     ownerId: ObjectId|null,  // original owner
 *     walletAddress: String|null // original wallet
 *   } | null,
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
   * @param {String} [params.walletAddress] – lowercase wallet address
   * @param {'public'|'private'} [params.visibility]
   * @returns {Promise<{_id:ObjectId,slug:string}>}
   */
  async createWorkspace({ snapshot, name = '', ownerId = null, walletAddress = null, origin = null, visibility = 'public' } = {}) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('snapshot is required');
    }

    // Generate unique slug with collision detection
    let slug;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
      slug = this._generateSlug();
      const existing = await this.findBySlug(slug);
      if (!existing) break;
      attempts++;
    } while (attempts < maxAttempts);
    
    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique workspace slug');
    }

    const now = new Date();
    // Use Buffer.byteLength for accurate UTF-8 byte count (matches MongoDB storage)
    const bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');

    const doc = {
      slug,
      ownerId: ownerId ? new ObjectId(ownerId) : null,
      walletAddress: walletAddress ? walletAddress.toLowerCase() : null,
      name: (name || '').trim(),
      visibility,
      snapshot,
      sizeBytes: bytes,
      version: this.schemaVersion,
      origin: origin || null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.insertOne(doc);
    return { _id: result.insertedId, slug };
  }

  async findBySlug(slug) {
    return this.findOne({ slug });
  }

  async updateSnapshot(slug, snapshot, requesterId = null, name = undefined) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('snapshot is required');
    }

    const ws = await this.findBySlug(slug);
    if (!ws) throw new Error('Workspace not found');

    // Authorization: allow update if workspace has no owner (anonymous) OR requester is owner
    if (ws.ownerId) {
      // Workspace has owner - require matching requesterId
      if (!requesterId) {
        throw new Error('Forbidden');
      }
      // Convert both to strings for comparison (handles ObjectId vs string)
      if (ws.ownerId.toString() !== requesterId.toString()) {
        throw new Error('Forbidden');
      }
    }
    // If no ownerId, allow update (anonymous workspace)

    // Use Buffer.byteLength for accurate UTF-8 byte count
    const bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');

    const $set = { snapshot, sizeBytes: bytes, updatedAt: new Date() };
    if (typeof name === 'string') $set.name = name.trim();

    const result = await this.updateOne({ slug }, { $set });
    
    if (result.matchedCount === 0) {
      throw new Error('Workspace not found');
    }
    
    return result;
  }

  async listWorkspacesByOwner(ownerId, { limit = 50, skip = 0 } = {}) {
    return this.findMany({ ownerId: new ObjectId(ownerId) }, { limit, skip, sort: { updatedAt: -1 } });
  }

  /**
   * List workspaces for a specific wallet address owned by a user.
   * Falls back to all owner workspaces if walletAddress is null.
   */
  async listWorkspacesByOwnerAndWallet(ownerId, walletAddress, { limit = 50, skip = 0 } = {}) {
    const filter = { ownerId: new ObjectId(ownerId) };
    if (walletAddress) {
      filter.walletAddress = walletAddress.toLowerCase();
    }
    return this.findMany(filter, { limit, skip, sort: { updatedAt: -1 } });
  }

  async deleteWorkspace(slug, requesterId) {
    const ws = await this.findBySlug(slug);
    if (!ws) {
      throw new Error('Workspace not found');
    }
    
    // Authorization: only owner can delete (or anonymous if no owner)
    if (ws.ownerId) {
      if (!requesterId) {
        throw new Error('Forbidden');
      }
      if (ws.ownerId.toString() !== requesterId.toString()) {
        throw new Error('Forbidden');
      }
    }
    
    const result = await this.deleteOne({ slug });
    if (result.deletedCount === 0) {
      throw new Error('Workspace not found');
    }
    
    return result;
  }
}

module.exports = WorkspacesDB;
