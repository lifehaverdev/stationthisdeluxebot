const express = require('express');
const jwt = require('jsonwebtoken');
const { createLogger } = require('../../../utils/logger');
const { ethers } = require('ethers');
const crypto = require('crypto');

const logger = createLogger('AuthApi');

// createAuthApi will receive internalApiClient via dependencies (canonical DI)

// Simple in-memory store for nonces. In a production environment,
// you would use a more robust cache like Redis.
const nonceStore = new Map();

/**
 * Creates a router for authentication flows.
 * @param {object} dependencies - Service dependencies.
 * @returns {express.Router}
 */
/**
 * EIP-1271 Magic Value - returned by isValidSignature when signature is valid
 * This is the first 4 bytes of keccak256("isValidSignature(bytes32,bytes)")
 */
const EIP1271_MAGIC_VALUE = '0x1626ba7e';

/**
 * Check if an address is a smart contract (has code)
 * @param {ethers.Provider} provider - Ethereum provider
 * @param {string} address - Address to check
 * @returns {Promise<boolean>} True if address is a contract
 */
async function isContract(provider, address) {
  try {
    const code = await provider.getCode(address);
    return code && code !== '0x' && code !== '0x0';
  } catch (error) {
    logger.error(`[AuthApi] Error checking if address is contract:`, error);
    return false;
  }
}

