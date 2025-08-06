const express = require('express');
const { requireLogin, authenticateUserOrApiKey } = require('../../../platforms/web/middleware/auth');
const { getFundingRate, getDecimals, DEFAULT_FUNDING_RATE } = require('../../../core/services/alchemy/tokenConfig');
const { createLogger } = require('../../../utils/logger');

function createPointsApi(dependencies) {
    const router = express.Router();
    const { internalApiClient, logger } = dependencies;

    /**
     * @route GET /api/external/points/supported-assets
     * @description Fetches the list of all tokens and NFTs that can be deposited.
     * @access Private (JWT or API Key)
     */
    router.get('/supported-assets', async (req, res, next) => {
        try {
            const response = await internalApiClient.get('/internal/v1/data/points/supported-assets');
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    /**
     * @route POST /api/external/points/quote
     * @description Provides a real-time quote for a deposit.
     * @access Private (JWT or API Key)
     */
    router.post('/quote', async (req, res, next) => {
        try {
            const response = await internalApiClient.post('/internal/v1/data/points/quote', req.body);
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    /**
     * @route POST /api/external/points/purchase
     * @description Initiates the on-chain deposit process.
     * @access Private (JWT or API Key)
     */
    router.post('/purchase', async (req, res, next) => {
        try {
            let { referral_code: referralCode } = req.cookies;

            // If no cookie, check user preferences for logged-in users
            if (!referralCode && req.user && req.user.userId) {
                try {
                    const response = await internalApiClient.get(`/internal/v1/data/users/${req.user.userId}/preferences/preferredCharteredFund`);
                    if (response.data && response.data.value && response.data.value.referralCode) {
                        referralCode = response.data.value.referralCode;
                        logger.info(`[pointsApi-external] Used referral code '${referralCode}' from user preferences for user ${req.user.userId}.`);
                    }
                } catch (error) {
                    // A 404 is expected if the preference isn't set. We can ignore it.
                    if (error.response && error.response.status !== 404) {
                        // Log other errors but don't block the transaction
                        logger.warn(`[pointsApi-external] Failed to fetch user preferences: ${error.message}`);
                    }
                }
            }

            const payload = {
                ...req.body,
                userId: req.user.id,
                referralCode
            };
            const response = await internalApiClient.post('/internal/v1/data/points/purchase', payload);
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    /**
     * @route GET /api/external/points/tx-status
     * @description Polls for the status of a deposit transaction.
     * @access Private (JWT or API Key)
     */
    router.get('/tx-status', async (req, res, next) => {
        try {
            const { txHash } = req.query;
            if (!txHash) {
                return res.status(400).json({ message: 'Transaction hash is required.' });
            }
            const response = await internalApiClient.get(`/internal/v1/data/points/tx-status?txHash=${txHash}`);
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createPointsApi; 