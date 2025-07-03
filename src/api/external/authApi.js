const express = require('express');
const jwt = require('jsonwebtoken');
const { createLogger } = require('../../utils/logger');
const { ethers } = require('ethers');
const crypto = require('crypto');
const internalApiClient = require('../../utils/internalApiClient');

const logger = createLogger('AuthApi');

// Simple in-memory store for nonces. In a production environment,
// you would use a more robust cache like Redis.
const nonceStore = new Map();

/**
 * Creates a router for authentication flows.
 * @param {object} dependencies - Service dependencies.
 * @returns {express.Router}
 */
function createAuthApi(dependencies) {
  const router = express.Router();

  /**
   * POST /web3/nonce
   * Generates a nonce for the client to sign.
   * Expects { address: "0x..." } in the body.
   */
  router.post('/web3/nonce', async (req, res) => {
    try {
      const { address } = req.body;
      if (!address || !ethers.isAddress(address)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'A valid Ethereum address is required.' } });
      }

      const lowerCaseAddress = address.toLowerCase();

      // Generate a secure random nonce with a human-readable prefix
      const nonce = `Sign this message to log in to StationThis. Nonce: ${crypto.randomBytes(16).toString('hex')}`;
      
      // Store the nonce with a timestamp for expiration
      nonceStore.set(lowerCaseAddress, { nonce, timestamp: Date.now() });

      // Set a timeout to automatically remove the nonce after 5 minutes
      setTimeout(() => {
        const storedNonce = nonceStore.get(lowerCaseAddress);
        if (storedNonce && storedNonce.nonce === nonce) {
          nonceStore.delete(lowerCaseAddress);
          logger.info(`Nonce for ${lowerCaseAddress} expired and was removed.`);
        }
      }, 5 * 60 * 1000); // 5 minutes

      logger.info(`Generated nonce for address: ${lowerCaseAddress}`);
      res.status(200).json({ nonce });

    } catch (error) {
      logger.error('[AuthApi] /web3/nonce failed:', error);
      res.status(500).json({ error: { code: 'NONCE_GENERATION_FAILED', message: 'Failed to generate nonce.' } });
    }
  });

  /**
   * POST /web3/verify
   * Verifies a signed nonce and returns a JWT.
   * Expects { address: "0x...", signature: "0x..." } in the body.
   */
  router.post('/web3/verify', async (req, res) => {
    try {
        const { address, signature } = req.body;

        if (!address || !signature) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Address and signature are required.' } });
        }
        
        const lowerCaseAddress = address.toLowerCase();

        const storedNonceData = nonceStore.get(lowerCaseAddress);
        if (!storedNonceData) {
            return res.status(400).json({ error: { code: 'INVALID_NONCE', message: 'Nonce not found or expired. Please try again.' } });
        }
        
        const { nonce } = storedNonceData;

        const recoveredAddress = ethers.verifyMessage(nonce, signature);

        if (recoveredAddress.toLowerCase() !== lowerCaseAddress) {
            return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature is invalid.' } });
        }

        nonceStore.delete(lowerCaseAddress);

        // Defer user creation/lookup to the internal API
        const response = await internalApiClient.post('/internal/v1/data/auth/find-or-create-by-wallet', { address: lowerCaseAddress });
        const { user } = response.data;

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          logger.error('JWT_SECRET is not defined in environment variables.');
          return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
        }
        
        const token = jwt.sign(
            { userId: user._id, address: lowerCaseAddress },
            jwtSecret,
            { expiresIn: '1h' }
        );

        res.cookie('jwt', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 1000 // 1 hour
        });
        res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
        logger.error('[AuthApi] /web3/verify failed:', error.message);
        if (error.response) {
            logger.error('Response data:', error.response.data);
            return res.status(error.response.status).json(error.response.data);
        }
        res.status(500).json({ error: { code: 'VERIFICATION_FAILED', message: 'Failed to verify signature.', details: error.message } });
    }
  });

  /**
   * POST /password
   * Authenticates with username/password and returns a JWT.
   */
  router.post('/password', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Username and password are required.' } });
    }

    try {
      const response = await internalApiClient.post('/internal/v1/data/auth/verify-password', { username, password });
      const { user } = response.data;

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        logger.error('JWT_SECRET is not defined in environment variables.');
        return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
      }
      
      const token = jwt.sign(
          { userId: user._id, username: user.profile.username },
          jwtSecret,
          { expiresIn: '1h' }
      );

      res.cookie('jwt', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000 // 1 hour
      });
      res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
      logger.error('[AuthApi] /password authentication failed:', {
          errorMessage: error.message,
          responseData: error.response?.data,
          responseStatus: error.response?.status
      });

      if (error.response && error.response.status === 401) {
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
      }
      
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  });

  /**
   * POST /apikey
   * Authenticates with an API key and returns a JWT.
   */
  router.post('/apikey', async (req, res) => {
    try {
        const { apikey } = req.body;
        if (!apikey) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'API key is required.' } });
        }

        const response = await internalApiClient.post('/internal/v1/data/auth/validate-key', { apiKey: apikey });

        const { user } = response.data;

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          logger.error('JWT_SECRET is not defined in environment variables.');
          return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
        }
        
        const token = jwt.sign(
            { userId: user.masterAccountId, isApiKeyAuth: true },
            jwtSecret,
            { expiresIn: '1h' }
        );

        res.cookie('jwt', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 1000 // 1 hour
        });
        res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
        logger.error('[AuthApi] /apikey authentication failed:', {
            errorMessage: error.message,
            responseData: error.response?.data,
            responseStatus: error.response?.status
        });
        
        if (error.response) {
            const status = error.response.status;
            if (status === 401 || status === 404 || status === 403) {
              return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive API key.' } });
            }
        }
      
        res.status(500).json({ error: { code: 'API_KEY_AUTH_FAILED', message: 'Failed to authenticate with API key.' } });
    }
  });

  return router;
}

module.exports = { createAuthApi }; 