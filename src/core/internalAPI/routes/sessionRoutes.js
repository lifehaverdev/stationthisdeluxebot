/**
 * Session Routes
 * 
 * API routes for session management, handling authentication, validation, and session operations.
 */

const express = require('express');
const { SessionAgent, generateApiKey, signNonce } = require('../../session/sessionAgent');
const { SessionService } = require('../../session/service');
const { Logger } = require('../../../utils/logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'session-routes'
});

// Create router
const router = express.Router();

// Initialize session service and agent
const sessionService = new SessionService();
const sessionAgent = new SessionAgent({ 
  sessionService,
  logger
});

// Store nonces temporarily (in a real implementation, this would be in Redis/DB)
const nonceStore = new Map();

/**
 * Validate API key and get session
 * POST /api/internal/session/validate
 */
router.post('/validate', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }
    
    // Initialize session with API key
    const result = await sessionAgent.initializeWebSession({ apiKey });
    
    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error
      });
    }
    
    // Return session data
    res.status(200).json({
      success: true,
      session: result.session
    });
  } catch (error) {
    logger.error('Error validating API key', { error });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Generate nonce for wallet authentication
 * POST /api/internal/session/nonce
 */
router.post('/nonce', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }
    
    // Generate random nonce
    const nonce = Math.floor(Math.random() * 1000000).toString();
    const timestamp = Date.now();
    
    // Store nonce with expiration (10 minutes)
    nonceStore.set(walletAddress, {
      nonce,
      timestamp,
      expires: timestamp + (10 * 60 * 1000)
    });
    
    // Clean up expired nonces
    const expired = [];
    nonceStore.forEach((data, address) => {
      if (data.expires < Date.now()) {
        expired.push(address);
      }
    });
    
    expired.forEach(address => nonceStore.delete(address));
    
    // Return nonce
    res.status(200).json({
      success: true,
      nonce,
      expires: timestamp + (10 * 60 * 1000)
    });
  } catch (error) {
    logger.error('Error generating nonce', { error });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Validate wallet signature
 * POST /api/internal/session/wallet
 */
router.post('/wallet', async (req, res) => {
  try {
    const { walletAddress, signature, nonce } = req.body;
    
    if (!walletAddress || !signature || !nonce) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address, signature, and nonce are required'
      });
    }
    
    // Check if nonce exists and is valid
    const storedNonce = nonceStore.get(walletAddress);
    
    if (!storedNonce || storedNonce.nonce !== nonce) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired nonce'
      });
    }
    
    // Check if nonce is expired
    if (storedNonce.expires < Date.now()) {
      nonceStore.delete(walletAddress);
      
      return res.status(401).json({
        success: false,
        error: 'Expired nonce'
      });
    }
    
    // Initialize session with wallet
    const result = await sessionAgent.initializeWebSession({
      walletAddress,
      walletSignature: signature,
      nonce
    });
    
    // Remove used nonce
    nonceStore.delete(walletAddress);
    
    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error
      });
    }
    
    // Return session data
    res.status(200).json({
      success: true,
      session: result.session
    });
  } catch (error) {
    logger.error('Error validating wallet', { error });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Create guest session
 * POST /api/internal/session/guest
 */
router.post('/guest', async (req, res) => {
  try {
    // Initialize guest session
    const result = await sessionAgent.initializeWebSession({ isGuest: true });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Return session data
    res.status(200).json({
      success: true,
      session: result.session
    });
  } catch (error) {
    logger.error('Error creating guest session', { error });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get current session
 * GET /api/internal/session
 */
router.get('/', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key is required'
      });
    }
    
    // Get session by API key
    const session = await sessionService.getSessionByApiKey(apiKey);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    // Return session data
    res.status(200).json({
      success: true,
      session: {
        userId: session.userId,
        apiKey,
        clientType: session.state.activeClientType,
        isGuest: session.state.isGuest || false,
        hasWallet: !!session.state.walletAddress,
        points: session.state.points || 0,
        verified: session.state.verified || false
      }
    });
  } catch (error) {
    logger.error('Error getting session', { error });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Update session
 * PUT /api/internal/session
 */
router.put('/', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const updates = req.body;
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key is required'
      });
    }
    
    // Get session by API key
    const session = await sessionService.getSessionByApiKey(apiKey);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    // Update session
    const updatedSession = await sessionService.updateSession(session.userId, updates);
    
    // Return updated session data
    res.status(200).json({
      success: true,
      session: {
        userId: updatedSession.userId,
        apiKey,
        clientType: updatedSession.state.activeClientType,
        isGuest: updatedSession.state.isGuest || false,
        hasWallet: !!updatedSession.state.walletAddress,
        points: updatedSession.state.points || 0,
        verified: updatedSession.state.verified || false
      }
    });
  } catch (error) {
    logger.error('Error updating session', { error });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * End session
 * DELETE /api/internal/session
 */
router.delete('/', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key is required'
      });
    }
    
    // Get session by API key
    const session = await sessionService.getSessionByApiKey(apiKey);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    // End session
    await sessionService.endSession(session.userId);
    
    // Return success
    res.status(200).json({
      success: true,
      message: 'Session ended'
    });
  } catch (error) {
    logger.error('Error ending session', { error });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router; 