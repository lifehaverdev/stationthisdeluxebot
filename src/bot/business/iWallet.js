const { PrivyInterface } = require('../../privy/index');
const { lobby, abacus, prefixHandlers, actionMap, commandRegistry } = require('../core/core.js');
const { getBalance, getNFTBalance } = require('../core/users/checkBalance');
const { UserCore } = require('../../db/index');
const {
    sendMessage,
    react,
    editMessage
} = require('../utils');

// Define wallet types
const WALLET_TYPES = {
    PRIVY_SOL: 'PRIVY_SOL',
    PRIVY_ETH: 'PRIVY_ETH',
    CONNECTED_SOL: 'CONNECTED_SOL',
    CONNECTED_ETH: 'CONNECTED_ETH'
};

// Define transaction types
const TX_TYPES = {
    CHAIN_SELECT: 'CHAIN_SELECT',
    WALLET_CREATE: 'WALLET_CREATE',
    MS2_SWAP: 'MS2_SWAP',
    WALLET_VERIFY: 'WALLET_VERIFY'
};

class AbacusHelper {
    static createEntry(userId, txType, data = {}) {
        userId = parseInt(userId);
        if (!abacus[userId]) {
            abacus[userId] = {};
        }

        const baseEntry = {
            txType,
            data,
            timestamp: Date.now(),
            heading: this.getHeading(txType),
            description: this.getDescription(txType, data),
            status: 'pending'
        };

        abacus[userId][txType] = baseEntry;
        return baseEntry;
    }

    static updateStatus(userId, txType, status) {
        if (abacus[userId]?.[txType]) {
            abacus[userId][txType].status = status;
            return abacus[userId][txType];
        }
        return null;
    }

    static updateDescription(userId, txType) {
        if (!abacus[userId]?.[txType]) return;
        
        const entry = abacus[userId][txType];
        entry.description = this.getDescription(txType, entry.data);
    }

    static clearEntry(userId, txType) {
        if (abacus[userId] && abacus[userId][txType]) {
            delete abacus[userId][txType];
        }
    }

    static getHeading(txType) {
        const headings = {
            [TX_TYPES.CHAIN_SELECT]: '🌟 Chain Selection',
            [TX_TYPES.WALLET_CREATE]: '👛 Wallet Creation',
            [TX_TYPES.MS2_SWAP]: '💱 MS2 Token Swap',
            [TX_TYPES.WALLET_VERIFY]: '✅ Wallet Verification'
        };
        return headings[txType] || 'Transaction';
    }

    static getDescription(txType, data) {
        switch (txType) {
            case TX_TYPES.CHAIN_SELECT:
                if (!data.info) {
                    return 'Please select a chain to continue.';
                }
                return `You are about to select ${data.info} as your primary chain.\n\n` +
                       `This will create a new wallet for you on the ${data.info} network.`;
            case TX_TYPES.MS2_SWAP:
                if (!data.amount || !data.chain) {
                    return 'Please complete swap details to continue.';
                }
                return `Swap Details:\n` +
                       `Amount: ${data.amount} ${data.chain}\n` +
                       `Expected MS2: ${data.expectedMS2}\n\n` +
                       `Gas Fee (estimated): ${data.gasFee} ${data.chain}`;
            // Add more cases as needed
            default:
                return 'Please confirm this transaction';
        }
    }

    static getPendingTransaction(userId) {
        if (!abacus[userId]) return null;
        return Object.values(abacus[userId])
            .find(entry => entry?.status === 'pending');
    }
}

class WalletHandler {
    constructor() {
        this.privy = new PrivyInterface();
    }

