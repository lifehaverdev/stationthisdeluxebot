/**
 * Spell Payment Service
 * 
 * Handles on-chain payment transactions for public spell execution.
 * Generates transaction parameters, tracks payments, and monitors for confirmation.
 */

const { ethers } = require('ethers');
const { v4: uuidv4 } = require('uuid');

class SpellPaymentService {
  constructor({ logger, ethereumService, creditService, guestAccountService, guestAuthService, foundationConfig }) {
    this.logger = logger;
    this.ethereumService = ethereumService;
    this.creditService = creditService;
    this.guestAccountService = guestAccountService;
    this.guestAuthService = guestAuthService;
    this.foundationAddress = foundationConfig.address;
    this.foundationAbi = foundationConfig.abi;
    this.USD_TO_POINTS_CONVERSION_RATE = 0.000337;
    
    // In-memory cache for spellPaymentId -> txHash mapping
    // Could also use Redis or a temporary DB collection for production
    this.paymentTracking = new Map(); // spellPaymentId -> { txHash, walletAddress, spellId, amountPts, amountUsd, token }
  }

  /**
   * Calculate USD amount from points
   * @param {number} points
   * @returns {number} USD amount
   */
  pointsToUsd(points) {
    return points * this.USD_TO_POINTS_CONVERSION_RATE;
  }

