const express = require('express');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('UserApi');

/**
 * Creates a router for user-related data.
 * @param {object} dependencies - Service dependencies.
 * @returns {express.Router}
 */
function createUserApi(dependencies) {
  const { internalApiClient } = dependencies;
  if (!internalApiClient) {
    throw new Error('[UserApi] Missing required dependency "internalApiClient"');
  }
  const router = express.Router();

  /**
   * GET /me
   * Fetches the profile of the currently authenticated user.
   */
  router.get('/me', async (req, res) => {
    try {
      // The user object is attached to the request by the authMiddleware
      const { userId } = req.user;
      
      const response = await internalApiClient.get(`/internal/v1/data/user-core/${userId}`);
      const user = response.data;
      
      // Return a curated user object, not the whole database document
      res.status(200).json({
        profile: user.profile,
        wallets: user.wallets,
        status: user.status,
      });

    } catch (error) {
      logger.error('[UserApi] /me failed:', {
          errorMessage: error.message,
          responseData: error.response?.data,
          responseStatus: error.response?.status
      });

      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }

      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch user data.' } });
    }
  });

  /**
   * GET /dashboard
   * Fetches the dashboard summary for the authenticated user (JWT/session or API key).
   */
  router.get('/dashboard', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
      }

      // Fetch user core info
      const userRes = await internalApiClient.get(`/internal/v1/data/users/${userId}`);
      const user = userRes.data;

      // Fetch economy info
      let economy = null;
      try {
        const economyRes = await internalApiClient.get(`/internal/v1/data/users/${userId}/economy`);
        economy = economyRes.data;
      } catch (err) {
        logger.warn('[UserApi] /dashboard: No economy record found for user, defaulting to zero.', { error: err.message });
        economy = { exp: 0, points: 0 };
      }

      // Fetch transactions
      const txRes = await internalApiClient.get(`/internal/v1/data/users/${userId}/transactions`);
      const transactions = txRes.data;



      // Fetch referral vaults
      let referralVaults = [];
      try {
        const vaultsRes = await internalApiClient.get(`/internal/v1/data/ledger/vaults/by-master-account/${userId}`);
        const vaults = vaultsRes.data && Array.isArray(vaultsRes.data.vaults) ? vaultsRes.data.vaults : [];
        referralVaults = vaults;
      } catch (vaultErr) {
        logger.warn('[UserApi] /dashboard: Could not fetch referral vaults:', { error: vaultErr.message });
        referralVaults = [];
      }

      // Username
      const username = user.username || user.profile?.username || user.profile?.name || 'User';
      // Wallet address (primary or first)
      let wallet = null;
      if (user.wallets && user.wallets.length > 0) {
        const primary = user.wallets.find(w => w.isPrimary);
        wallet = (primary ? primary.address : user.wallets[0].address) || null;
      }
      // Level/EXP
      const exp = parseFloat(economy.exp?.$numberDouble || economy.exp || 0);
      const level = Math.floor(Math.cbrt(exp));
      const nextLevelExp = Math.pow(level + 1, 3);
      const lastLevelExp = Math.pow(level, 3);
      const expToNextLevel = nextLevelExp - lastLevelExp;
      const userExpInLevel = exp - lastLevelExp;
      const levelProgressRatio = expToNextLevel > 0 ? userExpInLevel / expToNextLevel : 0;
      // Points
      let points = 0;
      try {
        if (wallet) {
          const pointsRes = await internalApiClient.get(`/internal/v1/data/ledger/points/by-wallet/${wallet}`);
          points = pointsRes.data.points || 0;
        }
      } catch (err) {
        logger.warn('[UserApi] /dashboard: Could not fetch points for wallet:', { error: err.message });
        points = 0;
      }
      // Rewards
      const sumRewards = (type) => transactions
        .filter(t => t.transactionType === type && parseFloat(t.amountUsd) > 0)
        .reduce((sum, t) => sum + parseFloat(t.amountUsd), 0);
      const rewards = {
        referral: sumRewards('referral_bonus'),
        model: sumRewards('model_reward'),
        spell: sumRewards('spell_reward'),
      };
      res.status(200).json({
        masterAccountId: userId, // Add this line
        username,
        wallet,
        level,
        exp,
        expToNextLevel,
        levelProgressRatio,
        points,
        rewards,
        referralVaults // only return the array, no single vault
      });
    } catch (error) {
      logger.error('[UserApi] /dashboard failed:', {
        errorMessage: error.message,
        responseData: error.response?.data,
        responseStatus: error.response?.status
      });
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch dashboard data.' } });
    }
  });

  /**
   * GET /history
   * Fetches usage/spending history for the authenticated user for a given time window.
   * Query params: timeUnit (day|week|month), offset (int, default 0)
   */
  router.get('/history', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
      }
      // Parse query params
      const timeUnit = ['day','week','month'].includes(req.query.timeUnit) ? req.query.timeUnit : 'month';
      const offset = parseInt(req.query.offset, 10) || 0;
      // Calculate time window
      const now = new Date();
      let endDate = new Date(now);
      let startDate;
      if (timeUnit === 'month') {
        endDate.setMonth(now.getMonth() - offset);
        startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - 1);
      } else {
        const unitDays = timeUnit === 'week' ? 7 : 1;
        const dayOffset = offset * unitDays;
        endDate.setDate(now.getDate() - dayOffset);
        startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - unitDays);
      }
      // Fetch generation outputs for this user and window
      const genRes = await internalApiClient.get(`/internal/v1/data/generations`, {
        params: {
          masterAccountId: userId,
          requestTimestamp_gte: startDate.toISOString(),
          requestTimestamp_lte: endDate.toISOString()
        }
      });
      const generations = genRes.data.generations || [];
      // Calculate total spent and tool breakdown
      const totalSpent = generations.reduce((sum, gen) => sum + parseFloat(gen.costUsd?.$numberDecimal || gen.costUsd || 0), 0);
      const toolStats = generations.reduce((stats, gen) => {
        const tool = gen.metadata?.displayName || gen.serviceName || 'Unknown';
        if (!stats[tool]) stats[tool] = { count: 0, spent: 0 };
        stats[tool].count++;
        stats[tool].spent += parseFloat(gen.costUsd?.$numberDecimal || gen.costUsd || 0);
        return stats;
      }, {});
      let mostUsedTool = 'N/A';
      if (Object.keys(toolStats).length > 0) {
        mostUsedTool = Object.entries(toolStats).sort(([,a],[,b]) => b.count - a.count)[0][0];
      }
      // Format tool breakdown
      const toolBreakdown = Object.entries(toolStats).map(([tool, stats]) => ({ tool, count: stats.count, spent: stats.spent }));
      res.status(200).json({
        timeUnit,
        offset,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalSpent,
        mostUsedTool,
        toolBreakdown
      });
    } catch (error) {
      logger.error('[UserApi] /history failed:', {
        errorMessage: error.message,
        responseData: error.response?.data,
        responseStatus: error.response?.status
      });
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch user history.' } });
    }
  });

  /* -------------------------------------------------------
   * Model Favorites (Preferences)
   * -----------------------------------------------------*/

  // Helper to compute internal path
  const buildInternalPrefPath = (userId, suffix) => `/internal/v1/data/users/${userId}/preferences/model-favorites${suffix}`;

  // GET /users/me/preferences/model-favorites(/:category)
  router.get('/me/preferences/model-favorites/:category?', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });

      const { category } = req.params;
      const suffix = category ? `/${encodeURIComponent(category)}` : '';
      const response = await internalApiClient.get(buildInternalPrefPath(userId, suffix));
      res.status(200).json(response.data);
    } catch (error) {
      logger.error('[UserApi] GET model-favorites failed:', { errorMessage: error.message, responseData: error.response?.data, responseStatus: error.response?.status });
      if (error.response) return res.status(error.response.status).json(error.response.data);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch model favorites.' } });
    }
  });

  // POST /users/me/preferences/model-favorites/:category
  router.post('/me/preferences/model-favorites/:category', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });

      const { category } = req.params;
      const { modelId } = req.body || {};
      const response = await internalApiClient.post(buildInternalPrefPath(userId, `/${encodeURIComponent(category)}`), { modelId });
      res.status(response.status).json(response.data);
    } catch (error) {
      logger.error('[UserApi] POST model-favorites failed:', { errorMessage: error.message, responseData: error.response?.data, responseStatus: error.response?.status });
      if (error.response) return res.status(error.response.status).json(error.response.data);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add model favorite.' } });
    }
  });

  // DELETE /users/me/preferences/model-favorites/:category/:modelId
  router.delete('/me/preferences/model-favorites/:category/:modelId', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });

      const { category, modelId } = req.params;
      const response = await internalApiClient.delete(buildInternalPrefPath(userId, `/${encodeURIComponent(category)}/${encodeURIComponent(modelId)}`));
      res.status(response.status).send();
    } catch (error) {
      logger.error('[UserApi] DELETE model-favorites failed:', { errorMessage: error.message, responseData: error.response?.data, responseStatus: error.response?.status });
      if (error.response) return res.status(error.response.status).json(error.response.data);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to remove model favorite.' } });
    }
  });

  /* -------------------------------------------------------
   * API Keys Management
   * -----------------------------------------------------*/

  /**
   * GET /apikeys
   * Lists all API keys for the authenticated user (masked, prefix only).
   */
  router.get('/apikeys', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
      }

      const response = await internalApiClient.get(`/internal/v1/data/users/${userId}/apikeys`);
      res.status(200).json(response.data);
    } catch (error) {
      logger.error('[UserApi] GET /apikeys failed:', {
        errorMessage: error.message,
        responseData: error.response?.data,
        responseStatus: error.response?.status
      });
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch API keys.' } });
    }
  });

  /**
   * POST /apikeys
   * Creates a new API key for the authenticated user.
   * Body: { name: string }
   * Returns the full API key (shown only once).
   */
  router.post('/apikeys', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
      }

      const { name } = req.body || {};
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Name is required.' } });
      }

      const response = await internalApiClient.post(`/internal/v1/data/users/${userId}/apikeys`, { name: name.trim() });
      res.status(201).json(response.data);
    } catch (error) {
      logger.error('[UserApi] POST /apikeys failed:', {
        errorMessage: error.message,
        responseData: error.response?.data,
        responseStatus: error.response?.status
      });
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create API key.' } });
    }
  });

  /**
   * DELETE /apikeys/:keyPrefix
   * Deletes an API key by its prefix.
   */
  router.delete('/apikeys/:keyPrefix', async (req, res) => {
    try {
      const userId = req.user && (req.user.userId || req.user.id || req.user._id);
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
      }

      const { keyPrefix } = req.params;
      if (!keyPrefix) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Key prefix is required.' } });
      }

      await internalApiClient.delete(`/internal/v1/data/users/${userId}/apikeys/${keyPrefix}`);
      res.status(204).send();
    } catch (error) {
      logger.error('[UserApi] DELETE /apikeys failed:', {
        errorMessage: error.message,
        responseData: error.response?.data,
        responseStatus: error.response?.status
      });
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete API key.' } });
    }
  });

  return router;
}

module.exports = { createUserApi }; 