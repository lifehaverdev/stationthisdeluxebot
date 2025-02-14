//const { PrivyInterface } = require('../../../privy');
const { lobby, abacus, prefixHandlers, actionMap, commandRegistry } = require('../bot');
const { getBalance, getNFTBalance, getEthBalance } = require('../../users/checkBalance');
const { UserCore, UserEconomy } = require('../../../db/index');
const {
    sendMessage,
    react,
    editMessage,
    escapeMarkdown,
} = require('../../utils');
const { 
    Connection, 
    PublicKey, 
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

/**
 * Simple price cache system to minimize API calls
 */
const priceCache = {
    sol: {
        price: null,
        lastUpdated: 0
    },
    eth: {
        price: null,
        lastUpdated: 0
    },
    ms2: {
        price: null,
        lastUpdated: 0
    }
};

const TOKENS = {
    MS2_ETH: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820',
    MS2_SOL: 'AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg',
    MS2_ETH_POOL: '0xdC7e9E9808BB28aa4cbef08Fe604C4AB4CfE0402'
};

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Gets the current price of MS2 token in USD from CoinGecko with caching
 * @returns {Promise<number>} Current price of MS2 in USD
 * @throws {Error} If price fetch fails and no cache available
 */
async function getMS2Price() {
    try {
        const now = Date.now();
        
        // Check if cache is valid
        if (priceCache.ms2.price && 
            (now - priceCache.ms2.lastUpdated) < CACHE_DURATION) {
            return priceCache.ms2.price;
        }

        // Cache expired or doesn't exist, fetch new price
        const response = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price?ids=station-this&vs_currencies=usd'
        );
        
        const ms2Price = response.data['station-this'].usd;
        
        // Update cache
        priceCache.ms2.price = ms2Price;
        priceCache.ms2.lastUpdated = now;
        
        return ms2Price;
    } catch (error) {
        console.error('Error fetching MS2 price:', error);
        
        // If we have a cached price, use it as fallback
        if (priceCache.ms2.price) {
            console.log('Using cached price due to API error');
            return priceCache.ms2.price;
        }
        
        throw error;
    }
}


/**
 * Gets the current price of ETH in USD from CoinGecko with caching
 * @returns {Promise<number>} Current price of ETH in USD
 * @throws {Error} If price fetch fails and no cache available
 */
async function getETHPrice() {
    try {
        const now = Date.now();
        
        // Check if cache is valid
        if (priceCache.eth.price && 
            (now - priceCache.eth.lastUpdated) < CACHE_DURATION) {
            return priceCache.eth.price;
        }

        // Cache expired or doesn't exist, fetch new price
        const response = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
        );
        
        const ethPrice = response.data.ethereum.usd;
        
        // Update cache
        priceCache.eth.price = ethPrice;
        priceCache.eth.lastUpdated = now;
        
        return ethPrice;
    } catch (error) {
        console.error('Error fetching ETH price:', error);
        
        // If we have a cached price, use it as fallback
        if (priceCache.eth.price) {
            console.log('Using cached price due to API error');
            return priceCache.eth.price;
        }
        
        throw error;
    }
}

/**
 * Gets the current price of SOL in USD from CoinGecko with caching
 * @returns {Promise<number>} Current price of SOL in USD
 * @throws {Error} If price fetch fails and no cache available
 */
async function getSOLPrice() {
    try {
        const now = Date.now();
        
        // Check if cache is valid
        if (priceCache.sol.price && 
            (now - priceCache.sol.lastUpdated) < CACHE_DURATION) {
            return priceCache.sol.price;
        }

        // Cache expired or doesn't exist, fetch new price
        const response = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
        );
        
        const solPrice = response.data.solana.usd;
        
        // Update cache
        priceCache.sol.price = solPrice;
        priceCache.sol.lastUpdated = now;
        
        return solPrice;
    } catch (error) {
        console.error('Error fetching SOL price:', error);
        
        // If we have a cached price, use it as fallback
        if (priceCache.sol.price) {
            console.log('Using cached price due to API error');
            return priceCache.sol.price;
        }
        
        throw error;
    }
}

async function getSolanaWalletBalance(walletAddress) {
    try {
        // Get native SOL balance
        //const nativeBalance = await getNativeSolBalance(walletAddress);
        
        // Get MS2 token balance using your existing function
        const tokenBalance = await getBalance(walletAddress);

        return {
            success: true,
            balance: {
                //native: nativeBalance,
                ms2: tokenBalance
            }
        };
    } catch (error) {
        return handleError(error, 'get Solana wallet balance');
    }
}

