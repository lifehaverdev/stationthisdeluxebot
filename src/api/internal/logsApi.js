const express = require('express');
const { getRegistry, setLevel } = require('../../../utils/logger');

function createLogsApi() {
  const router = express.Router();

  router.get('/levels', (req, res) => {
    const modules = [];
    for (const [module, logger] of getRegistry()) {
      modules.push({ module, level: logger.level });
    }
    res.json({ modules });
  });

  router.post('/levels', (req, res) => {
    const { module, level } = req.body;
    if (!module || !level) {
      return res.status(400).json({ error: 'module and level are required' });
    }
    try {
      setLevel(module, level);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createLogsApi };