    async promptChainSelection(message) {
        const userId = message.from.id;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⚡ Solana', callback_data: 'preConfirm_SOL' },
                    { text: '💎 Ethereum', callback_data: 'preConfirm_ETH' }
                ]
            ]
        };
    
        const sent =  await sendMessage(message, 
            '🌟 Welcome to MS2! Please select your preferred chain:\n\n' +
            '• Solana: Fast & low-cost transactions\n' +
            '• Ethereum: Widely supported & secure\n\n' +
            'This will be your primary chain for MS2 transactions.',
            { reply_markup: keyboard }
        );

        // Create abacus entry right away with the callback prefix
        AbacusHelper.createEntry(userId, TX_TYPES.CHAIN_SELECT, {
            callback_data_prefix: 'selectChain_',
            originalMessageId: message.message_id,
            sentMessageId: sent.message_id,
            chain: null
        });
    }

    async handleChainSelection(action, message, userId) {
        const selectedChain = action.split('_')[1]; // 'selectChain_SOL' -> 'SOL'

        try {
            // Create wallet for selected chain
            const wallet = await this.createPrivyWallet(userId, selectedChain);
            
            if (wallet.success) {
                const minBalance = selectedChain === 'SOL' ? '0.01 SOL' : '0.01 ETH';
                const msg = `✅ Your ${selectedChain} wallet has been created!\n\n` +
                           `📋 Address: \`${wallet.wallet.address}\`\n\n` +
                           `To complete setup, please send:\n` +
                           `1️⃣ At least ${minBalance} for transaction fees\n` +
                           `2️⃣ Your MS2 tokens\n\n` +
                           `Once you've sent both, type /verify to activate your wallet.`;
                const keyboard = {
                    inline_keyboard: [
                        [{ text: `✅ I've Sent the Tokens`, callback_data: 'verify_wallet' }]
                    ]
                };
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: msg,
                    options: {
                        reply_markup: keyboard
                    }
                });
            } else {
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: '❌ Failed to create wallet. Please try again later or contact support.'
                });
            }
        } catch (error) {
            console.error('Chain selection error:', error);
            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: '❌ An error occurred. Please try again later or contact support.'
            });
        }
    }

    async verifyWalletSetup(message) {
        const userId = message.from.id;
        try {
            const assetInfo = await this.getUserAssets(userId);
            if (!assetInfo.success) {
                return await sendMessage(message, 
                    '❌ Failed to check balances. Please try again later.');
            }

            // Check different scenarios
            const hasSolNative = assetInfo.assets.SOL.native >= 0.01;
            const hasEthNative = assetInfo.assets.ETH.native >= 0.01;
            const hasMS2 = assetInfo.totalMS2 > 0;

            // Scenario 1: Empty wallet
            if (!hasSolNative && !hasEthNative) {
                return await sendMessage(message,
                    '⚠️ Your wallet needs some funds to get started!\n\n' +
                    'Please send either:\n' +
                    '• SOL to your Solana wallet\n' +
                    '• ETH to your Ethereum wallet\n\n' +
                    'Use /wallet to see your addresses.'
                );
            }

            // Scenario 2: Has native tokens but no MS2
            if ((hasSolNative || hasEthNative) && !hasMS2) {
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🛍️ Buy MS2 Tokens', callback_data: 'buy_ms2' }],
                        [{ text: '💡 Learn More', callback_data: 'learn_ms2' }]
                    ]
                };

                return await sendMessage(message,
                    '💫 Great! You have some native tokens.\n\n' +
                    'You can either:\n' +
                    '• Buy MS2 tokens to unlock unlimited generations\n' +
                    '• Continue without MS2 and pay per generation\n\n' +
                    `Current Balance:\n` +
                    `${hasSolNative ? `• ${assetInfo.assets.SOL.native} SOL\n` : ''}` +
                    `${hasEthNative ? `• ${assetInfo.assets.ETH.native} ETH\n` : ''}`,
                    { reply_markup: keyboard }
                );
            }

            // Scenario 3: Has MS2
            if (hasMS2) {
                // Update user status in database
                const userCoreDb = new UserCore();
                await userCoreDb.updateOne(
                    { userId },
                    { status: 'active', setupComplete: true }
                );

                const keyboard = {
                    inline_keyboard: [
                        [{ text: '👤 Check Account', callback_data: 'check_account' }]
                    ]
                };

                return await sendMessage(message,
                    '🎉 Welcome to MS2!\n\n' +
                    `Total MS2 Balance: ${assetInfo.totalMS2}\n\n` +
                    '📝 Quick Guide:\n' +
                    '• Your points replenish over time\n' +
                    '• Use /account to check your point balance\n' +
                    '• Each generation costs 1 point\n' +
                    '• Points replenish faster with more MS2\n\n' +
                    '🎮 Ready to start generating? Try /create!',
                    { reply_markup: keyboard }
                );
            }

        } catch (error) {
            console.error('Verify setup error:', error);
            return await sendMessage(message,
                '❌ An error occurred during verification. Please try again later.');
        }
    }

    
    // Create a wallet object with standardized structure
    createWalletObject(address, type, privyId = null) {
        return {
            address,
            type,
            privyId,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString()
        };
    }

    // Add a wallet to user's wallets array
    async addWalletToUser(userId, wallet) {
        const userCoreDb = new UserCore();
        try {
            console.log(`📝 Adding wallet for user ${userId}:`, wallet);

            // Update lobby if user exists there
            if (lobby[userId]) {
                console.log('🏠 User found in lobby, updating...');
                if (!lobby[userId].wallets) {
                    lobby[userId].wallets = [];
                }
                lobby[userId].wallets.push(wallet);
                console.log('✅ Lobby updated:', lobby[userId].wallets);
            }

            // Get user from database
            const user = await userCoreDb.findOne({ userId });
            
            if (!user) {
                console.log('❌ User not found in database');
                return {
                    success: false,
                    error: 'User not found in database'
                };
            }

            // Initialize wallets array if it doesn't exist
            if (!user.wallets) {
                user.wallets = [];
            }

            // Add new wallet
            user.wallets.push(wallet);

            // Update user in database
            
            console.log('💾 Updating database...');
            await userCoreDb.updateOne({ userId }, { wallets: user.wallets });
            console.log('✅ Database updated');

            return {
                success: true,
                wallet
            };
        } catch (error) {
            console.error('❌ Error adding wallet:', error);
            
            // If we succeeded in updating lobby but database failed,
            // rollback lobby changes to maintain consistency
            if (lobby[userId]?.wallets) {
                console.log('🔄 Rolling back lobby changes due to error');
                lobby[userId].wallets = lobby[userId].wallets.filter(w => 
                    w.address !== wallet.address
                );
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    // Create a new Privy wallet for user
    async createPrivyWallet(userId, chain) {
        try {
            // Uncomment this when ready to use real Privy integration
            const walletResponse = await this.privy[chain === 'SOL' ? 'createSolWallet' : 'createEthWallet']();
            
            // The response should directly contain id and address
            // If these don't exist, it means the API call failed
            if (!walletResponse.id || !walletResponse.address || !walletResponse.chain_type) {
                throw new Error(`Invalid wallet response from Privy: ${JSON.stringify(walletResponse)}`);
            }

            // Create our standardized wallet object
            const wallet = {
                address: walletResponse.address,
                type: chain === 'SOL' ? WALLET_TYPES.PRIVY_SOL : WALLET_TYPES.PRIVY_ETH,
                privyId: walletResponse.id,
                assets: [],
                createdAt: new Date().toISOString(),
                lastUsed: new Date().toISOString()
            };

            // Add wallet to user's wallets array
            return await this.addWalletToUser(userId, wallet);

        } catch (error) {
            console.error('Error creating Privy wallet:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Add a connected wallet
    async addConnectedWallet(userId, address, chain) {
        try {
            const wallet = this.createWalletObject(
                address,
                chain === 'SOL' ? WALLET_TYPES.CONNECTED_SOL : WALLET_TYPES.CONNECTED_ETH
            );

            return await this.addWalletToUser(userId, wallet);
        } catch (error) {
            console.error('Error adding connected wallet:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getUserAssets(userId) {
        try {
            let wallets;
            console.log(`🔍 Getting assets for user ${userId}`);

            // First check lobby
            if (lobby[userId]?.wallets?.length > 0) {
                console.log('📍 Found wallets in lobby:', lobby[userId].wallets);
                wallets = lobby[userId].wallets;
            } else {
                console.log('🔄 No wallets in lobby, checking database...');
                const userCoreDb = new UserCore();
                const user = await userCoreDb.findOne({ userId });
                
                if (!user?.wallets?.length) {
                    console.log('❌ No wallets found in database');
                    return null;
                }

                console.log('💾 Found wallets in database:', user.wallets);
                if (!lobby[userId]) lobby[userId] = {};
                lobby[userId].wallets = user.wallets;
                wallets = user.wallets;
            }

            // Initialize assets object with USD values
            const assets = {
                SOL: { 
                    native: 0,
                    ms2: 0,
                    ms2_usd: 0,
                    nfts: {},
                    tokens: {}
                },
                ETH: { 
                    native: 0,
                    ms2: 0,
                    ms2_usd: 0,
                    tokens: {}
                }
            };

            // Process each wallet
            for (const wallet of wallets) {
                const chain = wallet.type.includes('SOL') ? 'SOL' : 'ETH';
                console.log(`📊 Processing ${chain} wallet: ${wallet.address}`);

                // Get native and MS2 balances
                const balances = chain === 'SOL'
                    ? await this.privy.getSolanaWalletBalance(wallet.address)
                    : await this.privy.getEthereumWalletBalance(wallet.address);

                if (balances.success) {
                    assets[chain].native += balances.balance.native;
                    assets[chain].ms2 += balances.balance.ms2;

                    // Calculate USD value for MS2
                    const ms2UsdValue = chain === 'SOL'
                        ? await this.privy.getMS2SOLUSDValue(balances.balance.ms2)
                        : await this.privy.getMS2ETHUSDValue(balances.balance.ms2);

                    if (ms2UsdValue.success) {
                        assets[chain].ms2_usd += ms2UsdValue.value.usd;
                    }
                }

                // Process additional assets in wallet.assets array
                if (wallet.assets?.length > 0) {
                    console.log(`🔍 Checking additional assets for wallet: ${wallet.address}`);
                    
                    for (const asset of wallet.assets) {
                        if (chain === 'SOL') {
                            if (asset.type === 'nft') {
                                const nftCount = await getNFTBalance(wallet.address, asset.address);
                                if (nftCount > 0) {
                                    assets.SOL.nfts[asset.address] = nftCount;
                                }
                            } else {
                                const tokenBalance = await getBalance(wallet.address, asset.address);
                                if (tokenBalance > 0) {
                                    assets.SOL.tokens[asset.address] = tokenBalance;
                                }
                            }
                        } else {
                            const tokenBalance = await this.privy.getEthTokenBalance(wallet.address, asset.address);
                            if (tokenBalance > 0) {
                                assets.ETH.tokens[asset.address] = tokenBalance;
                            }
                        }
                    }
                }
            }

            // Calculate totals
            const totalMS2 = Object.values(assets).reduce((sum, chainAssets) => 
                sum + chainAssets.ms2, 0
            );
            const totalMS2USD = Object.values(assets).reduce((sum, chainAssets) => 
                sum + chainAssets.ms2_usd, 0
            );

            console.log('💰 Total assets:', assets);
            console.log('🎯 Total MS2:', totalMS2);
            console.log('💵 Total MS2 USD Value:', totalMS2USD);
            
            return {
                success: true,
                assets,
                totalMS2,
                totalMS2USD
            };

        } catch (error) {
            console.error('❌ Error getting user assets:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async handleMS2Purchase(message, userId) {
        try {
            // Get current assets
            const assetInfo = await this.getUserAssets(userId);
            if (!assetInfo.success) {
                return await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: '❌ Failed to fetch your balance. Please try again later.'
                });
            }

            // Get wallet type and balance
            const { chain, native: balance } = assetInfo.assets;
            const isEth = chain === 'ETH';
            
            // Check minimum balance for gas
            const minGas = isEth ? 0.001 : 0.01; // ETH needs less gas than SOL
            if (balance < minGas) {
                return await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: `⚠️ Insufficient ${isEth ? 'ETH' : 'SOL'} balance for swap.\n` +
                          `You need at least ${minGas} ${isEth ? 'ETH' : 'SOL'} for gas fees.`
                });
            }

            // Reserve gas amount
            const gasReserve = isEth ? 0.0005 : 0.001;
            const swappableAmount = balance - gasReserve;
            
            // Get MS2 quote based on chain
            let quote;
            if (isEth) {
                quote = await this.privy.getMS2ETHQuote();
            } else {
                quote = await this.privy.getMS2Quote(swappableAmount);
            }

            if (!quote.success) {
                return await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: '❌ Failed to get MS2 price quote. Please try again.'
                });
            }

            // Calculate options differently based on chain
            const options = [0.25, 0.5, 0.75, 1.0].map(percent => {
                const nativeAmount = (swappableAmount * percent).toFixed(4);
                let ms2Amount;
                
                if (isEth) {
                    // ETH quote gives us price per MS2
                    ms2Amount = (nativeAmount / quote.price.eth).toFixed(2);
                } else {
                    // SOL quote gives us direct output amount
                    ms2Amount = (quote.data.outAmount * percent / 1_000_000).toFixed(2);
                }

                return {
                    native: nativeAmount,
                    ms2: ms2Amount
                };
            });

            const keyboard = {
                inline_keyboard: [
                    options.map(opt => ({
                        text: `${opt.native} ${isEth ? 'ETH' : 'SOL'} → ${opt.ms2} MS2`,
                        callback_data: `swap_ms2_${opt.native}`
                    })),
                    [
                        { text: '🔄 Refresh Quote', callback_data: 'refresh_ms2_quote' },
                        { text: '❌ Cancel', callback_data: 'cancel_ms2_swap' }
                    ]
                ]
            };

            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: '💱 MS2 Swap Calculator\n\n' +
                      `Available: ${balance} ${isEth ? 'ETH' : 'SOL'}\n` +
                      `Reserved for gas: ${gasReserve} ${isEth ? 'ETH' : 'SOL'}\n` +
                      `Swappable: ${swappableAmount} ${isEth ? 'ETH' : 'SOL'}\n\n` +
                      'Select how much you want to swap:',
                reply_markup: keyboard
            });

        } catch (error) {
            console.error('MS2 purchase error:', error);
            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: '❌ An error occurred. Please try again later.'
            });
        }
    }
}

