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
            const { chainId } = req.query;
            const url = chainId ? `/internal/v1/data/points/supported-assets?chainId=${chainId}` : '/internal/v1/data/points/supported-assets';
            logger.info(`[pointsApi-external] /supported-assets forwarding -> ${url}`);
            const response = await internalApiClient.get(url);
            try {
                const data = response.data || {};
                logger.debug('[pointsApi-external] supported-assets response', {
                    chainId: chainId || null,
                    tokensCount: Array.isArray(data.tokens) ? data.tokens.length : 0,
                    nftsCount: Array.isArray(data.nfts) ? data.nfts.length : 0,
                });
            } catch (e) {
                logger.warn('[pointsApi-external] Failed to log response preview', { error: e.message });
            }
            res.json(response.data);
        } catch (error) {
            next(error);
        }
    });

    /**
     * @route POST /api/external/points/quote
     * @description Provides a real-time quote for a deposit.
     * @access Private (JWT or API Key)
     * @param {string} [mode=contribute] - Operation mode: 'contribute' for standard deposit flow (default) or 'donate' for irrevocable one-tx donation with boosted funding rate.
     */
    router.post('/quote', async (req, res, next) => {
        try {
            const response = await internalApiClient.post('/internal/v1/data/points/quote', req.body);
            res.json(response.data);
        } catch (error) {
            logger.error('[pointsApi-external] /quote error', { 
                error: error.message,
                status: error.response?.status,
                data: error.response?.data 
            });
            // Forward error response from internal API if available
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }
            // Generic error if internal API error is not available
            res.status(500).json({ 
                error: { 
                    code: 'QUOTE_ERROR', 
                    message: 'An error occurred while generating the quote. Please try again.' 
                } 
            });
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
                        logger.info('[pointsApi-external] Used referral code from user preferences', { 
                            userId: req.user.userId,
                            referralCode 
                        });
                    }
                } catch (error) {
                    // A 404 is expected if the preference isn't set. We can ignore it.
                    if (error.response && error.response.status !== 404) {
                        // Log other errors but don't block the transaction
                        logger.warn('[pointsApi-external] Failed to fetch user preferences', { 
                            error: error.message,
                            userId: req.user.userId 
                        });
                    }
                }
            }

            const payload = {
                ...req.body,
                userId: req.user.id,
                referralCode,
                mode: req.body.mode || 'contribute',
            };
            const response = await internalApiClient.post('/internal/v1/data/points/purchase', payload);
            res.json(response.data);
        } catch (error) {
            logger.error('[pointsApi-external] /purchase error', { 
                error: error.message,
                status: error.response?.status,
                data: error.response?.data 
            });
            // Forward error response from internal API if available
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }
            // Generic error if internal API error is not available
            res.status(500).json({ 
                error: { 
                    code: 'PURCHASE_ERROR', 
                    message: 'An error occurred while preparing the purchase. Please try again.' 
                } 
            });
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
                return res.status(400).json({ 
                    error: { 
                        code: 'MISSING_FIELDS', 
                        message: 'Transaction hash is required.' 
                    } 
                });
            }
            const response = await internalApiClient.get(`/internal/v1/data/points/tx-status?txHash=${txHash}`);
            res.json(response.data);
        } catch (error) {
            logger.error('[pointsApi-external] /tx-status error', { 
                error: error.message,
                status: error.response?.status,
                data: error.response?.data 
            });
            // Forward error response from internal API if available
            if (error.response) {
                return res.status(error.response.status).json(error.response.data);
            }
            // Generic error if internal API error is not available
            res.status(500).json({ 
                error: { 
                    code: 'TX_STATUS_ERROR', 
                    message: 'An error occurred while fetching transaction status. Please try again.' 
                } 
            });
        }
    });

    return router;
}

module.exports = createPointsApi; 