const { getBalance, getEthBalance, getEthNFTBalance } = require('../bot/core/users/checkBalance');
const { request, gql } = require('graphql-request').default;
const crypto = require('crypto');
const dotenv = require('dotenv');
const { 
    Connection, 
    PublicKey, 
    LAMPORTS_PER_SOL,
    SystemProgram,
    Transaction,
} = require('@solana/web3.js');
const { 
    createTransferInstruction,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    createBurnInstruction,
    ASSOCIATED_TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const { ethers } = require('ethers');

dotenv.config();

const TOKENS = {
    MS2_ETH: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820',
    MS2_SOL: 'AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg',
    MS2_ETH_POOL: '0xdC7e9E9808BB28aa4cbef08Fe604C4AB4CfE0402'
};

class PrivyInterface {
    constructor() {
        this.APP_ID = process.env.PRIVY_APP_ID;
        this.APP_SECRET = process.env.PRIVY_APP_SECRET;
        this.AUTH_KEY = process.env.PRIVY_AUTH_KEY;
        this.API_BASE_URL = 'https://api.privy.io/v1'; // Updated base URL
        // Add pending transactions storage
        this.pendingTransactions = new Map();
        
        this.connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
        //this.ethProvider = new ethers.providers.JsonRpcProvider(process.env.ETH_RPC_URL);
        this.jupiterHandler = new JupiterHandler();
         // Start the transaction monitor
         this.startTransactionMonitor();
    }

    // Transaction Status Enum
    static TxStatus = {
        SUBMITTED: 'submitted',
        PENDING: 'pending',
        CONFIRMED: 'confirmed',
        FAILED: 'failed',
        UNKNOWN: 'unknown'
    };


    // Transaction monitoring system
    startTransactionMonitor() {
        setInterval(() => this.checkPendingTransactions(), 10000); // Check every 10 seconds
    }

    async estimateGasCost(chainType, operation, params = {}) {
        if (chainType === 'ethereum') {
            // Get current gas price
            const gasPrice = await this.ethProvider.getGasPrice();
            
            // Known gas limits for different operations
            const GAS_LIMITS = {
                ETH_TRANSFER: 21000,  // Standard ETH transfer
                ERC20_TRANSFER: 65000, // Approximate for ERC20 transfers
                // Add more operations as needed
            };

            const gasLimit = GAS_LIMITS[operation];
            const gasCostWei = gasPrice.mul(gasLimit);
            const gasCostEth = ethers.utils.formatEther(gasCostWei);

            return {
                estimatedGas: gasLimit,
                gasPrice: gasPrice.toString(),
                totalCost: gasCostEth,
                currency: 'ETH'
            };
        }
        
        if (chainType === 'solana') {
            // Solana's static fees (in SOL)
            const SOLANA_FEES = {
                SOL_TRANSFER: 0.000005,
                TOKEN_TRANSFER: 0.000004598
            };

            return {
                estimatedGas: SOLANA_FEES[operation],
                currency: 'SOL'
            };
        }
    }

    async submitTransaction(params) {
        const {
            chainType,  // 'ethereum' or 'solana'
            walletId,
            fromAddress,
            toAddress,
            amount,
            tokenAddress = null  // null for native token transfers
        } = params;

        try {
            // Create transaction based on chain type
            const body = {
                method: 'signAndSendTransaction',
                caip2: this._getChainId(chainType),
                params: await this._createTransactionParams(params)
            };

            const response = await this._makeApiCall(`/wallets/${walletId}/rpc`, 'POST', body);

            // Create transaction record
            const txRecord = {
                id: response.data.hash,
                chainType,
                status: PrivyInterface.TxStatus.SUBMITTED,
                fromAddress,
                toAddress,
                amount,
                tokenAddress,
                submittedAt: new Date().toISOString(),
                confirmations: 0,
                requiredConfirmations: this._getRequiredConfirmations(chainType)
            };

            // Add to pending transactions
            this.pendingTransactions.set(response.data.hash, txRecord);

            return {
                success: true,
                status: PrivyInterface.TxStatus.SUBMITTED,
                transaction: txRecord
            };

        } catch (error) {
            return this._handleError(error, `submit ${chainType} transaction`);
        }
    }

    async checkTransactionStatus(txHash, chainType) {
        try {
            if (this.pendingTransactions.has(txHash)) {
                const txRecord = this.pendingTransactions.get(txHash);
                
                let status;
                if (chainType === 'solana') {
                    status = await this._checkSolanaTransaction(txHash);
                } else if (chainType === 'ethereum') {
                    status = await this._checkEthereumTransaction(txHash);
                }

                // Update transaction record
                txRecord.status = status.status;
                txRecord.confirmations = status.confirmations;
                txRecord.error = status.error;
                
                if (status.isComplete) {
                    this.pendingTransactions.delete(txHash);
                }

                return {
                    success: true,
                    transaction: txRecord
                };
            }

            return {
                success: false,
                error: 'Transaction not found in monitoring system'
            };
        } catch (error) {
            return this._handleError(error, 'check transaction status');
        }
    }

    async _checkSolanaTransaction(txHash) {
        const status = await this.connection.getSignatureStatus(txHash);
        console.log('🔄 Transaction status:', status);
    
        if (!status.value) {
            console.log('⚠️ No status value returned');
            return {
                status: PrivyInterface.TxStatus.PENDING,
                confirmations: 0,
                isComplete: false
            };
        }
    
        if (status.value?.err) {
            console.log('❌ Transaction error:', status.value.err);
            return {
                status: PrivyInterface.TxStatus.FAILED,
                error: status.value.err,
                isComplete: true
            };
        }

        if (status.value?.confirmationStatus === 'finalized') {
            console.log('🔄 Transaction finalized');
            return {
                status: PrivyInterface.TxStatus.CONFIRMED,
                confirmations: 32, // Solana finality
                isComplete: true
            };
        }
        console.log('⏳ Current confirmations:', status.value?.confirmations || 0);
        return {
            status: PrivyInterface.TxStatus.PENDING,
            confirmations: status.value?.confirmations || 0,
            isComplete: false
        };
    }

    async _checkEthereumTransaction(txHash) {
        const tx = await this.ethProvider.getTransaction(txHash);
        if (!tx) {
            return {
                status: PrivyInterface.TxStatus.UNKNOWN,
                isComplete: false
            };
        }

        const confirmations = tx.confirmations || 0;
        
        if (confirmations >= 12) { // Standard ETH finality
            return {
                status: PrivyInterface.TxStatus.CONFIRMED,
                confirmations,
                isComplete: true
            };
        }

        return {
            status: PrivyInterface.TxStatus.PENDING,
            confirmations,
            isComplete: false
        };
    }

    _getRequiredConfirmations(chainType) {
        return chainType === 'solana' ? 32 : 12; // Solana vs ETH
    }

    _getChainId(chainType) {
        return chainType === 'solana' 
            ? 'solana:mainnet' 
            : 'eip155:1'; // Mainnet ETH
    }

    async checkTransactionStatus(txHash, chainType) {
        try {
            if (this.pendingTransactions.has(txHash)) {
                const txRecord = this.pendingTransactions.get(txHash);
                
                let status;
                if (chainType === 'solana') {
                    status = await this._checkSolanaTransaction(txHash);
                } else if (chainType === 'ethereum') {
                    status = await this._checkEthereumTransaction(txHash);
                }

                // Update transaction record
                txRecord.status = status.status;
                txRecord.confirmations = status.confirmations;
                txRecord.error = status.error;
                
                if (status.isComplete) {
                    this.pendingTransactions.delete(txHash);
                }

                return {
                    success: true,
                    transaction: txRecord
                };
            }

            return {
                success: false,
                error: 'Transaction not found in monitoring system'
            };
        } catch (error) {
            return this._handleError(error, 'check transaction status');
        }
    }

    // Internal method to check all pending transactions
    async checkPendingTransactions() {
        for (const [txHash, txRecord] of this.pendingTransactions) {
            try {
                const result = await this.checkTransactionStatus(txHash, txRecord.chainType);
                if (result.transaction.status === PrivyInterface.TxStatus.CONFIRMED || 
                    result.transaction.status === PrivyInterface.TxStatus.FAILED) {
                    // Emit event or callback here if needed
                    console.log(`Transaction ${txHash} completed:`, result.transaction);
                }
            } catch (error) {
                console.error(`Error checking transaction ${txHash}:`, error);
            }
        }
    }


    _handleError(error, context) {
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

    _getBasicAuthHeader() {
        const auth = Buffer.from(`${this.APP_ID}:${this.APP_SECRET}`).toString('base64');
        return `Basic ${auth}`;
    }

    _createAuthSignature(method, path, body = '') {
        if (!this.AUTH_KEY) return null;
        
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `${timestamp}.${method}.${path}${body ? '.' + JSON.stringify(body) : ''}`;
        
        const signature = crypto
            .createHmac('sha256', this.AUTH_KEY)
            .update(message)
            .digest('hex');

        return `t=${timestamp},s=${signature}`;
    }

    async _createTransactionParams(params) {
        const { chainType, fromAddress, toAddress, amount, tokenAddress } = params;

        if (chainType === 'solana') {
            return this._createSolanaTransactionParams(fromAddress, toAddress, amount, tokenAddress);
        } else if (chainType === 'ethereum') {
            return this._createEthereumTransactionParams(fromAddress, toAddress, amount, tokenAddress);
        }

        throw new Error(`Unsupported chain type: ${chainType}`);
    }

    async _createSolanaTransactionParams(fromAddress, toAddress, amount, tokenAddress) {
        try {
            let transaction = new Transaction();

            if (tokenAddress) {
                // Token transfer (MS2 or other SPL tokens)
                const mint = new PublicKey(tokenAddress);
                const fromPubkey = new PublicKey(fromAddress);
                const toPubkey = new PublicKey(toAddress);

                // Get token accounts for both addresses
                const fromTokenAccount = await getAssociatedTokenAddress(
                    mint,
                    fromPubkey
                );
                
                const toTokenAccount = await getAssociatedTokenAddress(
                    mint,
                    toPubkey
                );

                // Check if destination token account exists
                const toAccountInfo = await this.connection.getAccountInfo(toTokenAccount);
                if (!toAccountInfo) {
                    transaction.add(
                        createAssociatedTokenAccountInstruction(
                            fromPubkey, // payer
                            toTokenAccount,
                            toPubkey,
                            mint
                        )
                    );
                }

                // Add transfer instruction
                transaction.add(
                    createTransferInstruction(
                        fromTokenAccount,
                        toTokenAccount,
                        fromPubkey,
                        amount * 1000000 // Convert to token decimals (6 for MS2)
                    )
                );
            } else {
                // Native SOL transfer
                transaction.add(
                    SystemProgram.transfer({
                        fromPubkey: new PublicKey(fromAddress),
                        toPubkey: new PublicKey(toAddress),
                        lamports: amount * LAMPORTS_PER_SOL
                    })
                );
            }

            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = new PublicKey(fromAddress);

            // Serialize the transaction
            const serializedTransaction = transaction.serialize({
                requireAllSignatures: false,
                verifySignatures: false
            });

            return {
                transaction: serializedTransaction.toString('base64'),
                encoding: 'base64'
            };
        } catch (error) {
            throw new Error(`Failed to create Solana transaction: ${error.message}`);
        }
    }

    async _makeApiCall(endpoint, method = 'GET', body = null) {
        try {
            const url = `${this.API_BASE_URL}${endpoint}`;
            console.log('Making API call to:', url);
            
            const headers = {
                'Authorization': this._getBasicAuthHeader(),
                'privy-app-id': this.APP_ID,
                'Content-Type': 'application/json'
            };

            // Add authorization signature for POST requests to specific endpoints
            if (method === 'POST' && endpoint === '/wallets') {
                const signature = this._createAuthSignature(method, endpoint, body);
                if (signature) {
                    headers['privy-authorization-signature'] = signature;
                }
            }

            console.log('Request headers:', headers);
            if (body) console.log('Request body:', body);

            const response = await fetch(url, {
                method,
                headers,
                ...(body && { body: JSON.stringify(body) })
            });

            const responseText = await response.text();
            console.log('Response:', responseText);

            if (!response.ok) {
                throw new Error(`API call failed: ${response.status} ${response.statusText}\n${responseText}`);
            }

            return JSON.parse(responseText);
        } catch (error) {
            return this._handleError(error, `API call to ${endpoint}`);
        }
    }

    async _trackGasUsage(address, operation, callback) {
        try {
            // Get balance before operation
            const balanceBefore = await this.getNativeSolBalance(address);
            
            // Perform the operation
            const result = await callback();
            
            // Wait for transaction confirmation with better error handling
            console.log(`Waiting for transaction ${result.hash} to confirm...`);
            try {
                await this.connection.confirmTransaction(result.hash, 'confirmed');
                
                // Get balance after operation (now that transaction is confirmed)
                const balanceAfter = await this.getNativeSolBalance(address);
                
                // Calculate gas used
                const gasUsed = balanceBefore - balanceAfter;
                
                return {
                    ...result,
                    gas: {
                        used: gasUsed,
                        operation,
                        balanceBefore,
                        balanceAfter,
                        timestamp: new Date().toISOString()
                    }
                };
            } catch (confirmError) {
                return {
                    success: false,
                    error: `Transaction confirmation failed: ${confirmError.message}`,
                    hash: result.hash,
                    context: operation,
                    timestamp: new Date().toISOString()
                };
            }
        } catch (error) {
            return this._handleError(error, `track gas usage for ${operation}`);
        }
    }

    async createEthWallet() {
        try {
            const body = {
                chain_type: 'ethereum',
                idempotency_key: `eth_wallet_${Date.now()}`
            };

            const response = await this._makeApiCall('/wallets', 'POST', body);
            
            if (response.success === false) {
                throw new Error(response.error);
            }

            return {
                success: true,
                wallet: response
            };
        } catch (error) {
            return this._handleError(error, 'create ETH wallet');
        }
    }

    async createSolWallet() {
        try {
            const body = {
                chain_type: 'solana',
                idempotency_key: `sol_wallet_${Date.now()}`
            };

            const response = await this._makeApiCall('/wallets', 'POST', body);
            
            if (response.success === false) {
                throw new Error(response.error);
            }

            return {
                success: true,
                wallet: response
            };
        } catch (error) {
            return this._handleError(error, 'create SOL wallet');
        }
    }

    async sendSol(walletId, fromAddress, toAddress, amount) {
        return this.submitTransaction({
            chainType: 'solana',
            walletId,
            fromAddress,
            toAddress,
            amount,
            tokenAddress: null  // null indicates native SOL transfer
        });
    }

    async sendMS2Solana(walletId, fromAddress, toAddress, amount) {
        return this.submitTransaction({
            chainType: 'solana',
            walletId,
            fromAddress,
            toAddress,
            amount,
            tokenAddress: 'AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg'  // MS2 mint address
        });
    }

    async buyMS2Solana(walletId, fromAddress, solAmount) {
        try {
            // Add buffer for fees (0.01 SOL)
            const totalNeeded = solAmount + 0.01;
            
            // Check if wallet has enough SOL
            const balance = await this.getSolanaWalletBalance(fromAddress);
            if (balance < totalNeeded) {
                throw new Error(`Insufficient SOL balance. Need ${totalNeeded} SOL (including fees), have ${balance} SOL`);
            }

            // Get the swap transaction data
            const swapResult = await this.jupiterHandler.getMS2SwapTransaction(solAmount, fromAddress);
            if (!swapResult.success) {
                throw new Error(`Failed to get swap transaction: ${swapResult.error}`);
            }

            // Submit through Privy
            const response = await this._makeApiCall(`/wallets/${walletId}/rpc`, 'POST', {
                method: 'signAndSendTransaction',
                caip2: this._getChainId('solana'),
                params: {
                    transaction: swapResult.data.swapTransaction,
                    encoding: 'base64'
                }
            });

            // Check if response indicates success
            if (!response?.data?.hash) {
                throw new Error(`Transaction failed: ${JSON.stringify(response?.error || 'Unknown error')}`);
            }

            // Create transaction record
            const txRecord = {
                id: response.data.hash,
                chainType: 'solana',
                status: PrivyInterface.TxStatus.SUBMITTED,
                fromAddress,
                operation: 'BUY_MS2',
                solAmount,
                submittedAt: new Date().toISOString(),
                confirmations: 0,
                requiredConfirmations: 32
            };

            this.pendingTransactions.set(response.data.hash, txRecord);

            return {
                success: true,
                status: PrivyInterface.TxStatus.SUBMITTED,
                transaction: txRecord
            };

        } catch (error) {
            return this._handleError(error, 'buy MS2');
        }
    }

    async burnMS2Solana(walletId, fromAddress, amount) {
        try {
            // Get the user's MS2 token account
            const fromPubkey = new PublicKey(fromAddress);
            const mint = new PublicKey('AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg');
            const tokenAccount = await getAssociatedTokenAddress(
                mint,
                fromPubkey
            );

            // Create burn transaction
            const burnTx = await this._createMS2BurnTransaction(
                fromAddress,
                tokenAccount.toString(),
                amount * 1000000 // Convert to token decimals (6 for MS2)
            );

            // Submit through Privy
            const response = await this._makeApiCall(`/wallets/${walletId}/rpc`, 'POST', {
                method: 'signAndSendTransaction',
                caip2: this._getChainId('solana'),
                params: {
                    transaction: burnTx,
                    encoding: 'base64'
                }
            });

            // Create transaction record
            const txRecord = {
                id: response.data.hash,
                chainType: 'solana',
                status: PrivyInterface.TxStatus.SUBMITTED,
                fromAddress,
                operation: 'BURN_MS2',
                amount,
                submittedAt: new Date().toISOString(),
                confirmations: 0,
                requiredConfirmations: 32
            };

            this.pendingTransactions.set(response.data.hash, txRecord);

            return {
                success: true,
                status: PrivyInterface.TxStatus.SUBMITTED,
                transaction: txRecord
            };

        } catch (error) {
            return this._handleError(error, 'burn MS2');
        }
    }

    async _createMS2BurnTransaction(fromAddress, tokenAddress, amount) {
        try {
            const transaction = new Transaction();
            const fromPubkey = new PublicKey(fromAddress);
            const mintPublicKey = new PublicKey('AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg');
            const tokenAccountPublicKey = new PublicKey(tokenAddress);

            // Use createBurnInstruction directly instead of Token.createBurnInstruction
            const burnInstruction = createBurnInstruction(
                tokenAccountPublicKey, // source (token account)
                mintPublicKey,         // mint
                fromPubkey,           // owner
                amount,               // amount
                []                    // multiSigners (empty array for single signer)
            );
            transaction.add(burnInstruction);

            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash('finalized');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = fromPubkey;

            // Serialize the transaction
            const serializedTransaction = transaction.serialize({
                requireAllSignatures: false,
                verifySignatures: true
            });

            return serializedTransaction.toString('base64');
        } catch (error) {
            throw new Error(`Failed to create MS2 burn transaction: ${error.message}`);
        }
    }

    async sendEth(walletId, fromAddress, toAddress, amount) {
        // Get gas estimate before transaction
        const gasEstimate = await this.estimateGasCost('ethereum', 'ETH_TRANSFER');
        console.log(`Estimated gas cost: ${gasEstimate.totalCost} ETH`);

        // Proceed with transaction...
        return this.submitTransaction({
            chainType: 'ethereum',
            walletId,
            fromAddress,
            toAddress,
            amount,
            gasEstimate  // Include estimate in transaction record
        });
    }

    async getMS2ETHQuote() {
        try {
            const endpoint = `https://gateway.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`;
            
            const query = gql`
                {
                    pool(id: "${TOKENS.MS2_ETH_POOL.toLowerCase()}") {
                        tick
                        sqrtPrice
                        token0 {
                            symbol
                            decimals
                        }
                        token1 {
                            symbol
                            decimals
                        }
                        liquidity
                        token0Price
                        token1Price
                    }
                    bundles(first: 1) {
                        ethPriceUSD
                    }
                }
            `;

            const data = await request(endpoint, query);
            console.log('Pool data:', JSON.stringify(data, null, 2));

            const pool = data.pool;
            const ethPrice = parseFloat(data.bundles[0].ethPriceUSD);

            // Calculate price from sqrt price
            const sqrtPriceX96 = BigInt(pool.sqrtPrice);
            const Q96 = BigInt(2) ** BigInt(96);
            
            // Price = (sqrtPrice/2^96)^2
            const price = Number((sqrtPriceX96 * sqrtPriceX96 * BigInt(1e18)) / (Q96 * Q96)) / 1e18;

            // Determine if we need to invert the price based on token order
            const isMS2Token0 = pool.token0.symbol === 'MS2';
            const rawPrice = isMS2Token0 ? price : 1 / price;

            // Adjust for decimal differences (MS2: 6, WETH: 18)
            const decimalAdjustment = Math.pow(10, 18 - 6); // 10^12
            const ms2EthPrice = rawPrice / decimalAdjustment;

            // Calculate USD price
            const ms2UsdPrice = ms2EthPrice * ethPrice;

            return {
                success: true,
                price: {
                    usd: parseFloat(ms2UsdPrice.toFixed(6)),
                    eth: parseFloat(ms2EthPrice.toFixed(8)),
                    timestamp: new Date().toISOString()
                },
                pool: {
                    liquidity: pool.liquidity,
                    tick: pool.tick,
                    token0: pool.token0.symbol,
                    token1: pool.token1.symbol
                }
            };

        } catch (error) {
            return this._handleError(error, 'get MS2 price quote from pool ticks');
        }
    }

    async getMS2SOLQuote() {
        try {
            // First get SOL price
            const solResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
            const solData = await solResponse.json();
            const solPrice = parseInt(solData.solana.usd);
            
            // Get MS2/SOL quote from Jupiter for 1 MS2 (1000000 because 6 decimals)
            const jupiterQuote = await this.jupiterHandler.getMS2PriceQuote();
            if (!jupiterQuote.success) {
                throw new Error('Failed to get Jupiter quote');
            }
            
            // Jupiter returns amount in lamports, convert to SOL
            const ms2InSol = parseFloat(jupiterQuote.data.pricePerMS2);
            console.log('MS2 in SOL:', ms2InSol);
            const ms2UsdPrice = ms2InSol * solPrice;
            
            console.log('MS2 USD Price:', ms2UsdPrice);
            return {
                success: true,
                price: {
                    usd: parseFloat(ms2UsdPrice.toFixed(6)),
                    sol: parseFloat(ms2InSol.toFixed(8)),
                    timestamp: new Date().toISOString()
                },
                pool: {
                    route: jupiterQuote.data.quoteData.routePlan,
                }
            };

        } catch (error) {
            return this._handleError(error, 'get MS2 SOL price quote');
        }
    }

    // Helper function to convert MS2 amount to USD value (Solana version)
    async getMS2SOLUSDValue(ms2Amount) {
        try {
            const quote = await this.getMS2SOLQuote();
            if (!quote.success) {
                throw new Error('Failed to get MS2 SOL price quote');
            }

            const usdValue = ms2Amount * quote.price.usd;
            
            return {
                success: true,
                value: {
                    ms2: ms2Amount,
                    usd: parseFloat(usdValue.toFixed(2)),
                    pricePerToken: quote.price.usd,
                    timestamp: quote.price.timestamp
                }
            };

        } catch (error) {
            return this._handleError(error, 'calculate MS2 SOL USD value');
        }
    }

    // Helper function to convert MS2 amount to USD value
    async getMS2ETHUSDValue(ms2Amount) {
        try {
            const quote = await this.getMS2ETHQuote();
            if (!quote.success) {
                throw new Error('Failed to get MS2 price quote');
            }

            const usdValue = ms2Amount * quote.price.usd;
            
            return {
                success: true,
                value: {
                    ms2: ms2Amount,
                    usd: parseFloat(usdValue.toFixed(2)),
                    pricePerToken: quote.price.usd,
                    timestamp: quote.price.timestamp
                }
            };

        } catch (error) {
            return this._handleError(error, 'calculate MS2 USD value');
        }
    }

    async getSolanaWalletBalance(walletAddress) {
        try {
            // Get native SOL balance
            const nativeBalance = await this.getNativeSolBalance(walletAddress);
            
            // Get MS2 token balance using your existing function
            const tokenBalance = await getBalance(walletAddress);

            return {
                success: true,
                balance: {
                    native: nativeBalance,
                    ms2: tokenBalance
                }
            };
        } catch (error) {
            return this._handleError(error, 'get Solana wallet balance');
        }
    }

    async getEthereumWalletBalance(walletAddress) {
        try {
            // Get native ETH balance
            const nativeBalance = await this.getNativeEthBalance(walletAddress);
            
            // Get MS2 token balance using the token address
            const tokenBalance = await getEthBalance(
                walletAddress, 
                TOKENS.MS2_ETH  // We'll need to add this to TOKENS constant
            );

            return {
                success: true,
                balance: {
                    native: nativeBalance,
                    ms2: tokenBalance
                }
            };
        } catch (error) {
            return this._handleError(error, 'get Ethereum wallet balance');
        }
    }

    async getNativeSolBalance(walletAddress) {
        try {
            const publicKey = new PublicKey(walletAddress);
            const balance = await this.connection.getBalance(publicKey);
            return balance / LAMPORTS_PER_SOL; // Convert from lamports to SOL
        } catch (error) {
            return this._handleError(error, 'get native SOL balance');
        }
    }

    async getNativeEthBalance(walletAddress) {
        try {
            const provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`);
            const balance = await provider.getBalance(walletAddress);
            return Number(ethers.formatEther(balance)); // Convert from wei to ETH
        } catch (error) {
            return this._handleError(error, 'get native ETH balance');
        }
    }

    _getChainId(chainType) {
        const networks = {
            solana: {
                mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
                testnet: 'solana:testnet',
                devnet: 'solana:devnet'
            },
            ethereum: {
                mainnet: 'eip155:1',
                goerli: 'eip155:5',
                sepolia: 'eip155:11155111'
            }
        };

        // For now, just return mainnet. Later we can add network selection
        return networks[chainType].mainnet;
    }

}

class JupiterHandler {
    constructor() {
        this.API_BASE_URL = 'https://quote-api.jup.ag/v6';
        
        // Common token addresses
        this.TOKENS = {
            SOL: 'So11111111111111111111111111111111111111112',
            MS2: 'AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg',
            USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        };
    }

    async getQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps = 50  // default 0.5% slippage
    }) {
        try {
            const url = `${this.API_BASE_URL}/quote?` + new URLSearchParams({
                inputMint,
                outputMint,
                amount: amount.toString(),
                slippageBps: slippageBps.toString()
            });

            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
            }

            const quoteData = await response.json();
            return {
                success: true,
                data: quoteData
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to get Jupiter quote: ${error.message}`
            };
        }
    }

    // Helper method for SOL -> MS2 quotes
    async getMS2Quote(solAmount) {
        // Convert SOL to lamports
        const lamports = solAmount * 1_000_000_000;
        
        return this.getQuote({
            inputMint: this.TOKENS.SOL,
            outputMint: this.TOKENS.MS2,
            amount: lamports
        });
    }

    // Add new method for price quotes
    async getMS2PriceQuote() {
        // Use 1 SOL as reference amount
        const quoteResult = await this.getQuote({
            inputMint: this.TOKENS.SOL,
            outputMint: this.TOKENS.MS2,
            amount: LAMPORTS_PER_SOL // 1 SOL
        });

        if (!quoteResult.success) {
            return quoteResult;
        }

        // Calculate price per MS2 token
        const ms2Amount = quoteResult.data.outAmount / 1_000_000; // Convert from MS2 decimals
        const pricePerMS2 = 1 / ms2Amount; // SOL per MS2

        return {
            success: true,
            data: {
                pricePerMS2,
                quoteData: quoteResult.data
            }
        };
    }

    async getSwapTransaction(quoteResponse, userPublicKey) {
        try {
            const response = await fetch(`${this.API_BASE_URL}/swap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quoteResponse,
                    userPublicKey,
                    wrapAndUnwrapSol: true  // Handle SOL wrapping automatically
                })
            });

            if (!response.ok) {
                throw new Error(`Jupiter swap API error: ${response.status} ${response.statusText}`);
            }

            const swapData = await response.json();
            return {
                success: true,
                data: swapData
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to get swap transaction: ${error.message}`
            };
        }
    }

    // Helper method for SOL -> MS2 swap transaction
    async getMS2SwapTransaction(solAmount, userPublicKey) {
        // 1. Get quote first
        const quoteResult = await this.getMS2Quote(solAmount);
        if (!quoteResult.success) {
            return quoteResult;
        }

        // 2. Get swap transaction
        return this.getSwapTransaction(quoteResult.data, userPublicKey);
    }
}

class TransactionMonitor {
    static TIMEOUTS = {
        SOLANA: {
            INITIAL: 2 * 60 * 1000,     // 2 minutes
            EXTENDED: 30 * 60 * 1000,   // 30 minutes
        },
        ETHEREUM: {
            INITIAL: 5 * 60 * 1000,     // 5 minutes
            EXTENDED: 60 * 60 * 1000,   // 1 hour
            FINAL: 4 * 60 * 60 * 1000   // 4 hours
        }
    };

    async monitorTransaction(txHash, chain = 'SOLANA') {
        console.log(`🔍 Starting ${chain} transaction monitoring...`);
        
        // First tier - Active monitoring
        const quickResult = await this.activeMonitoring(txHash, chain);
        if (quickResult.confirmed) return quickResult;

        // Second tier - Extended monitoring
        console.log('⏳ Switching to extended monitoring...');
        const extendedResult = await this.extendedMonitoring(txHash, chain);
        if (extendedResult.confirmed || chain === 'SOLANA') return extendedResult;

        // Third tier - Only for ETH, final long monitoring
        if (chain === 'ETHEREUM') {
            console.log('⌛ Switching to final extended monitoring (ETH only)...');
            return this.finalMonitoring(txHash);
        }
    }

    async getRequiredConfirmations(chain) {
        return chain === 'ETHEREUM' ? 12 : 32; // 12 for ETH, 32 for SOL
    }

    async getTransactionStatus(txHash, chain) {
        // Implementation depends on your specific ETH/SOL clients
        return chain === 'ETHEREUM' 
            ? await this.getEthereumStatus(txHash)
            : await this.getSolanaStatus(txHash);
    }

    async finalMonitoring(txHash) {
        const startTime = Date.now();
        const checkInterval = 15 * 60 * 1000; // Check every 15 minutes

        while (Date.now() - startTime < TransactionMonitor.TIMEOUTS.ETHEREUM.FINAL) {
            try {
                const status = await this.getTransactionStatus(txHash, 'ETHEREUM');
                if (status.confirmations >= 12) {
                    return { confirmed: true, status };
                }
                
                // Check if transaction was dropped/replaced
                if (status.isDropped) {
                    return {
                        confirmed: false,
                        status: 'DROPPED',
                        reason: 'Transaction was dropped or replaced'
                    };
                }
            } catch (error) {
                console.log('Final monitoring check failed:', error.message);
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        return {
            confirmed: false,
            status: 'FAILED',
            reason: 'Transaction exceeded maximum lifetime (4 hours)'
        };
    }
}


// Test function
// async function testJupiterQuote() {
//     const jupiter = new JupiterHandler();
    
//     console.log('🚀 Testing Jupiter Quote API...');
//     console.log('Getting quote for 0.1 SOL -> MS2');
    
//     const result = await jupiter.getMS2Quote(0.1);
//     console.log('Quote result:', JSON.stringify(result, null, 2));
// }

// Updated test function
async function testJupiterSwap() {
    const jupiter = new JupiterHandler();
    
    console.log('🚀 Testing Jupiter Swap API...');
    console.log('Getting swap transaction for 0.1 SOL -> MS2');
    
    const testWallet = '3VttTfc9BiW24Nvw1oxoi1TtwBZ7Zyj1ZKcYr4453RbQ';
    const result = await jupiter.getMS2SwapTransaction(0.1, testWallet);
    console.log('Swap transaction result:', JSON.stringify(result, null, 2));
}

//just redid submitTransaction 

async function testSolTransfer() {
    const privy = new PrivyInterface();
    
    console.log('🌟 Testing SOL transfer...');
    const result = await privy.sendSol(
        'tvbjabl6vz4q3ll2tuocmctj',
        '3VttTfc9BiW24Nvw1oxoi1TtwBZ7Zyj1ZKcYr4453RbQ',
        '7CYDtKY7xXiGZHQJqhxfSHL1po36H8B4VfYUCH7dm4mi',
        0.001
    );
    
    console.log('Initial transaction result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
        console.log('\n📡 Monitoring transaction...');
        const txHash = result.transaction.id;
        
        // Return a promise that resolves when monitoring is complete
        return new Promise((resolve) => {
            const interval = setInterval(async () => {
                const status = await privy.checkTransactionStatus(txHash, 'solana');
                console.log('Transaction status:', JSON.stringify(status, null, 2));
                
                if (status.transaction.status === PrivyInterface.TxStatus.CONFIRMED || 
                    status.transaction.status === PrivyInterface.TxStatus.FAILED) {
                    clearInterval(interval);
                    console.log('\n✅ Transaction monitoring complete');
                    resolve();
                }
            }, 5000);

            // Timeout after 2 minutes just in case
            setTimeout(() => {
                clearInterval(interval);
                console.log('\n⚠️ Transaction monitoring timed out after 2 minutes');
                resolve();
            }, 120000);
        });
    }
}

// Test function for MS2 transfer
async function testMS2Transfer() {
    const privy = new PrivyInterface();
    
    console.log('🎮 Testing MS2 transfer...');
    const result = await privy.sendMS2Solana(
        'tvbjabl6vz4q3ll2tuocmctj',
        '3VttTfc9BiW24Nvw1oxoi1TtwBZ7Zyj1ZKcYr4453RbQ',
        '7CYDtKY7xXiGZHQJqhxfSHL1po36H8B4VfYUCH7dm4mi',
        1  // amount in MS2
    );
    
    console.log('Initial transaction result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
        console.log('\n📡 Monitoring transaction...');
        const txHash = result.transaction.id;
        
        return new Promise((resolve) => {
            const interval = setInterval(async () => {
                const status = await privy.checkTransactionStatus(txHash, 'solana');
                console.log('Transaction status:', JSON.stringify(status, null, 2));
                
                if (status.transaction.status === PrivyInterface.TxStatus.CONFIRMED || 
                    status.transaction.status === PrivyInterface.TxStatus.FAILED) {
                    clearInterval(interval);
                    console.log('\n✅ Transaction monitoring complete');
                    resolve();
                }
            }, 5000);

            setTimeout(() => {
                clearInterval(interval);
                console.log('\n⚠️ Transaction monitoring timed out after 2 minutes');
                resolve();
            }, 120000);
        });
    }
}

async function testMS2Buy() {
    const privy = new PrivyInterface();
    
    console.log('💫 Testing MS2 Buy...');
    console.log('Attempting to buy MS2 with 0.01 SOL');
    
    const result = await privy.buyMS2Solana(
        'tvbjabl6vz4q3ll2tuocmctj',
        '3VttTfc9BiW24Nvw1oxoi1TtwBZ7Zyj1ZKcYr4453RbQ',
        0.001  // amount in SOL
    );
    
    console.log('Initial transaction result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
        console.log('\n📡 Monitoring transaction...');
        const txHash = result.transaction.id;
        
        return new Promise((resolve) => {
            const interval = setInterval(async () => {
                const status = await privy.checkTransactionStatus(txHash, 'solana');
                console.log('Transaction status:', JSON.stringify(status, null, 2));
                
                if (status.transaction.status === PrivyInterface.TxStatus.CONFIRMED || 
                    status.transaction.status === PrivyInterface.TxStatus.FAILED) {
                    clearInterval(interval);
                    console.log('\n✅ Transaction monitoring complete');
                    resolve();
                }
            }, 5000);

            // Timeout after 2 minutes
            setTimeout(() => {
                clearInterval(interval);
                console.log('\n⚠️ Transaction monitoring timed out after 2 minutes');
                resolve();
            }, 120000);
        });
    }
}

async function testMS2Burn() {
    const privy = new PrivyInterface();
    
    console.log('🔥 Testing MS2 Burn...');
    console.log('Attempting to burn 1 MS2');
    
    const result = await privy.burnMS2Solana(
        'tvbjabl6vz4q3ll2tuocmctj',
        '3VttTfc9BiW24Nvw1oxoi1TtwBZ7Zyj1ZKcYr4453RbQ',
        1  // amount in MS2
    );
    
    console.log('Initial transaction result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
        console.log('\n📡 Monitoring transaction...');
        const txHash = result.transaction.id;
        
        return new Promise((resolve) => {
            const interval = setInterval(async () => {
                const status = await privy.checkTransactionStatus(txHash, 'solana');
                console.log('Transaction status:', JSON.stringify(status, null, 2));
                
                if (status.transaction.status === PrivyInterface.TxStatus.CONFIRMED || 
                    status.transaction.status === PrivyInterface.TxStatus.FAILED) {
                    clearInterval(interval);
                    console.log('\n✅ Transaction monitoring complete');
                    resolve();
                }
            }, 5000);

            setTimeout(() => {
                clearInterval(interval);
                console.log('\n⚠️ Transaction monitoring timed out after 2 minutes');
                resolve();
            }, 120000);
        });
    }
}

// Run tests if this file is run directly
// if (require.main === module) {
//     testMS2Transfer().then(() => {
//         console.log('\n🏁 Tests complete');
//         // Give a moment for any final console logs to complete
//         setTimeout(() => process.exit(0), 1000);
//     }).catch(error => {
//         console.error('\n❌ Tests failed:', error);
//         setTimeout(() => process.exit(1), 1000);
//     });
// }

async function testEthBalances() {
    const privy = new PrivyInterface();
    const testAddress = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';

    console.log('🧪 Testing ETH balance checking...');
    
    try {
        // Test native ETH balance
        console.log('📊 Checking native ETH balance...');
        const nativeBalance = await privy.getNativeEthBalance(testAddress);
        console.log('Native ETH Balance:', nativeBalance);

        // Test full wallet balance (native + MS2)
        console.log('\n📊 Checking full wallet balance...');
        const fullBalance = await privy.getEthereumWalletBalance(testAddress);
        console.log('Full Balance Response:', JSON.stringify(fullBalance, null, 2));

        // Test NFT balance if we have that implemented
        console.log('\n🖼️ Checking NFT balance...');
        const nftCount = await getEthNFTBalance(testAddress);
        console.log('Total NFTs:', nftCount);

        return {
            success: true,
            testResults: {
                nativeBalance,
                fullBalance,
                nftCount
            }
        };

    } catch (error) {
        console.error('❌ Test failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Add to test function
async function testMS2Price() {
    const privy = new PrivyInterface();
    console.log('🏷️ Testing MS2 price quote...');
    
    // Test with a small amount
    const testAmount = 600000;
    
    // Get price quote
    const quote = await privy.getMS2PriceQuote();
    console.log('MS2 Price Quote:', JSON.stringify(quote, null, 2));
    
    // Get USD value
    const value = await privy.getMS2USDValue(testAmount);
    console.log('MS2 USD Value:', JSON.stringify(value, null, 2));
    
    return {
        quote,
        value
    };
}

// Add to test function
async function testMS2SolPrice() {
    const privy = new PrivyInterface();
    console.log('🏷️ Testing MS2 price quote...');
    
    // Test with a small amount
    const testAmount = 600000;
    
    // Get price quote
    const quote = await privy.getMS2SOLQuote();
    console.log('MS2 Price Quote:', JSON.stringify(quote, null, 2));
    
    // Get USD value
    const value = await privy.getMS2SOLUSDValue(testAmount);
    console.log('MS2 USD Value:', JSON.stringify(value, null, 2));
    
    return {
        quote,
        value
    };
}

// Run test if file is run directly
if (require.main === module) {
    testMS2SolPrice().then(() => {
        console.log('\n✅ Test complete');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
}

module.exports = {
    PrivyInterface,
    JupiterHandler,
    TransactionMonitor
}