commandRegistry['/signup'] = {
    handler: async (message) => {
        const userId = message.from.id;
        const walletHandler = new WalletHandler();

        try {
            // First check lobby for existing wallets
            if (lobby.hasOwnProperty(userId) && 
                lobby[userId].hasOwnProperty('wallets') && 
                lobby[userId].wallets.length > 0) {
                return await sendMessage(message, 
                    '⚠️ You already have a wallet setup. Use /wallet to view your details.');
            }

            // If not in lobby, check database
            const userCoreDb = new UserCore();
            const user = await userCoreDb.findOne({ userId });
            if (user?.wallets?.length > 0) {
                // Update lobby with wallet info from database
                if (!lobby[userId]) lobby[userId] = {};
                lobby[userId].wallets = user.wallets;
                
                return await sendMessage(message, 
                    '⚠️ You already have a wallet setup. Use /wallet to view your details.');
            }

            // No existing wallets found, start chain selection process
            await walletHandler.promptChainSelection(message);

        } catch (error) {
            console.error('Signup error:', error);
            await sendMessage(message, 
                '❌ An error occurred during signup. Please try again later.');
        }
    }

    
};

// Add these to your actionMap
actionMap['buy_ms2'] = async (message, user) => {
    const walletHandler = new WalletHandler();
    await walletHandler.handleMS2Purchase(message, user.id);
};

