const crypto = require('crypto');
const dotenv = require('dotenv');
dotenv.config();

class PrivyInterface {
    constructor() {
        this.APP_ID = process.env.PRIVY_APP_ID;
        this.APP_SECRET = process.env.PRIVY_APP_SECRET;
        this.AUTH_KEY = process.env.PRIVY_AUTH_KEY;
        this.API_BASE_URL = 'https://api.privy.io/v1'; // Updated base URL
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

    async getSolanaWalletBalance(walletId) {
        try {
            const body = {
                chain_id: "solana:mainnet", // CAIP-2 chain ID for Solana mainnet
                token_addresses: [] // Empty array since we're just checking SOL balance
            };
    
            const response = await this._makeApiCall(`/wallets/${walletId}/balance`, 'POST', body);
            
            if (response.success === false) {
                throw new Error(response.error);
            }
    
            return {
                success: true,
                balance: {
                    native: response.native_balance,
                    tokens: response.token_balances
                }
            };
        } catch (error) {
            return this._handleError(error, 'get Solana wallet balance');
        }
    }
}

// Test Functions
// async function testPrivyInterface() {
//     try {
//         console.log('Testing Privy Interface...');
//         const privy = new PrivyInterface();
        
//         // Test SOL wallet creation
//         console.log('\n☀️ Testing SOL wallet creation...');
//         const solResult = await privy.createSolWallet();
//         console.log('SOL wallet result:', JSON.stringify(solResult, null, 2));
        
//     } catch (error) {
//         console.error('Test failed:', error);
//     }
// }

// Updated test function
async function testPrivyInterface() {
    try {
        console.log('Testing Privy Interface...');
        const privy = new PrivyInterface();
        
        // Test SOL wallet balance
        console.log('\n💰 Testing SOL wallet balance...');
        const solWalletId = "tvbjabl6vz4q3ll2tuocmctj";
        const balanceResult = await privy.getSolanaWalletBalance(solWalletId);
        console.log('SOL balance result:', JSON.stringify(balanceResult, null, 2));
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Run tests if this file is run directly
if (require.main === module) {
    testPrivyInterface().then(() => {
        console.log('Tests complete');
        process.exit(0);
    }).catch(error => {
        console.error('Tests failed:', error);
        process.exit(1);
    });
}

module.exports = new PrivyInterface();