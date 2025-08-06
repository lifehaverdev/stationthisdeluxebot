const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const foundationAbi = require('../../../core/contracts/abis/foundation.json');
const { contracts } = require('../../../core/contracts');
const { TOKEN_CONFIG, getFundingRate, getDecimals, DEFAULT_FUNDING_RATE } = require('../../../core/services/alchemy/tokenConfig');

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

module.exports = function pointsApi(dependencies) {
    const { logger, priceFeedService, nftPriceService, creditService, ethereumService, db } = dependencies;
    const creditLedgerDb = db.creditLedger;
    logger.info('[pointsApi] Initializing with dependencies:', {
        priceFeedService: !!priceFeedService,
        nftPriceService: !!nftPriceService,
        creditService: !!creditService,
        ethereumService: !!ethereumService,
        creditLedgerDb: !!creditLedgerDb
    });
    const router = express.Router();

    if (!priceFeedService || !nftPriceService || !creditLedgerDb) {
        logger.error('[pointsApi] Critical dependency failure: required services are missing!');
        return (req, res, next) => {
            res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Core services for points API are not available.' } });
        };
    }

    /**
     * GET /supported-assets
     * Returns a list of all tokens and NFTs supported for credit deposits.
     */
    router.get('/supported-assets', (req, res) => {
        logger.info('[pointsApi] GET /supported-assets');
        
        const tokens = Object.entries(TOKEN_CONFIG).map(([address, { fundingRate, symbol, iconUrl, decimals }]) => ({
            type: 'TOKEN',
            address,
            symbol,
            fundingRate,
            iconUrl,
            decimals,
        }));

        const nfts = Object.entries(TRUSTED_NFT_COLLECTIONS).map(([address, { fundingRate, name, iconUrl }]) => ({
            type: 'NFT',
            address,
            name,
            fundingRate,
            iconUrl,
        }));

        res.json({
            tokens,
            nfts,
            defaults: {
                tokenFundingRate: DEFAULT_FUNDING_RATE,
                nftFundingRate: BASELINE_NFT_FUNDING_RATE,
            },
        });
    });

    /**
     * @route POST /internal/v1/points/quote
     * @description Provides a real-time quote for a deposit.
     * @access Internal
     */
    router.post('/quote', async (req, res, next) => {
        try {
            const { type, assetAddress, amount, tokenId, userWalletAddress } = req.body;
            console.log('[pointsApi:/quote] Incoming request:', req.body);
            if (!type || !assetAddress || (type === 'token' && !amount)) {
                return res.status(400).json({ message: 'Missing required fields.' });
            }

            let fundingRate, symbol, name, decimals, grossUsd, netAfterFundingRate, price, assetAmount;
            let estimatedGasUsd = 5.5; // Placeholder, will be replaced by dynamic estimation
            let userReceivesUsd, pointsCredited;

            if (type === 'token') {
                fundingRate = getFundingRate(assetAddress);
                decimals = getDecimals(assetAddress);
                // Fix: Use floating point division for assetAmount
                assetAmount = Number(amount) / 10 ** decimals;
                // Get price in USD
                price = await priceFeedService.getPriceInUsd(assetAddress);
                console.log('[pointsApi:/quote] Price fetched for', assetAddress, ':', price);
                grossUsd = assetAmount * price;
                netAfterFundingRate = grossUsd * fundingRate;
                // --- Dynamic gas estimation ---
                try {
                    if (!creditService.estimateDepositGasCostInUsd) throw new Error('creditService.estimateDepositGasCostInUsd not implemented');
                    estimatedGasUsd = await creditService.estimateDepositGasCostInUsd({
                        type,
                        assetAddress,
                        amount,
                        userWalletAddress
                    });
                    console.log('[pointsApi:/quote] Dynamic gas estimate (USD):', estimatedGasUsd);
                } catch (err) {
                    console.warn('[pointsApi:/quote] Failed to estimate gas dynamically, using fallback:', err);
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
                console.log('[pointsApi:/quote] NFT price fetched for', assetAddress, ':', price);
                if (!price) {
                    return res.status(400).json({ message: 'Could not fetch NFT floor price.' });
                }
                grossUsd = price;
                netAfterFundingRate = grossUsd * fundingRate;
                assetAmount = 1;
                // --- Dynamic gas estimation for NFT transfer ---
                try {
                    if (!creditService.estimateDepositGasCostInUsd) throw new Error('creditService.estimateDepositGasCostInUsd not implemented');
                    estimatedGasUsd = await creditService.estimateDepositGasCostInUsd({
                        type,
                        assetAddress,
                        tokenId,
                        userWalletAddress
                    });
                    console.log('[pointsApi:/quote] Dynamic gas estimate (USD) for NFT:', estimatedGasUsd);
                } catch (err) {
                    console.warn('[pointsApi:/quote] Failed to estimate gas dynamically for NFT, using fallback:', err);
                }
            } else {
                return res.status(400).json({ message: 'Invalid type.' });
            }

            // Calculate funding rate deduction
            const fundingRateDeduction = grossUsd - netAfterFundingRate;

            // Only deduct gas after funding rate
            userReceivesUsd = netAfterFundingRate - estimatedGasUsd;

            // Ensure pointsCredited is always set and valid
            if (typeof USD_TO_POINTS_CONVERSION_RATE === 'number' && USD_TO_POINTS_CONVERSION_RATE > 0 && typeof userReceivesUsd === 'number' && userReceivesUsd > 0) {
                pointsCredited = Math.max(0, Math.floor(userReceivesUsd / USD_TO_POINTS_CONVERSION_RATE));
            } else {
                pointsCredited = 0;
            }

            // Log all intermediate values
            console.log('[pointsApi:/quote] Calculated values:', {
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

            const quoteId = 'qid_' + crypto.randomBytes(8).toString('hex');

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
                }
            });
        } catch (error) {
            logger.error('Failed to generate quote:', error);
            next(error);
        }
    });

    /**
     * @route POST /internal/v1/points/purchase
     * @description Initiates the on-chain deposit process. Returns tx data for the frontend wallet.
     * @access Internal
     */
    router.post('/purchase', async (req, res, next) => {
        try {
            const { quoteId, type, assetAddress, amount, tokenId, userWalletAddress, recipientAddress, referralCode } = req.body;
            logger.info(`[pointsApi] /purchase called with:`, req.body);
            // Debug: Log the full request body
            console.log('[pointsApi] /purchase received body:', req.body);
            const missingFields = [];
            if (!quoteId) missingFields.push('quoteId');
            if (!type) missingFields.push('type');
            if (!assetAddress) missingFields.push('assetAddress');
            if (!userWalletAddress) missingFields.push('userWalletAddress');
            if (type === 'token' && !amount) missingFields.push('amount');
            if (missingFields.length > 0) {
                logger.warn(`[pointsApi] /purchase missing required fields: ${missingFields.join(', ')}`);
                console.warn('[pointsApi] /purchase missing fields:', missingFields, 'Body:', req.body);
                return res.status(400).json({ message: 'Missing required fields.', missingFields });
            }

            let approvalRequired = false;
            let approvalTx = null;
            let depositTx = null;
            const purchaseId = 'pid_' + crypto.randomBytes(8).toString('hex');
            const iface = new ethers.Interface(foundationAbi);

            // Determine the foundation address once
            const vaultNetwork = 'sepolia'; // TODO: dynamically detect network if needed
            const foundationAddress = contracts.foundation.addresses[vaultNetwork];
            let toAddress = foundationAddress;

            if (!foundationAddress) {
                logger.error(`[pointsApi] /purchase could not find foundation address for network: ${vaultNetwork}`);
                return res.status(500).json({ message: 'Internal server configuration error: foundation address not found.' });
            }

            if (referralCode) {
                logger.info(`[pointsApi] /purchase looking up referral code: ${referralCode}`);
                const vault = await creditLedgerDb.findReferralVaultByName(referralCode);
                if (vault && vault.vault_address) {
                    logger.info(`[pointsApi] /purchase found vault for referral code ${referralCode}: ${vault.vault_address}`);
                    toAddress = vault.vault_address;
                } else {
                    logger.warn(`[pointsApi] /purchase referral code ${referralCode} not found or vault has no address. Defaulting to foundation address.`);
                }
            } else if (recipientAddress && isValidAddress(recipientAddress)) {
                logger.info(`[pointsApi] /purchase using recipientAddress from request body: ${recipientAddress}`);
                toAddress = recipientAddress;
            }

            logger.info(`[pointsApi] Using recipient address for deposit: ${toAddress}`);

            // Helper to validate Ethereum address
            function isValidAddress(addr) {
                return /^0x[a-fA-F0-9]{40}$/.test(addr);
            }

            if (type === 'token') {
                if (assetAddress === '0x0000000000000000000000000000000000000000') {
                    // Native currency (ETH) deposit
                    logger.info(`[pointsApi] /purchase processing native currency (ETH) deposit for amount: ${amount}`);
                    depositTx = {
                        from: userWalletAddress,
                        to: toAddress,
                        value: amount, // Amount is already in wei
                        data: '0x', // No data for native transfer
                    };
                } else {
                    // ERC20 token deposit
                    const tokenContract = ethereumService.getContract(assetAddress, ['function allowance(address, address) view returns (uint256)', 'function approve(address, uint256) returns (bool)']);
                    const allowance = await tokenContract.allowance(userWalletAddress, toAddress);

                    logger.info(`[pointsApi] /purchase ERC20 allowance check: allowance=${allowance}, amount=${amount}`);

                    if (ethers.toBigInt(allowance) < ethers.toBigInt(amount)) {
                        approvalRequired = true;
                        const approveData = tokenContract.interface.encodeFunctionData('approve', [toAddress, amount]);
                        approvalTx = {
                            from: userWalletAddress,
                            to: assetAddress,
                            data: approveData,
                        };
                        logger.info(`[pointsApi] /purchase approval required for ${amount}. Approval tx:`, approvalTx);
                    }

                    const depositData = iface.encodeFunctionData("deposit", [assetAddress, amount]);
                    depositTx = {
                        from: userWalletAddress,
                        to: toAddress,
                        data: depositData,
                    };
                }
            } else if (type === 'nft') {
                const erc721Abi = ['function isApprovedForAll(address owner, address operator) view returns (bool)', 'function setApprovalForAll(address operator, bool approved)'];
                const nftContract = ethereumService.getContract(assetAddress, erc721Abi);
                const isApproved = await nftContract.isApprovedForAll(userWalletAddress, toAddress);
                logger.info(`[pointsApi] /purchase NFT isApprovedForAll check: isApproved=${isApproved}`);

                if (!isApproved) {
                    approvalRequired = true;
                    const approveData = nftContract.interface.encodeFunctionData('setApprovalForAll', [toAddress, true]);
                    approvalTx = {
                        from: userWalletAddress,
                        to: assetAddress,
                        data: approveData,
                    };
                    logger.info(`[pointsApi] /purchase NFT approval required. Approval tx:`, approvalTx);
                }

                const depositData = iface.encodeFunctionData("depositNFT", [assetAddress, tokenId]);
                depositTx = {
                    from: userWalletAddress,
                    to: toAddress,
                    data: depositData,
                };
            } else {
                logger.warn('[pointsApi] /purchase invalid type.');
                return res.status(400).json({ message: 'Invalid type.' });
            }

            logger.info(`[pointsApi] /purchase returning tx data for purchaseId ${purchaseId}`);
            res.json({
                approvalRequired,
                approvalTx,
                depositTx,
                purchaseId
            });
        } catch (error) {
            logger.error('[pointsApi] /purchase error:', error);
            next(error);
        }
    });

    /**
     * @route GET /internal/v1/points/tx-status
     * @description Returns the status and receipt for a deposit transaction.
     * @access Internal
     */
    router.get('/tx-status', async (req, res, next) => {
        try {
            const { txHash } = req.query;
            logger.info(`[pointsApi] /tx-status called with txHash: ${txHash}`);
            if (!txHash) {
                logger.warn('[pointsApi] /tx-status missing txHash.');
                return res.status(400).json({ message: 'Transaction hash is required.' });
            }

            // 1. Try to find the ledger entry
            const ledgerEntry = await creditService.creditLedgerDb.findLedgerEntryByTxHash(txHash);
            if (ledgerEntry) {
                logger.info(`[pointsApi] /tx-status found ledger entry for txHash: ${txHash}`);
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
                    const tokenConfig = Object.entries(TOKEN_CONFIG).find(
                        ([address]) => address.toLowerCase() === assetAddress.toLowerCase()
                    );
                    assetSymbol = tokenConfig ? tokenConfig[1].symbol : undefined;
                }
                // Format amount
                let assetAmount = amount;
                if (amount && assetAddress && assetSymbol) {
                    const tokenConfig = Object.entries(TOKEN_CONFIG).find(
                        ([address]) => address.toLowerCase() === assetAddress.toLowerCase()
                    );
                    if (tokenConfig) {
                        const decimals = tokenConfig[1].decimals;
                        assetAmount = (BigInt(amount) / BigInt(10 ** decimals)).toString();
                    }
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
            logger.info(`[pointsApi] /tx-status ledger entry not found, checking on-chain for txHash: ${txHash}`);
            let txReceipt;
            try {
                txReceipt = await ethereumService.getProvider().getTransactionReceipt(txHash);
            } catch (err) {
                logger.warn(`[pointsApi] /tx-status error checking on-chain:`, err);
            }
            if (txReceipt) {
                logger.info(`[pointsApi] /tx-status found on-chain tx, but not in ledger. Returning PENDING_CONFIRMATION.`);
                res.json({
                    status: 'PENDING_CONFIRMATION',
                    txHash,
                    blockNumber: txReceipt.blockNumber,
                    receipt: null,
                    failureReason: null
                });
                return;
            }

            // 3. Not found at all
            logger.warn(`[pointsApi] /tx-status txHash not found in ledger or on-chain: ${txHash}`);
            res.json({
                status: 'UNKNOWN',
                txHash,
                blockNumber: null,
                receipt: null,
                failureReason: 'Transaction not found in ledger or on-chain.'
            });
        } catch (error) {
            logger.error('[pointsApi] /tx-status error:', error);
            next(error);
        }
    });

    return router;
}; 