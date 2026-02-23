const express = require('express');
const { createLogger } = require('../../utils/logger');
const WorkspacesDB = require('../../core/services/db/workspacesDb');

const MAX_SNAPSHOT_SIZE = 900 * 1024; // 900KB (leave buffer for 1MB limit)

/**
 * Validate snapshot structure
 * @param {Object} snapshot - Snapshot to validate
 * @throws {Error} If snapshot is invalid
 */
function validateSnapshotStructure(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('snapshot must be an object');
  }
  
  if (!Array.isArray(snapshot.connections)) {
    throw new Error('snapshot.connections must be an array');
  }
  
  if (!Array.isArray(snapshot.toolWindows)) {
    throw new Error('snapshot.toolWindows must be an array');
  }
  
  // Validate connections
  snapshot.connections.forEach((conn, idx) => {
    if (!conn || typeof conn !== 'object') {
      throw new Error(`connection at index ${idx} must be an object`);
    }
    if (!conn.id || typeof conn.id !== 'string') {
      throw new Error(`connection at index ${idx} missing or invalid id`);
    }
    if (!conn.fromWindowId || typeof conn.fromWindowId !== 'string') {
      throw new Error(`connection at index ${idx} missing or invalid fromWindowId`);
    }
    if (!conn.toWindowId || typeof conn.toWindowId !== 'string') {
      throw new Error(`connection at index ${idx} missing or invalid toWindowId`);
    }
  });
  
  // Validate tool windows
  snapshot.toolWindows.forEach((win, idx) => {
    if (!win || typeof win !== 'object') {
      throw new Error(`tool window at index ${idx} must be an object`);
    }
    if (!win.id || typeof win.id !== 'string') {
      throw new Error(`tool window at index ${idx} missing or invalid id`);
    }
    if (typeof win.workspaceX !== 'number' || typeof win.workspaceY !== 'number') {
      throw new Error(`tool window at index ${idx} missing or invalid position`);
    }
    
    // Validate based on type
    if (win.isSpell) {
      if (!win.spell || typeof win.spell !== 'object' || !win.spell._id) {
        throw new Error(`spell window at index ${idx} missing spell._id`);
      }
    } else if (win.type === 'collection') {
      if (!win.collection || typeof win.collection !== 'object' || !win.collection.collectionId) {
        throw new Error(`collection window at index ${idx} missing collection.collectionId`);
      }
    } else {
      if (!win.toolId && !win.displayName) {
        throw new Error(`tool window at index ${idx} missing both toolId and displayName`);
      }
    }
  });
}

/**
 * Calculate snapshot size in bytes
 * @param {Object} snapshot - Snapshot to measure
 * @returns {number} Size in bytes
 */
function calculateSnapshotSize(snapshot) {
  try {
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  } catch (e) {
    return 0;
  }
}