  /**
   * Generate payment transaction parameters
   * @param {Object} params
   * @param {number} params.amountPts - Amount in points
   * @param {string} params.spellId - Spell ID
   * @param {string} params.slug - Spell slug
   * @param {string} params.walletAddress - User's wallet address
   * @param {string} params.preferredToken - Token to use ('ETH' or token address)
   * @returns {Promise<Object>} Transaction parameters
   */
  async generatePaymentTransaction({ amountPts, spellId, slug, walletAddress, preferredToken = 'ETH' }) {
    try {
      const amountUsd = this.pointsToUsd(amountPts);
      const spellPaymentId = uuidv4();

      // Get token price and calculate amount needed
      const priceFeedService = this.creditService.priceFeedService;
      
      let tokenPrice;
      let tokenAmount;
      let tokenAddress;

      if (preferredToken === 'ETH' || preferredToken === ethers.ZeroAddress) {
        // Native ETH payment
        tokenAddress = ethers.ZeroAddress;
        try {
          tokenPrice = await priceFeedService.getPriceInUsd(ethers.ZeroAddress);
          if (!tokenPrice || tokenPrice <= 0) {
            throw new Error('Invalid ETH price from price feed');
          }
        } catch (error) {
          this.logger.error(`[SpellPaymentService] Failed to get ETH price:`, error);
          throw new Error('Failed to fetch ETH price. Please try again.');
        }
        
        tokenAmount = amountUsd / tokenPrice;
        
        if (!isFinite(tokenAmount) || tokenAmount <= 0) {
          throw new Error(`Invalid token amount calculated: ${tokenAmount}`);
        }
        
        // Generate transaction parameters for ETH
        const txParams = {
          to: this.foundationAddress,
          value: ethers.parseEther(tokenAmount.toFixed(18)),
          data: '0x'
        };

        // Estimate gas
        const provider = this.ethereumService.getProvider();
        let gasEstimate;
        try {
          gasEstimate = await provider.estimateGas({
            ...txParams,
            from: walletAddress
          });
          
          if (!gasEstimate || gasEstimate.toString() === '0') {
            throw new Error('Gas estimation returned zero');
          }
        } catch (error) {
          this.logger.error(`[SpellPaymentService] Gas estimation failed for ETH:`, error);
          if (error.code === 'UNPREDICTABLE_GAS_LIMIT' || error.message.includes('insufficient funds')) {
            throw new Error('Insufficient funds for transaction. Please check your wallet balance.');
          } else if (error.message.includes('network') || error.code === 'NETWORK_ERROR') {
            throw new Error('Network error during gas estimation. Please try again.');
          }
          throw new Error('Failed to estimate gas. Please try again.');
        }

        // Store payment tracking info
        this.paymentTracking.set(spellPaymentId, {
          walletAddress,
          spellId,
          amountPts,
          amountUsd,
          token: 'ETH',
          tokenAddress
        });

        return {
          to: txParams.to,
          value: txParams.value.toString(), // Convert BigInt to string for JSON serialization
          data: txParams.data,
          gasEstimate: gasEstimate.toString(),
          spellPaymentId,
          amountUsd,
          amountPts,
          token: 'ETH',
          tokenAddress
        };
      } else {
        // ERC20 token payment
        tokenAddress = preferredToken;
        try {
          tokenPrice = await priceFeedService.getPriceInUsd(tokenAddress);
          if (!tokenPrice || tokenPrice <= 0) {
            throw new Error(`Invalid price for token ${tokenAddress}`);
          }
        } catch (error) {
          this.logger.error(`[SpellPaymentService] Failed to get token price for ${tokenAddress}:`, error);
          throw new Error(`Failed to fetch price for token ${tokenAddress}. Please try again or use ETH.`);
        }
        
        tokenAmount = amountUsd / tokenPrice;
        
        if (!isFinite(tokenAmount) || tokenAmount <= 0) {
          throw new Error(`Invalid token amount calculated: ${tokenAmount}`);
        }

        // ERC20 transfer function signature
        const erc20Abi = ['function transfer(address to, uint256 amount)'];
        const iface = new ethers.Interface(erc20Abi);
        
        // Get token decimals (default to 18)
        let decimals = 18;
        try {
          const tokenAbi = ['function decimals() view returns (uint8)'];
          const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, this.ethereumService.getProvider());
          decimals = await tokenContract.decimals();
        } catch (err) {
          this.logger.warn(`[SpellPaymentService] Could not fetch decimals for ${tokenAddress}, using 18`);
        }

        const txParams = {
          to: tokenAddress,
          value: '0x0',
          data: iface.encodeFunctionData('transfer', [
            this.foundationAddress,
            ethers.parseUnits(tokenAmount.toFixed(decimals), decimals)
          ])
        };

        // Estimate gas
        const provider = this.ethereumService.getProvider();
        let gasEstimate;
        try {
          gasEstimate = await provider.estimateGas({
            ...txParams,
            from: walletAddress
          });
          
          if (!gasEstimate || gasEstimate.toString() === '0') {
            throw new Error('Gas estimation returned zero');
          }
        } catch (error) {
          this.logger.error(`[SpellPaymentService] Gas estimation failed for ERC20:`, error);
          if (error.code === 'UNPREDICTABLE_GAS_LIMIT' || error.message.includes('insufficient funds')) {
            throw new Error('Insufficient funds for transaction. Please check your wallet balance.');
          } else if (error.message.includes('network') || error.code === 'NETWORK_ERROR') {
            throw new Error('Network error during gas estimation. Please try again.');
          }
          throw new Error('Failed to estimate gas. Please try again.');
        }

        // Store payment tracking info
        this.paymentTracking.set(spellPaymentId, {
          walletAddress,
          spellId,
          amountPts,
          amountUsd,
          token: tokenAddress,
          tokenAddress
        });

        return {
          to: txParams.to,
          value: txParams.value, // Already '0x0' string for ERC20
          data: txParams.data, // Already hex string from encodeFunctionData
          gasEstimate: gasEstimate.toString(),
          spellPaymentId,
          amountUsd,
          amountPts,
          token: tokenAddress,
          tokenAddress
        };
      }
    } catch (error) {
      this.logger.error(`[SpellPaymentService] Error generating payment transaction:`, error);
      throw error;
    }
  }
  
  /**
   * Update payment tracking when transaction is sent
   * @param {string} spellPaymentId
   * @param {string} txHash
   */
  async trackTransactionSent(spellPaymentId, txHash) {
    const tracking = this.paymentTracking.get(spellPaymentId);
    if (tracking) {
      tracking.txHash = txHash;
      this.paymentTracking.set(spellPaymentId, tracking);
      this.logger.info(`[SpellPaymentService] Tracked transaction ${txHash} for payment ${spellPaymentId}`);
    } else {
      this.logger.warn(`[SpellPaymentService] No tracking found for spellPaymentId ${spellPaymentId}`);
    }
  }
  
  /**
   * Get payment tracking info by spellPaymentId
   * @param {string} spellPaymentId
   * @returns {Object|null}
   */
  getPaymentTracking(spellPaymentId) {
    return this.paymentTracking.get(spellPaymentId);
  }
  
  /**
   * Get payment tracking info by transaction hash
   * @param {string} txHash
   * @returns {Object|null}
   */
  getPaymentTrackingByTxHash(txHash) {
    for (const [spellPaymentId, tracking] of this.paymentTracking.entries()) {
      if (tracking.txHash === txHash) {
        return { spellPaymentId, ...tracking };
      }
    }
    return null;
  }

  /**
   * Monitor for payment confirmation
   * This hooks into CreditService's event processing
   * @param {string} spellPaymentId
   * @returns {Promise<Object>} Payment status
   */
  async checkPaymentStatus(spellPaymentId) {
    try {
      const user = await this.guestAccountService.findBySpellPaymentId(spellPaymentId);
      
      if (!user) {
        return { status: 'not_found' };
      }

      if (user.isGuest && user.guestMetadata?.txHash) {
        // Payment confirmed, get guest token
        const guestToken = await this.guestAuthService.createGuestToken(user);
        
        // Get points balance from credit ledger
        const activeDeposits = await this.creditService.creditLedgerDb.findActiveDepositsForUser(user._id.toString());
        const pointsBalance = activeDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);
        
        return {
          status: 'confirmed',
          txHash: user.guestMetadata.txHash,
          guestToken,
          pointsCredited: pointsBalance
        };
      }

      if (user.guestMetadata?.txHash) {
        // Transaction sent but not yet confirmed
        return {
          status: 'pending',
          txHash: user.guestMetadata.txHash
        };
      }

      return {
        status: 'pending_payment',
        message: 'Waiting for transaction'
      };
    } catch (error) {
      this.logger.error(`[SpellPaymentService] Error checking payment status:`, error);
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Handle ContributionRecorded event for spell payment
   * Called by CreditService when processing events
   * @param {Object} event - Event object (may be null)
   * @param {Object} decodedLog - Decoded log data
   * @param {string} spellPaymentId - Spell payment ID
   * @returns {Promise<Object|null>} Result object or null
   */
  async handleSpellPaymentEvent(event, decodedLog, spellPaymentId) {
    try {
      const { user: walletAddress, amount, transactionHash } = decodedLog.args || decodedLog;
      
      // First, try to find guest account by transaction hash
      let user = await this.guestAccountService.findByTxHash(transactionHash);
      
      // If not found by txHash, try to find by spellPaymentId if provided
      if (!user && spellPaymentId) {
        user = await this.guestAccountService.findBySpellPaymentId(spellPaymentId);
      }
      
      if (!user || !user.isGuest) {
        // Not a spell payment, or user account doesn't exist yet
        // Create guest account now if we have spellPaymentId
        if (spellPaymentId) {
          const tracking = this.getPaymentTracking(spellPaymentId);
          if (tracking && tracking.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
            const guestAccount = await this.guestAccountService.createOrFindGuestAccount({
              walletAddress,
              spellPaymentId,
              spellId: tracking.spellId || null,
              txHash: transactionHash
            });
            
            this.logger.info(`[SpellPaymentService] Created guest account ${guestAccount.masterAccountId} for spell payment ${spellPaymentId}`);
            
            return {
              masterAccountId: guestAccount.masterAccountId,
              spellPaymentId
            };
          }
        }
        // If no tracking found, this might not be a spell payment
        return null;
      }

      // User account already exists and is flagged as guest
      // Points will be credited automatically by CreditService
      // Update metadata if txHash wasn't set yet
      if (!user.guestMetadata?.txHash) {
        await this.guestAccountService.updateGuestMetadata(user.guestMetadata?.spellPaymentId, {
          txHash: transactionHash
        });
      }
      
      return {
        masterAccountId: user._id.toString(),
        spellPaymentId: user.guestMetadata?.spellPaymentId
      };
    } catch (error) {
      this.logger.error(`[SpellPaymentService] Error handling spell payment event:`, error);
      return null;
    }
  }
}

module.exports = SpellPaymentService;

