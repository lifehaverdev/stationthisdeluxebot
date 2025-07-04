const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const creditVaultAbi = require('../../core/contracts/abis/creditVault.json');
const { creditVaultAddress } = require('../../core/contracts');

// Constants are replicated from creditService for immediate use.
// TODO: Refactor creditService to expose these lists via a method.
const TOKEN_FUNDING_RATES = {
    // Tier 1: 0.95
    '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820': { fundingRate: 0.95, symbol: 'MS2', iconUrl: '/images/sandbox/components/ms2.png', decimals: 9 },
    '0x0000000000c5dc95539589fbD24BE07c6C14eCa4': { fundingRate: 0.95, symbol: 'CULT', iconUrl: '/images/sandbox/components/cult.png', decimals: 18 },
    // Tier 2: 0.70
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { fundingRate: 0.70, symbol: 'USDC', iconUrl: '/images/sandbox/components/usdc.png', decimals: 6 },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { fundingRate: 0.70, symbol: 'WETH', iconUrl: '/images/sandbox/components/weth.png', decimals: 18 },
    '0x0000000000000000000000000000000000000000': { fundingRate: 0.70, symbol: 'ETH', iconUrl: '/images/sandbox/components/eth.png', decimals: 18 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { fundingRate: 0.70, symbol: 'USDT', iconUrl: '/images/sandbox/components/usdt.png', decimals: 6 },
    // Tier 3: 0.60
    '0x6982508145454ce325ddbe47a25d4ec3d2311933': { fundingRate: 0.60, symbol: 'PEPE', iconUrl: '/images/sandbox/components/pepe.png', decimals: 18 },
    '0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a': { fundingRate: 0.60, symbol: 'MOG', iconUrl: '/images/sandbox/components/mog.png', decimals: 18 },
    '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c': { fundingRate: 0.60, symbol: 'SPX6900', iconUrl: '/images/sandbox/components/spx6900.png', decimals: 18 },
};
const DEFAULT_FUNDING_RATE = 0.55;

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
    const { logger, priceFeedService, nftPriceService, creditService, ethereumService } = dependencies;
    logger.info('[pointsApi] Initializing with dependencies:', {
        priceFeedService: !!priceFeedService,
        nftPriceService: !!nftPriceService,
        creditService: !!creditService,
        ethereumService: !!ethereumService,
    });
    const router = express.Router();

    if (!priceFeedService || !nftPriceService) {
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
        
        const tokens = Object.entries(TOKEN_FUNDING_RATES).map(([address, { fundingRate, symbol, iconUrl, decimals }]) => ({
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
            const { type, assetAddress, amount, tokenId } = req.body;
            if (!type || !assetAddress || (type === 'token' && !amount)) {
                return res.status(400).json({ message: 'Missing required fields.' });
            }

            let fundingRate, symbol, name, decimals, grossUsd, netAfterFundingRate, price, assetAmount;
            let estimatedGasUsd = 5.5; // Placeholder
            let protocolMarkupRate = 0.30; // Placeholder, should match creditService.js
            let protocolMarkupUsd, totalFeesUsd, userReceivesUsd, pointsCredited;

            if (type === 'token') {
                // Lookup token config
                const tokenConfig = Object.entries(TOKEN_FUNDING_RATES).find(
                    ([address]) => address.toLowerCase() === assetAddress.toLowerCase()
                );
                if (!tokenConfig) {
                    return res.status(400).json({ message: 'Unsupported token.' });
                }
                const [address, data] = tokenConfig;
                fundingRate = data.fundingRate;
                symbol = data.symbol;
                name = data.name;
                decimals = data.decimals;
                assetAmount = parseFloat((BigInt(amount) / BigInt(10 ** decimals)).toString());
                // Get price in USD
                price = await priceFeedService.getPriceInUsd(assetAddress);
                grossUsd = assetAmount * price;
                netAfterFundingRate = grossUsd * fundingRate;
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
                if (!price) {
                    return res.status(400).json({ message: 'Could not fetch NFT floor price.' });
                }
                grossUsd = price;
                netAfterFundingRate = grossUsd * fundingRate;
                assetAmount = 1;
            } else {
                return res.status(400).json({ message: 'Invalid type.' });
            }

            protocolMarkupUsd = (netAfterFundingRate - estimatedGasUsd) * protocolMarkupRate;
            totalFeesUsd = estimatedGasUsd + protocolMarkupUsd;
            userReceivesUsd = netAfterFundingRate - totalFeesUsd;
            pointsCredited = Math.floor(userReceivesUsd / USD_TO_POINTS_CONVERSION_RATE);

            const quoteId = 'qid_' + crypto.randomBytes(8).toString('hex');

            res.json({
                pointsCredited,
                asset: { symbol, amount: assetAmount.toString() },
                usdValue: { gross: grossUsd, netAfterFundingRate },
                fundingRate,
                fees: {
                    estimatedGasUsd,
                    protocolMarkupUsd,
                    totalFeesUsd
                },
                userReceivesUsd,
                quoteId
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
            const { quoteId, type, assetAddress, amount, tokenId, userWalletAddress } = req.body;
            logger.info(`[pointsApi] /purchase called with:`, req.body);
            if (!quoteId || !type || !assetAddress || !userWalletAddress || (type === 'token' && !amount)) {
                logger.warn('[pointsApi] /purchase missing required fields.');
                return res.status(400).json({ message: 'Missing required fields.' });
            }

            let approvalRequired = false;
            let approvalTx = null;
            let depositTx = null;
            const purchaseId = 'pid_' + crypto.randomBytes(8).toString('hex');
            const iface = new ethers.Interface(creditVaultAbi);

            if (type === 'token') {
                if (assetAddress === '0x0000000000000000000000000000000000000000') {
                    // ETH deposit
                    const data = iface.encodeFunctionData('deposit', [userWalletAddress, assetAddress, amount]);
                    depositTx = {
                        to: creditVaultAddress,
                        from: userWalletAddress,
                        value: amount,
                        data
                    };
                    approvalRequired = false;
                    approvalTx = null;
                } else {
                    // ERC20 deposit
                    // 1. Approval
                    const erc20Abi = ["function approve(address spender, uint256 amount)"];
                    const erc20Iface = new ethers.Interface(erc20Abi);
                    const approveData = erc20Iface.encodeFunctionData('approve', [creditVaultAddress, amount]);
                    approvalRequired = true;
                    approvalTx = {
                        to: assetAddress,
                        from: userWalletAddress,
                        value: '0',
                        data: approveData
                    };
                    // 2. Deposit
                    const data = iface.encodeFunctionData('deposit', [userWalletAddress, assetAddress, amount]);
                    depositTx = {
                        to: creditVaultAddress,
                        from: userWalletAddress,
                        value: '0',
                        data
                    };
                }
            } else if (type === 'nft') {
                // ERC721 transfer
                const erc721Abi = ["function safeTransferFrom(address from, address to, uint256 tokenId)"];
                const erc721Iface = new ethers.Interface(erc721Abi);
                const transferData = erc721Iface.encodeFunctionData('safeTransferFrom', [userWalletAddress, creditVaultAddress, tokenId]);
                depositTx = {
                    to: assetAddress,
                    from: userWalletAddress,
                    value: '0',
                    data: transferData
                };
                approvalRequired = false;
                approvalTx = null;
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
                    const tokenConfig = Object.entries(TOKEN_FUNDING_RATES).find(
                        ([address]) => address.toLowerCase() === assetAddress.toLowerCase()
                    );
                    assetSymbol = tokenConfig ? tokenConfig[1].symbol : undefined;
                }
                // Format amount
                let assetAmount = amount;
                if (amount && assetAddress && assetSymbol) {
                    const tokenConfig = Object.entries(TOKEN_FUNDING_RATES).find(
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