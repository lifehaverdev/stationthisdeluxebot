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
 */
function setupMiddleware(app) {
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
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));
  
  // Add request logging
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

module.exports = {
  setupMiddleware
}; 