async function getEthereumWalletBalance(walletAddress) {
    try {
        // Get MS2 token balance using the token address
        const rawBalance = await getEthBalance(
            walletAddress, 
            TOKENS.MS2_ETH
        );
        console.log('rawBalance', rawBalance);
        // Convert from 6 decimals (ETH MS2) to proper number
        // 1 MS2 = 1000000 (6 zeros)
        const tokenBalance = Number(rawBalance) * 1e12;
        console.log('tokenBalance', tokenBalance);
        // Ensure we're returning a proper number, not scientific notation
        const formattedBalance = Number(tokenBalance.toFixed(6));
        console.log('formattedBalance', formattedBalance);

        return {
            success: true,
            balance: {
                ms2: formattedBalance
            }
        };
    } catch (error) {
        return handleError(error, 'get Ethereum wallet balance');
    }
}

async function getNativeSolBalance(walletAddress) {
    try {
        const publicKey = new PublicKey(walletAddress);
        const balance = await connection.getBalance(publicKey);
        return balance / LAMPORTS_PER_SOL; // Convert from lamports to SOL
    } catch (error) {
        return handleError(error, 'get native SOL balance');
    }
}

async function getNativeEthBalance(walletAddress) {
    try {
        const provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`);
        const balance = await provider.getBalance(walletAddress);
        return Number(ethers.formatEther(balance)); // Convert from wei to ETH
    } catch (error) {
        return handleError(error, 'get native ETH balance');
    }
}

// Define wallet types
const WALLET_TYPES = {
    // PRIVY_SOL: 'PRIVY_SOL',
    // PRIVY_ETH: 'PRIVY_ETH',
    CONNECTED_SOL: 'CONNECTED_SOL',
    CONNECTED_ETH: 'CONNECTED_ETH'
};

// // Define transaction types
// const TX_TYPES = {
//     CHAIN_SELECT: 'CHAIN_SELECT',
//     WALLET_CREATE: 'WALLET_CREATE',
//     MS2_SWAP: 'MS2_SWAP',
//     WALLET_VERIFY: 'WALLET_VERIFY'
// };

function handleError(error, context) {
    console.error(`Error in ${context}:`, {
        message: error.message,
        stack: error.stack,
        context
    });
    return {
        success: false,
        error: error.message,
        context,
        timestamp: new Date().toISOString()
    };
}

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
        //this.privy = new PrivyInterface();
    }

    async promptChainSelection(message) {
        const userId = message.from.id;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⚡ Solana', callback_data: 'selectChain_SOL' },
                    { text: '💎 Ethereum', callback_data: 'selectChain_ETH' }
                ]
            ]
        };
    
        await sendMessage(message, 
            '🌟 Welcome to MS2! Please select your preferred chain:\n\n' +
            '• Solana: Shitslop Casino\n' +
            '• Ethereum: Decentralized World Computer Masterpiece\n\n' +
            'This will be your primary chain for MS2 transactions.',
            { reply_markup: keyboard }
        );

        // Create abacus entry right away with the callback prefix
        // AbacusHelper.createEntry(userId, TX_TYPES.CHAIN_SELECT, {
        //     callback_data_prefix: 'selectChain_',
        //     originalMessageId: message.message_id,
        //     sentMessageId: sent.message_id,
        //     chain: null
        // });
    }

    async handleChainSelection(action, message, userId) {
        const selectedChain = action.split('_')[1]; // 'selectChain_SOL' -> 'SOL'
        try {
            // If they chose Solana, send them away
            if (selectedChain === 'SOL') {
                await sendMessage(
                    {...message, from: {id: userId}}, 
                    'wrong choice...'
                );
                return;
            }
    
            // For ETH, check if they already have a verified wallet
            // REMOVED BECASUE THIS IS THE ADD WALLET FLOW
            // if (lobby[userId]?.wallets?.length > 0) {
            //     const verifiedWallet = lobby[userId].wallets.find(w => w.verified === true);
            //     if (verifiedWallet) {
            //         await sendMessage(
            //             {...message, from: {id: userId}}, 
            //             `You already have a verified wallet: \`${verifiedWallet.address}\`\n\nUse /wallets to view your details and add more wallets.`
            //         );
            //         return;
            //     }
            // }
    
            // TODO: Handle case where user needs to verify their wallet
            // We'll implement this in the next step
            // This is where we'll:
            // 1. Generate a unique verification amount
            // 2. Store it in abacus for the user
            // 3. Show instructions for sending ETH to verify ownership
            // Generate unique verification amount
            const generateUniqueAmount = () => {
                // Generate a random number between 1-90 to ensure amount is under 0.00009
                let amount;
                do {
                    amount = (0.0000 + Math.floor(Math.random() * 90) / 1000000).toFixed(6);
                } while (
                    // Check if amount is already in use by another user
                    Object.values(abacus).some(entry => 
                        entry.type === 'verify' && 
                        entry.amount === amount &&
                        // Only consider entries from last hour
                        (Date.now() - entry.date) < 3600000
                    )
                );
                return amount;
            };
            const verificationAmount = generateUniqueAmount();

            // Store in abacus
            abacus[userId] = {
                type: 'verify',
                amount: verificationAmount,
                date: Date.now()
            };

            // Create keyboard
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ I sent the ETH', callback_data: 'verify_wallet' },
                        { text: '❌ Cancel', callback_data: 'cancel' }
                    ]
                ]
            };

            const msg = escapeMarkdown(`🔐 To verify your wallet ownership, please send *exactly*\n\n \`${verificationAmount}\` ETH to:\n\n` +
                `\`${process.env.RECEIVING_WALLET_ADDRESS}\`\n\n` +
                `⚠️ The amount must be exact! This helps us verify your wallet.\n` +
                `⏰ This verification is valid for 1 hour.\n\n` +
                `Click the button below once you've sent the transaction.`)

            // Send instructions
            await sendMessage(
                {...message, from: {id: userId}},
                msg,
                { parse_mode: "MarkdownV2", reply_markup: keyboard }
            );
    
        } catch (error) {
            console.error('Chain selection error:', error);
            await sendMessage(
                {...message, from: {id: userId}}, 
                '❌ An error occurred. Please try again later or contact support.'
            );
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
    // async createPrivyWallet(userId, chain) {
    //     try {
    //         // Uncomment this when ready to use real Privy integration
    //         const walletResponse = await this.privy[chain === 'SOL' ? 'createSolWallet' : 'createEthWallet']();
            
    //         // The response should directly contain id and address
    //         // If these don't exist, it means the API call failed
    //         if (!walletResponse.id || !walletResponse.address || !walletResponse.chain_type) {
    //             throw new Error(`Invalid wallet response from Privy: ${JSON.stringify(walletResponse)}`);
    //         }

    //         // Create our standardized wallet object
    //         const wallet = {
    //             address: walletResponse.address,
    //             type: chain === 'SOL' ? WALLET_TYPES.PRIVY_SOL : WALLET_TYPES.PRIVY_ETH,
    //             privyId: walletResponse.id,
    //             assets: [],
    //             createdAt: new Date().toISOString(),
    //             lastUsed: new Date().toISOString()
    //         };

    //         // Add wallet to user's wallets array
    //         return await this.addWalletToUser(userId, wallet);

    //     } catch (error) {
    //         console.error('Error creating Privy wallet:', error);
    //         return {
    //             success: false,
    //             error: error.message
    //         };
    //     }
    // }

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
            const userCoreDb = new UserCore();
            
            // First check lobby
            if (lobby[userId]?.wallets?.length > 0) {
                console.log('📍 Found wallets in lobby:', lobby[userId].wallets);
                wallets = lobby[userId].wallets;
            } else {
                console.log('🔄 No wallets in lobby, checking database...');
                const user = await userCoreDb.findOne({ userId });
                
                if (!user) {
                    console.log('❌ No user found in database');
                    return null;
                }

                // Initialize wallets array if it doesn't exist
                if (!user.wallets) user.wallets = [];

                // Check and migrate legacy wallet if needed
                const updatedWallets = await ensureLegacyWalletMigration(user);
                
                // Update database if wallets changed
                if (updatedWallets.length !== user.wallets.length) {
                    await userCoreDb.updateOne({ userId }, { wallets: updatedWallets });
                }

                if (!updatedWallets.length) {
                    console.log('❌ No wallets found in database');
                    return null;
                }

                wallets = updatedWallets;
                console.log('💾 Found/Updated wallets in database:', wallets);
                
                // Update lobby
                if (!lobby[userId]) lobby[userId] = {};
                lobby[userId].wallets = wallets;
            }

            // Find the active wallet (default to first verified wallet if none marked active)
            const activeWallet = wallets.find(w => w.active) || 
                               wallets.find(w => w.verified) ||
                               wallets[0];

            if (!activeWallet) {
                return {
                    success: false,
                    error: 'No active wallet found'
                };
            }

            // Initialize assets object
            const chain = activeWallet.type.includes('SOL') ? 'SOL' : 'ETH';
            const assets = {
                chain,
                ms2: 0,
                ms2_usd: 0
            };

            // Get balances for active wallet only
            const balances = chain === 'SOL'
                ? await getSolanaWalletBalance(activeWallet.address)
                : await getEthereumWalletBalance(activeWallet.address);

            if (balances.success) {
                assets.ms2 = balances.balance.ms2;

                // Get current MS2 price and calculate USD value
                const ms2Price = await getMS2Price();
                assets.ms2_usd = assets.ms2 * ms2Price;
            }

            console.log('💰 Active wallet assets:', assets);
            
            return {
                success: true,
                assets,
                activeWallet: activeWallet.address,
                checked: Date.now()
            };

        } catch (error) {
            console.error('❌ Error getting user assets:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

async function getUserAssets(userId) {
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
            
            if (!user) {
                console.log('❌ No user found in database');
                return null;
            }

            // Initialize wallets array if it doesn't exist
            if (!user.wallets) user.wallets = [];

            // Check and migrate legacy wallet if needed
            const updatedWallets = await ensureLegacyWalletMigration(user);
            
            // Update database if wallets changed
            if (updatedWallets.length !== user.wallets.length) {
                await userCoreDb.updateOne({ userId }, { wallets: updatedWallets });
            }

            if (!updatedWallets.length) {
                console.log('❌ No wallets found in database');
                return null;
            }

            wallets = updatedWallets;
            console.log('💾 Found/Updated wallets in database:', wallets);
            
            // Update lobby
            if (!lobby[userId]) lobby[userId] = {};
            lobby[userId].wallets = wallets;
        }

        // Find the active wallet (default to first verified wallet if none marked active)
        const activeWallet = wallets.find(w => w.active) || 
                           wallets.find(w => w.verified) ||
                           wallets[0];

        if (!activeWallet) {
            return {
                success: false,
                error: 'No active wallet found'
            };
        }

        // Initialize assets object
        const chain = activeWallet.type.includes('SOL') ? 'SOL' : 'ETH';
        const assets = {
            chain,
            ms2: 0,
            ms2_usd: 0
        };

        // Get balances for active wallet only
        const balances = chain === 'SOL'
            ? await getSolanaWalletBalance(activeWallet.address)
            : await getEthereumWalletBalance(activeWallet.address);

        if (balances.success) {
            assets.ms2 = balances.balance.ms2;

            // Get current MS2 price and calculate USD value
            const ms2Price = await getMS2Price();
            assets.ms2_usd = assets.ms2 * ms2Price;
        }

        console.log('💰 Active wallet assets:', assets);
        
        return {
            success: true,
            assets,
            activeWallet: activeWallet.address,
            checked: Date.now()
        };

    } catch (error) {
        console.error('❌ Error getting user assets:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function ensureLegacyWalletMigration(user) {
    // Early return if conditions aren't met
    if (!user?.wallet || !user?.verified || !Array.isArray(user?.wallets)) {
        return user?.wallets || [];
    }

    // Check if legacy wallet exists in wallets array
    const legacyWalletExists = user.wallets.some(
        w => w.address.toLowerCase() === user.wallet.toLowerCase()
    );

    // Return existing wallets if legacy wallet is already there
    if (legacyWalletExists) {
        return user.wallets;
    }

    // Create new wallet object for legacy wallet
    const legacyWallet = {
        address: user.wallet,
        type: WALLET_TYPES.CONNECTED_SOL,
        isOG: true,
        verified: true,
        active: true,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString()
    };

    // Deactivate any other wallets and add legacy wallet
    const updatedWallets = [
        ...user.wallets.map(w => ({ ...w, active: false })),
        legacyWallet
    ];

    console.log('🔄 Migrated legacy wallet to wallets array:', user.wallet);
    return updatedWallets;
}

async function setActiveWallet(userId, walletAddress) {
    try {
        const userCoreDb = new UserCore();
        
        // Update in database
        const user = await userCoreDb.findOne({ userId });
        if (!user?.wallets?.length) {
            throw new Error('No wallets found for user');
        }

        // Update active status for all wallets
        const updatedWallets = user.wallets.map(w => ({
            ...w,
            active: w.address.toLowerCase() === walletAddress.toLowerCase()
        }));

        await userCoreDb.updateOne(
            { userId },
            { wallets: updatedWallets }
        );

        // Update in lobby if exists
        if (lobby[userId]?.wallets) {
            lobby[userId].wallets = updatedWallets;
        }

        return {
            success: true,
            activeWallet: walletAddress
        };

    } catch (error) {
        console.error('❌ Error setting active wallet:', error);
        return {
            success: false,
            error: error.message
        };
    }
}



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
        await walletHandler.promptChainSelection(message);
    }
};
actionMap['add_wallet'] = async (message, user) => {
    const walletHandler = new WalletHandler();
    await walletHandler.promptChainSelection(message);
};