/**
 * Verify signature using EIP-1271 for smart contract wallets
 * @param {ethers.Provider} provider - Ethereum provider
 * @param {string} address - Smart contract wallet address
 * @param {string} messageHash - Hash of the message (bytes32)
 * @param {string} signature - Signature bytes
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifyEIP1271Signature(provider, address, messageHash, signature) {
  try {
    // EIP-1271 ABI - isValidSignature(bytes32 hash, bytes signature) returns (bytes4 magicValue)
    const EIP1271_ABI = [
      'function isValidSignature(bytes32 hash, bytes memory signature) public view returns (bytes4)'
    ];
    
    const contract = new ethers.Contract(address, EIP1271_ABI, provider);
    const result = await contract.isValidSignature(messageHash, signature);
    
    // Check if result matches the magic value
    return result === EIP1271_MAGIC_VALUE;
  } catch (error) {
    logger.error(`[AuthApi] EIP-1271 verification failed:`, error);
    return false;
  }
}

function createAuthApi(dependencies) {
  const { internalApiClient, ethereumService, ethereumServices } = dependencies;
  if (!internalApiClient) {
    throw new Error('[AuthApi] Missing required dependency "internalApiClient"');
  }
  
  // Get ethereum service - prefer mainnet (chainId '1'), fallback to any available
  const getEthereumService = () => {
    if (ethereumServices && typeof ethereumServices === 'object') {
      return ethereumServices['1'] || ethereumServices[Object.keys(ethereumServices)[0]] || ethereumService;
    }
    return ethereumService;
  };
  
  const router = express.Router();

  /**
   * POST /ensure-user
   * Public endpoint for web clients to obtain/ensure a UserCore record.
   * Expects { platform: 'web', platformId: 'uuid-or-jwt-sub', platformContext?: {...} }
   * Returns { masterAccountId, isNewUser }
   */
  router.post('/ensure-user', async (req, res) => {
    try {
      const { platform, platformId, platformContext = {} } = req.body || {};
      if (!platform || !platformId) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'platform and platformId are required.' } });
      }

      // Proxy to internal find-or-create using service credentials
      const resp = await internalApiClient.post('/internal/v1/data/users/find-or-create', {
        platform,
        platformId,
        platformContext,
      });
      return res.status(resp.status || 200).json({ masterAccountId: resp.data.masterAccountId, isNewUser: resp.data.isNewUser });
    } catch (err) {
      const status = err.response ? err.response.status : 500;
      const msg = err.response?.data?.error?.message || err.message;
      res.status(status).json({ error: { code: 'USER_CORE_ERROR', message: msg } });
    }
  });

  /**
   * POST /web3/nonce
   * Generates a nonce for the client to sign.
   * Expects { address: "0x..." } in the body.
   */
  router.post('/web3/nonce', async (req, res) => {
    try {
      const { address } = req.body;
      if (!address || !ethers.isAddress(address)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'A valid Ethereum address is required.' } });
      }

      const lowerCaseAddress = address.toLowerCase();

      // Generate a secure random nonce with a human-readable prefix
      const nonce = `Sign this message to log in to StationThis. Nonce: ${crypto.randomBytes(16).toString('hex')}`;
      
      // Store the nonce with a timestamp for expiration
      nonceStore.set(lowerCaseAddress, { nonce, timestamp: Date.now() });

      // Set a timeout to automatically remove the nonce after 5 minutes
      setTimeout(() => {
        const storedNonce = nonceStore.get(lowerCaseAddress);
        if (storedNonce && storedNonce.nonce === nonce) {
          nonceStore.delete(lowerCaseAddress);
          logger.info(`Nonce for ${lowerCaseAddress} expired and was removed.`);
        }
      }, 5 * 60 * 1000); // 5 minutes

      logger.info(`Generated nonce for address: ${lowerCaseAddress}`);
      res.status(200).json({ nonce });

    } catch (error) {
      logger.error('[AuthApi] /web3/nonce failed:', error);
      res.status(500).json({ error: { code: 'NONCE_GENERATION_FAILED', message: 'Failed to generate nonce.' } });
    }
  });

  /**
   * POST /web3/verify
   * Verifies a signed nonce and returns a JWT.
   * Expects { address: "0x...", signature: "0x..." } in the body.
   */
  router.post('/web3/verify', async (req, res) => {
    try {
        const { address, signature } = req.body;
        const { referral_code: referralCode } = req.cookies;

        if (!address || !signature) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Address and signature are required.' } });
        }
        
        const lowerCaseAddress = address.toLowerCase();

        // Basic signature format validation
        if (typeof signature !== 'string' || !signature.startsWith('0x')) {
            logger.error(`[AuthApi] Invalid signature format: not a hex string`, { 
                address: lowerCaseAddress, 
                signatureType: typeof signature,
                signatureLength: signature?.length 
            });
            return res.status(400).json({ 
                error: { 
                    code: 'INVALID_SIGNATURE_FORMAT', 
                    message: 'Signature must be a hex string starting with 0x. Please ensure you are signing a message, not a transaction.' 
                } 
            });
        }

        const signatureHex = signature.slice(2); // Remove 0x prefix
        
        // Validate hex characters
        if (!/^[0-9a-fA-F]+$/.test(signatureHex)) {
            logger.error(`[AuthApi] Invalid signature: contains non-hex characters`, { 
                address: lowerCaseAddress 
            });
            return res.status(400).json({ 
                error: { 
                    code: 'INVALID_SIGNATURE_FORMAT', 
                    message: 'Signature contains invalid characters. Must be a valid hex string.' 
                } 
            });
        }

        const storedNonceData = nonceStore.get(lowerCaseAddress);
        if (!storedNonceData) {
            return res.status(400).json({ error: { code: 'INVALID_NONCE', message: 'Nonce not found or expired. Please try again.' } });
        }
        
        const { nonce } = storedNonceData;

        // INSPECT SIGNATURE: Try to decode and understand what's in there
        logger.info(`[AuthApi] Inspecting signature: length=${signatureHex.length} chars (${signatureHex.length / 2} bytes)`);
        
        // Try to decode as ABI-encoded data
        let decodedSignature = null;
        let extractedStandardSig = null;
        
        try {
            // Check if it looks like ABI-encoded data (starts with function selector or offset)
            const firstBytes = signature.substring(0, 10); // First 4 bytes (8 hex chars) + 0x
            
            // Try to decode as ABI-encoded bytes
            // ABI encoding: offset (32 bytes) + length (32 bytes) + data
            if (signatureHex.length > 64) {
                // Try to extract bytes from ABI-encoded format
                // Format: 0x + offset (64 chars) + length (64 chars) + data
                const offsetHex = signatureHex.substring(0, 64);
                const offset = parseInt(offsetHex, 16);
                
                if (offset === 32 || offset === 64) { // Common ABI offset values
                    const lengthHex = signatureHex.substring(64, 128);
                    const length = parseInt(lengthHex, 16);
                    
                    if (length > 0 && length < 10000) { // Reasonable length
                        const dataStart = offset * 2; // offset in hex chars
                        const dataEnd = dataStart + (length * 2);
                        if (dataEnd <= signatureHex.length) {
                            extractedStandardSig = '0x' + signatureHex.substring(dataStart, dataEnd);
                            logger.info(`[AuthApi] Extracted potential signature from ABI encoding: length=${extractedStandardSig.length - 2} chars`);
                        }
                    }
                }
            }
            
            // Also try to find a 65-byte (130 hex char) signature somewhere in the data
            // Look for patterns that might be a signature
            for (let i = 0; i <= signatureHex.length - 130; i += 2) {
                const candidate = '0x' + signatureHex.substring(i, i + 130);
                try {
                    // Quick check: signatures usually have specific patterns
                    // v value (last byte) should be 27, 28, or 0-1 (for EIP-2098 compact)
                    const vByte = parseInt(candidate.substring(candidate.length - 2), 16);
                    if (vByte === 27 || vByte === 28 || vByte === 0 || vByte === 1) {
                        // Try to verify it
                        try {
                            const recovered = ethers.verifyMessage(nonce, candidate);
                            if (recovered.toLowerCase() === lowerCaseAddress) {
                                logger.info(`[AuthApi] Found valid signature embedded at offset ${i}!`);
                                extractedStandardSig = candidate;
                                break;
                            }
                        } catch (e) {
                            // Not a valid signature, continue searching
                        }
                    }
                } catch (e) {
                    // Continue searching
                }
            }
        } catch (error) {
            logger.warn(`[AuthApi] Error inspecting signature:`, error.message);
        }
        
        // If we found a standard signature, use it and skip to standard verification!
        if (extractedStandardSig && extractedStandardSig.length === 132) { // 0x + 130 chars
            logger.info(`[AuthApi] Using extracted standard signature, proceeding with standard verification`);
            try {
                const recoveredAddress = ethers.verifyMessage(nonce, extractedStandardSig);
                if (recoveredAddress.toLowerCase() === lowerCaseAddress) {
                    logger.info(`[AuthApi] Extracted signature verified successfully!`);
                    nonceStore.delete(lowerCaseAddress);
                    
                    // Defer user creation/lookup to the internal API
                    const response = await internalApiClient.post('/internal/v1/data/auth/find-or-create-by-wallet', {
                         address: lowerCaseAddress,
                         referralCode 
                    });
                    const { user } = response.data;

                    const jwtSecret = process.env.JWT_SECRET;
                    if (!jwtSecret) {
                      logger.error('JWT_SECRET is not defined in environment variables.');
                      return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
                    }
                    
                    const token = jwt.sign(
                        { userId: user._id, address: lowerCaseAddress },
                        jwtSecret,
                        { expiresIn: '1h' }
                    );

                    res.cookie('jwt', token, {
                      httpOnly: true,
                      secure: process.env.NODE_ENV === 'production',
                      sameSite: 'lax',
                      maxAge: 60 * 60 * 1000 // 1 hour
                    });
                    return res.status(200).json({ success: true, message: 'Login successful' });
                } else {
                    logger.warn(`[AuthApi] Extracted signature did not match address`);
                }
            } catch (error) {
                logger.warn(`[AuthApi] Extracted signature verification failed:`, error.message);
                // Continue with normal flow
            }
        }

        // Check if this is a smart contract wallet FIRST, before validating signature length
        // This allows us to handle smart wallets that return non-standard signature formats
        let ethereumService = getEthereumService();
        
        // Fallback: Create a provider if ethereumService isn't available
        let fallbackProvider = null;
        if (!ethereumService || !ethereumService.provider) {
            try {
                // Try to create a provider from environment variables
                // Use ETHEREUM_RPC_URL (mainnet) - same as foundationConfig expects
                const rpcUrl = process.env.ETHEREUM_RPC_URL || 
                              process.env.ETHEREUM_MAINNET_RPC_URL || 
                              (process.env.ALCHEMY_SECRET ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_SECRET}` : null) ||
                              'https://eth.llamarpc.com'; // Public fallback
                
                if (rpcUrl) {
                    fallbackProvider = new ethers.JsonRpcProvider(rpcUrl);
                    logger.info(`[AuthApi] Created fallback provider for signature verification using ${rpcUrl.substring(0, 30)}...`);
                } else {
                    logger.warn(`[AuthApi] No RPC URL available for fallback provider`);
                }
            } catch (error) {
                logger.warn(`[AuthApi] Could not create fallback provider:`, error.message);
            }
        }
        
        const provider = (ethereumService && ethereumService.provider) ? ethereumService.provider : fallbackProvider;
        let isSmartWallet = false;
        const expectedEOALength = 130; // 65 bytes * 2 hex chars per byte
        const signatureIsLong = signatureHex.length > expectedEOALength;
        
        if (provider) {
            try {
                isSmartWallet = await isContract(provider, lowerCaseAddress);
                logger.info(`[AuthApi] Address ${lowerCaseAddress} is ${isSmartWallet ? 'a smart contract wallet' : 'an EOA'}, signature length: ${signatureHex.length}`);
            } catch (error) {
                logger.warn(`[AuthApi] Could not check if address is contract:`, error.message);
                // If contract check fails but signature is unusually long, assume it might be a smart wallet
                if (signatureIsLong) {
                    logger.info(`[AuthApi] Contract check failed but signature length (${signatureHex.length}) suggests smart wallet, will attempt EIP-1271 verification`);
                    isSmartWallet = true; // Try smart wallet verification as fallback
                }
            }
        } else {
            logger.warn(`[AuthApi] No provider available (ethereumService or fallback)`);
            // If no provider is available but signature is very long, we can't verify
            if (signatureIsLong) {
                logger.error(`[AuthApi] No provider available, but signature length (${signatureHex.length}) suggests smart wallet. Cannot verify without provider.`);
                return res.status(503).json({ 
                    error: { 
                        code: 'SERVICE_UNAVAILABLE', 
                        message: 'Smart wallet verification requires blockchain access. Please ensure RPC configuration is set up.' 
                    } 
                });
            }
        }

        let isValid = false;

        // If signature is longer than standard EOA signature, always try smart wallet verification
        // This handles cases where contract detection might fail or wallet uses non-standard format
        if (isSmartWallet || signatureIsLong) {
            // Smart contract wallet or unusual signature length - use EIP-1271 verification
            if (!provider) {
                logger.error(`[AuthApi] Cannot verify smart wallet signature: no provider available`, {
                    address: lowerCaseAddress,
                    signatureLength: signatureHex.length
                });
                return res.status(503).json({ 
                    error: { 
                        code: 'SERVICE_UNAVAILABLE', 
                        message: 'Smart wallet verification requires blockchain access. Please ensure RPC configuration is set up.' 
                    } 
                });
            }

            try {
                // For EIP-1271, we need the message hash (bytes32)
                // ethers.hashMessage() returns the hash that matches what signMessage produces
                const messageHash = ethers.hashMessage(nonce);
                
                logger.info(`[AuthApi] Attempting EIP-1271 verification for ${isSmartWallet ? 'smart wallet' : 'long signature'}`, {
                    address: lowerCaseAddress,
                    signatureLength: signatureHex.length,
                    messageHash: messageHash
                });
                
                // Smart wallets may return signatures in different formats
                // Accept any hex string as the signature format varies by wallet implementation
                isValid = await verifyEIP1271Signature(
                    provider,
                    lowerCaseAddress,
                    messageHash,
                    signature
                );
                
                if (!isValid) {
                    logger.error(`[AuthApi] EIP-1271 signature verification failed`, {
                        address: lowerCaseAddress,
                        signatureLength: signatureHex.length,
                        isContract: isSmartWallet,
                        messageHash: messageHash
                    });
                    
                    // Provide more specific error message based on whether we confirmed it's a contract
                    const errorMessage = isSmartWallet 
                        ? 'Smart wallet signature verification failed. The signature does not match the expected format. Please ensure you signed the login message correctly.'
                        : 'Signature verification failed. The signature format suggests a smart wallet, but verification failed. Please ensure you signed the login message correctly with your wallet.';
                    
                    return res.status(401).json({ 
                        error: { 
                            code: 'INVALID_SIGNATURE', 
                            message: errorMessage
                        } 
                    });
                }
                
                logger.info(`[AuthApi] EIP-1271 signature verified successfully for ${lowerCaseAddress}`);
            } catch (error) {
                logger.error(`[AuthApi] Error during EIP-1271 verification:`, {
                    error: error.message,
                    errorCode: error.code,
                    errorReason: error.reason,
                    stack: error.stack,
                    address: lowerCaseAddress,
                    signatureLength: signatureHex.length,
                    isContract: isSmartWallet
                });
                
                // Check if error indicates the contract doesn't exist or doesn't implement EIP-1271
                const isContractError = error.message?.includes('execution reverted') || 
                                      error.message?.includes('call exception') ||
                                      error.code === 'CALL_EXCEPTION';
                
                if (isContractError && !isSmartWallet) {
                    // Address is not a contract, so EIP-1271 won't work
                    // This might be a hardware wallet returning transaction data instead of a message signature
                    logger.warn(`[AuthApi] EIP-1271 failed - address is not a contract. Signature may be transaction data.`, {
                        address: lowerCaseAddress,
                        signatureLength: signatureHex.length
                    });
                    return res.status(400).json({ 
                        error: { 
                            code: 'INVALID_SIGNATURE_FORMAT', 
                            message: 'The signature format is not recognized. Please ensure your wallet is signing a message (not a transaction). If you are using a hardware wallet, make sure it is configured to sign messages, not transactions.' 
                        } 
                    });
                }
                
                // If EIP-1271 fails and it's not confirmed to be a contract, try standard verification as fallback (only if signature length matches)
                if (!isSmartWallet && signatureHex.length === expectedEOALength) {
                    logger.info(`[AuthApi] EIP-1271 failed but signature length matches EOA, trying standard verification`);
                    try {
                        const recoveredAddress = ethers.verifyMessage(nonce, signature);
                        isValid = recoveredAddress.toLowerCase() === lowerCaseAddress;
                        if (isValid) {
                            logger.info(`[AuthApi] Standard verification succeeded as fallback`);
                        } else {
                            return res.status(401).json({ 
                                error: { 
                                    code: 'INVALID_SIGNATURE', 
                                    message: 'Signature verification failed. Please ensure you signed the login message correctly.' 
                                } 
                            });
                        }
                    } catch (fallbackError) {
                        logger.error(`[AuthApi] Fallback standard verification also failed:`, fallbackError.message);
                        return res.status(500).json({ 
                            error: { 
                                code: 'VERIFICATION_FAILED', 
                                message: 'Failed to verify signature. Please try again.' 
                            } 
                        });
                    }
                } else {
                    // EIP-1271 failed for a confirmed contract or long signature
                    const errorMessage = isSmartWallet
                        ? 'Smart wallet signature verification failed. The contract may not implement EIP-1271, or the signature format is incorrect. Please ensure you signed the login message correctly.'
                        : 'Signature verification failed. The signature format suggests a smart wallet, but verification failed. Please try again or contact support if the issue persists.';
                    
                    return res.status(500).json({ 
                        error: { 
                            code: 'VERIFICATION_FAILED', 
                            message: errorMessage
                        } 
                    });
                }
            }
        } else {
            // EOA (Externally Owned Account) - use standard message signature verification
            const expectedLength = 130; // 65 bytes * 2 hex chars per byte
            
            if (signatureHex.length !== expectedLength) {
                logger.error(`[AuthApi] Invalid signature length: expected ${expectedLength} hex chars, got ${signatureHex.length}`, { 
                    address: lowerCaseAddress, 
                    signatureLength: signatureHex.length,
                    signaturePreview: signature.substring(0, 100) + '...'
                });
                return res.status(400).json({ 
                    error: { 
                        code: 'INVALID_SIGNATURE_LENGTH', 
                        message: `Invalid signature format. Expected 65-byte signature (130 hex characters), but received ${signatureHex.length} characters. This may indicate your wallet is signing a transaction instead of a message. Please try using a different wallet or ensure you are signing the login message, not a transaction.` 
                    } 
                });
            }

            try {
                const recoveredAddress = ethers.verifyMessage(nonce, signature);
                isValid = recoveredAddress.toLowerCase() === lowerCaseAddress;
                
                if (!isValid) {
                    logger.error(`[AuthApi] Standard signature verification failed for EOA`, {
                        address: lowerCaseAddress,
                        recoveredAddress: recoveredAddress.toLowerCase()
                    });
                    return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature is invalid.' } });
                }
                
                logger.info(`[AuthApi] Standard signature verified successfully for EOA ${lowerCaseAddress}`);
            } catch (error) {
                logger.error(`[AuthApi] Error during standard signature verification:`, error);
                return res.status(500).json({ 
                    error: { 
                        code: 'VERIFICATION_FAILED', 
                        message: 'Failed to verify signature. Please try again.' 
                    } 
                });
            }
        }

        nonceStore.delete(lowerCaseAddress);

        // Defer user creation/lookup to the internal API
        const response = await internalApiClient.post('/internal/v1/data/auth/find-or-create-by-wallet', {
             address: lowerCaseAddress,
             referralCode 
        });
        const { user } = response.data;

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          logger.error('JWT_SECRET is not defined in environment variables.');
          return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
        }
        
        const token = jwt.sign(
            { userId: user._id, address: lowerCaseAddress },
            jwtSecret,
            { expiresIn: '1h' }
        );

        res.cookie('jwt', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 1000 // 1 hour
        });
        res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
        logger.error('[AuthApi] /web3/verify failed:', {
            message: error.message,
            code: error.code,
            address: req.body?.address,
            signatureLength: req.body?.signature?.length,
            stack: error.stack
        });
        
        if (error.response) {
            logger.error('Response data:', error.response.data);
            return res.status(error.response.status).json(error.response.data);
        }
        
        // Check for specific ethers.js errors
        if (error.code === 'INVALID_ARGUMENT' && error.message?.includes('signature')) {
            return res.status(400).json({ 
                error: { 
                    code: 'INVALID_SIGNATURE_FORMAT', 
                    message: 'Invalid signature format. Please ensure your wallet is signing a message (not a transaction) and try again. If the problem persists, try using a different wallet.' 
                } 
            });
        }
        
        res.status(500).json({ 
            error: { 
                code: 'VERIFICATION_FAILED', 
                message: 'Failed to verify signature. Please try again or contact support if the issue persists.' 
            } 
        });
    }
  });

  /**
   * POST /password
   * Authenticates with username/password and returns a JWT.
   */
  router.post('/password', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Username and password are required.' } });
    }

    try {
      const response = await internalApiClient.post('/internal/v1/data/auth/verify-password', { username, password });
      const { user } = response.data;

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        logger.error('JWT_SECRET is not defined in environment variables.');
        return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
      }
      
      const token = jwt.sign(
          { userId: user._id, username: user.profile.username },
          jwtSecret,
          { expiresIn: '1h' }
      );

      res.cookie('jwt', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000 // 1 hour
      });
      res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
      logger.error('[AuthApi] /password authentication failed:', {
          errorMessage: error.message,
          responseData: error.response?.data,
          responseStatus: error.response?.status
      });

      if (error.response && error.response.status === 401) {
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
      }
      
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  });

  /**
   * POST /apikey
   * Authenticates with an API key and returns a JWT.
   */
  router.post('/apikey', async (req, res) => {
    try {
        const { apikey } = req.body;
        if (!apikey) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'API key is required.' } });
        }

        const response = await internalApiClient.post('/internal/v1/data/auth/validate-key', { apiKey: apikey });

        const { user } = response.data;

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          logger.error('JWT_SECRET is not defined in environment variables.');
          return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
        }
        
        const token = jwt.sign(
            { userId: user.masterAccountId, isApiKeyAuth: true },
            jwtSecret,
            { expiresIn: '1h' }
        );

        res.cookie('jwt', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 1000 // 1 hour
        });
        res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
        logger.error('[AuthApi] /apikey authentication failed:', {
            errorMessage: error.message,
            responseData: error.response?.data,
            responseStatus: error.response?.status
        });
        
        if (error.response) {
            const status = error.response.status;
            if (status === 401 || status === 404 || status === 403) {
              return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive API key.' } });
            }
        }
      
        res.status(500).json({ error: { code: 'API_KEY_AUTH_FAILED', message: 'Failed to authenticate with API key.' } });
    }
  });

  return router;
}

module.exports = { createAuthApi }; 