const express = require('express');
const { createLogger } = require('../../utils/logger');
const contractUtils = require('../../core/services/alchemy/contractUtils');
const { ethers } = require('ethers');

const logger = createLogger('ReferralVaultApi');
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

function createReferralVaultApi(dependencies) {
  const { internalApiClient, longRunningApiClient, priceFeedService, creditServices = {}, ethereumServices = {}, creditService: legacyCredit, ethereumService: legacyEth } = dependencies;

  // Debug logging for dependencies
  logger.debug('[ReferralVaultApi] Dependencies check:', {
    internalApiClient: !!internalApiClient,
    longRunningApiClient: !!longRunningApiClient,
    priceFeedService: !!priceFeedService,
    creditServices: Object.keys(creditServices),
    ethereumServices: Object.keys(ethereumServices)
  });

  // Multichain service resolver
  const getChainServices = (cid = '1') => ({
    creditService: creditServices[cid] || legacyCredit,
    ethereumService: ethereumServices[cid] || legacyEth,
  });

  // Default to mainnet services
  const { creditService, ethereumService } = getChainServices('1');

  if (!internalApiClient) {
    throw new Error('[ReferralVaultApi] internalApiClient dependency missing');
  }
  const router = express.Router();
  // All contract config comes from creditService
  const contractConfig = creditService && creditService.contractConfig;

  // Debug log for missing dependencies
  logger.debug('[ReferralVaultApi] Dependency check:', {
    ethereumService: !!ethereumService,
    priceFeedService: !!priceFeedService,
    creditService: !!creditService,
    contractConfig: !!contractConfig,
    contractConfigAddress: contractConfig && contractConfig.address,
    contractConfigAbi: contractConfig && Array.isArray(contractConfig.abi) && contractConfig.abi.length
  });

  if (!ethereumService || !priceFeedService || !creditService || !contractConfig) {
    //throw new Error('ReferralVaultApi: Missing one or more required services or contract configuration. (creditService is the canonical source for contract config)');
    logger.debug('[ReferralVaultApi] Missing one or more required services or contract configuration. (creditService is the canonical source for contract config)');
  }

  // Endpoint to check if a vault name is available
  router.post('/check-name', async (req, res) => {
    const { name } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
    }
    if (!name || name.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Name must be at least 4 characters long and contain only letters, numbers, underscores, or dashes.' } });
    }

    try {
      // This internal endpoint will need to be created.
      const response = await internalApiClient.get(`/internal/v1/data/ledger/vaults/by-name/${name}`);
      // If the request succeeds, it means a vault was found.
      res.status(200).json({ isAvailable: false });
    } catch (error) {
      if (error.response && error.response.status === 404) {
        // 404 means the name was not found, so it's available.
        res.status(200).json({ isAvailable: true });
      } else {
        logger.error('[ReferralVaultApi] /check-name failed:', error);
        res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error checking name availability.' } });
      }
    }
  });

  // Endpoint to create a new referral vault
  router.post('/create', async (req, res) => {
    const { name } = req.body;
    const userId = req.user?.userId;

     if (!userId) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
    }
    if (!name || name.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Invalid name provided.' } });
    }
    
    try {
        // Check if longRunningApiClient is available
        if (!longRunningApiClient) {
            logger.error('[ReferralVaultApi] longRunningApiClient is not available in dependencies');
            return res.status(500).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Salt mining service is not available.' } });
        }

        logger.debug(`[ReferralVaultApi] Creating vault "${name}" for user ${userId} using long-running client`);
        
        // This internal endpoint will orchestrate the creation.
        // Use long-running client for salt mining operations which can take time
        const response = await longRunningApiClient.post(`/internal/v1/data/actions/create-referral-vault`, {
            masterAccountId: userId,
            vaultName: name
        });
        
        logger.debug(`[ReferralVaultApi] Successfully created vault "${name}" for user ${userId}`);
        // The internal endpoint will return the new vault details upon success.
        res.status(201).json(response.data);

    } catch(error) {
        // Log a clean, structured error instead of the massive Axios object
        logger.error('[ReferralVaultApi] /create call to internal API failed.', {
            status: error.response?.status,
            method: error.config?.method,
            url: error.config?.url,
            responseData: error.response?.data,
            errorMessage: error.message,
            errorCode: error.code
        });

        const errPayload = error.response?.data || { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create referral vault.' } };
        res.status(error.response?.status || 500).json(errPayload);
    }
  });

  // List the authenticated user's vaults
  router.get('/my-vaults', async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
    }

    try {
      const response = await internalApiClient.get(`/internal/v1/data/ledger/vaults/by-master-account/${userId}`);
      res.json({ vaults: response.data.vaults || [] });
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return res.json({ vaults: [] });
      }
      logger.error('[ReferralVaultApi] /my-vaults failed:', { status: error.response?.status, message: error.message });
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch vaults.' } });
    }
  });

  router.get('/:vaultAddress/dashboard', async (req, res) => {
    const { vaultAddress } = req.params;
    logger.debug(`[ReferralVaultApi] GET /:vaultAddress/dashboard for vault: ${vaultAddress}`);

    try {
      // 1. Get historical stats from the internal API
      const response = await internalApiClient.get(`/internal/v1/data/ledger/vaults/${vaultAddress}/stats`);
      const historicalStats = response.data.stats;

      // 2. Enrich with on-chain data and prices
      const enrichedStats = await Promise.all(
        historicalStats.map(async (stat) => {
          const { tokenAddress, totalDeposits, totalAdjustedGrossUsd } = stat;

          // a. Get token metadata
          let symbol = 'N/A', decimals = 18, iconUrl = null, name = '';
          if (tokenAddress.toLowerCase() === NATIVE_ETH_ADDRESS) {
            // Native ETH: hardcode metadata
            symbol = 'ETH';
            decimals = 18;
            name = 'Ethereum';
            iconUrl = null;
          } else {
            try {
              const meta = await priceFeedService.getMetadata(tokenAddress);
              symbol = meta.symbol;
              decimals = meta.decimals;
              name = meta.name;
              iconUrl = meta.logo || null;
            } catch (e) {
              logger.warn(`[ReferralVaultApi] Could not fetch metadata for token ${tokenAddress}`, e.message);
            }
          }

          // b. Get on-chain withdrawable balance (userOwned)
          let currentWithdrawable = '0';
          try {
            const custodyKey = contractUtils.getCustodyKey(vaultAddress, tokenAddress);
            const packedAmount = await ethereumService.read(contractConfig.address, contractConfig.abi, 'custody', custodyKey);
            const { userOwned } = contractUtils.splitCustodyAmount(packedAmount);
            currentWithdrawable = userOwned.toString();
          } catch (e) {
            logger.error(`[ReferralVaultApi] Could not fetch on-chain custody for ${tokenAddress} in vault ${vaultAddress}`, e);
          }

          // c. Get current price
          let price = 0;
          try {
            price = await priceFeedService.getPriceInUsd(tokenAddress);
          } catch (e) {
            logger.warn(`[ReferralVaultApi] Could not fetch price for token ${tokenAddress}`, e.message);
          }
          
          const toFloat = (val) => parseFloat(ethers.formatUnits(val, decimals));

          return {
            tokenAddress,
            symbol,
            decimals,
            iconUrl,
            name,
            totalDeposits,
            totalDepositsUsd: totalAdjustedGrossUsd,
            currentWithdrawable,
            currentWithdrawableUsd: toFloat(currentWithdrawable) * price,
          };
        })
      );

      res.json({
        vaultAddress,
        tokens: enrichedStats,
      });

    } catch (error) {
      logger.error(`[ReferralVaultApi] Failed to get dashboard data for vault ${vaultAddress}:`, error);
      if (error.response && error.response.status === 404) {
        return res.status(404).json({ error: { message: 'Vault not found or has no confirmed deposits.' } });
      }
      res.status(500).json({ error: { message: 'An internal error occurred while fetching vault data.' } });
    }
  });

  // Create a withdrawal request for a vault
  router.post('/:vaultAddress/withdraw', async (req, res) => {
    const userId = req.user?.userId;
    const { vaultAddress } = req.params;
    const { tokenAddress } = req.body;

    if (!userId) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
    }
    if (!tokenAddress) {
      return res.status(400).json({ error: { code: 'MISSING_TOKEN', message: 'tokenAddress is required.' } });
    }

    try {
      // Look up the vault to verify ownership
      const vaultRes = await internalApiClient.get(`/internal/v1/data/ledger/vaults/by-address/${vaultAddress}`);
      const vault = vaultRes.data;

      if (!vault || vault.master_account_id?.toString() !== userId.toString()) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this vault.' } });
      }

      // Get on-chain withdrawable balance
      let collateralAmountWei = '0';
      try {
        const custodyKey = contractUtils.getCustodyKey(vaultAddress, tokenAddress);
        const packedAmount = await ethereumService.read(contractConfig.address, contractConfig.abi, 'custody', custodyKey);
        const { userOwned } = contractUtils.splitCustodyAmount(packedAmount);
        collateralAmountWei = userOwned.toString();
      } catch (e) {
        logger.error(`[ReferralVaultApi] Could not read on-chain balance for withdraw:`, e);
        return res.status(500).json({ error: { code: 'CHAIN_READ_FAILED', message: 'Could not read on-chain balance.' } });
      }

      if (BigInt(collateralAmountWei) === 0n) {
        return res.status(400).json({ error: { code: 'ZERO_BALANCE', message: 'Nothing to withdraw for this token.' } });
      }

      // Create withdrawal request via internal ledger
      const requestId = `wr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const response = await internalApiClient.post('/internal/v1/data/ledger/withdrawals', {
        request_tx_hash: requestId,
        request_block_number: 0,
        vault_account: vaultAddress,
        user_address: vault.owner_address,
        token_address: tokenAddress,
        master_account_id: userId,
        collateral_amount_wei: collateralAmountWei,
      });

      res.status(201).json(response.data);
    } catch (error) {
      logger.error('[ReferralVaultApi] /withdraw failed:', { status: error.response?.status, message: error.message });
      const status = error.response?.status || 500;
      const errPayload = error.response?.data || { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create withdrawal request.' } };
      res.status(status).json(errPayload);
    }
  });

  return router;
}

module.exports = { createReferralVaultApi }; 