actionMap['refresh_ms2_quote'] = async (message, user) => {
    const walletHandler = new WalletHandler();
    await walletHandler.handleMS2Purchase(message, user.id);
};

actionMap['cancel_ms2_swap'] = async (message, user) => {
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: '❌ MS2 swap cancelled.\n\nUse /verify when you\'re ready to check your balance again!'
    });
};

// Now preConfirm just needs to build the final callback data
prefixHandlers['preConfirm_'] = async (action, message, userId) => {
    const info = action.split('_')[1];
    // Get all pending transactions for the user
    const userAbacus = abacus[userId];
    const pendingTx = Object.values(userAbacus || {})
        .find(entry => entry?.status === 'pending');
    
    if (!pendingTx) {
        return await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: '❌ Session expired. Please start over.'
        });
    }

    // Build the final callback data from prefix + selection
    const finalCallback = `${pendingTx.data.callback_data_prefix}${info}`;
    
    // Update abacus with the complete callback data
    pendingTx.data.finalCallback = finalCallback;
    pendingTx.data.info = info;

    // Update the description now that we have the info
    AbacusHelper.updateDescription(userId, pendingTx.txType);

    // Update original message
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: '⏳ Processing your selection...'
    });

    // Send confirmation message
    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ Confirm', callback_data: finalCallback },
                { text: '❌ Cancel', callback_data: 'cancel_tx' }
            ]
        ]
    };

    await sendMessage(message, 
        `${pendingTx.heading}\n\n${pendingTx.description}`,
        { reply_markup: keyboard }
    );
};