actionMap['verify_wallet'] = async (message, user) => {
    const walletHandler = new WalletHandler();
    await walletHandler.verifyWalletSetup({...message, from: {id: user}});
};

async function verifyTransfer(toAddress, expectedAmount, fromBlock = '0x0') {
    try {
        const response = await axios.post(
            `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
            {
                id: 1,
                jsonrpc: '2.0',
                method: 'alchemy_getAssetTransfers',
                params: [
                    {
                        fromBlock,
                        toBlock: 'latest',
                        toAddress,
                        category: ['external'],
                        order: 'desc', // Most recent first
                        withMetadata: true,
                        excludeZeroValue: true,
                        maxCount: '0x64' // Check last 100 transfers
                    }
                ]
            },
            {
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json'
                }
            }
        );

        const transfers = response.data.result.transfers;
        
        // Look for a transfer matching our expected amount
        return transfers.find(transfer => 
            Math.abs(parseFloat(transfer.value) - expectedAmount) < 0.0001 // Allow small rounding differences
        );
    } catch (error) {
        console.error('Error verifying transfer:', error);
        return null;
    }
}

actionMap['verify_wallet'] = async (message, user) => {
    const expectedAmount = abacus[user].amount;
    const result = await handleSignUpVerification(message, expectedAmount);
    
    if (result.success) {
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: `✅ Transfer verified!\n\n` +
                  `Received: ${result.data.transferAmount} ETH\n` +
                  `Credited: ${result.data.chargeAmount} charges\n\n` +
                  `Wallet added: ${result.data.wallet.address.slice(0, 6)}...`
        });
    } else {
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: `❌ Verification failed: ${result.error}`
        });
    }
};

/**
 * Verifies a user's transfer and updates their account accordingly
 * @param {Object} callbackQuery - Telegram callback query object
 * @param {string} expectedAmount - Expected ETH amount as string
 * @returns {Promise<Object>} Result of verification
 */
async function handleSignUpVerification(message, expectedAmount) {
    const receivingAddress = process.env.RECEIVING_WALLET_ADDRESS;
    
    try {
        // Convert expected amount to number and validate
        const amount = parseFloat(expectedAmount);
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Invalid expected amount');
        }

        // Find the userId in abacus by matching the verification amount
        const userId = Object.entries(abacus).find(([id, entry]) => 
            entry.type === 'verify' && 
            parseFloat(entry.amount) === amount &&
            // Verify it's within the last hour
            (Date.now() - entry.date) < 3600000
        )?.[0];

        if (!userId) {
            return {
                success: false,
                error: 'Verification session not found or expired. Please start over.'
            };
        }
        console.log('userId',userId)

        // Verify the transfer occurred
        const transfer = await verifyTransfer(receivingAddress, amount);
        if (!transfer) {
            return {
                success: false,
                error: 'Transfer not found. Please wait a few minutes and try again.'
            };
        }
        console.log('transfer:', transfer);

        // Validate the exact amount (allowing for minor rounding differences)
        const receivedAmount = parseFloat(transfer.value);
        const difference = Math.abs(receivedAmount - amount);
        if (difference > 0.0001) { // Allow 0.0001 ETH difference for rounding
            return {
                success: false,
                error: `Transfer amount mismatch. Expected ${amount} ETH, received ${receivedAmount} ETH`
            };
        }

        // Calculate charge amount
        const chargeAmount = await calculateChargeAmount(amount);

        // Initialize user's wallet array if needed
        if (!lobby[userId]) {
            lobby[userId] = { wallets: [] };
        }

        // Create wallet object for the sender's address
        const walletObject = {
            address: transfer.from,
            type: WALLET_TYPES.CONNECTED_ETH,
            verified: true,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            assets: []
        };

        // Update user's data in database
        const userCore = new UserCore();
        const userEconomy = new UserEconomy();

        // Fetch current user data
        const user = await userCore.findOne({ userId: parseInt(userId) });
        if (!user) {
            throw new Error('User not found in database');
        }

        // Check if wallet already exists
        const existingWallet = user.wallets?.find(w => w.address.toLowerCase() === transfer.from.toLowerCase());
        if (!existingWallet) {
            // Add wallet to user's wallets array
            const updatedWallets = [...(user.wallets || []), walletObject];
            await userCore.updateOne(
                { userId: parseInt(userId) },
                { wallets: updatedWallets }
            );

            // Update lobby state
            lobby[userId].wallets.push(walletObject);
        }

        // Get current qoints from lobby
        const currentQoints = lobby[userId]?.qoints || 0;
        
        // Add new charges to existing balance
        const newQointBalance = currentQoints + chargeAmount;
        
        // Update both database and lobby
        await userEconomy.writeQoints(parseInt(userId), newQointBalance);
        
        // Update lobby state
        if (!lobby[userId]) lobby[userId] = {};
        lobby[userId].qoints = newQointBalance;

        return {
            success: true,
            data: {
                transferAmount: amount,
                chargeAmount,
                wallet: walletObject
            }
        };

    } catch (error) {
        console.error('Error in signup verification:', error);
        return {
            success: false,
            error: 'An error occurred during verification. Please try again.'
        };
    }
}

// Function to handle charge purchase verification
async function handleChargePurchase(ctx, amount) {
    const receivingAddress = process.env.RECEIVING_WALLET_ADDRESS;
    
    try {
        const transfer = await verifyTransfer(receivingAddress, amount);
        
        if (transfer) {
            // Calculate charge amount based on ETH sent
            const chargeAmount = calculateChargeAmount(amount);
            
            // Update user's charge balance
            await db.updateUserBalance(ctx.from.id, chargeAmount);
            
            return chargeAmount;
        }
        return 0;
    } catch (error) {
        console.error('Error in charge purchase:', error);
        return 0;
    }
}


async function calculateChargeAmountMS2(ms2Amount) {
    try {
        // Get the MS2 price in USD using the new function
        const ms2Price = await getMS2Price();
        console.log('MS2 Price (USD):', ms2Price);
        
        // Calculate USD value of the MS2 amount
        const usdValue = ms2Amount * ms2Price;
        console.log('USD Value:', usdValue);
        
        // Convert to charges (0.1 cents per charge)
        const charges = Math.floor((usdValue * 100 * 25)); // 0.04 cents per charge
        console.log('Charges:', charges);
        
        return charges;
    } catch (error) {
        console.error('Error calculating charges:', error);
        throw error;
    }
}

async function calculateChargeAmount(ethAmount) {
    try {
        const ethPrice = await getETHPrice();
        console.log('ETH Price (USD):', ethPrice);
        
        // Calculate USD value
        const usdValue = ethAmount * ethPrice;
        
        // Convert to charges (0.1 cents per charge)
        const charges = Math.floor((usdValue * 100 * 10)); // 0.1 cents per charge
        console.log('usdValue:', usdValue);
        console.log('charges:', charges);
        return charges;
    } catch (error) {
        console.error('Error getting ETH price:', error);
        throw error;
    }
}

// Create a function to generate the charge message and options
async function createChargeMessage(userId) {
    const user = lobby[userId];

    // Check if user has verified wallets
    if (!lobby[userId]?.wallets || !lobby[userId].wallets.some(w => w.verified)) {
        return {
            text: 'You need to verify a wallet first! Use /verify to get started.',
            options: {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '..nvm', callback_data: 'delete_message' }
                    ]]
                }
            }
        };
    }

    const chargeInfo = `
🔋 Charge your points with MS2, ETH, or SOL!

Current Rates:
• 1000 MS2 = ${await calculateChargeAmountMS2(1000)} points
• 1,000,000 MS2 = ${await calculateChargeAmountMS2(1000000)} points
• 0.001 ETH = ${await calculateChargeAmount(0.001)} points
• 0.1 SOL = ${await calculateChargeAmount(0.1)} points
Your current points: ${user.points + user.doints} / ${Math.floor((lobby[userId].balance + NOCOINERSTARTER) / POINTMULTI)}

To charge:
1. Send MS2 (eth) or ETH to \`${process.env.RECEIVING_WALLET_ADDRESS}\`
2. Click 'Confirm Transfer' below
3. We'll check your balance and add points!

Need MS2? Use the Buy button below!
    `;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Confirm (ETH) Transfer ✅', callback_data: 'confirmCharge_eth' },
                    { text: 'Confirm (SOL) Transfer ✅', callback_data: 'confirmCharge_sol' },
                    { text: 'Buy MS2 (ETH)🛒', url: 'https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820' },
                    { text: 'Buy MS2 (SOL)🛒', url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg' },
                    { text: 'Bridge MS2', url: 'https://portalbridge.com/' }
                ],
                [
                    { text: '..nvm', callback_data: 'delete_message' }
                ]
            ]
        }
    };

    return { text: chargeInfo, options };
}

