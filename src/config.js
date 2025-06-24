/**
 * Application Configuration
 * 
 * Central configuration for the application
 * Environment variables take precedence over defaults
 */

const path = require('path');
const { createLogger } = require('./utils/logger'); // Assuming logger is now in utils
const logger = createLogger('config');

// Load environment variables early
// require('dotenv').config(); // This is now handled at the entry point (app.js)

module.exports = {
  // Bot configuration
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  ADMIN_USERS: (process.env.ADMIN_USERS || '').split(',').filter(Boolean),
  
  // Database configuration
  DB_URI: process.env.DB_URI || 'mongodb://localhost:27017/stationthisdeluxebot',
  
  // Storage configuration
  STORAGE_PATH: process.env.STORAGE_PATH || path.join(process.cwd(), 'storage'),
  
  // Media configuration
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10), // 50MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_AUDIO_TYPES: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/quicktime', 'video/mpeg', 'video/webm'],
  
  // Pagination
  DEFAULT_PAGE_SIZE: parseInt(process.env.DEFAULT_PAGE_SIZE || '10', 10),
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  IS_DEVELOPMENT: process.env.NODE_ENV !== 'production',
  IS_TEST: process.env.NODE_ENV === 'test'
}; 