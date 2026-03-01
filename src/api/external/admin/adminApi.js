const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { createAdminVerificationMiddleware } = require('./middleware');
const { getCustodyKey, splitCustodyAmount } = require('../../../core/services/alchemy/contractUtils');
const { contracts: contractRegistry } = require('../../../core/contracts');
const { USD_PER_POINT } = require('../../../core/constants/economy');
const { createWalletRateLimitMiddleware } = require('../../../utils/rateLimiter');

const logger = createLogger('AdminVaultApi');
const NATIVE_ETH = '0x0000000000000000000000000000000000000000';

function createAdminApi(dependencies) {
  const { 
    internalApiClient, 
    priceFeedService,
    creditServices = {}, 
    ethereumServices = {}, 
    creditService: legacyCredit, 
    ethereumService: legacyEth
  } = dependencies;

  const getChainServices = (chainId = '1') => ({
    creditService: creditServices[String(chainId)] || legacyCredit,
    ethereumService: ethereumServices[String(chainId)] || legacyEth,
  });

  if (!internalApiClient) {
    logger.error('[AdminApi] Missing required dependencies (internalApiClient)');
    return null;
  }

  const router = express.Router();
  const adminMiddleware = createAdminVerificationMiddleware(dependencies);

  // Rate limiting for admin endpoints: 60 requests per minute per wallet
  // Admin endpoints are already protected by NFT ownership, but we add rate limiting
  // to prevent abuse even from legitimate admins
  // Note: Dashboard makes 12+ calls on initial load, so we need a higher limit
  const adminRateLimiter = createWalletRateLimitMiddleware({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    message: 'Too many admin requests. Please try again later.'
  }, logger);

  // Apply rate limiting to all admin routes
  router.use(adminRateLimiter);

  /**
   * GET /accounts - Get all user accounts with their deposit details and balances
   */
  router.get('/accounts', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    
    logger.debug(`[AdminApi] GET /accounts for chainId=${chainId}, requestId=${requestId}`);

    try {
      const { creditService, ethereumService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit service not available',
            requestId 
          } 
        });
      }

      const creditLedgerDb = creditService.creditLedgerDb;
      const contractConfig = creditService.contractConfig;

      // Get all confirmed deposits
      const allDeposits = await creditLedgerDb.findMany({
        status: 'CONFIRMED',
        token_address: { $exists: true, $ne: null },
        depositor_address: { $exists: true, $ne: null },
        points_credited: { $exists: true, $gt: 0 }
      });

      logger.debug(`[AdminApi] Found ${allDeposits.length} confirmed deposits with points`);

      // Group deposits by (depositor_address, token_address) to get account summaries
      const accountMap = new Map();
      
      for (const deposit of allDeposits) {
        const key = `${deposit.depositor_address.toLowerCase()}_${deposit.token_address.toLowerCase()}`;
        
        if (!accountMap.has(key)) {
          accountMap.set(key, {
            depositorAddress: deposit.depositor_address,
            tokenAddress: deposit.token_address,
            masterAccountId: deposit.master_account_id?.toString() || null,
            deposits: [],
            totalDeposited: 0n,
            totalPointsCredited: 0n,
            totalPointsRemaining: 0n
          });
        }
        // Update masterAccountId if we find one (some deposits may have it, others may not)
        if (deposit.master_account_id && !accountMap.get(key).masterAccountId) {
          accountMap.get(key).masterAccountId = deposit.master_account_id.toString();
        }
        
        const account = accountMap.get(key);
        const depositAmount = BigInt(deposit.deposit_amount_wei || '0');
        const pointsCredited = BigInt(deposit.points_credited || '0');
        const pointsRemaining = BigInt(deposit.points_remaining || '0');
        
        account.deposits.push({
          depositId: deposit._id.toString(),
          depositTxHash: deposit.deposit_tx_hash,
          depositAmount: depositAmount.toString(),
          pointsCredited: pointsCredited.toString(),
          pointsRemaining: pointsRemaining.toString(),
          createdAt: deposit.createdAt
        });
        
        account.totalDeposited += depositAmount;
        account.totalPointsCredited += pointsCredited;
        account.totalPointsRemaining += pointsRemaining;
      }

      // Get token metadata and on-chain balances for each account
      const accounts = await Promise.all(
        Array.from(accountMap.values()).map(async (account) => {
          // Get token metadata
          let symbol = 'N/A', decimals = 18, name = '';
          if (account.tokenAddress.toLowerCase() === NATIVE_ETH.toLowerCase()) {
            symbol = 'ETH';
            decimals = 18;
            name = 'Ethereum';
          } else if (priceFeedService) {
            try {
              const meta = await priceFeedService.getMetadata(account.tokenAddress);
              symbol = meta.symbol || 'N/A';
              decimals = meta.decimals || 18;
              name = meta.name || '';
            } catch (e) {
              // Ignore metadata errors
            }
          }

          // Calculate real user owned
          let realUserOwned = 0n;
          for (const deposit of account.deposits) {
            const depositAmount = BigInt(deposit.depositAmount);
            const pointsCredited = BigInt(deposit.pointsCredited);
            const pointsRemaining = BigInt(deposit.pointsRemaining);
            
            if (pointsCredited > 0n) {
              const userShare = (pointsRemaining * depositAmount) / pointsCredited;
              realUserOwned += userShare;
            }
          }

          // Get on-chain escrow balance
          let onChainEscrow = 0n;
          let onChainUserOwned = 0n;
          try {
            const custodyKey = getCustodyKey(account.depositorAddress, account.tokenAddress);
            const packedAmount = await ethereumService.read(
              contractConfig.address,
              contractConfig.abi,
              'custody',
              custodyKey
            );
            const split = splitCustodyAmount(packedAmount);
            onChainEscrow = split.escrow;
            onChainUserOwned = split.userOwned;
          } catch (error) {
            // If custody key doesn't exist, balances are 0
          }

          // Calculate protocol owned (not seized)
          // Protocol owns the difference between what was deposited and what the user actually owns
          // This is based on points spent: (points_credited - points_remaining) / points_credited * deposit_amount
          const totalDepositedBigInt = BigInt(account.totalDeposited.toString());
          const realUserOwnedBigInt = BigInt(realUserOwned.toString());
          
          logger.info(`[AdminApi] Account ${account.depositorAddress.slice(0, 10)}... ${symbol}: totalDeposited=${totalDepositedBigInt.toString()}, realUserOwned=${realUserOwnedBigInt.toString()}, comparison=${totalDepositedBigInt > realUserOwnedBigInt}`);
          
          const protocolOwnedNotSeized = totalDepositedBigInt > realUserOwnedBigInt 
            ? totalDepositedBigInt - realUserOwnedBigInt 
            : 0n;
          
          logger.info(`[AdminApi] Account ${account.depositorAddress.slice(0, 10)}... ${symbol}: protocolOwned=${protocolOwnedNotSeized.toString()}`);

          return {
            depositorAddress: account.depositorAddress,
            tokenAddress: account.tokenAddress,
            masterAccountId: account.masterAccountId,
            symbol,
            decimals,
            name,
            totalDeposited: account.totalDeposited.toString(),
            totalPointsCredited: account.totalPointsCredited.toString(),
            totalPointsRemaining: account.totalPointsRemaining.toString(),
            realUserOwned: realUserOwned.toString(),
            onChainEscrow: onChainEscrow.toString(),
            onChainUserOwned: onChainUserOwned.toString(),
            protocolOwnedNotSeized: protocolOwnedNotSeized.toString(),
            depositCount: account.deposits.length,
            deposits: account.deposits
          };
        })
      );

      // Sort by total deposited (descending)
      accounts.sort((a, b) => {
        const aTotal = BigInt(a.totalDeposited);
        const bTotal = BigInt(b.totalDeposited);
        return aTotal > bTotal ? -1 : aTotal < bTotal ? 1 : 0;
      });

      res.json({
        accounts,
        chainId,
        requestId,
        totalAccounts: accounts.length
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting accounts:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to fetch accounts',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /free-points - Get all free points (reward credit entries) in circulation
   */
  router.get('/free-points', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    
    logger.info(`[AdminApi] GET /free-points for chainId=${chainId}, requestId=${requestId}`);

    try {
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit service not available',
            requestId 
          } 
        });
      }

      const creditLedgerDb = creditService.creditLedgerDb;

      // Get all reward credit entries (free points)
      // These have a 'type' field but no deposit_tx_hash or depositor_address
      const freePointsEntries = await creditLedgerDb.findMany({
        status: 'CONFIRMED',
        type: { $exists: true, $ne: null },
        deposit_tx_hash: { $exists: false }, // Reward entries don't have deposit tx hashes
        points_credited: { $exists: true, $gt: 0 }
      });

      logger.info(`[AdminApi] Found ${freePointsEntries.length} free points entries`);

      // Group by reward type
      const byRewardType = new Map();
      let totalPointsCredited = 0n;
      let totalPointsRemaining = 0n;
      let totalPointsSpent = 0n;

      for (const entry of freePointsEntries) {
        const rewardType = entry.type || 'UNKNOWN';
        const pointsCredited = BigInt(entry.points_credited || '0');
        const pointsRemaining = BigInt(entry.points_remaining || '0');
        const pointsSpent = pointsCredited - pointsRemaining;

        totalPointsCredited += pointsCredited;
        totalPointsRemaining += pointsRemaining;
        totalPointsSpent += pointsSpent;

        if (!byRewardType.has(rewardType)) {
          byRewardType.set(rewardType, {
            rewardType,
            entries: [],
            totalPointsCredited: 0n,
            totalPointsRemaining: 0n,
            totalPointsSpent: 0n,
            userCount: new Set()
          });
        }

        const typeData = byRewardType.get(rewardType);
        typeData.entries.push({
          entryId: entry._id.toString(),
          masterAccountId: entry.master_account_id?.toString(),
          pointsCredited: pointsCredited.toString(),
          pointsRemaining: pointsRemaining.toString(),
          pointsSpent: pointsSpent.toString(),
          description: entry.description || '',
          createdAt: entry.createdAt,
          relatedItems: entry.related_items || {}
        });
        typeData.totalPointsCredited += pointsCredited;
        typeData.totalPointsRemaining += pointsRemaining;
        typeData.totalPointsSpent += pointsSpent;
        if (entry.master_account_id) {
          typeData.userCount.add(entry.master_account_id.toString());
        }
      }

      // Convert to array format with USD values
      const rewardTypes = Array.from(byRewardType.values()).map(typeData => {
        const pointsCreditedNum = Number(typeData.totalPointsCredited);
        const pointsRemainingNum = Number(typeData.totalPointsRemaining);
        const pointsSpentNum = Number(typeData.totalPointsSpent);
        
        return {
          rewardType: typeData.rewardType,
          totalPointsCredited: typeData.totalPointsCredited.toString(),
          totalPointsRemaining: typeData.totalPointsRemaining.toString(),
          totalPointsSpent: typeData.totalPointsSpent.toString(),
          usdValueCredited: (pointsCreditedNum * USD_PER_POINT).toFixed(2),
          usdValueRemaining: (pointsRemainingNum * USD_PER_POINT).toFixed(2),
          usdValueSpent: (pointsSpentNum * USD_PER_POINT).toFixed(2),
          userCount: typeData.userCount.size,
          entryCount: typeData.entries.length,
          entries: typeData.entries
        };
      });

      // Sort by total points credited (descending)
      rewardTypes.sort((a, b) => {
        const aTotal = BigInt(a.totalPointsCredited);
        const bTotal = BigInt(b.totalPointsCredited);
        return aTotal > bTotal ? -1 : aTotal < bTotal ? 1 : 0;
      });

      // Calculate USD values for summary
      const totalPointsCreditedNum = Number(totalPointsCredited.toString());
      const totalPointsRemainingNum = Number(totalPointsRemaining.toString());
      const totalPointsSpentNum = Number(totalPointsSpent.toString());

      res.json({
        rewardTypes,
        summary: {
          totalPointsCredited: totalPointsCredited.toString(),
          totalPointsRemaining: totalPointsRemaining.toString(),
          totalPointsSpent: totalPointsSpent.toString(),
          usdValueCredited: (totalPointsCreditedNum * USD_PER_POINT).toFixed(2),
          usdValueRemaining: (totalPointsRemainingNum * USD_PER_POINT).toFixed(2),
          usdValueSpent: (totalPointsSpentNum * USD_PER_POINT).toFixed(2),
          totalEntries: freePointsEntries.length,
          totalRewardTypes: rewardTypes.length
        },
        chainId,
        requestId
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting free points:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to fetch free points',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /vault-balances
   * Get Foundation protocolEscrow and chartered vault balances
   * Query params: chainId (default: '1'), wallet (admin wallet address)
   * Full path: /api/v1/admin/vaults/vault-balances
   */
  router.get('/vault-balances', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.chainId || '1';
    
    logger.info(`[AdminApi] GET /vault-balances for chainId=${chainId}, requestId=${requestId}`);

    try {
      const { creditService, ethereumService } = getChainServices(chainId);
      if (!creditService || !ethereumService) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: `Services not available for chainId ${chainId}`,
            requestId 
          } 
        });
      }

      const contractConfig = creditService.contractConfig;
      if (!contractConfig) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Contract configuration not available',
            requestId 
          } 
        });
      }

      // Get all tokens that have been deposited (from credit ledger)
      // Use creditService's creditLedgerDb to access the database
      const creditLedgerDb = creditService.creditLedgerDb;
      if (!creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit ledger database service not available',
            requestId 
          } 
        });
      }

      // Get all confirmed deposits (deposits don't have a 'type' field, they're just ledger entries)
      const allDeposits = await creditLedgerDb.findMany({
        status: 'CONFIRMED',
        token_address: { $exists: true, $ne: null }
      });

      logger.info(`[AdminApi] Found ${allDeposits.length} confirmed deposits`);

      // Get unique token addresses from deposits
      let tokenAddresses = [...new Set(allDeposits.map(d => d.token_address).filter(Boolean))];
      
      // If no deposits, at least check for ETH (native token)
      if (tokenAddresses.length === 0) {
        tokenAddresses = [NATIVE_ETH];
        logger.info(`[AdminApi] No deposits found, checking ETH balance only`);
      } else {
        // Always include ETH in case there are deposits but no ETH deposits yet
        if (!tokenAddresses.some(addr => addr.toLowerCase() === NATIVE_ETH.toLowerCase())) {
          tokenAddresses.push(NATIVE_ETH);
        }
      }
      
      logger.info(`[AdminApi] Checking balances for ${tokenAddresses.length} tokens:`, tokenAddresses);

      // Get Foundation protocolEscrow balances and calculate real user-owned based on points
      const foundationBalances = await Promise.all(
        tokenAddresses.map(async (tokenAddress) => {
          try {
            const balance = await creditService.getProtocolEscrowBalance(tokenAddress);
            
            // Get token metadata
            let symbol = 'N/A', decimals = 18, name = '';
            if (tokenAddress.toLowerCase() === NATIVE_ETH.toLowerCase()) {
              symbol = 'ETH';
              decimals = 18;
              name = 'Ethereum';
            } else if (priceFeedService) {
              try {
                const meta = await priceFeedService.getMetadata(tokenAddress);
                symbol = meta.symbol || 'N/A';
                decimals = meta.decimals || 18;
                name = meta.name || '';
              } catch (e) {
                logger.warn(`[AdminApi] Could not fetch metadata for token ${tokenAddress}`, e.message);
              }
            }

            // Calculate real user-owned balance based on points_remaining
            // User deposits are stored in individual user escrow balances, not Foundation protocol escrow
            // Get all confirmed deposits for this token (across all users)
            const foundationAddr = contractConfig.address.toLowerCase();
            const tokenDeposits = allDeposits.filter(d =>
              d.token_address && d.token_address.toLowerCase() === tokenAddress.toLowerCase() &&
              d.points_credited && d.points_credited > 0 &&
              d.deposit_amount_wei &&
              d.depositor_address &&
              // Foundation-only: vault_account is null/undefined (legacy) or explicitly Foundation
              (!d.vault_account || d.vault_account.toLowerCase() === foundationAddr)
            );

            logger.info(`[AdminApi] Found ${tokenDeposits.length} deposits for token ${tokenAddress} (${symbol})`);

            let realUserOwnedWei = 0n;
            let totalDepositedWei = 0n;
            let totalUserEscrowOnChain = 0n; // Will sum up all user escrow balances
            let totalPointsRemaining = 0;
            
            // Group deposits by depositor to query their escrow balances
            const depositorsByAddress = {};
            for (const deposit of tokenDeposits) {
              const depositAmount = BigInt(deposit.deposit_amount_wei || '0');
              const pointsCredited = BigInt(deposit.points_credited || '0');
              const pointsRemaining = BigInt(deposit.points_remaining || '0');
              const depositor = deposit.depositor_address.toLowerCase();
              
              totalDepositedWei += depositAmount;
              totalPointsRemaining += Number(deposit.points_remaining || 0);
              
              // Calculate user's share: (points_remaining / points_credited) * deposit_amount
              if (pointsCredited > 0n) {
                const userShare = (pointsRemaining * depositAmount) / pointsCredited;
                realUserOwnedWei += userShare;
              }
              
              // Track depositors to query their on-chain escrow balances
              if (!depositorsByAddress[depositor]) {
                depositorsByAddress[depositor] = [];
              }
              depositorsByAddress[depositor].push(deposit);
            }

            // Query on-chain escrow balances for each unique depositor
            const { ethereumService } = getChainServices(chainId);
            const contractConfig = creditService.contractConfig;
            
            for (const [depositorAddress, deposits] of Object.entries(depositorsByAddress)) {
              try {
                const custodyKey = getCustodyKey(depositorAddress, tokenAddress);
                const packedAmount = await ethereumService.read(
                  contractConfig.address,
                  contractConfig.abi,
                  'custody',
                  custodyKey
                );
                const { userOwned, escrow } = splitCustodyAmount(packedAmount);
                // User escrow is what's in their escrow bucket
                totalUserEscrowOnChain += escrow;
              } catch (error) {
                logger.warn(`[AdminApi] Could not read escrow balance for depositor ${depositorAddress}:`, error.message);
                // If custody key doesn't exist, escrow is 0
              }
            }

            // Protocol-owned (not yet seized) = total deposited - real user-owned
            // This represents what the protocol has earned from point spends but hasn't seized yet
            const ledgerProtocolClaimWei = totalDepositedWei > realUserOwnedWei 
              ? totalDepositedWei - realUserOwnedWei 
              : 0n;
            const protocolOwnedNotSeized = ledgerProtocolClaimWei;
            
            const contractProtocolEscrowWei = BigInt(balance.protocolEscrow.toString());
            const contractUserOwnedWei = BigInt(balance.userOwned.toString());
            const contractTotalWei = contractProtocolEscrowWei + contractUserOwnedWei;
            
            const pointDebtWei = realUserOwnedWei > contractUserOwnedWei 
              ? realUserOwnedWei - contractUserOwnedWei 
              : 0n;
            const pendingSeizureWei = ledgerProtocolClaimWei > contractProtocolEscrowWei
              ? ledgerProtocolClaimWei - contractProtocolEscrowWei
              : 0n;
            const pointsOutstandingUsd = Number((totalPointsRemaining * USD_PER_POINT).toFixed(4));
            
            logger.info(`[AdminApi] Token ${symbol}: totalDeposited=${totalDepositedWei.toString()}, realUserOwned=${realUserOwnedWei.toString()}, totalUserEscrowOnChain=${totalUserEscrowOnChain.toString()}, protocolOwnedNotSeized=${protocolOwnedNotSeized.toString()}`);

            return {
              tokenAddress,
              symbol,
              decimals,
              name,
              contractTotalWei: contractTotalWei.toString(),
              contractProtocolEscrowWei: contractProtocolEscrowWei.toString(),
              contractUserOwnedWei: contractUserOwnedWei.toString(),
              protocolEscrow: contractProtocolEscrowWei.toString(), // legacy
              userOwned: contractUserOwnedWei.toString(), // legacy
              realUserOwned: realUserOwnedWei.toString(), // Calculated from points_remaining across all deposits
              ledgerUserClaimWei: realUserOwnedWei.toString(),
              ledgerProtocolClaimWei: ledgerProtocolClaimWei.toString(),
              protocolOwnedNotSeized: protocolOwnedNotSeized.toString(), // Protocol's share not yet seized (legacy)
              totalDeposited: totalDepositedWei.toString(),
              totalUserEscrowOnChain: totalUserEscrowOnChain.toString(), // Sum of all user escrow balances on-chain
              pointDebtWei: pointDebtWei.toString(),
              pendingSeizureWei: pendingSeizureWei.toString(),
              pointsOutstanding: totalPointsRemaining,
              pointsOutstandingUsd
            };
          } catch (error) {
            logger.error(`[AdminApi] Error getting protocolEscrow balance for ${tokenAddress}:`, error);
            return null;
          }
        })
      );

      // Filter out null results
      const foundation = foundationBalances.filter(b => b !== null);

      // Get all chartered vaults
      const charteredVaults = await creditLedgerDb.findMany({
        type: 'REFERRAL_VAULT',
        is_active: true
      });

      logger.info(`[AdminApi] Found ${charteredVaults.length} active chartered vaults`);

      // Get balances for each chartered vault
      const charterFundAbi = contractRegistry.charteredFund.abi;
      const charteredVaultsWithBalances = await Promise.all(
        charteredVaults.map(async (vault) => {
          const vaultAddress = vault.vault_address;
          const vaultAddrLower = vaultAddress.toLowerCase();
          const vaultBalances = await Promise.all(
            tokenAddresses.map(async (tokenAddress) => {
              // Get token metadata first (shared between success/error paths)
              let symbol = 'N/A', decimals = 18, name = '';
              if (tokenAddress.toLowerCase() === NATIVE_ETH.toLowerCase()) {
                symbol = 'ETH';
                decimals = 18;
                name = 'Ethereum';
              } else if (priceFeedService) {
                try {
                  const meta = await priceFeedService.getMetadata(tokenAddress);
                  symbol = meta.symbol || 'N/A';
                  decimals = meta.decimals || 18;
                  name = meta.name || '';
                } catch (e) { /* ignore */ }
              }

              try {
                // Read vault's own protocol escrow bucket from the CharterFund contract itself.
                // custody[keccak(vaultAddress, token)].escrow = accumulated protocol fees
                // (these are what sweepProtocolFees moves to Foundation).
                const vaultProtocolKey = getCustodyKey(vaultAddress, tokenAddress);
                const packedAmount = await ethereumService.read(
                  vaultAddress,       // CharterFund contract, NOT Foundation
                  charterFundAbi,
                  'custody',
                  vaultProtocolKey
                );
                const { escrow } = splitCustodyAmount(packedAmount);

                // Calculate pending seizure: what the ledger says this vault owes protocol
                // minus what's already accumulated in the vault's protocol escrow bucket.
                const vaultDeposits = allDeposits.filter(d =>
                  d.token_address && d.token_address.toLowerCase() === tokenAddress.toLowerCase() &&
                  d.points_credited && d.points_credited > 0 &&
                  d.deposit_amount_wei &&
                  d.depositor_address &&
                  d.vault_account && d.vault_account.toLowerCase() === vaultAddrLower
                );

                let ledgerProtocolClaimWei = 0n;
                for (const d of vaultDeposits) {
                  const depositAmount = BigInt(d.deposit_amount_wei || '0');
                  const pointsCredited = BigInt(d.points_credited || '0');
                  const pointsRemaining = BigInt(d.points_remaining || '0');
                  if (pointsCredited > 0n && pointsRemaining < pointsCredited) {
                    ledgerProtocolClaimWei += ((pointsCredited - pointsRemaining) * depositAmount) / pointsCredited;
                  }
                }

                const pendingSeizureWei = ledgerProtocolClaimWei > escrow
                  ? ledgerProtocolClaimWei - escrow
                  : 0n;

                return {
                  tokenAddress,
                  symbol,
                  decimals,
                  name,
                  escrow: escrow.toString(),
                  pendingSeizureWei: pendingSeizureWei.toString(),
                };
              } catch (error) {
                return {
                  tokenAddress,
                  symbol,
                  decimals,
                  name,
                  escrow: '0',
                  pendingSeizureWei: '0',
                };
              }
            })
          );

          return {
            vaultAddress,
            vaultName: vault.vault_name || '(unnamed)',
            masterAccountId: vault.master_account_id?.toString(),
            tokens: vaultBalances.filter(t => BigInt(t.escrow) > 0n || BigInt(t.pendingSeizureWei) > 0n)
          };
        })
      );

      const response = {
        foundation,
        charteredVaults: charteredVaultsWithBalances,
        chainId,
        requestId
      };

      logger.info(`[AdminApi] Returning ${foundation.length} foundation token balances and ${charteredVaultsWithBalances.length} chartered vaults`);
      logger.debug(`[AdminApi] Response data:`, JSON.stringify(response, null, 2));

      res.json(response);

    } catch (error) {
      logger.error(`[AdminApi] Error getting vault balances:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to get vault balances',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /withdrawal-requests
   * Get pending withdrawal requests (read-only, for display)
   * Query params: status (default: 'PENDING_PROCESSING'), wallet (admin wallet address)
   * Full path: /api/v1/admin/vaults/withdrawal-requests
   */
  router.get('/withdrawal-requests', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const status = req.query.status || 'PENDING_PROCESSING';
    
    logger.info(`[AdminApi] GET /withdrawal-requests with status=${status}, requestId=${requestId}`);

    try {
      // Get creditService to access creditLedgerDb
      const chainId = req.query.chainId || req.body.chainId || '1';
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit ledger database service not available',
            requestId 
          } 
        });
      }

      // Withdrawal requests are stored with request_tx_hash field
      const requests = await creditService.creditLedgerDb.findMany({
        request_tx_hash: { $exists: true },
        status: status
      });

      // Sort by creation date, newest first
      requests.sort((a, b) => {
        const dateA = a.createdAt || new Date(0);
        const dateB = b.createdAt || new Date(0);
        return dateB - dateA;
      });

      res.json({
        requests,
        count: requests.length,
        status,
        requestId
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting withdrawal requests:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to get withdrawal requests',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /analytics/usage
   * Get usage analytics (point usage, deposits, active users)
   * Query params: startDate (ISO string), endDate (ISO string), period ('daily', 'weekly', 'monthly')
   * Full path: /api/v1/admin/vaults/analytics/usage
   */
  router.get('/analytics/usage', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    const period = req.query.period || 'daily'; // daily, weekly, monthly
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    
    logger.info(`[AdminApi] GET /analytics/usage for chainId=${chainId}, period=${period}, requestId=${requestId}`);

    try {
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit service not available',
            requestId 
          } 
        });
      }

      const creditLedgerDb = creditService.creditLedgerDb;

      // Get deposits from credit ledger
      const deposits = await creditLedgerDb.findMany({
        status: 'CONFIRMED',
        token_address: { $exists: true, $ne: null },
        deposit_tx_hash: { $exists: true },
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Get generations for point usage and active user counts
      // This is the work ledger - pointsSpent field shows actual work done
      let generations = [];
      try {
        const genResponse = await internalApiClient.get('/internal/v1/data/generations', {
          params: {
            requestTimestamp_gte: startDate.toISOString(),
            requestTimestamp_lte: endDate.toISOString()
          }
        });
        generations = genResponse.data?.generations || [];
        logger.info(`[AdminApi] Fetched ${generations.length} generations for analytics`);
      } catch (error) {
        logger.warn(`[AdminApi] Could not fetch generations: ${error.message}`);
      }

      // Aggregate by period
      const aggregateData = (items, dateField, valueField, period) => {
        const buckets = new Map();
        
        items.forEach(item => {
          const date = new Date(item[dateField]);
          let key;
          
          if (period === 'daily') {
            key = date.toISOString().split('T')[0]; // YYYY-MM-DD
          } else if (period === 'weekly') {
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
            key = weekStart.toISOString().split('T')[0];
          } else { // monthly
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
          }
          
          if (!buckets.has(key)) {
            buckets.set(key, { date: key, value: 0, count: 0 });
          }
          
          const bucket = buckets.get(key);
          if (valueField) {
            const val = typeof valueField === 'function' ? valueField(item) : (item[valueField] || 0);
            bucket.value += Number(val) || 0;
          }
          bucket.count += 1;
        });
        
        return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
      };

      // Calculate point usage from generations (work ledger)
      // Use pointsSpent field from generationOutputs
      const generationsWithPoints = generations.filter(gen => gen.pointsSpent && Number(gen.pointsSpent) > 0);
      
      const pointUsageByPeriod = aggregateData(
        generationsWithPoints,
        'requestTimestamp',
        'pointsSpent',
        period
      );
      
      // Add USD cost values to point usage data
      const pointUsageWithCosts = pointUsageByPeriod.map(periodData => ({
        ...periodData,
        costUsd: (Number(periodData.value) * USD_PER_POINT).toFixed(2)
      }));
      
      // GPU cost rates map for reverse lookup
      const GPU_COST_RATES = {
        0.000337: 'A10G',
        0.00018: 'T4',
        0.00004: 'CPU',
        0.000042: 'CPU', // Alternative CPU rate
        0.00032: 'L4',
        0.000596: 'L40S',
        0.00114: 'A100',
        0.001708: 'A100-80GB',
        0.002338: 'H100',
        0.001891: 'H200',
        0.002604: 'B200'
      };

      // Helper to extract GPU type from generation metadata
      const getGpuType = (gen) => {
        // Check metadata for gpuType directly
        if (gen.metadata?.gpuType) {
          return gen.metadata.gpuType;
        }
        // Check metadata for gpu_type
        if (gen.metadata?.gpu_type) {
          return gen.metadata.gpu_type;
        }
        // Try to reverse-lookup from costRate amount
        if (gen.metadata?.costRate?.amount) {
          const amount = gen.metadata.costRate.amount;
          // Try exact match first
          if (GPU_COST_RATES[amount]) {
            return GPU_COST_RATES[amount];
          }
          // Try approximate match (within 0.000001 tolerance)
          for (const [rate, gpuType] of Object.entries(GPU_COST_RATES)) {
            if (Math.abs(parseFloat(rate) - amount) < 0.000001) {
              return gpuType;
            }
          }
        }
        return 'unknown';
      };

      // Break down point usage by service, with GPU breakdown for comfyui
      const serviceBreakdown = new Map();
      const comfyuiGpuBreakdown = new Map(); // Separate map for comfyui GPU breakdown
      
      generationsWithPoints.forEach(gen => {
        const serviceName = gen.serviceName || 'unknown';
        const pointsSpent = Number(gen.pointsSpent || 0);
        
        // Main service breakdown
        if (!serviceBreakdown.has(serviceName)) {
          serviceBreakdown.set(serviceName, {
            serviceName,
            totalPointsSpent: 0,
            generationCount: 0,
            costUsd: 0,
            gpuBreakdown: serviceName === 'comfyui' ? {} : undefined
          });
        }
        
        const service = serviceBreakdown.get(serviceName);
        service.totalPointsSpent += pointsSpent;
        service.generationCount += 1;
        service.costUsd += pointsSpent * USD_PER_POINT;
        
        // For comfyui, also track by GPU type
        if (serviceName === 'comfyui') {
          const gpuType = getGpuType(gen);
          const gpuKey = `${serviceName}:${gpuType}`;
          
          if (!comfyuiGpuBreakdown.has(gpuKey)) {
            comfyuiGpuBreakdown.set(gpuKey, {
              serviceName: 'comfyui',
              gpuType,
              totalPointsSpent: 0,
              generationCount: 0,
              costUsd: 0
            });
          }
          
          const gpuEntry = comfyuiGpuBreakdown.get(gpuKey);
          gpuEntry.totalPointsSpent += pointsSpent;
          gpuEntry.generationCount += 1;
          gpuEntry.costUsd += pointsSpent * USD_PER_POINT;
        }
      });
      
      const serviceBreakdownArray = Array.from(serviceBreakdown.values())
        .map(service => ({
          ...service,
          costUsd: service.costUsd.toFixed(2)
        }))
        .sort((a, b) => b.totalPointsSpent - a.totalPointsSpent);
      
      // Create GPU breakdown array for comfyui
      const comfyuiGpuBreakdownArray = Array.from(comfyuiGpuBreakdown.values())
        .map(gpu => ({
          ...gpu,
          costUsd: gpu.costUsd.toFixed(2)
        }))
        .sort((a, b) => b.totalPointsSpent - a.totalPointsSpent);
      
      // Calculate totals
      const totalPointsSpent = generationsWithPoints.reduce((sum, gen) => sum + Number(gen.pointsSpent || 0), 0);
      const totalCostUsd = (totalPointsSpent * USD_PER_POINT).toFixed(2);
      
      const depositsByPeriod = aggregateData(deposits, 'createdAt', null, period);
      
      // Active users by period (unique masterAccountIds)
      const activeUsersByPeriod = new Map();
      generations.forEach(gen => {
        if (!gen.masterAccountId || !gen.requestTimestamp) return;
        
        const date = new Date(gen.requestTimestamp);
        let key;
        
        if (period === 'daily') {
          key = date.toISOString().split('T')[0];
        } else if (period === 'weekly') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        
        if (!activeUsersByPeriod.has(key)) {
          activeUsersByPeriod.set(key, new Set());
        }
        activeUsersByPeriod.get(key).add(gen.masterAccountId.toString());
      });

      const activeUsersData = Array.from(activeUsersByPeriod.entries())
        .map(([date, users]) => ({ date, value: users.size, count: users.size }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        pointUsage: pointUsageWithCosts,
        deposits: depositsByPeriod,
        activeUsers: activeUsersData,
        serviceBreakdown: serviceBreakdownArray,
        comfyuiGpuBreakdown: comfyuiGpuBreakdownArray,
        totals: {
          totalPointsSpent: totalPointsSpent.toString(),
          totalCostUsd: totalCostUsd,
          totalGenerations: generationsWithPoints.length
        },
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        requestId
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting usage analytics:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to get usage analytics',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /deposits/pending
   * Provides a list of ledger entries that require operator attention (pending/error states).
   * Query params:
   *   statuses (comma-separated) - defaults to pending + error states
   *   token (address) - optional filter
   *   depositor (address) - optional filter
   *   limit - max rows (default 100, max 500)
   */
  router.get('/deposits/pending', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    const defaultStatuses = ['PENDING_CONFIRMATION', 'ERROR', 'FAILED_RISK_ASSESSMENT', 'REJECTED_UNPROFITABLE'];
    const statuses = (req.query.statuses ? req.query.statuses.split(',') : defaultStatuses)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const tokenFilter = req.query.token ? req.query.token.toLowerCase() : null;
    const depositorFilter = req.query.depositor ? req.query.depositor.toLowerCase() : null;

    logger.info(`[AdminApi] GET /deposits/pending chainId=${chainId} statuses=${statuses.join('|')} requestId=${requestId}`);

    try {
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Credit service not available',
            requestId
          }
        });
      }

      if (!statuses.length) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'At least one status must be provided',
            requestId
          }
        });
      }

      const filter = { status: { $in: statuses } };
      if (tokenFilter) {
        filter.token_address = tokenFilter;
      }
      if (depositorFilter) {
        filter.depositor_address = depositorFilter;
      }

      const options = {
        sort: { updatedAt: -1 },
        limit
      };

      const deposits = await creditService.creditLedgerDb.findMany(filter, options);

      const normalized = deposits.map(entry => ({
        deposit_tx_hash: entry.deposit_tx_hash,
        confirmation_tx_hash: entry.confirmation_tx_hash,
        depositor_address: entry.depositor_address,
        master_account_id: entry.master_account_id,
        token_address: entry.token_address,
        status: entry.status,
        failure_reason: entry.failure_reason,
        error_details: entry.error_details,
        deposit_amount_wei: entry.deposit_amount_wei,
        points_credited: entry.points_credited,
        points_remaining: entry.points_remaining,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
        vault_account: entry.vault_account,
        deposit_type: entry.deposit_type
      }));

      const metrics = normalized.reduce((acc, deposit) => {
        acc.countByStatus[deposit.status] = (acc.countByStatus[deposit.status] || 0) + 1;
        if (deposit.deposit_amount_wei) {
          const amount = BigInt(deposit.deposit_amount_wei);
          acc.totalAmountWei = (acc.totalAmountWei || 0n) + amount;
        }
        return acc;
      }, { countByStatus: {}, totalAmountWei: 0n });

      res.json({
        success: true,
        requestId,
        chainId,
        deposits: normalized,
        metrics: {
          ...metrics,
          totalAmountWei: metrics.totalAmountWei ? metrics.totalAmountWei.toString() : '0'
        }
      });
    } catch (error) {
      logger.error('[AdminApi] Error fetching pending deposits:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch pending deposits',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * GET /analytics/withdrawals
   * Get withdrawal patterns over time
   * Query params: startDate, endDate, period
   * Full path: /api/v1/admin/vaults/analytics/withdrawals
   */
  router.get('/analytics/withdrawals', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    const period = req.query.period || 'daily';
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    
    logger.info(`[AdminApi] GET /analytics/withdrawals for chainId=${chainId}, requestId=${requestId}`);

    try {
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit service not available',
            requestId 
          } 
        });
      }

      const creditLedgerDb = creditService.creditLedgerDb;

      // Get withdrawal requests
      const withdrawals = await creditLedgerDb.findMany({
        request_tx_hash: { $exists: true },
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Aggregate by period
      const aggregateData = (items, dateField, valueField, period) => {
        const buckets = new Map();
        
        items.forEach(item => {
          const date = new Date(item[dateField]);
          let key;
          
          if (period === 'daily') {
            key = date.toISOString().split('T')[0];
          } else if (period === 'weekly') {
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            key = weekStart.toISOString().split('T')[0];
          } else {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          }
          
          if (!buckets.has(key)) {
            buckets.set(key, { date: key, value: 0, count: 0, byStatus: {} });
          }
          
          const bucket = buckets.get(key);
          if (valueField) {
            const val = typeof valueField === 'function' ? valueField(item) : (item[valueField] || '0');
            bucket.value = (BigInt(bucket.value) + BigInt(val || '0')).toString();
          }
          bucket.count += 1;
          
          const status = item.status || 'UNKNOWN';
          bucket.byStatus[status] = (bucket.byStatus[status] || 0) + 1;
        });
        
        return Array.from(buckets.values()).map(b => ({
          ...b,
          value: b.value.toString()
        })).sort((a, b) => a.date.localeCompare(b.date));
      };

      const withdrawalsByPeriod = aggregateData(withdrawals, 'createdAt', 'collateral_amount_wei', period);

      res.json({
        withdrawals: withdrawalsByPeriod,
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        requestId
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting withdrawal analytics:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to get withdrawal analytics',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /costs - Get cost entries (admin view)
   * Query params: category, startDate, endDate, createdBy, limit, skip
   * Full path: /api/v1/admin/vaults/costs
   */
  router.get('/costs', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    
    logger.info(`[AdminApi] GET /costs, requestId=${requestId}`);

    try {
      const response = await internalApiClient.get('/internal/v1/data/costs', {
        params: req.query
      });
      
      res.json(response.data);
    } catch (error) {
      logger.error(`[AdminApi] Error getting costs:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get cost entries',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * POST /costs - Create a new cost entry
   * Body: { date, category, description, amount, currency, vendor, receiptUrl, tags, createdBy }
   * Full path: /api/v1/admin/vaults/costs
   */
  router.post('/costs', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const adminWallet = req.adminWallet || req.query.wallet;
    
    logger.info(`[AdminApi] POST /costs, requestId=${requestId}`);

    try {
      const costData = {
        ...req.body,
        createdBy: adminWallet || req.body.createdBy
      };

      const response = await internalApiClient.post('/internal/v1/data/costs', costData);
      
      res.status(201).json(response.data);
    } catch (error) {
      logger.error(`[AdminApi] Error creating cost entry:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create cost entry',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * PUT /costs/:costId - Update a cost entry
   * Full path: /api/v1/admin/vaults/costs/:costId
   */
  router.put('/costs/:costId', adminMiddleware, async (req, res) => {
    const { costId } = req.params;
    const requestId = require('uuid').v4();
    
    logger.info(`[AdminApi] PUT /costs/${costId}, requestId=${requestId}`);

    try {
      const response = await internalApiClient.put(`/internal/v1/data/costs/${costId}`, req.body);
      
      res.json(response.data);
    } catch (error) {
      logger.error(`[AdminApi] Error updating cost entry:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update cost entry',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * DELETE /costs/:costId - Delete a cost entry
   * Full path: /api/v1/admin/vaults/costs/:costId
   */
  router.delete('/costs/:costId', adminMiddleware, async (req, res) => {
    const { costId } = req.params;
    const requestId = require('uuid').v4();
    
    logger.info(`[AdminApi] DELETE /costs/${costId}, requestId=${requestId}`);

    try {
      const response = await internalApiClient.delete(`/internal/v1/data/costs/${costId}`);
      
      res.json(response.data);
    } catch (error) {
      logger.error(`[AdminApi] Error deleting cost entry:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete cost entry',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * GET /costs/totals/by-category - Get cost totals by category
   * Query params: startDate, endDate
   * Full path: /api/v1/admin/vaults/costs/totals/by-category
   */
  router.get('/costs/totals/by-category', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    
    logger.info(`[AdminApi] GET /costs/totals/by-category, requestId=${requestId}`);

    try {
      const response = await internalApiClient.get('/internal/v1/data/costs/totals/by-category', {
        params: req.query
      });
      
      res.json(response.data);
    } catch (error) {
      logger.error(`[AdminApi] Error getting cost totals:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get cost totals',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * GET /analytics/rankings - Get tool/command usage rankings
   * Query params: startDate, endDate, sortBy (usage|points|users|revenue), limit, serviceName
   * Full path: /api/v1/admin/vaults/analytics/rankings
   */
  router.get('/analytics/rankings', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const sortBy = req.query.sortBy || 'usage'; // usage, points, users, cost
    const limit = parseInt(req.query.limit || '50', 10);
    const serviceName = req.query.serviceName; // Optional filter by service
    
    logger.info(`[AdminApi] GET /analytics/rankings for chainId=${chainId}, sortBy=${sortBy}, requestId=${requestId}`);

    try {
      // Get generations for the period
      let generations = [];
      try {
        const genFilter = {
          requestTimestamp_gte: startDate.toISOString(),
          requestTimestamp_lte: endDate.toISOString()
        };
        if (serviceName) {
          genFilter.serviceName = serviceName;
        }
        
        const genResponse = await internalApiClient.get('/internal/v1/data/generations', {
          params: genFilter
        });
        generations = genResponse.data?.generations || [];
        logger.info(`[AdminApi] Fetched ${generations.length} generations for rankings`);
      } catch (error) {
        logger.warn(`[AdminApi] Could not fetch generations: ${error.message}`);
      }

      // Aggregate by tool
      const toolStats = new Map();
      const userSetByTool = new Map(); // Track unique users per tool
      
      generations.forEach(gen => {
        const toolId = gen.toolId || gen.toolDisplayName || 'unknown';
        const toolDisplayName = gen.toolDisplayName || gen.toolId || 'unknown';
        const pointsSpent = Number(gen.pointsSpent || 0);
        const costUsd = Number(gen.costUsd?.$numberDecimal || gen.costUsd || 0);
        const masterAccountId = gen.masterAccountId?.toString() || null;
        
        if (!toolStats.has(toolId)) {
          toolStats.set(toolId, {
            toolId,
            toolDisplayName,
            serviceName: gen.serviceName || 'unknown',
            usageCount: 0,
            totalPointsSpent: 0,
            totalCostUsd: 0, // This is cost, not revenue
            uniqueUsers: new Set(),
            avgPointsPerUse: 0,
            avgCostPerUse: 0
          });
          userSetByTool.set(toolId, new Set());
        }
        
        const stats = toolStats.get(toolId);
        stats.usageCount += 1;
        stats.totalPointsSpent += pointsSpent;
        stats.totalCostUsd += costUsd;
        
        if (masterAccountId) {
          userSetByTool.get(toolId).add(masterAccountId);
        }
      });

      // Calculate unique users and averages
      const rankings = Array.from(toolStats.values()).map(tool => {
        const uniqueUserCount = userSetByTool.get(tool.toolId)?.size || 0;
        return {
          ...tool,
          uniqueUsers: uniqueUserCount,
          avgPointsPerUse: tool.usageCount > 0 ? (tool.totalPointsSpent / tool.usageCount).toFixed(2) : '0',
          avgCostPerUse: tool.usageCount > 0 ? (tool.totalCostUsd / tool.usageCount).toFixed(4) : '0'
        };
      });

      // Sort by requested metric
      const sortFunctions = {
        usage: (a, b) => b.usageCount - a.usageCount,
        points: (a, b) => b.totalPointsSpent - a.totalPointsSpent,
        users: (a, b) => b.uniqueUsers - a.uniqueUsers,
        cost: (a, b) => b.totalCostUsd - a.totalCostUsd
      };
      
      rankings.sort(sortFunctions[sortBy] || sortFunctions.usage);
      
      // Calculate totals for percentages
      const totals = {
        totalUsage: rankings.reduce((sum, r) => sum + r.usageCount, 0),
        totalPoints: rankings.reduce((sum, r) => sum + r.totalPointsSpent, 0),
        totalUsers: new Set(generations.map(g => g.masterAccountId?.toString()).filter(Boolean)).size,
        totalCost: rankings.reduce((sum, r) => sum + r.totalCostUsd, 0) // Total cost, not revenue
      };

      // Add percentages and limit results
      const rankedResults = rankings.slice(0, limit).map(tool => ({
        ...tool,
        usagePercentage: totals.totalUsage > 0 ? ((tool.usageCount / totals.totalUsage) * 100).toFixed(1) : '0',
        pointsPercentage: totals.totalPoints > 0 ? ((tool.totalPointsSpent / totals.totalPoints) * 100).toFixed(1) : '0',
        usersPercentage: totals.totalUsers > 0 ? ((tool.uniqueUsers / totals.totalUsers) * 100).toFixed(1) : '0',
        costPercentage: totals.totalCost > 0 ? ((tool.totalCostUsd / totals.totalCost) * 100).toFixed(1) : '0'
      }));

      res.json({
        rankings: rankedResults,
        totals,
        sortBy,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        },
        requestId
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting rankings:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to get rankings',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /analytics/active-users - Get most active users leaderboard
   * Query params: startDate, endDate, sortBy (points|generations|deposits|tenure), limit
   * Full path: /api/v1/admin/vaults/analytics/active-users
   */
  router.get('/analytics/active-users', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const sortBy = req.query.sortBy || 'points'; // points, generations, deposits, tenure
    const limit = parseInt(req.query.limit || '50', 10);
    
    logger.info(`[AdminApi] GET /analytics/active-users for chainId=${chainId}, sortBy=${sortBy}, requestId=${requestId}`);

    try {
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit service not available',
            requestId 
          } 
        });
      }

      const creditLedgerDb = creditService.creditLedgerDb;

      // Get generations for the period
      let generations = [];
      try {
        const genResponse = await internalApiClient.get('/internal/v1/data/generations', {
          params: {
            requestTimestamp_gte: startDate.toISOString(),
            requestTimestamp_lte: endDate.toISOString()
          }
        });
        generations = genResponse.data?.generations || [];
        logger.info(`[AdminApi] Fetched ${generations.length} generations for active users`);
      } catch (error) {
        logger.warn(`[AdminApi] Could not fetch generations: ${error.message}`);
      }

      // Get deposits for the period
      const deposits = await creditLedgerDb.findMany({
        status: 'CONFIRMED',
        token_address: { $exists: true, $ne: null },
        deposit_tx_hash: { $exists: true },
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Aggregate user activity
      const userActivity = new Map();

      // Process generations
      generations.forEach(gen => {
        const masterAccountId = gen.masterAccountId?.toString();
        if (!masterAccountId) return;

        if (!userActivity.has(masterAccountId)) {
          userActivity.set(masterAccountId, {
            masterAccountId,
            pointsSpent: 0,
            generationsCount: 0,
            depositsCount: 0,
            totalDeposited: 0,
            accountCreatedAt: null,
            favoriteTools: new Map()
          });
        }

        const activity = userActivity.get(masterAccountId);
        activity.generationsCount += 1;
        activity.pointsSpent += Number(gen.pointsSpent || 0);
        
        // Track favorite tools
        const toolName = gen.toolDisplayName || gen.toolId || 'unknown';
        if (!activity.favoriteTools.has(toolName)) {
          activity.favoriteTools.set(toolName, 0);
        }
        activity.favoriteTools.set(toolName, activity.favoriteTools.get(toolName) + 1);
      });

      // Process deposits
      deposits.forEach(deposit => {
        const masterAccountId = deposit.master_account_id?.toString();
        if (!masterAccountId) return;

        if (!userActivity.has(masterAccountId)) {
          userActivity.set(masterAccountId, {
            masterAccountId,
            pointsSpent: 0,
            generationsCount: 0,
            depositsCount: 0,
            totalDeposited: 0,
            accountCreatedAt: null,
            favoriteTools: new Map()
          });
        }

        const activity = userActivity.get(masterAccountId);
        activity.depositsCount += 1;
        activity.totalDeposited += Number(deposit.amount || 0);
      });

      // Get userCore data for wallet addresses and account creation dates
      // Fetch userCore data for each active user
      const userIds = Array.from(userActivity.keys());
      for (const masterAccountIdStr of userIds) {
        try {
          const userResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountIdStr}`);
          const user = userResponse.data;
          
          if (user) {
            // Get primary wallet or first wallet
            const primaryWallet = user.wallets?.find(w => w.isPrimary) || user.wallets?.[0];
            const walletAddress = primaryWallet?.address || null;
            
            // Get account creation date
            const accountCreatedAt = user.userCreationTimestamp 
              ? new Date(user.userCreationTimestamp)
              : (user.createdAt ? new Date(user.createdAt) : null);
            
            if (userActivity.has(masterAccountIdStr)) {
              const activity = userActivity.get(masterAccountIdStr);
              activity.accountCreatedAt = accountCreatedAt;
              activity.walletAddress = walletAddress;
              activity.username = user.username || user.profile?.username || null;
            }
          }
        } catch (error) {
          // Silently skip users that can't be fetched
          logger.debug(`[AdminApi] Could not fetch userCore for ${masterAccountIdStr}: ${error.message}`);
        }
      }

      // Convert to array and calculate tenure
      const usersList = Array.from(userActivity.values()).map(activity => {
        const accountAge = activity.accountCreatedAt 
          ? Math.floor((new Date() - activity.accountCreatedAt) / (1000 * 60 * 60 * 24)) // days
          : null;
        
        // Get top 3 favorite tools
        const favoriteToolsArray = Array.from(activity.favoriteTools.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([tool, count]) => ({ tool, count }));

        return {
          masterAccountId: activity.masterAccountId,
          pointsSpent: activity.pointsSpent,
          generationsCount: activity.generationsCount,
          depositsCount: activity.depositsCount,
          totalDeposited: activity.totalDeposited.toString(),
          accountAgeDays: accountAge,
          favoriteTools: favoriteToolsArray,
          // Account info if available
          walletAddress: activity.walletAddress || null,
          username: activity.username || null
        };
      });

      // Sort by requested metric
      const sortFunctions = {
        points: (a, b) => b.pointsSpent - a.pointsSpent,
        generations: (a, b) => b.generationsCount - a.generationsCount,
        deposits: (a, b) => b.depositsCount - a.depositsCount,
        tenure: (a, b) => {
          const ageA = a.accountAgeDays || 0;
          const ageB = b.accountAgeDays || 0;
          return ageB - ageA;
        }
      };
      
      usersList.sort(sortFunctions[sortBy] || sortFunctions.points);
      
      // Limit results
      const rankedUsers = usersList.slice(0, limit);

      // Calculate totals
      const totals = {
        totalUsers: usersList.length,
        totalPointsSpent: usersList.reduce((sum, u) => sum + u.pointsSpent, 0),
        totalGenerations: usersList.reduce((sum, u) => sum + u.generationsCount, 0),
        totalDeposits: usersList.reduce((sum, u) => sum + u.depositsCount, 0),
        totalDeposited: usersList.reduce((sum, u) => sum + Number(u.totalDeposited || 0), 0)
      };

      res.json({
        users: rankedUsers,
        totals,
        sortBy,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        },
        requestId
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting active users:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to get active users',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /analytics/accounting - Get business accounting dashboard data
   * Query params: startDate, endDate, period (all|ytd|mtd|custom)
   * Full path: /api/v1/admin/vaults/analytics/accounting
   */
  router.get('/analytics/accounting', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const chainId = req.query.chainId || '1';
    const period = req.query.period || 'mtd'; // all, ytd, mtd, custom
    let startDate, endDate;
    
    // Calculate date range based on period
    const now = new Date();
    if (period === 'all') {
      startDate = new Date(0); // Beginning of time
      endDate = now;
    } else if (period === 'ytd') {
      startDate = new Date(now.getFullYear(), 0, 1); // Jan 1 of current year
      endDate = now;
    } else if (period === 'mtd') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
      endDate = now;
    } else { // custom
      startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      endDate = req.query.endDate ? new Date(req.query.endDate) : now;
    }
    
    logger.info(`[AdminApi] GET /analytics/accounting for chainId=${chainId}, period=${period}, requestId=${requestId}`);

    try {
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({ 
          error: { 
            code: 'SERVICE_UNAVAILABLE', 
            message: 'Credit service not available',
            requestId 
          } 
        });
      }

      const creditLedgerDb = creditService.creditLedgerDb;

      // Get all deposits (revenue)
      const allDeposits = await creditLedgerDb.findMany({
        status: 'CONFIRMED',
        token_address: { $exists: true, $ne: null },
        deposit_tx_hash: { $exists: true }
      });

      // Filter deposits by period
      const depositsInPeriod = allDeposits.filter(d => {
        const depositDate = new Date(d.createdAt);
        return depositDate >= startDate && depositDate <= endDate;
      });

      // Calculate total revenue (deposits)
      const totalRevenue = depositsInPeriod.reduce((sum, d) => sum + Number(d.amount || 0), 0);

      // Get withdrawals
      const withdrawals = await creditLedgerDb.findMany({
        request_tx_hash: { $exists: true },
        createdAt: { $gte: startDate, $lte: endDate }
      });

      // Calculate total withdrawn
      const totalWithdrawn = withdrawals.reduce((sum, w) => sum + Number(w.amount || 0), 0);

      // Get protocol-owned funds (not seized) - this is from the accounts endpoint
      // We'll calculate this from deposits minus user withdrawals
      let protocolOwnedNotSeized = 0;
      try {
        const accountsResponse = await internalApiClient.get('/internal/v1/data/ledger/accounts', {
          params: { chainId, limit: '1000' }
        });
        const accounts = accountsResponse.data?.accounts || [];
        protocolOwnedNotSeized = accounts.reduce((sum, acc) => {
          const protocolOwned = Number(acc.protocolOwnedNotSeized || '0');
          return sum + protocolOwned;
        }, 0);
      } catch (error) {
        logger.warn(`[AdminApi] Could not fetch accounts for protocol-owned calculation: ${error.message}`);
      }

      // Get logged costs from cost logging system
      let loggedCosts = 0;
      try {
        const costsParams = {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        };
        const costsResponse = await internalApiClient.get('/internal/v1/data/costs', {
          params: costsParams
        });
        const costs = costsResponse.data?.costs || [];
        loggedCosts = costs.reduce((sum, cost) => {
          const amount = Number(cost.amount?.$numberDecimal || cost.amount || 0);
          return sum + amount;
        }, 0);
      } catch (error) {
        logger.warn(`[AdminApi] Could not fetch logged costs: ${error.message}`);
      }

      // Get estimated infrastructure costs from usage (generations)
      let infrastructureCosts = 0;
      try {
        const genResponse = await internalApiClient.get('/internal/v1/data/generations', {
          params: {
            requestTimestamp_gte: startDate.toISOString(),
            requestTimestamp_lte: endDate.toISOString()
          }
        });
        const generations = genResponse.data?.generations || [];
        infrastructureCosts = generations.reduce((sum, gen) => {
          const cost = Number(gen.costUsd?.$numberDecimal || gen.costUsd || 0);
          return sum + cost;
        }, 0);
      } catch (error) {
        logger.warn(`[AdminApi] Could not fetch infrastructure costs: ${error.message}`);
      }

      // Calculate totals
      const totalExpenses = loggedCosts + infrastructureCosts;
      const netRevenue = totalRevenue - totalWithdrawn;
      const grossProfit = netRevenue - totalExpenses;
      const operatingMargin = netRevenue > 0 ? ((grossProfit / netRevenue) * 100) : 0;

      // Get unique users who deposited
      const uniqueDepositors = new Set(depositsInPeriod.map(d => d.master_account_id?.toString()).filter(Boolean));
      const averageRevenuePerUser = uniqueDepositors.size > 0 ? (totalRevenue / uniqueDepositors.size) : 0;

      // Breakdown by category for logged costs
      let costBreakdown = {};
      try {
        const costTotalsResponse = await internalApiClient.get('/internal/v1/data/costs/totals/by-category', {
          params: {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString()
          }
        });
        const costTotals = costTotalsResponse.data?.totals || [];
        costBreakdown = costTotals.reduce((acc, cat) => {
          acc[cat.category] = Number(cat.total || 0);
          return acc;
        }, {});
      } catch (error) {
        logger.warn(`[AdminApi] Could not fetch cost breakdown: ${error.message}`);
      }

      res.json({
        period: {
          type: period,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        },
        revenue: {
          totalDeposits: totalRevenue.toString(),
          totalWithdrawn: totalWithdrawn.toString(),
          netRevenue: netRevenue.toString(),
          protocolOwnedNotSeized: protocolOwnedNotSeized.toString(),
          uniqueDepositors: uniqueDepositors.size,
          averageRevenuePerUser: averageRevenuePerUser.toFixed(2)
        },
        expenses: {
          loggedCosts: loggedCosts.toFixed(2),
          infrastructureCosts: infrastructureCosts.toFixed(2),
          totalExpenses: totalExpenses.toFixed(2),
          costBreakdown
        },
        profitLoss: {
          grossProfit: grossProfit.toFixed(2),
          operatingMargin: operatingMargin.toFixed(2),
          netRevenue: netRevenue.toFixed(2)
        },
        requestId
      });

    } catch (error) {
      logger.error(`[AdminApi] Error getting accounting data:`, error);
      res.status(500).json({ 
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to get accounting data',
          details: error.message,
          requestId 
        } 
      });
    }
  });

  /**
   * GET /analytics/expenditure - Get points expenditure analysis
   * Query params: startDate, endDate, groupBy ('tool', 'user', 'period')
   * Full path: /api/v1/admin/vaults/analytics/expenditure
   */
  router.get('/analytics/expenditure', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const groupBy = req.query.groupBy || 'tool'; // 'tool', 'user', 'period'
    
    logger.info(`[AdminApi] GET /analytics/expenditure, groupBy=${groupBy}, requestId=${requestId}`);

    try {
      // Get generations with points spent
      const genResponse = await internalApiClient.get('/internal/v1/data/generations', {
        params: {
          requestTimestamp_gte: startDate.toISOString(),
          requestTimestamp_lte: endDate.toISOString(),
          pointsSpent: { $gt: 0 }
        }
      });
      
      const generations = genResponse.data?.generations || [];
      
      if (groupBy === 'tool') {
        // Group by toolId/toolDisplayName
        const toolMap = new Map();
        
        generations.forEach(gen => {
          const toolId = gen.toolId || gen.toolDisplayName || 'unknown';
          const toolName = gen.toolDisplayName || gen.toolId || 'Unknown Tool';
          const pointsSpent = Number(gen.pointsSpent || 0);
          
          if (!toolMap.has(toolId)) {
            toolMap.set(toolId, {
              toolId,
              toolName,
              totalPointsSpent: 0,
              usageCount: 0,
              uniqueUsers: new Set(),
              totalCostUsd: 0
            });
          }
          
          const tool = toolMap.get(toolId);
          tool.totalPointsSpent += pointsSpent;
          tool.usageCount += 1;
          if (gen.masterAccountId) {
            tool.uniqueUsers.add(gen.masterAccountId.toString());
          }
          if (gen.costUsd) {
            tool.totalCostUsd += Number(gen.costUsd);
          }
        });
        
        const toolStats = Array.from(toolMap.values()).map(tool => ({
          toolId: tool.toolId,
          toolName: tool.toolName,
          totalPointsSpent: tool.totalPointsSpent,
          usageCount: tool.usageCount,
          uniqueUsers: tool.uniqueUsers.size,
          avgPointsPerUse: tool.usageCount > 0 ? (tool.totalPointsSpent / tool.usageCount).toFixed(2) : 0,
          totalCostUsd: tool.totalCostUsd.toFixed(2)
        })).sort((a, b) => b.totalPointsSpent - a.totalPointsSpent);
        
        res.json({
          groupBy: 'tool',
          tools: toolStats,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          requestId
        });
        
      } else if (groupBy === 'user') {
        // Group by masterAccountId
        const userMap = new Map();
        
        generations.forEach(gen => {
          const userId = gen.masterAccountId?.toString() || 'unknown';
          const pointsSpent = Number(gen.pointsSpent || 0);
          
          if (!userMap.has(userId)) {
            userMap.set(userId, {
              masterAccountId: userId,
              totalPointsSpent: 0,
              generationCount: 0,
              totalCostUsd: 0
            });
          }
          
          const user = userMap.get(userId);
          user.totalPointsSpent += pointsSpent;
          user.generationCount += 1;
          if (gen.costUsd) {
            user.totalCostUsd += Number(gen.costUsd);
          }
        });
        
        const userStats = Array.from(userMap.values())
          .sort((a, b) => b.totalPointsSpent - a.totalPointsSpent)
          .slice(0, 100); // Top 100 users
        
        res.json({
          groupBy: 'user',
          users: userStats,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          requestId
        });
        
      } else {
        // Group by period (daily/weekly/monthly)
        const period = req.query.period || 'daily';
        const periodMap = new Map();
        
        generations.forEach(gen => {
          if (!gen.requestTimestamp) return;
          
          const date = new Date(gen.requestTimestamp);
          let key;
          
          if (period === 'daily') {
            key = date.toISOString().split('T')[0];
          } else if (period === 'weekly') {
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            key = weekStart.toISOString().split('T')[0];
          } else {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          }
          
          if (!periodMap.has(key)) {
            periodMap.set(key, {
              date: key,
              totalPointsSpent: 0,
              generationCount: 0,
              uniqueUsers: new Set()
            });
          }
          
          const periodData = periodMap.get(key);
          periodData.totalPointsSpent += Number(gen.pointsSpent || 0);
          periodData.generationCount += 1;
          if (gen.masterAccountId) {
            periodData.uniqueUsers.add(gen.masterAccountId.toString());
          }
        });
        
        const periodStats = Array.from(periodMap.values())
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(p => ({
            ...p,
            uniqueUsers: p.uniqueUsers.size
          }));
        
        res.json({
          groupBy: 'period',
          period,
          trends: periodStats,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          requestId
        });
      }
      
    } catch (error) {
      logger.error(`[AdminApi] Error getting expenditure analysis:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get expenditure analysis',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * GET /users/search - Search for users by various criteria
   */
  router.get('/users/search', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const { query, type } = req.query; // query: search term, type: wallet|platform|masterAccountId|email
    
    logger.info(`[AdminApi] GET /users/search: query=${query}, type=${type}, requestId=${requestId}`);

    try {
      if (!query) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Query parameter is required',
            requestId
          }
        });
      }

      let users = [];
      const { ObjectId } = require('mongodb');

      switch (type) {
        case 'wallet':
          // Search by wallet address
          const walletUsers = await internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${encodeURIComponent(query)}`);
          if (walletUsers.data && walletUsers.data.masterAccountId) {
            const userCore = await internalApiClient.get(`/internal/v1/data/users/${walletUsers.data.masterAccountId}`);
            if (userCore.data) users.push(userCore.data);
          }
          break;

        case 'platform':
          // Search by platform ID (format: platform:platformId)
          const [platform, platformId] = query.split(':');
          if (platform && platformId) {
            const platformUsers = await internalApiClient.post('/internal/v1/data/users/find-or-create', {
              platform,
              platformId
            });
            if (platformUsers.data && platformUsers.data.user) {
              users.push(platformUsers.data.user);
            }
          }
          break;

        case 'masterAccountId':
          // Search by masterAccountId
          if (ObjectId.isValid(query)) {
            const userCore = await internalApiClient.get(`/internal/v1/data/users/${query}`);
            if (userCore.data) users.push(userCore.data);
          }
          break;

        default:
          // General search - try multiple methods
          // Try as wallet
          try {
            const walletUsers = await internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${encodeURIComponent(query)}`);
            if (walletUsers.data && walletUsers.data.masterAccountId) {
              const userCore = await internalApiClient.get(`/internal/v1/data/users/${walletUsers.data.masterAccountId}`);
              if (userCore.data) users.push(userCore.data);
            }
          } catch (err) {
            // Not a wallet, continue
          }

          // Try as masterAccountId
          if (ObjectId.isValid(query)) {
            try {
              const userCore = await internalApiClient.get(`/internal/v1/data/users/${query}`);
              if (userCore.data) users.push(userCore.data);
            } catch (err) {
              // Not found, continue
            }
          }
          break;
      }

      res.json({
        users,
        count: users.length,
        requestId
      });
    } catch (error) {
      logger.error(`[AdminApi] Error searching users:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to search users',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * GET /users/:masterAccountId - Get detailed user information
   */
  router.get('/users/:masterAccountId', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const { masterAccountId } = req.params;
    
    logger.info(`[AdminApi] GET /users/${masterAccountId}, requestId=${requestId}`);

    try {
      const { ObjectId } = require('mongodb');
      if (!ObjectId.isValid(masterAccountId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid masterAccountId format',
            requestId
          }
        });
      }

      // Get user core data
      const userCoreResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountId}`);
      if (!userCoreResponse.data) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            requestId
          }
        });
      }

      const userCore = userCoreResponse.data;

      // Get user economy data
      let economy = null;
      try {
        const economyResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountId}/economy`);
        economy = economyResponse.data;
      } catch (err) {
        // Economy record might not exist yet
      }

      // Get recent transactions
      let transactions = [];
      try {
        const transactionsResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountId}/transactions?limit=50`);
        transactions = transactionsResponse.data.transactions || [];
      } catch (err) {
        // Transactions might not exist
      }

      // Get recent generations
      let generations = [];
      try {
        const generationsResponse = await internalApiClient.get(`/internal/v1/data/generations?masterAccountId=${masterAccountId}&limit=20&sort=createdAt:-1`);
        generations = generationsResponse.data.generations || [];
      } catch (err) {
        // Generations might not exist
      }

      // Get deposit history
      let deposits = [];
      try {
        const depositsResponse = await internalApiClient.get(`/internal/v1/data/ledger/entries?master_account_id=${masterAccountId}&limit=50&sort=createdAt:-1`);
        deposits = depositsResponse.data.entries || [];
      } catch (err) {
        // Deposits might not exist
      }

      res.json({
        user: userCore,
        economy,
        transactions,
        generations: generations.slice(0, 20),
        deposits: deposits.slice(0, 50),
        requestId
      });
    } catch (error) {
      logger.error(`[AdminApi] Error getting user details:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get user details',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * POST /users/:masterAccountId/adjust-points - Add points via ADMIN_GIFT credit ledger entry
   */
  router.post('/users/:masterAccountId/adjust-points', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const { masterAccountId } = req.params;
    const { amountUsd, points, description, reason, walletAddress } = req.body;
    const adminWallet = req.adminWallet;
    const chainId = req.query.chainId || '1';

    logger.info(`[AdminApi] POST /users/${masterAccountId}/adjust-points by ${adminWallet}, requestId=${requestId}`, req.body);

    try {
      const { ObjectId } = require('mongodb');
      if (!ObjectId.isValid(masterAccountId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid masterAccountId format',
            requestId
          }
        });
      }

      if (amountUsd === undefined && points === undefined) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Either amountUsd or points must be provided',
            requestId
          }
        });
      }

      if (!description || typeof description !== 'string' || description.trim() === '') {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Description is required',
            requestId
          }
        });
      }

      // Calculate final points from either points or USD input
      let finalPoints;
      if (points !== undefined) {
        finalPoints = Math.round(points);
      } else {
        finalPoints = Math.round(amountUsd / USD_PER_POINT);
      }

      if (!finalPoints || finalPoints <= 0) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Points must be a positive number',
            requestId
          }
        });
      }

      // Resolve the user's wallet address (required for credit ledger balance lookups)
      let depositorAddress = walletAddress;
      if (!depositorAddress) {
        try {
          const userResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountId}`);
          const userData = userResponse.data;
          if (userData && userData.wallets && userData.wallets.length > 0) {
            depositorAddress = userData.wallets[0].address;
          }
        } catch (err) {
          logger.warn(`[AdminApi] Could not look up wallet for ${masterAccountId}: ${err.message}`);
        }
      }

      if (!depositorAddress) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Could not resolve wallet address for user. Provide walletAddress in request body.',
            requestId
          }
        });
      }

      // Get creditLedgerDb from creditService
      const { creditService } = getChainServices(chainId);
      if (!creditService || !creditService.creditLedgerDb) {
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Credit service not available',
            requestId
          }
        });
      }

      const creditLedgerDb = creditService.creditLedgerDb;
      const fullDescription = `Admin gift by ${adminWallet}: ${description}${reason ? ` (Reason: ${reason})` : ''}`;

      // Create ADMIN_GIFT credit ledger entry with depositor_address so it appears in wallet-based balance queries
      const result = await creditLedgerDb.createRewardCreditEntry({
        masterAccountId,
        points: finalPoints,
        rewardType: 'ADMIN_GIFT',
        description: fullDescription,
        depositorAddress,
        relatedItems: {
          adminWallet,
          reason: reason || 'Manual adjustment',
          originalAmountUsd: amountUsd || null,
          requestId
        }
      });

      logger.info(`[AdminApi] Created ADMIN_GIFT ledger entry for ${masterAccountId}: ${finalPoints} points, requestId=${requestId}`);

      res.json({
        success: true,
        entry: result,
        message: `Successfully added ${finalPoints.toLocaleString()} points`,
        requestId
      });
    } catch (error) {
      logger.error(`[AdminApi] Error adjusting points:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to adjust points',
          details: error.message,
          requestId
        }
      });
    }
  });

  /**
   * POST /users/:masterAccountId/notes - Add or update admin notes for a user
   */
  router.post('/users/:masterAccountId/notes', adminMiddleware, async (req, res) => {
    const requestId = require('uuid').v4();
    const { masterAccountId } = req.params;
    const { note, flag } = req.body;
    const adminWallet = req.adminWallet;
    
    logger.info(`[AdminApi] POST /users/${masterAccountId}/notes by ${adminWallet}, requestId=${requestId}`);

    try {
      const { ObjectId } = require('mongodb');
      if (!ObjectId.isValid(masterAccountId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid masterAccountId format',
            requestId
          }
        });
      }

      // Get current user data
      const userCoreResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountId}`);
      if (!userCoreResponse.data) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            requestId
          }
        });
      }

      const updateData = {
        updatedAt: new Date()
      };

      if (note !== undefined) {
        updateData['adminNotes'] = {
          note: note.trim(),
          updatedBy: adminWallet,
          updatedAt: new Date()
        };
      }

      if (flag !== undefined) {
        updateData['adminFlags'] = flag || null;
        if (flag) {
          updateData['adminFlagsUpdatedBy'] = adminWallet;
          updateData['adminFlagsUpdatedAt'] = new Date();
        }
      }

      // Update user core via internal API
      await internalApiClient.put(`/internal/v1/data/users/${masterAccountId}`, updateData);

      res.json({
        success: true,
        message: 'User notes/flags updated successfully',
        requestId
      });
    } catch (error) {
      logger.error(`[AdminApi] Error updating user notes:`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update user notes',
          details: error.message,
          requestId
        }
      });
    }
  });

  return router;
}

module.exports = { createAdminApi };