// Action handler for inline button
actionMap['gated_charge'] = async (message, user) => {
    const userId = message.from.id;
    const { text, options } = await createChargeMessage(userId);
    
    return await editMessage({
        chat_id: message.message.chat.id,
        message_id: message.message.message_id,
        text,
        ...options
    });
};

// Command handler for /charge
commandRegistry['/charge'] = {
    handler: async (msg) => {
        const userId = msg.from.id;
        const { text, options } = await createChargeMessage(userId);
        
        return await sendMessage(msg, text, options);
    }
};

/**
 * Creates a formatted wallet display message with inline keyboard
 * @param {number} userId - The user's ID
 * @returns {Promise<{text: string, options: Object}>} Formatted message and keyboard options
 */
async function createWalletsMessage(userId) {
    try {
        // Get user's wallets from lobby or database
        let wallets = [];
        if (lobby[userId]?.wallets?.length > 0) {
            wallets = lobby[userId].wallets;
        } else {
            const userCoreDb = new UserCore();
            const user = await userCoreDb.findOne({ userId });
            wallets = user?.wallets || [];
        }

        if (!wallets.length) {
            return {
                text: '❌ No wallets found. Use /verify to add a wallet!',
                options: {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Add Wallet', callback_data: 'verify_wallet' }
                        ]]
                    }
                }
            };
        }

        // Get assets for active wallet
        const assets = await getUserAssets(userId);
        
        // Create wallet list with status indicators
        let messageText = '👛 *Your Wallets*\n\n';
        
        for (const wallet of wallets) {
            const isActive = wallet.active ? '✅ ' : '   ';
            const isVerified = wallet.verified ? '🔒' : '🔓';
            const chain = wallet.type.includes('SOL') ? 'SOL☢️' : 'ETH💎';
            const shortAddress = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
            
            messageText += `${isActive}${chain} \`${shortAddress}\` ${isVerified}\n`;
        }

        // Add active wallet details if available
        if (assets?.success) {
            messageText += '\n💰 *Active Wallet Balance*\n';
            messageText += `• MS2: ${assets.assets.ms2.toFixed(2)}\n`;
            messageText += `• USD Value: $${assets.assets.ms2_usd.toFixed(2)}\n`;
        }

        // Create inline keyboard
        const keyboard = [];
        
        // Add wallet action buttons
        keyboard.push([
            { text: '🔄 Switch Active', callback_data: 'switch_wallet' },
            { text: '➕ Add New', callback_data: 'add_wallet' }
        ]);

        // Add view on explorer buttons if there's an active wallet
        if (assets?.activeWallet) {
            const activeWallet = wallets.find(w => w.address === assets.activeWallet);
            if (activeWallet) {
                const explorerUrl = activeWallet.type.includes('SOL') 
                    ? `https://solscan.io/account/${activeWallet.address}`
                    : `https://etherscan.io/address/${activeWallet.address}`;
                
                keyboard.push([
                    { text: '🔍 View on Explorer', url: explorerUrl }
                ]);
            }
        }

        // Add close button
        keyboard.push([
            { text: '❌ Close', callback_data: 'delete_message' }
        ]);

        return {
            text: messageText,
            options: {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        };
    } catch (error) {
        console.error('Error creating wallets message:', error);
        return {
            text: '❌ Error fetching wallet information. Please try again later.',
            options: {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❌ Close', callback_data: 'delete_message' }
                    ]]
                }
            }
        };
    }
}

