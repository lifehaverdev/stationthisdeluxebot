/**
 * Pipeline API routes for StationThis web interface
 * Handles pipeline templates and related operations
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const db = require('../../../../core/services/db');

/**
 * Get all pipeline templates for the current user
 * GET /api/pipelines/templates
 */
router.get('/templates', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get templates from the database
    const templates = await db.query(
      'SELECT * FROM pipeline_templates WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    
    // Format templates
    const formattedTemplates = templates.map(template => {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        tiles: JSON.parse(template.tiles),
        connections: JSON.parse(template.connections),
        createdAt: template.created_at
      };
    });
    
    res.json(formattedTemplates);
  } catch (error) {
    console.error('Error fetching pipeline templates:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline templates' });
  }
});

/**
 * Create a new pipeline template
 * POST /api/pipelines/templates
 */
router.post('/templates', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description, tiles, connections } = req.body;
    
    // Validate request
    if (!name || !tiles || !connections) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Create template in database
    const result = await db.query(
      'INSERT INTO pipeline_templates (id, user_id, name, description, tiles, connections, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        req.body.id || `template-${Date.now()}`,
        userId,
        name,
        description || '',
        JSON.stringify(tiles),
        JSON.stringify(connections),
        new Date().toISOString()
      ]
    );
    
    // Return success
    res.status(201).json({
      id: req.body.id || `template-${Date.now()}`,
      name,
      description,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating pipeline template:', error);
    res.status(500).json({ error: 'Failed to create pipeline template' });
  }
});

/**
 * Get a specific pipeline template by ID
 * GET /api/pipelines/templates/:id
 */
router.get('/templates/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;
    
    // Get template from database
    const templates = await db.query(
      'SELECT * FROM pipeline_templates WHERE id = ? AND user_id = ?',
      [templateId, userId]
    );
    
    if (templates.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    const template = templates[0];
    
    // Format template
    const formattedTemplate = {
      id: template.id,
      name: template.name,
      description: template.description,
      tiles: JSON.parse(template.tiles),
      connections: JSON.parse(template.connections),
      createdAt: template.created_at
    };
    
    res.json(formattedTemplate);
  } catch (error) {
    console.error('Error fetching pipeline template:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline template' });
  }
});

/**
 * Delete a pipeline template
 * DELETE /api/pipelines/templates/:id
 */
router.delete('/templates/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const templateId = req.params.id;
    
    // Delete template from database
    const result = await db.query(
      'DELETE FROM pipeline_templates WHERE id = ? AND user_id = ?',
      [templateId, userId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting pipeline template:', error);
    res.status(500).json({ error: 'Failed to delete pipeline template' });
  }
});

module.exports = router; 