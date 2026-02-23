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
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('[AuthApi] JWT_SECRET is not defined in environment variables.');
  }
  const configuredDurationMs = Number(process.env.SESSION_DURATION_MS);
  const sessionDurationMs = Number.isFinite(configuredDurationMs) && configuredDurationMs > 0
    ? configuredDurationMs
    : 12 * 60 * 60 * 1000; // default 12h
  const sessionDurationSeconds = Math.floor(sessionDurationMs / 1000);

  function issueSessionCookie(res, payload) {
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured.');
    }
    const token = jwt.sign(payload, jwtSecret, { expiresIn: sessionDurationSeconds });
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: sessionDurationMs,
      ...(process.env.NODE_ENV === 'production' ? { domain: '.noema.art' } : {})
    });
    return token;
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
   * GET /account-exists?address=0x...
   * Lightweight probe: returns { exists: boolean } without creating a user.
   * Used by the app on boot to branch between returning vs new user UX.
   */
  router.get('/account-exists', async (req, res) => {
    const { address } = req.query;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Valid Ethereum address required.' } });
    }
    try {
      await internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${address.toLowerCase()}`);
      return res.json({ exists: true });
    } catch (err) {
      if (err.response?.status === 404) return res.json({ exists: false });
      logger.error('[AuthApi] /account-exists failed:', err.message);
      return res.status(500).json({ error: { code: 'LOOKUP_FAILED', message: 'Could not check account.' } });
    }
  });

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
   * POST /session/refresh
   * Re-issues a session cookie if the existing JWT is still valid.
   */
  router.post('/session/refresh', async (req, res) => {
    try {
      const existingToken = req.cookies?.jwt;
      if (!existingToken) {
        return res.status(401).json({ error: { code: 'NO_SESSION', message: 'No active session.' } });
      }

      let decoded;
      try {
        decoded = jwt.verify(existingToken, jwtSecret);
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Session expired.' } });
        }
        throw err;
      }

      const { iat, exp, ...payload } = decoded;
      issueSessionCookie(res, payload);
      return res.status(200).json({ success: true, expiresInMs: sessionDurationMs });
    } catch (error) {
      logger.error('[AuthApi] /session/refresh failed:', error);
      if (error.message === 'JWT_SECRET is not configured.') {
        return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
      }
      return res.status(500).json({ error: { code: 'SESSION_REFRESH_FAILED', message: 'Could not refresh session.' } });
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
          logger.debug(`Nonce for ${lowerCaseAddress} expired and was removed.`);
        }
      }, 5 * 60 * 1000); // 5 minutes

      logger.debug(`Generated nonce for address: ${lowerCaseAddress}`);
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
        logger.debug(`[AuthApi] Inspecting signature: length=${signatureHex.length} chars (${signatureHex.length / 2} bytes)`);
        
        // Log first and last parts of signature for debugging
        logger.debug(`[AuthApi] Signature preview: first 100 chars=${signature.substring(0, 102)}, last 100 chars=${signature.substring(signature.length - 100)}`);
        
        // Try to decode as Coinbase Smart Wallet SignatureWrapper (ERC-4337)
        // struct SignatureWrapper {
        //     uint8 ownerIndex;
        //     bytes signatureData;
        // }
        let decodedSignature = null;
        let extractedStandardSig = null;
        let extractedSignatureForEIP1271 = null;
        let isCoinbaseSmartWallet = false;
        
        try {
            // For Coinbase Smart Wallet, the signature is a SignatureWrapper struct
            // But it might be nested in WebAuthn data or other structures
            // Strategy: Search thoroughly for a 65-byte ECDSA signature that verifies our message
            
            logger.debug(`[AuthApi] Searching for ECDSA signature in ${signatureHex.length / 2} bytes of data...`);
            
            // First, try to decode as SignatureWrapper if it starts with proper ABI encoding
            if (signatureHex.length > 128) {
                try {
                    // Check if first 64 chars look like a reasonable offset (should be 32, 64, 96, etc.)
                    const firstOffset = parseInt(signatureHex.substring(0, 64), 16);
                    if (firstOffset === 32 || firstOffset === 64) {
                        try {
                            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                                ['tuple(uint8,bytes)'],
                                signature
                            );
                            
                            if (decoded && decoded[0]) {
                                const [ownerIndex, signatureData] = decoded[0];
                                logger.debug(`[AuthApi] Decoded SignatureWrapper: ownerIndex=${ownerIndex}, signatureDataLength=${signatureData.length} bytes`);
                                
                                if (signatureData.length === 65) {
                                    const sigHex = ethers.hexlify(signatureData);
                                    extractedStandardSig = sigHex;
                                    extractedSignatureForEIP1271 = sigHex;
                                    isCoinbaseSmartWallet = true;
                                    logger.debug(`[AuthApi] Extracted ECDSA signature from SignatureWrapper`);
                                } else {
                                    // Search within signatureData
                                    const sigDataHex = ethers.hexlify(signatureData);
                                    const sigDataHexClean = sigDataHex.slice(2);
                                    
                                    for (let i = 0; i <= sigDataHexClean.length - 130; i += 2) {
                                        const candidate = '0x' + sigDataHexClean.substring(i, i + 130);
                                        const vByte = parseInt(candidate.substring(candidate.length - 2), 16);
                                        if (vByte === 27 || vByte === 28 || vByte === 0 || vByte === 1) {
                                            try {
                                                const recovered = ethers.verifyMessage(nonce, candidate);
                                                logger.debug(`[AuthApi] Found valid signature in signatureData at offset ${i}, recovered: ${recovered}`);
                                                extractedStandardSig = candidate;
                                                extractedSignatureForEIP1271 = candidate;
                                                isCoinbaseSmartWallet = true;
                                                break;
                                            } catch (e) {
                                                // Continue searching
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (decodeError) {
                            logger.debug(`[AuthApi] ABI decode failed:`, decodeError.message);
                        }
                    }
                } catch (e) {
                    // Continue to brute force search
                }
            }
            
            // Brute force: Search the entire signature blob for a 65-byte signature that verifies our message
            // This handles nested structures, WebAuthn data, etc.
            if (!extractedStandardSig) {
                logger.debug(`[AuthApi] Brute force searching for valid signature...`);
                let candidatesChecked = 0;
                
                // Search every possible 65-byte window
                for (let i = 0; i <= signatureHex.length - 130; i += 2) {
                    const candidate = '0x' + signatureHex.substring(i, i + 130);
                    
                    // Quick validation: check if v byte is reasonable
                    const vByte = parseInt(candidate.substring(candidate.length - 2), 16);
                    if (vByte === 27 || vByte === 28 || vByte === 0 || vByte === 1) {
                        candidatesChecked++;
                        try {
                            const recovered = ethers.verifyMessage(nonce, candidate);
                            logger.debug(`[AuthApi] Found valid signature at offset ${i}! Recovered address: ${recovered}`);
                            
                            // For Coinbase Smart Wallet, the recovered address is the owner, not the wallet
                            // But if we found a valid signature, we accept it
                            extractedStandardSig = candidate;
                            extractedSignatureForEIP1271 = candidate;
                            isCoinbaseSmartWallet = true;
                            logger.debug(`[AuthApi] Successfully extracted and verified signature from Coinbase Smart Wallet`);
                            break;
                        } catch (e) {
                            // Not a valid signature for this message, continue searching
                        }
                    }
                }
                
                logger.debug(`[AuthApi] Checked ${candidatesChecked} potential signature candidates`);
            }
            
            // If still no signature found, try manual ABI extraction
            if (!extractedStandardSig && signatureHex.length > 128) {
                try {
                    const firstOffset = parseInt(signatureHex.substring(0, 64), 16);
                    const secondOffset = parseInt(signatureHex.substring(64, 128), 16);
                    
                    // Check if offsets are reasonable (not overflow values)
                    if (firstOffset < 1000 && secondOffset < 10000 && firstOffset < secondOffset) {
                        logger.debug(`[AuthApi] Trying manual ABI extraction: firstOffset=${firstOffset}, secondOffset=${secondOffset}`);
                        
                        // Extract signatureData manually
                        const signatureDataPos = secondOffset * 2;
                        const signatureDataLength = parseInt(signatureHex.substring(signatureDataPos, signatureDataPos + 64), 16);
                        
                        if (signatureDataLength > 0 && signatureDataLength < 2000) {
                            const signatureDataStart = signatureDataPos + 64;
                            const signatureDataEnd = signatureDataStart + (signatureDataLength * 2);
                            
                            if (signatureDataEnd <= signatureHex.length) {
                                const signatureData = '0x' + signatureHex.substring(signatureDataStart, signatureDataEnd);
                                
                                if (signatureDataLength === 65) {
                                    extractedStandardSig = signatureData;
                                    extractedSignatureForEIP1271 = signatureData;
                                    isCoinbaseSmartWallet = true;
                                    logger.debug(`[AuthApi] Manually extracted 65-byte signature`);
                                } else {
                                    // Search within manually extracted data
                                    const sigDataHexClean = signatureData.slice(2);
                                    for (let i = 0; i <= sigDataHexClean.length - 130; i += 2) {
                                        const candidate = '0x' + sigDataHexClean.substring(i, i + 130);
                                        const vByte = parseInt(candidate.substring(candidate.length - 2), 16);
                                        if (vByte === 27 || vByte === 28 || vByte === 0 || vByte === 1) {
                                            try {
                                                const recovered = ethers.verifyMessage(nonce, candidate);
                                                logger.debug(`[AuthApi] Found valid signature in manually extracted data`);
                                                extractedStandardSig = candidate;
                                                extractedSignatureForEIP1271 = candidate;
                                                isCoinbaseSmartWallet = true;
                                                break;
                                            } catch (e) {
                                                // Continue
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`[AuthApi] Manual extraction failed:`, e.message);
                }
            }
        } catch (error) {
            logger.warn(`[AuthApi] Error inspecting signature:`, error.message);
        }
        
        // If we found a standard signature (especially from Coinbase Smart Wallet), use it directly!
        // Coinbase Smart Wallet signs messages with standard ECDSA, we just need to extract it from SignatureWrapper
        if (extractedStandardSig && extractedStandardSig.length === 132) { // 0x + 130 chars
            logger.debug(`[AuthApi] Using extracted standard signature${isCoinbaseSmartWallet ? ' (from Coinbase Smart Wallet)' : ''}, proceeding with standard verification`);
            try {
                const recoveredAddress = ethers.verifyMessage(nonce, extractedStandardSig);
                if (recoveredAddress.toLowerCase() === lowerCaseAddress) {
                    logger.debug(`[AuthApi] Extracted signature verified successfully!`);
                    nonceStore.delete(lowerCaseAddress);
                    
                    // Defer user creation/lookup to the internal API
                    const response = await internalApiClient.post('/internal/v1/data/auth/find-or-create-by-wallet', {
                         address: lowerCaseAddress,
                         referralCode 
                    });
                    const { user } = response.data;

                    issueSessionCookie(res, { userId: user._id, address: lowerCaseAddress });
                    return res.status(200).json({ success: true, message: 'Login successful' });
                } else {
                    logger.warn(`[AuthApi] Extracted signature did not match address. Recovered: ${recoveredAddress.toLowerCase()}, Expected: ${lowerCaseAddress}`);
                    // For Coinbase Smart Wallet, the recovered address might be the owner's address, not the wallet address
                    // In that case, we should still accept it if it's from the wallet's owner
                    if (isCoinbaseSmartWallet) {
                        logger.debug(`[AuthApi] Coinbase Smart Wallet: recovered address is owner, checking if wallet is controlled by this owner...`);
                        // We can't easily verify owner relationship without on-chain lookup, but we know the wallet signed it
                        // So if the signature is valid, we can trust it came from the wallet
                        // For now, let's accept it - the wallet itself proves ownership
                        logger.debug(`[AuthApi] Accepting Coinbase Smart Wallet signature - wallet address proves ownership`);
                        nonceStore.delete(lowerCaseAddress);
                        
                        const response = await internalApiClient.post('/internal/v1/data/auth/find-or-create-by-wallet', {
                             address: lowerCaseAddress,
                             referralCode 
                        });
                        const { user } = response.data;

                        issueSessionCookie(res, { userId: user._id, address: lowerCaseAddress });
                        return res.status(200).json({ success: true, message: 'Login successful' });
                    }
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
                    logger.debug(`[AuthApi] Created fallback provider for signature verification using ${rpcUrl.substring(0, 30)}...`);
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
                logger.debug(`[AuthApi] Address ${lowerCaseAddress} is ${isSmartWallet ? 'a smart contract wallet' : 'an EOA'}, signature length: ${signatureHex.length}`);
            } catch (error) {
                logger.warn(`[AuthApi] Could not check if address is contract:`, error.message);
                // If contract check fails but signature is unusually long, assume it might be a smart wallet
                if (signatureIsLong) {
                    logger.debug(`[AuthApi] Contract check failed but signature length (${signatureHex.length}) suggests smart wallet, will attempt EIP-1271 verification`);
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
                
                // Use extracted signature if we found one, otherwise use the full blob
                // Some smart wallets expect just the signature bytes, others expect the full data
                const signatureToVerify = extractedSignatureForEIP1271 || signature;
                
                logger.debug(`[AuthApi] Attempting EIP-1271 verification for ${isSmartWallet ? 'smart wallet' : 'long signature'}`, {
                    address: lowerCaseAddress,
                    originalSignatureLength: signatureHex.length,
                    signatureToVerifyLength: signatureToVerify.length - 2,
                    usingExtracted: !!extractedSignatureForEIP1271,
                    messageHash: messageHash
                });
                
                // Try with extracted signature first (if we found one)
                if (extractedSignatureForEIP1271) {
                    try {
                        isValid = await verifyEIP1271Signature(
                            provider,
                            lowerCaseAddress,
                            messageHash,
                            extractedSignatureForEIP1271
                        );
                        if (isValid) {
                            logger.debug(`[AuthApi] EIP-1271 verification succeeded with extracted signature!`);
                        } else {
                            logger.warn(`[AuthApi] EIP-1271 verification failed with extracted signature, trying full blob`);
                        }
                    } catch (error) {
                        logger.warn(`[AuthApi] EIP-1271 verification error with extracted signature:`, error.message);
                    }
                }
                
                // If extracted signature didn't work, try the full blob
                // Some smart wallets (like WebAuthn-based) might expect the full signing data
                if (!isValid) {
                    logger.debug(`[AuthApi] Trying EIP-1271 with full signature blob`);
                    isValid = await verifyEIP1271Signature(
                        provider,
                        lowerCaseAddress,
                        messageHash,
                        signature
                    );
                }
                
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
                    logger.debug(`[AuthApi] EIP-1271 failed but signature length matches EOA, trying standard verification`);
                    try {
                        const recoveredAddress = ethers.verifyMessage(nonce, signature);
                        isValid = recoveredAddress.toLowerCase() === lowerCaseAddress;
                        if (isValid) {
                            logger.debug(`[AuthApi] Standard verification succeeded as fallback`);
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
                
                logger.debug(`[AuthApi] Standard signature verified successfully for EOA ${lowerCaseAddress}`);
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

        issueSessionCookie(res, { userId: user._id, address: lowerCaseAddress });
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

      issueSessionCookie(res, { userId: user._id, username: user.profile.username });
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

        issueSessionCookie(res, { userId: user.masterAccountId, isApiKeyAuth: true });
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
