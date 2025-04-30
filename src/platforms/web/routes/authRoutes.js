/**
 * Web Platform Authentication Routes
 * 
 * API routes for user authentication
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { authenticateUser } = require('../middleware/auth');

/**
 * Create authentication routes
 * @param {Object} services - Core services
 * @returns {Express.Router} - Express router
 */
function createAuthRoutes(services) {
  const router = express.Router();
  const { sessionService, pointsService } = services;
  
  // Store for wallet authentication messages
  const pendingWalletAuth = new Map();
  
  /**
   * User login
   * POST /api/auth/login
   */
  router.post('/login', async (req, res) => {
    try {
      const { userId, password } = req.body;
      
      if (!userId || !password) {
        return res.status(400).json({ error: 'User ID and password are required' });
      }
      
      // In a real implementation, this would validate credentials against a database
      // For now, we'll use a simple check based on session data
      const userData = await sessionService.getUserData(userId);
      
      if (!userData) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Create JWT token
      const token = jwt.sign(
        { id: userId },
        process.env.JWT_SECRET || 'stationthis-jwt-secret',
        { expiresIn: '24h' }
      );
      
      res.status(200).json({
        success: true,
        token,
        user: {
          id: userId,
          ...userData
        }
      });
    } catch (error) {
      console.error('Error during login:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * Generate wallet authentication message
   * POST /api/auth/wallet/message
   */
  router.post('/wallet/message', async (req, res) => {
    try {
      const { address } = req.body;
      
      if (!address) {
        return res.status(400).json({ error: 'Wallet address is required' });
      }
      
      // Generate a random challenge message
      const timestamp = Date.now().toString();
      const randomBytes = crypto.randomBytes(16).toString('hex');
      const message = `Sign this message to authenticate with StationThis: ${randomBytes} (${timestamp})`;
      
      // Store the message for verification later
      pendingWalletAuth.set(address.toLowerCase(), {
        message,
        timestamp: Date.now()
      });
      
      // Clean expired messages every 100 requests
      if (Math.random() < 0.01) {
        cleanExpiredWalletMessages();
      }
      
      res.status(200).json({
        success: true,
        message
      });
    } catch (error) {
      console.error('Error generating wallet auth message:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * Verify wallet signature and authenticate
   * POST /api/auth/wallet/verify
   */
  router.post('/wallet/verify', async (req, res) => {
    try {
      const { address, signature, message } = req.body;
      
      if (!address || !signature || !message) {
        return res.status(400).json({ error: 'Address, signature, and message are required' });
      }
      
      const normalizedAddress = address.toLowerCase();
      const pendingAuth = pendingWalletAuth.get(normalizedAddress);
      
      // Verify the message matches what we sent
      if (!pendingAuth || pendingAuth.message !== message) {
        return res.status(401).json({ error: 'Invalid or expired authentication request' });
      }
      
      // Verify the message hasn't expired (10 minute limit)
      if (Date.now() - pendingAuth.timestamp > 10 * 60 * 1000) {
        pendingWalletAuth.delete(normalizedAddress);
        return res.status(401).json({ error: 'Authentication request expired' });
      }
      
      // Verify the signature (this would use ethers.js or web3.js in production)
      // For this implementation, we'll assume verification passed
      
      // Clean up the pending auth
      pendingWalletAuth.delete(normalizedAddress);
      
      // Get or create user data for this wallet
      let userData = await sessionService.getUserDataByWallet(normalizedAddress);
      
      if (!userData) {
        // Create a new user with starter points
        userData = {
          username: `wallet_${normalizedAddress.substring(0, 8)}`,
          walletAddress: normalizedAddress,
          points: pointsService.calculateInitialPoints()
        };
        
        await sessionService.createUser({
          walletAddress: normalizedAddress,
          userData
        });
      }
      
      // Create JWT token
      const token = jwt.sign(
        { 
          id: userData.id || normalizedAddress,
          wallet: normalizedAddress
        },
        process.env.JWT_SECRET || 'stationthis-jwt-secret',
        { expiresIn: '24h' }
      );
      
      res.status(200).json({
        success: true,
        token,
        user: userData
      });
    } catch (error) {
      console.error('Error during wallet verification:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * Guest access
   * POST /api/auth/guest
   */
  router.post('/guest', async (req, res) => {
    try {
      const { guestId } = req.body;
      const uniqueGuestId = guestId || `guest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      
      // Create temporary user session with limited points
      const guestData = {
        username: `Guest_${uniqueGuestId.substring(6, 14)}`,
        isGuest: true,
        points: pointsService.calculateGuestPoints(),
        created: Date.now()
      };
      
      // Store in session service
      sessionService.updateSession(uniqueGuestId, guestData, false);
      
      // Create JWT token with shorter expiry for guests
      const token = jwt.sign(
        { 
          id: uniqueGuestId,
          isGuest: true
        },
        process.env.JWT_SECRET || 'stationthis-jwt-secret',
        { expiresIn: '4h' } // Shorter token lifespan for guests
      );
      
      res.status(200).json({
        success: true,
        token,
        user: {
          id: uniqueGuestId,
          ...guestData
        }
      });
    } catch (error) {
      console.error('Error creating guest access:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * Get current user info
   * GET /api/auth/me
   */
  router.get('/me', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const userData = await sessionService.getUserData(userId);
      
      if (!userData) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.status(200).json({
        success: true,
        user: {
          id: userId,
          ...userData
        }
      });
    } catch (error) {
      console.error('Error getting user info:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * User logout
   * POST /api/auth/logout
   */
  router.post('/logout', authenticateUser, (req, res) => {
    try {
      // In a real implementation, we might invalidate the token
      // Here we just return success
      res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * Clean expired wallet authentication messages
   * @private
   */
  function cleanExpiredWalletMessages() {
    const now = Date.now();
    for (const [address, data] of pendingWalletAuth.entries()) {
      if (now - data.timestamp > 10 * 60 * 1000) { // 10 minutes
        pendingWalletAuth.delete(address);
      }
    }
  }
  
  return router;
}

module.exports = createAuthRoutes; 