function createWorkspacesApi(deps = {}) {
  const router = express.Router();
  // Larger JSON payload to allow snapshots (~1MB)
  router.use(express.json({ limit: '1mb' }));
  const logger = deps.logger || createLogger('WorkspacesAPI');

  const workspacesDb = deps.db?.workspaces || new WorkspacesDB(logger);

  // Middleware to ensure db is available
  router.use((req, res, next) => {
    if (!workspacesDb) return res.status(503).json({ error: 'service-unavailable' });
    next();
  });
  
  // Middleware to validate snapshot size before processing
  router.use('/:slug?', (req, res, next) => {
    if (req.method === 'POST' && req.body.snapshot) {
      const size = calculateSnapshotSize(req.body.snapshot);
      if (size > MAX_SNAPSHOT_SIZE) {
        return res.status(413).json({ 
          error: 'snapshot-too-large',
          message: `Snapshot size (${Math.round(size / 1024)}KB) exceeds maximum (${Math.round(MAX_SNAPSHOT_SIZE / 1024)}KB)`
        });
      }
    }
    next();
  });

  // GET /            – list current user's workspaces; ?walletAddress= narrows to one wallet
  router.get('/', async (req, res) => {
    const userId = req.user?.id || req.userId || req.query.userId;
    if (!userId) return res.json({ workspaces: [] });
    const walletAddress = req.query.walletAddress || null;
    const docs = await workspacesDb.listWorkspacesByOwnerAndWallet(userId, walletAddress, { limit: 100 });
    res.json({ workspaces: docs });
  });

  // POST /           – create workspace (or update if slug provided and owned)
  router.post('/', async (req, res) => {
    try {
      const { slug, snapshot, name = '', visibility = 'public', walletAddress = null, origin = null } = req.body;
      const userId = req.user?.id || req.userId || req.body.userId;
      
      // Validate required fields
      if (!snapshot) {
        return res.status(400).json({ error: 'snapshot-required', message: 'snapshot is required' });
      }
      
      // Validate snapshot structure
      try {
        validateSnapshotStructure(snapshot);
      } catch (validationError) {
        logger.warn('[WorkspacesAPI] Invalid snapshot structure:', validationError.message);
        return res.status(400).json({ 
          error: 'invalid-snapshot',
          message: validationError.message
        });
      }
      
      // Validate visibility
      if (visibility !== 'public' && visibility !== 'private') {
        return res.status(400).json({ 
          error: 'invalid-visibility',
          message: 'visibility must be "public" or "private"'
        });
      }
      
      // Validate name length
      if (name && typeof name === 'string' && name.length > 200) {
        return res.status(400).json({ 
          error: 'name-too-long',
          message: 'name must be 200 characters or less'
        });
      }

      if (slug) {
        // Validate slug format
        if (typeof slug !== 'string' || slug.trim().length === 0) {
          return res.status(400).json({ 
            error: 'invalid-slug',
            message: 'slug must be a non-empty string'
          });
        }
        
        // Attempt update if owner
        try {
          await workspacesDb.updateSnapshot(slug.trim(), snapshot, userId, name || undefined);
          return res.json({ slug: slug.trim(), updated: true });
        } catch (e) {
          if (e.message === 'Forbidden') {
            return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to update this workspace' });
          } else if (e.message === 'Workspace not found') {
            return res.status(404).json({ error: 'not-found', message: 'Workspace not found' });
          }
          logger.error('[WorkspacesAPI] updateSnapshot error', e);
          return res.status(500).json({ error: 'internal-error', message: 'Failed to update workspace' });
        }
      }

      // Resolve authoritative provenance from the original doc (don't trust client-supplied ids)
      let resolvedOrigin = null;
      if (origin && origin.slug) {
        const originalDoc = await workspacesDb.findBySlug(origin.slug);
        if (originalDoc) {
          resolvedOrigin = {
            slug: originalDoc.slug,
            ownerId: originalDoc.ownerId || null,
            walletAddress: originalDoc.walletAddress || null,
          };
        } else {
          // Original no longer exists — preserve the slug reference only
          resolvedOrigin = { slug: origin.slug, ownerId: null, walletAddress: null };
        }
      }

      const doc = await workspacesDb.createWorkspace({
        snapshot,
        name: (name || '').trim(),
        ownerId: userId,
        walletAddress: walletAddress || null,
        origin: resolvedOrigin,
        visibility
      });
      return res.status(201).json(doc);
    } catch (err) {
      logger.error('[WorkspacesAPI] create error', err);
      res.status(500).json({ error: 'internal-error', message: 'Failed to create workspace' });
    }
  });

  // GET /:slug       – fetch workspace by slug (public or owned)
  router.get('/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      if (!slug || slug.length === 0) {
        return res.status(400).json({ error: 'invalid-slug', message: 'Invalid workspace ID' });
      }
      
      const doc = await workspacesDb.findBySlug(slug);
      if (!doc) {
        return res.status(404).json({ error: 'not-found', message: 'Workspace not found' });
      }
      
      const userId = req.user?.id || req.userId;
      
      // Check authorization for private workspaces
      if (doc.visibility === 'private') {
        // Allow access if no owner (anonymous workspace) or if user is owner
        const isOwner = !doc.ownerId || (userId && doc.ownerId.toString() === userId.toString());
        if (!isOwner) {
          return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to access this workspace' });
        }
      }
      
      res.json(doc);
    } catch (err) {
      logger.error('[WorkspacesAPI] get error', err);
      res.status(500).json({ error: 'internal-error', message: 'Failed to fetch workspace' });
    }
  });

  // DELETE /:slug    – delete if owner
  router.delete('/:slug', async (req, res) => {
    try {
      const slug = req.params.slug?.trim();
      if (!slug || slug.length === 0) {
        return res.status(400).json({ error: 'invalid-slug', message: 'Invalid workspace ID' });
      }
      
      const userId = req.user?.id || req.userId;
      
      try {
        await workspacesDb.deleteWorkspace(slug, userId);
        res.json({ ok: true, message: 'Workspace deleted successfully' });
      } catch (e) {
        if (e.message === 'Workspace not found') {
          return res.status(404).json({ error: 'not-found', message: 'Workspace not found' });
        }
        // deleteWorkspace may throw if not owner - treat as forbidden
        return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to delete this workspace' });
      }
    } catch (err) {
      logger.error('[WorkspacesAPI] delete error', err);
      res.status(500).json({ error: 'internal-error', message: 'Failed to delete workspace' });
    }
  });

  return router;
}

module.exports = { createWorkspacesApi };
