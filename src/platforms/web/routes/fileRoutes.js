/**
 * File Routes for StationThis Web Platform
 * 
 * Handles direct file access and special routes for the web client
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

/**
 * Create file routes
 * @returns {express.Router} Express router
 */
function createFileRoutes() {
  const router = express.Router();
  
  // Serve the client test page
  router.get('/test', (req, res) => {
    const testFilePath = path.join(__dirname, '..', 'client', 'dist', 'test.html');
    if (fs.existsSync(testFilePath)) {
      res.sendFile(testFilePath);
    } else {
      res.status(404).send('Test file not found');
    }
  });
  
  // Serve the auth test page
  router.get('/auth-test', (req, res) => {
    const authTestFilePath = path.join(__dirname, '..', 'client', 'dist', 'direct-auth.html');
    if (fs.existsSync(authTestFilePath)) {
      res.sendFile(authTestFilePath);
    } else {
      res.status(404).send('Auth test file not found');
    }
  });
  
  // Direct access to bundle.js
  router.get('/bundle.js', (req, res) => {
    const bundlePath = path.join(__dirname, '..', 'client', 'dist', 'bundle.js');
    if (fs.existsSync(bundlePath)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(bundlePath);
    } else {
      res.status(404).send('Bundle file not found');
    }
  });
  
  // Direct access to bundle.css
  router.get('/bundle.css', (req, res) => {
    const cssPath = path.join(__dirname, '..', 'client', 'dist', 'bundle.css');
    if (fs.existsSync(cssPath)) {
      res.setHeader('Content-Type', 'text/css');
      res.sendFile(cssPath);
    } else {
      res.status(404).send('CSS file not found');
    }
  });
  
  // Direct access to debug script
  router.get('/debug.js', (req, res) => {
    const debugPath = path.join(__dirname, '..', 'client', 'src', 'browser-debug.js');
    if (fs.existsSync(debugPath)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(debugPath);
    } else {
      res.status(404).send('Debug script not found');
    }
  });
  
  // Direct access to simplified auth script
  router.get('/simplified-auth.js', (req, res) => {
    const authPath = path.join(__dirname, '..', 'client', 'src', 'simplified-auth.js');
    if (fs.existsSync(authPath)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(authPath);
    } else {
      // Try looking in the dist folder if not found in src
      const distAuthPath = path.join(__dirname, '..', 'client', 'dist', 'simplified-auth.js');
      if (fs.existsSync(distAuthPath)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.sendFile(distAuthPath);
      } else {
        res.status(404).send('Simplified auth script not found');
      }
    }
  });
  
  // Direct access to direct auth script
  router.get('/direct-auth.js', (req, res) => {
    const directAuthPath = path.join(__dirname, '..', 'client', 'src', 'direct-auth.js');
    if (fs.existsSync(directAuthPath)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(directAuthPath);
    } else {
      // Try looking in the dist folder if not found in src
      const distAuthPath = path.join(__dirname, '..', 'client', 'dist', 'direct-auth.js');
      if (fs.existsSync(distAuthPath)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.sendFile(distAuthPath);
      } else {
        res.status(404).send('Direct auth script not found');
      }
    }
  });
  
  // Direct access to workflow tiles stylesheet
  router.get('/workflow-tiles.css', (req, res) => {
    const tilesPath = path.join(__dirname, '..', 'client', 'src', 'components', 'canvas', 'workflow-tiles.css');
    if (fs.existsSync(tilesPath)) {
      res.setHeader('Content-Type', 'text/css');
      res.sendFile(tilesPath);
    } else {
      res.status(404).send('Workflow tiles stylesheet not found');
    }
  });
  
  return router;
}

module.exports = createFileRoutes; 