// Add command handler for /wallets
commandRegistry['/wallets'] = {
    handler: async (message) => {
        const { text, options } = await createWalletsMessage(message.from.id);
        return await sendMessage(message, text, options);
    }
};

// Add action handler for see_wallets
actionMap['see_wallets'] = async (message, user) => {
    const { text, options } = await createWalletsMessage(user);
    return await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text,
        ...options
    });
};


/**
 * Creates a wallet selection menu for switching active wallet
 * @param {number} userId - The user's ID
 * @returns {Promise<{text: string, options: Object}>} Formatted message and keyboard options
 */
async function createWalletSwitchMenu(userId) {
    try {
        // Get user's wallets from lobby or database
        let wallets = [];
        if (lobby[userId]?.wallets?.length > 0) {
            wallets = lobby[userId].wallets;
        } else {
            const userCoreDb = new UserCore();
            const user = await userCoreDb.findOne({ userId });
            wallets = user?.wallets || [];
        }

        // Handle case with only one wallet
        if (wallets.length <= 1) {
            return {
                text: '❌ You only have one wallet! Add more wallets with /verify to switch between them.',
                options: {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '➕ Add New Wallet', callback_data: 'verify_start' },
                            { text: '❌ Close', callback_data: 'delete_message' }
                        ]]
                    }
                }
            };
        }

        // Create selection menu
        let messageText = '🔄 *Select wallet to make active:*\n\n';
        const keyboard = [];

        // Add button for each wallet
        wallets.forEach((wallet, index) => {
            const isActive = wallet.active ? '✅ ' : '   ';
            const chain = wallet.type.includes('SOL') ? 'SOL☢️' : 'ETH💎';
            const shortAddress = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
            
            // Add wallet info to message
            messageText += `${isActive}${chain} \`${shortAddress}\`\n`;
            
            // Add button for this wallet
            keyboard.push([{
                text: `${chain} ${shortAddress}`,
                callback_data: `switchWallet_${index}`
            }]);
        });

        // Add cancel button
        keyboard.push([
            { text: '❌ Cancel', callback_data: 'see_wallets' }
        ]);

        return {
            text: messageText,
            options: {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        };
    } catch (error) {
        console.error('Error creating wallet switch menu:', error);
        return {
            text: '❌ Error creating wallet selection menu. Please try again later.',
            options: {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❌ Close', callback_data: 'delete_message' }
                    ]]
                }
            }
        };
    }
}

