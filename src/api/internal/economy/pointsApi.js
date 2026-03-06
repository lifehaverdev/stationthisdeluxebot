const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const creditVaultAbi = require('../../../core/contracts/abis/creditVault.json');
const { contracts } = require('../../../core/contracts');
const { getFundingRate, getDecimals, DEFAULT_FUNDING_RATE, getChainTokenConfig, getChainNftConfig } = require('../../../core/services/alchemy/tokenConfig');
const { getCreditVaultAddress } = require('../../../core/services/alchemy/foundationConfig');
const { RPC_ENV_VARS, CHAIN_NAMES } = require('../../../core/services/alchemy/foundationConfig');
const tokenDecimalService = require('../../../core/services/tokenDecimalService');
const { createRateLimitMiddleware, createWalletRateLimitMiddleware } = require('../../../utils/rateLimiter');

const TRUSTED_NFT_COLLECTIONS = {
    "0x524cab2ec69124574082676e6f654a18df49a048": { fundingRate: 1, name: "MiladyStation", iconUrl: "/images/sandbox/components/miladystation.avif" },
    "0xd3d9ddd0cf0a5f0bfb8f7fc9e046c5318a33c168": { fundingRate: 1, name: "Remilio", iconUrl: "/images/sandbox/components/remilio.gif" },
    "0x7bd29408f11d2bfc23c34f18275bbf23cf646e9c": { fundingRate: 1, name: "Milady", iconUrl: "/images/sandbox/components/milady.png" },
    "0x139a67691b353f1d3a5b82f0223707e4a81571db": { fundingRate: 1, name: "Kagami", iconUrl: "/images/sandbox/components/kagami.avif" },
    "0x88f253ab39797375a025e64a1324792c3a9de35d": { fundingRate: 0.65, name: "Bonkler", iconUrl: "/images/sandbox/components/bonkler.avif" },
    "0x892972989e5a1b24d61f1c75908da684e27f46e5": { fundingRate: 0.85, name: "Fumo", iconUrl: "/images/sandbox/components/fumo.avif" },
    "0x42069055135d56221123495f5cff5bac4115b136": { fundingRate: 0.85, name: "CultExec", iconUrl: "/images/sandbox/components/cultexecutives.avif" },
};
const BASELINE_NFT_FUNDING_RATE = 0.70;

const USD_TO_POINTS_CONVERSION_RATE = 0.000337;

// --- Validation Helpers ---
function isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') return false;
    return ethers.isAddress(address);
}

function isValidTransactionHash(txHash) {
    if (!txHash || typeof txHash !== 'string') return false;
    return /^0x[a-fA-F0-9]{64}$/.test(txHash);
}

function isValidAmount(amount) {
    if (!amount || typeof amount !== 'string') return false;
    // Allow empty string, but if present must be valid number format
    if (amount === '') return true;
    // Must be a valid number string (allows decimals)
    if (!/^\d+\.?\d*$/.test(amount)) return false;
    // Must not be negative
    if (amount.startsWith('-')) return false;
    // Must not be just a decimal point
    if (amount === '.') return false;
    return true;
}

