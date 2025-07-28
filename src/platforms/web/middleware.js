/**
 * Web Platform Middleware
 * 
 * Configures Express middleware for the web platform
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');

/**
 * Set up middleware for the Express app
 * @param {Express} app - Express application instance
 * @param {Object} logger - Logger instance
 */
function setupMiddleware(app, logger) {
  // Parse JSON request body
  app.use(express.json());
  
  // Parse URL-encoded request body
  app.use(express.urlencoded({ extended: true }));
  
  // Enable CORS
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }));
  
  // Parse cookies
  app.use(cookieParser());
  
  // Set up session middleware
  app.use(session({
    secret: process.env.SESSION_SECRET || 'stationthis-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true, // Extend cookie expiration on every response if the user is active
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));
  
  // Add request logging
  app.use((req, res, next) => {
    const logOutput = {
      method: req.method,
      url: req.url,
      status: res.statusCode, // This might be more useful on response, but here for request time
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
    // Use logger.info for request logging
    if (logger && typeof logger.info === 'function') {
      logger.info('Incoming HTTP request', logOutput);
    } else {
      // Fallback if logger is not properly passed (should not happen)
      console.log(`[REQUEST] ${new Date().toISOString()} ${req.method} ${req.url}`);
    }
    next();
  });
}

module.exports = {
  setupMiddleware
}; 