// Add action handler for switch_wallet
actionMap['switch_wallet'] = async (message, user) => {
    const { text, options } = await createWalletSwitchMenu(user);
    return await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text,
        ...options
    });
};

// Add prefix handler for switchWallet_
prefixHandlers['switchWallet_'] = async (action, message, userId) => {
    try {
        const index = parseInt(action.split('_')[1]);
        
        // Get user's wallets
        let wallets = [];
        if (lobby[userId]?.wallets?.length > 0) {
            wallets = lobby[userId].wallets;
        } else {
            const userCoreDb = new UserCore();
            const user = await userCoreDb.findOne({ userId });
            wallets = user?.wallets || [];
        }

        // Validate index
        if (isNaN(index) || index < 0 || index >= wallets.length) {
            throw new Error('Invalid wallet selection');
        }

        // Set the selected wallet as active
        const result = await setActiveWallet(userId, wallets[index].address);

        if (result.success) {
            // Show updated wallet list
            const { text, options } = await createWalletsMessage(userId);
            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: text + '\n✅ Active wallet updated successfully!',
                ...options
            });
        } else {
            throw new Error(result.error);
        }

    } catch (error) {
        console.error('Error switching wallet:', error);
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: '❌ Failed to switch active wallet. Please try again later.',
            reply_markup: {
                inline_keyboard: [[
                    { text: '🔄 Try Again', callback_data: 'switch_wallet' },
                    { text: '❌ Close', callback_data: 'delete_message' }
                ]]
            }
        });
    }
};

// Run test if file is run directly
if (require.main === module) {
    calculateChargeAmount(0.0001).then(() => {
        console.log('\n✅ Test complete');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
    // calculateChargeAmountMS2(1000).then(() => {
    //     console.log('\n✅ Test complete');
    //     process.exit(0);
    // }).catch(error => {
    //     console.error('\n❌ Test failed:', error);
    //     process.exit(1);
    // });
}

module.exports = {
    WalletHandler,
    WALLET_TYPES,
    verifyTransfer,
    handleSignUpVerification,
    handleChargePurchase,
    getMS2Price,
    getETHPrice,
    getUserAssets,
    setActiveWallet
};