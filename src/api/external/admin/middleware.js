const { createLogger } = require('../../../utils/logger');
const { MILADY_STATION_NFT_ADDRESS, ADMIN_TOKEN_ID } = require('../../../core/services/alchemy/foundationConfig');
const { ethers } = require('ethers');

const logger = createLogger('AdminMiddleware');

const ERC721A_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)'
];

// Cache for NFT ownership verification (wallet -> { owner, expiresAt })
const adminOwnershipCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedOwner(walletAddress) {
  const normalized = walletAddress.toLowerCase();
  const cached = adminOwnershipCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.owner;
  }
  // Clean up expired entry
  if (cached) {
    adminOwnershipCache.delete(normalized);
  }
  return null;
}

function setCachedOwner(walletAddress, owner) {
  const normalized = walletAddress.toLowerCase();
  adminOwnershipCache.set(normalized, {
    owner: owner.toLowerCase(),
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

/**
 * Middleware to verify that the requesting wallet owns miladystation NFT #598.
 * Expects wallet address in req.query.wallet or req.body.wallet
 * @param {Object} dependencies - Service dependencies
 * @returns {Function} Express middleware
 */
function createAdminVerificationMiddleware(dependencies) {
  const { 
    ethereumServices = {}, 
    ethereumService: legacyEth,
    creditServices = {},
    creditService: legacyCredit
  } = dependencies;
  
  logger.info(`[AdminMiddleware] Initializing with dependencies:`, {
    hasEthereumServices: !!ethereumServices,
    ethereumServicesKeys: Object.keys(ethereumServices || {}),
    hasLegacyEth: !!legacyEth,
    legacyEthType: typeof legacyEth,
    hasCreditServices: !!creditServices,
    creditServicesKeys: Object.keys(creditServices || {})
  });
  
  const getEthereumService = (chainId = '1') => {
    // Try direct ethereumServices first
    let service = ethereumServices[String(chainId)] || ethereumServices[Number(chainId)] || legacyEth;
    
    // Fallback: get from creditService if available
    if (!service || typeof service.read !== 'function') {
      const creditService = creditServices[String(chainId)] || creditServices[Number(chainId)] || legacyCredit;
      if (creditService && creditService.ethereumService) {
        service = creditService.ethereumService;
        logger.debug(`[AdminMiddleware] Got ethereumService from creditService for chainId ${chainId}`);
      }
    }
    
    logger.debug(`[AdminMiddleware] Getting ethereumService for chainId ${chainId}:`, {
      found: !!service,
      hasReadMethod: service && typeof service.read === 'function',
      fromServices: !!ethereumServices[String(chainId)],
      fromLegacy: !!legacyEth && !ethereumServices[String(chainId)],
      fromCreditService: service && service === (creditServices[String(chainId)] || legacyCredit)?.ethereumService
    });
    return service;
  };

  return async (req, res, next) => {
    const walletAddress = req.query.wallet || req.body.wallet || req.headers['x-wallet-address'];
    
    logger.info(`[AdminMiddleware] Verifying admin for wallet: ${walletAddress}, path: ${req.path}, query:`, req.query);
    
    if (!walletAddress) {
      logger.warn(`[AdminMiddleware] No wallet address provided in request. Query:`, req.query, 'Body:', req.body, 'Headers:', req.headers);
      return res.status(401).json({ 
        error: { 
          code: 'UNAUTHORIZED', 
          message: 'Wallet address required for admin verification.' 
        } 
      });
    }

    try {
      const chainId = req.query.chainId || req.body.chainId || '1';
      const ethereumService = getEthereumService(chainId);
      
      if (!ethereumService) {
        logger.error(`[AdminMiddleware] No ethereumService available for chainId ${chainId}. Available services:`, Object.keys(ethereumServices || {}));
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Ethereum service not available for this chain.' 
          } 
        });
      }

      // Verify ethereumService has the read method
      if (typeof ethereumService.read !== 'function') {
        logger.error(`[AdminMiddleware] ethereumService.read is not a function. Service type:`, typeof ethereumService, 'Service keys:', Object.keys(ethereumService || {}));
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Ethereum service is not properly configured.' 
          } 
        });
      }

      // Check cache first to avoid repeated RPC calls
      let owner = getCachedOwner(walletAddress);

      if (!owner) {
        // Check on-chain if the wallet owns NFT #598
        owner = await ethereumService.read(
          MILADY_STATION_NFT_ADDRESS,
          ERC721A_ABI,
          'ownerOf',
          ADMIN_TOKEN_ID
        );
        // Cache the result
        setCachedOwner(walletAddress, owner);
        logger.debug(`[AdminMiddleware] Cached NFT owner: ${owner}`);
      } else {
        logger.debug(`[AdminMiddleware] Using cached NFT owner for ${walletAddress}`);
      }

      if (owner.toLowerCase() !== walletAddress.toLowerCase()) {
        logger.warn(`[AdminMiddleware] Wallet ${walletAddress} is not the admin (owner is ${owner})`);
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Wallet does not own the admin NFT.'
          }
        });
      }

      // Attach admin info to request
      req.adminWallet = walletAddress;
      req.chainId = chainId;
      next();
    } catch (error) {
      logger.error(`[AdminMiddleware] Error verifying admin status:`, error);
      return res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to verify admin status.' 
        } 
      });
    }
  };
}

module.exports = { createAdminVerificationMiddleware };