prefixHandlers['swap_ms2_'] = async (action, message, user) => {
    const solAmount = action.split('_')[2];
    // Here we'll implement the actual swap logic
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: '🔄 Preparing swap...\n\n' +
              `Amount: ${solAmount} SOL\n\n` +
              'Please follow these steps:\n' +
              '1. Visit [Jupiter Exchange Link]\n' +
              '2. Connect your wallet\n' +
              '3. Input these exact amounts\n' +
              '4. Complete the swap\n\n' +
              'Use /verify after swapping to check your new balance!'
    });
};

actionMap['learn_ms2'] = async (message, user) => {
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: '💡 About MS2:\n\n' +
              '• Holding MS2 gives you unlimited generations\n' +
              '• Points replenish automatically\n' +
              '• More MS2 = More Gens & Faster replenishment\n' +
              '• No MS2? Pay per generation\n\n' +
              'Ready to get started? Use /start to check out the tutorial!'
    });
};

actionMap['check_account'] = async (message, user) => {
    // Redirect to account command
    message.text = '/account';
    commandRegistry['/account']({...message, from: user});
};

// When a chain is selected, update both lobby and database
prefixHandlers['selectChain_'] = async (action, message, userId) => {
    const walletHandler = new WalletHandler();

    try {
        const result = await walletHandler.handleChainSelection(action, message, userId);
        if (result?.success) {
            // Update lobby
            if (!lobby[userId]) lobby[userId] = {};
            if (!lobby[userId].wallets) lobby[userId].wallets = [];
            lobby[userId].wallets.push(result.wallet);
        }
    } catch (error) {
        console.error('Chain selection error:', error);
    }
};

prefixHandlers['selectChain_'] = async (action, message, userId) => {
    const walletHandler = new WalletHandler();

    try {
        const result = await walletHandler.handleChainSelection(action, message, userId);
        if (result?.success) {
            // Update lobby
            if (!lobby[userId]) lobby[userId] = {};
            if (!lobby[userId].wallets) lobby[userId].wallets = [];
            lobby[userId].wallets.push(result.wallet);
        }
    } catch (error) {
        console.error('Chain selection error:', error);
    }
};

commandRegistry['/verify'] = {
    handler: async (message) => {
        const walletHandler = new WalletHandler();
        await walletHandler.verifyWalletSetup(message);
    }
};
actionMap['verify_wallet'] = async (message, user) => {
    const walletHandler = new WalletHandler();
    await walletHandler.verifyWalletSetup({...message, from: {id: user}});
};

module.exports = {
    WalletHandler,
    WALLET_TYPES
};