function sanitizeReferralCode(code) {
    if (!code || typeof code !== 'string') return null;
    // Only allow alphanumeric and common safe characters
    return code.trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function isValidChainId(chainId) {
    if (!chainId) return false;
    const chainIdStr = String(chainId);
    // Check if chainId is in the supported chains list (RPC_ENV_VARS keys)
    return chainIdStr in RPC_ENV_VARS;
}

function generateRequestId() {
    return 'req_' + crypto.randomBytes(8).toString('hex');
}

function createErrorResponse(message, code, requestId, details = null) {
    const response = {
        error: {
            code: code || 'ERROR',
            message,
            requestId
        }
    };
    if (details) {
        response.error.details = details;
    }
    return response;
}

module.exports = function pointsApi(dependencies) {
    const { logger, priceFeedService, nftPriceService, creditServices = {}, ethereumServices = {}, creditService: legacyCredit, ethereumService: legacyEth, db } = dependencies;
    // Helper to resolve chainId -> services, falling back to legacy singletons
    function getChainServices(chainId = '1') {
        const cs = creditServices[String(chainId)] || legacyCredit;
        const es = ethereumServices[String(chainId)] || legacyEth;
        return { creditService: cs, ethereumService: es };
    }
    const creditLedgerDb = db.creditLedger;
    logger.debug('[pointsApi] Initializing with dependencies:', {
        priceFeedService: !!priceFeedService,
        nftPriceService: !!nftPriceService,
        creditService: !!legacyCredit,
        ethereumService: !!legacyEth,
        creditLedgerDb: !!creditLedgerDb
    });
    const router = express.Router();

    if (!priceFeedService || !nftPriceService || !creditLedgerDb) {
        logger.error('[pointsApi] Critical dependency failure: required services are missing!');
        return (req, res, next) => {
            res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Core services for points API are not available.' } });
        };
    }

    // Rate limiting for quote endpoint: 20 requests per minute per IP
    const quoteRateLimiter = createRateLimitMiddleware({
        windowMs: 60 * 1000, // 1 minute
        max: 20,
        message: 'Too many quote requests. Please try again later.'
    }, logger);

    // Rate limiting for purchase endpoint: 10 requests per minute per wallet
    const purchaseRateLimiter = createWalletRateLimitMiddleware({
        windowMs: 60 * 1000, // 1 minute
        max: 10,
        message: 'Too many purchase requests. Please try again later.'
    }, logger);

    /**
     * GET /supported-assets
     * Returns a list of all tokens and NFTs supported for credit deposits.
     */
    router.get('/supported-assets', (req, res) => {
        const requestId = generateRequestId();
        const chainId = String(req.query.chainId || '1');
        
        // Validate chain ID
        if (!isValidChainId(chainId)) {
            logger.warn('[pointsApi] /supported-assets invalid chainId', { requestId, chainId });
            return res.status(400).json(createErrorResponse(
                `Unsupported chain ID '${chainId}'. Supported chains: ${Object.keys(RPC_ENV_VARS).join(', ')}.`,
                'UNSUPPORTED_CHAIN',
                requestId,
                { supportedChains: Object.keys(RPC_ENV_VARS).map(id => ({ chainId: id, name: CHAIN_NAMES[id] || id })) }
            ));
        }
        
        const { creditService, ethereumService } = getChainServices(chainId);
        logger.info('[pointsApi] /supported-assets requested', { requestId, chainId });

        try {
        // Trace helper outputs
            let tokensCfgRaw = getChainTokenConfig(chainId);
            let nftsCfgRaw = getChainNftConfig(chainId);

        // Defensive: if we accidentally received the root config object (keys are chainIds),
        // narrow it down to the specific chainId we want so the response shape is correct.
        if (tokensCfgRaw && ['1', '11155111'].every(key => Object.keys(tokensCfgRaw).includes(key))) {
            tokensCfgRaw = tokensCfgRaw[chainId] || tokensCfgRaw['1'];
        }
        if (nftsCfgRaw && ['1', '11155111'].every(key => Object.keys(nftsCfgRaw).includes(key))) {
            nftsCfgRaw = nftsCfgRaw[chainId] || {};
        }

            const tokens = Object.entries(tokensCfgRaw || {}).map(([address, cfg]) => {
            const { fundingRate, symbol, iconUrl, decimals } = cfg || {};
            return { type: 'TOKEN', address, symbol, fundingRate, iconUrl, decimals };
        });

            const nfts = Object.entries(nftsCfgRaw || {})
            .filter(([, cfg]) => cfg && cfg.name)
            .map(([address, { fundingRate, name, iconUrl }]) => ({
                type: 'NFT',
                address,
                name,
                fundingRate,
                iconUrl: iconUrl || '/images/sandbox/components/nft-placeholder.png',
            }));

        res.json({
            tokens,
            nfts,
            defaults: {
                tokenFundingRate: DEFAULT_FUNDING_RATE,
                nftFundingRate: BASELINE_NFT_FUNDING_RATE,
            },
        });
        } catch (error) {
            logger.error('[pointsApi] /supported-assets error:', error, { requestId });
            res.status(500).json(createErrorResponse('Failed to fetch supported assets', 'FETCH_ERROR', requestId));
        }
    });

    /**
     * @route POST /internal/v1/points/quote
     * @description Provides a real-time quote for a deposit.
     * @access Internal
     */
    router.post('/quote', quoteRateLimiter, async (req, res, next) => {
        const requestId = generateRequestId();
        try {
            const { type, assetAddress, amount, tokenId, userWalletAddress, chainId: bodyChainId } = req.body;
            const chainId = String(bodyChainId || '1');

            // Validate chain ID
            if (!isValidChainId(chainId)) {
                return res.status(400).json(createErrorResponse(
                    `Unsupported chain ID '${chainId}'. Supported chains: ${Object.keys(RPC_ENV_VARS).join(', ')}.`,
                    'UNSUPPORTED_CHAIN',
                    requestId,
                    { supportedChains: Object.keys(RPC_ENV_VARS).map(id => ({ chainId: id, name: CHAIN_NAMES[id] || id })) }
                ));
            }

            const { creditService, ethereumService } = getChainServices(chainId);

            // Validate required fields
            if (!type || !assetAddress) {
                return res.status(400).json(createErrorResponse(
                    'Missing required fields: type and assetAddress are required.',
                    'MISSING_FIELDS',
                    requestId,
                    { missing: ['type', 'assetAddress'] }
                ));
            }

            // Validate type
            if (!['token', 'nft'].includes(type)) {
                return res.status(400).json(createErrorResponse(
                    `Invalid type '${type}'. Allowed values: token, nft.`,
                    'INVALID_TYPE',
                    requestId
                ));
            }

            // Validate asset address
            if (!isValidEthereumAddress(assetAddress)) {
                return res.status(400).json(createErrorResponse(
                    'Invalid asset address format.',
                    'INVALID_ADDRESS',
                    requestId
                ));
            }

            // Validate amount for tokens
            if (type === 'token') {
                if (!amount) {
                    return res.status(400).json(createErrorResponse(
                        'Amount is required for token deposits.',
                        'MISSING_FIELDS',
                        requestId,
                        { missing: ['amount'] }
                    ));
                }
                if (!isValidAmount(amount)) {
                    return res.status(400).json(createErrorResponse(
                        'Invalid amount format. Amount must be a positive number.',
                        'INVALID_AMOUNT',
                        requestId
                    ));
                }
            }

            // Validate tokenId for NFTs
            if (type === 'nft' && !tokenId) {
                return res.status(400).json(createErrorResponse(
                    'TokenId is required for NFT deposits.',
                    'MISSING_FIELDS',
                    requestId,
                    { missing: ['tokenId'] }
                ));
            }

            logger.info('[pointsApi:/quote] Processing quote request', { requestId, type, assetAddress });

            let fundingRate, symbol, name, decimals, grossUsd, netAfterFundingRate, price, assetAmount;
            let estimatedGasUsd = 5.5; // Placeholder, will be replaced by dynamic estimation
            let userReceivesUsd, pointsCredited;

            if (type === 'token') {
                fundingRate = getFundingRate(assetAddress);
                // Use centralized decimal service for consistent token handling
                const decimals = tokenDecimalService.getTokenDecimals(assetAddress);
                const humanReadable = tokenDecimalService.formatTokenAmount(amount, assetAddress);
                const adjustedAmount = amount; // Already in correct format
                assetAmount = parseFloat(humanReadable);

                logger.debug(`[pointsApi:/quote] Amount conversion`, {
                    requestId,
                    token: assetAddress,
                    decimals,
                    humanReadable,
                    assetAmount
                });

                // Get price in USD (single call - was duplicated before)
                price = await priceFeedService.getPriceInUsd(assetAddress);
                if (!price || price <= 0) {
                    return res.status(400).json(createErrorResponse(
                        'Unable to fetch price for this asset. Please try again later.',
                        'PRICE_UNAVAILABLE',
                        requestId
                    ));
                }
                
                logger.debug(`[pointsApi:/quote] Price fetched`, { requestId, assetAddress, price });
                grossUsd = assetAmount * price;
                netAfterFundingRate = grossUsd * fundingRate;
                
                // --- Dynamic gas estimation ---
                // Skip gas estimation for MS2 token since we want it regardless of gas cost
                if (assetAddress.toLowerCase() === '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820'.toLowerCase()) {
                    logger.info('[pointsApi:/quote] Skipping gas estimation for MS2 token', { requestId });
                    estimatedGasUsd = 0; // Don't factor gas into the quote for MS2
                } else {
                    try {
                        if (!creditService.estimateDepositGasCostInUsd) {
                            logger.warn('[pointsApi:/quote] Gas estimation not available', { requestId });
                        } else {
                            // ERC20 tokens don't need a real wallet address for gas estimation.
                            // ETH (zero address) needs a `from` field — use the provided wallet or
                            // a dummy address so estimation still runs without a connected wallet.
                            const estimationAddress = (userWalletAddress && isValidEthereumAddress(userWalletAddress))
                                ? userWalletAddress
                                : '0x000000000000000000000000000000000000dEaD';
                            estimatedGasUsd = await creditService.estimateDepositGasCostInUsd({
                                type,
                                assetAddress,
                                amount,
                                userWalletAddress: estimationAddress,
                            });
                            logger.debug('[pointsApi:/quote] Dynamic gas estimate', { requestId, estimatedGasUsd });
                        }
                    } catch (err) {
                        logger.warn('[pointsApi:/quote] Failed to estimate gas dynamically, using fallback', { requestId, error: err.message });
                    }
                }
            } else if (type === 'nft') {
                // Lookup NFT config
                const nftConfig = Object.entries(TRUSTED_NFT_COLLECTIONS).find(
                    ([address]) => address.toLowerCase() === assetAddress.toLowerCase()
                );
                if (!nftConfig) {
                    return res.status(400).json({ message: 'Unsupported NFT collection.' });
                }
                const [address, data] = nftConfig;
                fundingRate = data.fundingRate;
                symbol = data.name;
                name = data.name;
                // Get floor price in USD
                price = await nftPriceService.getFloorPriceInUsd(assetAddress);
                if (!price || price <= 0) {
                    return res.status(400).json(createErrorResponse(
                        'Could not fetch NFT floor price. Please try again later.',
                        'PRICE_UNAVAILABLE',
                        requestId
                    ));
                }
                logger.debug('[pointsApi:/quote] NFT price fetched', { requestId, assetAddress, price });
                grossUsd = price;
                netAfterFundingRate = grossUsd * fundingRate;
                assetAmount = 1;
                
                // --- Dynamic gas estimation for NFT transfer ---
                try {
                    if (!creditService.estimateDepositGasCostInUsd) {
                        logger.warn('[pointsApi:/quote] Gas estimation not available for NFT', { requestId });
                    } else if (userWalletAddress && isValidEthereumAddress(userWalletAddress)) {
                    estimatedGasUsd = await creditService.estimateDepositGasCostInUsd({
                        type,
                        assetAddress,
                        tokenId,
                        userWalletAddress
                    });
                        logger.debug('[pointsApi:/quote] Dynamic gas estimate for NFT', { requestId, estimatedGasUsd });
                    }
                } catch (err) {
                    logger.warn('[pointsApi:/quote] Failed to estimate gas dynamically for NFT, using fallback', { requestId, error: err.message });
                }
            }
            
            // Calculate funding rate deduction
            const fundingRateDeduction = grossUsd - netAfterFundingRate;

            // Only deduct gas after funding rate
            userReceivesUsd = netAfterFundingRate - estimatedGasUsd;

            // Calculate points based on USD value for all tokens
            if (typeof USD_TO_POINTS_CONVERSION_RATE === 'number' && USD_TO_POINTS_CONVERSION_RATE > 0 && typeof userReceivesUsd === 'number' && userReceivesUsd > 0) {
                pointsCredited = Math.max(0, Math.floor(userReceivesUsd / USD_TO_POINTS_CONVERSION_RATE));
            } else {
                pointsCredited = 0;
            }

            // Log calculated values for debugging
            logger.debug('[pointsApi:/quote] Calculated quote values', {
                requestId,
                fundingRate,
                symbol,
                name,
                decimals,
                assetAmount,
                price,
                grossUsd,
                fundingRateDeduction,
                netAfterFundingRate,
                estimatedGasUsd,
                userReceivesUsd,
                pointsCredited
            });

            // Stage the quote in the credit ledger if we have a wallet address
            // so it can be matched when the deposit event arrives
            let quoteId = 'qid_' + crypto.randomBytes(8).toString('hex');

            if (userWalletAddress && isValidEthereumAddress(userWalletAddress) && pointsCredited > 0) {
                try {
                    const quoteEntry = await creditLedgerDb.createQuotedEntry({
                        depositor_address: userWalletAddress,
                        token_address: assetAddress,
                        deposit_amount_wei: type === 'token' ? amount : undefined,
                        points_quoted: pointsCredited,
                        chain_id: chainId,
                        pricing_snapshot: {
                            grossUsd,
                            fundingRate,
                            fundingRateDeduction,
                            netAfterFundingRate,
                            estimatedGasUsd,
                            userReceivesUsd,
                            price,
                        },
                    });
                    quoteId = quoteEntry.insertedId?.toString() || quoteId;
                    logger.info('[pointsApi:/quote] Staged quote in ledger', { requestId, quoteId });
                } catch (err) {
                    // Non-fatal — quote staging failure shouldn't block the quote response
                    logger.warn('[pointsApi:/quote] Failed to stage quote in ledger', { requestId, error: err.message });
                }
            }

            res.json({
                pointsCredited,
                asset: { symbol, amount: assetAmount.toString() },
                usdValue: { gross: grossUsd, netAfterFundingRate },
                fundingRate,
                fees: {
                    estimatedGasUsd
                },
                userReceivesUsd,
                quoteId,
                breakdown: {
                    grossUsd,
                    fundingRateDeduction,
                    netAfterFundingRate,
                    estimatedGasUsd,
                    userReceivesUsd
                },
                requestId
            });
        } catch (error) {
            logger.error('[pointsApi] /quote error', { requestId, error: error.message, stack: error.stack });
            res.status(500).json(createErrorResponse(
                'An error occurred while generating the quote. Please try again.',
                'QUOTE_ERROR',
                requestId
            ));
        }
    });

    /**
     * @route POST /internal/v1/points/purchase
     * @description Initiates the on-chain deposit process. Returns tx data for the frontend wallet.
     * @access Internal
     */
    router.post('/purchase', purchaseRateLimiter, async (req, res, next) => {
        const requestId = generateRequestId();
        try {
            const { quoteId, type, assetAddress, amount, tokenId, userWalletAddress, referralCode, chainId: bodyChainId } = req.body;
            const chainId = String(bodyChainId || '1');

            // Validate chain ID
            if (!isValidChainId(chainId)) {
                return res.status(400).json(createErrorResponse(
                    `Unsupported chain ID '${chainId}'. Supported chains: ${Object.keys(RPC_ENV_VARS).join(', ')}.`,
                    'UNSUPPORTED_CHAIN',
                    requestId,
                    { supportedChains: Object.keys(RPC_ENV_VARS).map(id => ({ chainId: id, name: CHAIN_NAMES[id] || id })) }
                ));
            }

            const { creditService, ethereumService } = getChainServices(chainId);

            // Validate required fields
            const missingFields = [];
            if (!quoteId) missingFields.push('quoteId');
            if (!type) missingFields.push('type');
            if (!assetAddress) missingFields.push('assetAddress');
            if (!userWalletAddress) missingFields.push('userWalletAddress');
            if (type === 'token' && !amount) missingFields.push('amount');
            if (type === 'nft' && !tokenId) missingFields.push('tokenId');

            if (missingFields.length > 0) {
                logger.warn(`[pointsApi] /purchase missing required fields`, { requestId, missingFields });
                return res.status(400).json(createErrorResponse(
                    'Missing required fields.',
                    'MISSING_FIELDS',
                    requestId,
                    { missingFields }
                ));
            }

            // Validate addresses
            if (!isValidEthereumAddress(assetAddress)) {
                return res.status(400).json(createErrorResponse(
                    'Invalid asset address format.',
                    'INVALID_ADDRESS',
                    requestId
                ));
            }

            if (!isValidEthereumAddress(userWalletAddress)) {
                return res.status(400).json(createErrorResponse(
                    'Invalid user wallet address format.',
                    'INVALID_ADDRESS',
                    requestId
                ));
            }

            // Validate amount for tokens
            if (type === 'token' && !isValidAmount(amount)) {
                return res.status(400).json(createErrorResponse(
                    'Invalid amount format. Amount must be a positive number.',
                    'INVALID_AMOUNT',
                    requestId
                ));
            }

            logger.info(`[pointsApi] /purchase processing purchase request`, { requestId, type, assetAddress });

            let approvalRequired = false;
            let approvalTx = null;
            let depositTx = null;
            const purchaseId = 'pid_' + crypto.randomBytes(8).toString('hex');
            const iface = new ethers.Interface(creditVaultAbi);

            // All payments go to the CreditVault contract
            const vaultAddress = getCreditVaultAddress(chainId);

            // Build referral key: keccak256(referralName) or bytes32(0) if none
            let referralKey = ethers.ZeroHash; // bytes32(0)
            if (referralCode) {
                const sanitizedCode = sanitizeReferralCode(referralCode);
                if (sanitizedCode) {
                    referralKey = ethers.keccak256(ethers.toUtf8Bytes(sanitizedCode));
                    logger.info(`[pointsApi] /purchase referral code hashed`, { requestId, referralCode: sanitizedCode, referralKey });
                }
            }

            if (type === 'token') {
                if (assetAddress === '0x0000000000000000000000000000000000000000') {
                    // Native ETH: payETH(referralKey) with msg.value
                    logger.info(`[pointsApi] /purchase processing ETH payment for amount: ${amount}`);
                    const dataEncoded = iface.encodeFunctionData('payETH', [referralKey]);
                    depositTx = {
                        from: userWalletAddress,
                        to: vaultAddress,
                        data: dataEncoded,
                        value: amount,
                    };
                } else {
                    // ERC20: pay(token, amount, referralKey)
                    const tokenContract = ethereumService.getContract(assetAddress, ['function allowance(address, address) view returns (uint256)', 'function approve(address, uint256) returns (bool)']);
                    const allowance = await tokenContract.allowance(userWalletAddress, vaultAddress);

                    const decimals = tokenDecimalService.getTokenDecimals(assetAddress);
                    const humanReadable = tokenDecimalService.formatTokenAmount(amount, assetAddress);

                    logger.info(`[pointsApi] /purchase ERC20 token details:`, {
                        token: assetAddress,
                        decimals,
                        originalAmount: amount,
                        humanReadable,
                        allowance: allowance.toString()
                    });

                    if (ethers.toBigInt(allowance) < ethers.toBigInt(amount)) {
                        approvalRequired = true;
                        const approveData = tokenContract.interface.encodeFunctionData('approve', [vaultAddress, amount]);
                        approvalTx = {
                            from: userWalletAddress,
                            to: assetAddress,
                            data: approveData,
                        };
                        logger.info(`[pointsApi] /purchase approval required`, { token: assetAddress, amount });
                    }

                    const dataEncoded = iface.encodeFunctionData('pay', [assetAddress, amount, referralKey]);
                    depositTx = {
                        from: userWalletAddress,
                        to: vaultAddress,
                        data: dataEncoded,
                    };
                }
            } else if (type === 'nft') {
                // NFT deposits: safeTransferFrom to vault (contract handles via onERC721Received)
                const erc721Abi = [
                    'function isApprovedForAll(address owner, address operator) view returns (bool)',
                    'function setApprovalForAll(address operator, bool approved)',
                    'function safeTransferFrom(address from, address to, uint256 tokenId)',
                ];
                const nftContract = ethereumService.getContract(assetAddress, erc721Abi);
                const isApproved = await nftContract.isApprovedForAll(userWalletAddress, vaultAddress);
                logger.info(`[pointsApi] /purchase NFT isApprovedForAll check: isApproved=${isApproved}`);

                if (!isApproved) {
                    approvalRequired = true;
                    const approveData = nftContract.interface.encodeFunctionData('setApprovalForAll', [vaultAddress, true]);
                    approvalTx = {
                        from: userWalletAddress,
                        to: assetAddress,
                        data: approveData,
                    };
                    logger.info(`[pointsApi] /purchase NFT approval required`, { nftAddress: assetAddress });
                }

                const dataEncoded = nftContract.interface.encodeFunctionData('safeTransferFrom', [userWalletAddress, vaultAddress, tokenId]);
                depositTx = {
                    from: userWalletAddress,
                    to: assetAddress,
                    data: dataEncoded,
                };
            } else {
                logger.warn('[pointsApi] /purchase invalid type.');
                return res.status(400).json({ message: 'Invalid type.' });
            }

            logger.info(`[pointsApi] /purchase returning tx data`, { requestId, purchaseId });
            res.json({
                approvalRequired,
                approvalTx,
                depositTx,
                purchaseId,
                requestId
            });
        } catch (error) {
            logger.error('[pointsApi] /purchase error', { requestId, error: error.message, stack: error.stack });
            res.status(500).json(createErrorResponse(
                'An error occurred while preparing the purchase. Please try again.',
                'PURCHASE_ERROR',
                requestId
            ));
        }
    });

    /**
     * @route GET /internal/v1/points/tx-status
     * @description Returns the status and receipt for a deposit transaction.
     * @access Internal
     */
    router.get('/tx-status', async (req, res, next) => {
        const requestId = generateRequestId();
        try {
            const { txHash, chainId: queryChainId } = req.query;
            const chainId = String(queryChainId || '1');
            
            if (!txHash) {
                logger.warn('[pointsApi] /tx-status missing txHash', { requestId });
                return res.status(400).json(createErrorResponse(
                    'Transaction hash is required.',
                    'MISSING_FIELDS',
                    requestId,
                    { missing: ['txHash'] }
                ));
            }
            
            // Validate chain ID
            if (!isValidChainId(chainId)) {
                return res.status(400).json(createErrorResponse(
                    `Unsupported chain ID '${chainId}'. Supported chains: ${Object.keys(RPC_ENV_VARS).join(', ')}.`,
                    'UNSUPPORTED_CHAIN',
                    requestId,
                    { supportedChains: Object.keys(RPC_ENV_VARS).map(id => ({ chainId: id, name: CHAIN_NAMES[id] || id })) }
                ));
            }
            
            // Validate transaction hash format
            if (!isValidTransactionHash(txHash)) {
                return res.status(400).json(createErrorResponse(
                    'Invalid transaction hash format.',
                    'INVALID_TX_HASH',
                    requestId
                ));
            }
            
            const { creditService, ethereumService } = getChainServices(chainId);
            logger.info('[pointsApi] /tx-status called', { requestId, txHash, chainId });

            // 1. Try to find the ledger entry
            const ledgerEntry = await creditService.creditLedgerDb.findLedgerEntryByTxHash(txHash);
            if (ledgerEntry) {
                logger.info('[pointsApi] /tx-status found ledger entry', { requestId, txHash });
                const {
                    status,
                    deposit_block_number: blockNumber,
                    points_credited: pointsCredited,
                    user_credited_usd: userCreditedUsd,
                    gas_cost_usd: gasCostUsd,
                    token_address: assetAddress,
                    deposit_amount_wei: amount,
                    failure_reason: failureReason,
                    symbol,
                } = ledgerEntry;
                // Try to get symbol from config if not present
                let assetSymbol = symbol;
                if (!assetSymbol && assetAddress) {
                    const tokenConfig = getChainTokenConfig(chainId);
                    const tokenEntry = Object.entries(tokenConfig || {}).find(
                        ([address]) => address.toLowerCase() === assetAddress.toLowerCase()
                    );
                    assetSymbol = tokenEntry ? tokenEntry[1].symbol : undefined;
                }
                // Format amount using centralized decimal service
                let assetAmount = amount;
                if (amount && assetAddress && assetSymbol) {
                    assetAmount = tokenDecimalService.formatTokenAmount(amount, assetAddress);
                }
                res.json({
                    status,
                    txHash,
                    blockNumber,
                    receipt: {
                        pointsCredited,
                        userCreditedUsd,
                        gasCostUsd,
                        asset: {
                            symbol: assetSymbol,
                            amount: assetAmount
                        }
                    },
                    failureReason: failureReason || null
                });
                return;
            }

            // 2. If not found in ledger, check on-chain
            logger.info('[pointsApi] /tx-status ledger entry not found, checking on-chain', { requestId, txHash });
            let txReceipt;
            try {
                txReceipt = await ethereumService.getProvider().getTransactionReceipt(txHash);
            } catch (err) {
                logger.warn('[pointsApi] /tx-status error checking on-chain', { requestId, error: err.message });
            }
            if (txReceipt) {
                logger.info('[pointsApi] /tx-status found on-chain tx, but not in ledger', { requestId, txHash });
                res.json({
                    status: 'PENDING_CONFIRMATION',
                    txHash,
                    blockNumber: txReceipt.blockNumber,
                    receipt: null,
                    failureReason: null,
                    requestId
                });
                return;
            }

            // 3. Not found at all
            logger.warn('[pointsApi] /tx-status txHash not found in ledger or on-chain', { requestId, txHash });
            res.json({
                status: 'UNKNOWN',
                txHash,
                blockNumber: null,
                receipt: null,
                failureReason: 'Transaction not found in ledger or on-chain.',
                requestId
            });
        } catch (error) {
            logger.error('[pointsApi] /tx-status error', { requestId, error: error.message, stack: error.stack });
            res.status(500).json(createErrorResponse(
                'An error occurred while fetching transaction status. Please try again.',
                'TX_STATUS_ERROR',
                requestId
            ));
        }
    });

    /**
     * @route GET /internal/v1/points/charter/:code
     * @description Get referral vault information by charter code
     * @access Internal
     */
    router.get('/charter/:code', async (req, res, next) => {
        try {
            const { code } = req.params;
            logger.info(`[pointsApi] /charter/${code} called`);
            
            if (!code) {
                return res.status(400).json({ message: 'Charter code is required.' });
            }

            const vault = await creditLedgerDb.findReferralVaultByName(code);
            if (!vault) {
                return res.status(404).json({ message: 'Charter not found.' });
            }

            res.json({
                code,
                address: vault.vault_address,
                vaultName: vault.vaultName,
                masterAccountId: vault.master_account_id
            });
        } catch (error) {
            logger.error('[pointsApi] /charter error:', error);
            next(error);
        }
    });

    return router;
}; 