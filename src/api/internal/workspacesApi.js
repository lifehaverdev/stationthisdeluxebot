const express = require('express');
const { createLogger } = require('../../utils/logger');
const WorkspacesDB = require('../../core/services/db/workspacesDb');

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

  // GET /            – list current user's workspaces
  router.get('/', async (req, res) => {
    const userId = req.user?.id || req.userId || req.query.userId;
    if (!userId) return res.json({ workspaces: [] });
    const docs = await workspacesDb.listWorkspacesByOwner(userId, { limit: 100 });
    res.json({ workspaces: docs });
  });

  // POST /           – create workspace (or update if slug provided and owned)
  router.post('/', async (req, res) => {
    try {
      const { slug, snapshot, name = '', visibility = 'public' } = req.body;
      const userId = req.user?.id || req.userId || req.body.userId;
      if (!snapshot) return res.status(400).json({ error: 'snapshot required' });

      if (slug) {
        // Attempt update if owner
        try {
          await workspacesDb.updateSnapshot(slug, snapshot, userId);
          return res.json({ slug, updated: true });
        } catch (e) {
          if (e.message === 'Forbidden') {
            return res.status(403).json({ error: 'forbidden' });
          } else if (e.message === 'Workspace not found') {
            return res.status(404).json({ error: 'not-found' });
          }
          logger.error('[WorkspacesAPI] updateSnapshot error', e);
          return res.status(500).json({ error: 'internal-error' });
        }
      }

      const doc = await workspacesDb.createWorkspace({ snapshot, name, ownerId: userId, visibility });
      return res.status(201).json(doc);
    } catch (err) {
      logger.error('[WorkspacesAPI] create error', err);
      res.status(500).json({ error: 'internal-error' });
    }
  });

  // GET /:slug       – fetch workspace by slug (public or owned)
  router.get('/:slug', async (req, res) => {
    try {
      const doc = await workspacesDb.findBySlug(req.params.slug);
      if (!doc) return res.status(404).json({ error: 'not-found' });
      const userId = req.user?.id || req.userId;
      if (doc.visibility === 'private' && (!userId || doc.ownerId?.toString() !== userId.toString())) {
        return res.status(403).json({ error: 'forbidden' });
      }
      res.json(doc);
    } catch (err) {
      logger.error('[WorkspacesAPI] get error', err);
      res.status(500).json({ error: 'internal-error' });
    }
  });

  // DELETE /:slug    – delete if owner
  router.delete('/:slug', async (req, res) => {
    try {
      const userId = req.user?.id || req.userId;
      await workspacesDb.deleteWorkspace(req.params.slug, userId);
      res.json({ ok: true });
    } catch (err) {
      logger.error('[WorkspacesAPI] delete error', err);
      res.status(500).json({ error: 'internal-error' });
    }
  });

  return router;
}

module.exports = { createWorkspacesApi };
