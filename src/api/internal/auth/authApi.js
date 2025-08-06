const express = require('express');
const { verifyApiKey } = require('../../../core/services/apiKeyService');
const crypto = require('crypto');

/**
 * Creates a router for internal authentication-related tasks.
 * @param {Object} dependencies - Service dependencies, including logger and db services.
 * @returns {express.Router} - An Express router.
 */
function createAuthApi(dependencies) {
  const router = express.Router();
  // This internal API is allowed to access the database directly.
  const { userCore, userPreferences: userPreferencesDb, creditLedger: creditLedgerDb } = dependencies.db;
  const logger = dependencies.logger;

  /**
   * POST /validate-key
   * Validates a given API key and returns the associated user and key details if successful.
   * This is intended for internal use by other services (like the external API gateway).
   */
  router.post('/validate-key', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.includes('_')) {
      return res.status(400).json({ error: { code: 'INVALID_FORMAT', message: 'API key is missing or has an invalid format.' } });
    }

    try {
      const keyPrefix = apiKey.substring(0, apiKey.indexOf('_') + 1);
      const user = await userCore.findUserByApiKeyPrefix(keyPrefix);

      if (!user) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No user found for the provided API key prefix.' } });
      }

      const key = user.apiKeys.find(k => k.keyPrefix === keyPrefix && verifyApiKey(apiKey, k.keyHash));

      if (!key) {
        return res.status(401).json({ error: { code: 'INVALID_KEY', message: 'API key verification failed.' } });
      }
      
      if (key.status !== 'active') {
          return res.status(403).json({ error: { code: 'KEY_INACTIVE', message: 'The API key is not active.' } });
      }

      // Key is valid. Update its last used timestamp (fire-and-forget).
      userCore.updateApiKeyLastUsed(user._id, key.keyPrefix).catch(err => {
        logger.error(`Failed to update last used timestamp for key ${key.keyPrefix} on behalf of internal request`, err);
      });

      // Return the necessary user and key information.
      res.status(200).json({
        user: {
          masterAccountId: user._id.toString(),
          ...user.profile,
        },
        apiKey: {
          keyPrefix: key.keyPrefix,
          permissions: key.permissions,
        },
      });
    } catch (error) {
      logger.error('Internal API key validation endpoint failed:', error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  });

  /**
   * POST /find-or-create-by-wallet
   * Finds a user by wallet or creates a new one, then returns the user doc.
   */
  router.post('/find-or-create-by-wallet', async (req, res) => {
    const { address, referralCode } = req.body;
    if (!address) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Wallet address is required.' } });
    }
    const normalizedAddress = address.toLowerCase();
    logger.info(`[AuthApi] /find-or-create-by-wallet looking for wallet: ${normalizedAddress}`);

    let user = null;
    let isNewUser = false;
    try {
      try {
        user = await userCore.findUserCoreByWalletAddress(normalizedAddress);
        logger.info(`[AuthApi] findUserCoreByWalletAddress result for ${normalizedAddress}:`, user ? `User found with ID ${user._id}` : 'User not found');
      } catch (dbFindErr) {
        logger.error(`[AuthApi] DB error in findUserCoreByWalletAddress: ${dbFindErr.message}`);
        logger.error(dbFindErr.stack);
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'DB error in findUserCoreByWalletAddress', details: dbFindErr.message } });
      }

      if (!user) {
        logger.info(`[AuthApi] No user found for wallet ${normalizedAddress}. Creating a new user.`);
        const newUserDoc = {
          wallets: [{ address: normalizedAddress, verified: true, isPrimary: true, addedAt: new Date() }],
          lastLoginTimestamp: new Date(),
          lastSeenPlatform: 'web'
        };
        try {
          user = await userCore.createUserCore(newUserDoc);
          isNewUser = true;
          logger.info(`[AuthApi] New user created for wallet address: ${normalizedAddress} with ID: ${user._id}`);
        } catch (dbCreateErr) {
          logger.error(`[AuthApi] DB error in createUserCore: ${dbCreateErr.message}`);
          logger.error(dbCreateErr.stack);
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'DB error in createUserCore', details: dbCreateErr.message } });
        }
      } else {
        logger.info(`[AuthApi] User found for wallet address: ${normalizedAddress} with ID: ${user._id}. Updating last login.`);
        try {
          await userCore.updateLastLogin(user._id, 'web');
          logger.info(`[AuthApi] User last login updated for ${normalizedAddress}.`);
        } catch (dbUpdateErr) {
          logger.error(`[AuthApi] DB error in updateLastLogin: ${dbUpdateErr.message}`);
          logger.error(dbUpdateErr.stack);
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'DB error in updateLastLogin', details: dbUpdateErr.message } });
        }
      }

      if (user && referralCode) {
        try {
          const existingPreference = await userPreferencesDb.getPreferenceByKey(user._id.toString(), 'preferredCharteredFund');
          if (!existingPreference) {
            logger.info(`[AuthApi] User ${user._id} has no preferred fund. Attempting to migrate referral code: ${referralCode}`);
            const vault = await creditLedgerDb.findReferralVaultByName(referralCode);
            if (vault && vault.vault_address) {
              const preferenceValue = { vaultName: vault.vaultName, vaultAddress: vault.vault_address, referralCode: referralCode };
              await userPreferencesDb.setPreferenceByKey(user._id.toString(), 'preferredCharteredFund', preferenceValue);
              logger.info(`[AuthApi] Successfully set preferredCharteredFund for user ${user._id} to vault ${vault.vaultName} (${vault.vault_address})`);
            } else {
              logger.warn(`[AuthApi] Referral code ${referralCode} provided during login for user ${user._id} is invalid or has no vault address. Skipping preference update.`);
            }
          } else {
            logger.info(`[AuthApi] User ${user._id} already has a preferred fund. Ignoring new referral code ${referralCode}.`);
          }
        } catch (prefError) {
          logger.error(`[AuthApi] Error during referral preference migration for user ${user._id}:`, prefError);
          // Non-fatal error, so we don't block the login process
        }
      }

      // Sanitize user object to prevent potential circular references in JSON serialization
      const safeUser = JSON.parse(JSON.stringify(user));
      res.status(200).json({ user: safeUser, isNewUser });
    } catch (error) {
      logger.error(`[AuthApi] /find-or-create-by-wallet for address ${normalizedAddress} failed: ${error.message}`);
      logger.error(error.stack);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while finding or creating the user.', details: error.message } });
    }
  });

  /**
   * POST /verify-password
   * Verifies a username/password combination and returns the user doc on success.
   */
  router.post('/verify-password', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Username and password are required.' } });
    }

    try {
      const user = await userCore.findOne({ 'profile.username': username });

      if (!user || !user.profile?.passwordHash || !user.profile?.passwordSalt) {
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
      }

      const { passwordHash, passwordSalt } = user.profile;
      
      crypto.scrypt(password, passwordSalt, 64, async (err, derivedKey) => {
        if (err) {
            logger.error(`[AuthApi] /verify-password scrypt error for user ${username}:`, err);
            return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred during password verification.' } });
        }

        if (crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), derivedKey)) {
          await userCore.updateLastLogin(user._id, 'web');
          // Return the user document, but be careful not to leak sensitive data like password hash/salt
          const { passwordHash, passwordSalt, ...safeProfile } = user.profile;
          const safeUser = { ...user, profile: safeProfile };
          res.status(200).json({ user: safeUser });
        } else {
          res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
        }
      });
    } catch (error) {
      logger.error(`[AuthApi] /verify-password for user ${username} failed:`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  });

  return router;
}

module.exports = { createAuthApi }; 