/**
 * ReferralVaultService
 * 
 * Handles referral vault creation, deployment, and finalization.
 * Manages the lifecycle of referral vaults from creation to active deployment.
 */
const { ethers } = require('ethers');
const { getGroupKey, acquireGroupLock } = require('./groupLockUtils');

class ReferralVaultService {
  constructor(
    ethereumService,
    creditLedgerDb,
    saltMiningService,
    internalApiClient,
    depositNotificationService,
    contractConfig,
    logger
  ) {
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.saltMiningService = saltMiningService;
    this.internalApiClient = internalApiClient;
    this.depositNotificationService = depositNotificationService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Creates a new referral vault account for a user with a vanity address starting with 0x1152
   * @param {string} ownerAddress - The address that will own the vault
   * @returns {Promise<{vaultAddress: string, salt: string}>}
   */
  async createVault(ownerAddress) {
    this.logger.debug(`[ReferralVaultService] Creating referral vault for owner ${ownerAddress}`);

    // SECURITY: Acquire lock to prevent concurrent vault creation for same user
    const vaultKey = `vault-creation-${ownerAddress.toLowerCase()}`;
    const releaseLock = await acquireGroupLock(vaultKey);
    
    try {
      // 1. Verify user account and wallet ownership
      let masterAccountId;
      try {
        const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${ownerAddress}`);
        masterAccountId = response.data.masterAccountId;
        this.logger.debug(`[ReferralVaultService] Found user account ${masterAccountId} for wallet ${ownerAddress}`);
      } catch (error) {
        if (error.response?.status === 404) {
          throw new Error('No user account found for this wallet address. The wallet must be linked to a user account first.');
        }
        throw error;
      }

      // 2. Check if user already has vaults (limit removed: users can create unlimited vaults)
      const vaultsResponse = await this.internalApiClient.get(`/internal/v1/data/ledger/vaults/by-master-account/${masterAccountId}`);
      const existingVaults = vaultsResponse.data.vaults;

      // 3. Get a pre-mined salt that will generate a vanity address
      const { salt, predictedAddress } = await this.saltMiningService.getSalt(ownerAddress);
      this.logger.debug(`[ReferralVaultService] Found valid salt for vanity address ${predictedAddress}`);

      // 4. Create the vault account using the mined salt
      const txResponse = await this.ethereumService.write(
        this.contractConfig.address,
        this.contractConfig.abi,
        'charterFund',
        ownerAddress,
        salt
      );

      const receipt = await this.ethereumService.waitForConfirmation(txResponse);
      if (!receipt || !receipt.hash) {
        throw new Error('Failed to get valid receipt for vault creation');
      }

      // 5. Verify the created vault address matches our prediction
      const logs = receipt.logs.filter(log => {
        try {
          const parsedLog = this.ethereumService.decodeEventLog(
            'FundChartered',
            log.data,
            log.topics,
            this.contractConfig.abi
          );
          return parsedLog.accountAddress === predictedAddress;
        } catch {
          return false;
        }
      });

      if (logs.length === 0) {
        throw new Error('Vault creation transaction succeeded but no matching FundChartered event found');
      }

      const vaultAddress = predictedAddress;
      
      // 6. Record the vault through internal API
      await this.internalApiClient.post('/internal/v1/data/ledger/vaults', {
        vault_address: vaultAddress,
        owner_address: ownerAddress,
        master_account_id: masterAccountId,
        creation_tx_hash: receipt.hash,
        salt: ethers.hexlify(salt)
      });
      
      this.logger.info(`[ReferralVaultService] Successfully created referral vault at ${vaultAddress} for user ${masterAccountId}`);
      
      return {
        vaultAddress,
        salt: ethers.hexlify(salt)
      };

    } catch (error) {
      this.logger.error(`[ReferralVaultService] Failed to create referral vault for ${ownerAddress}:`, error);
      throw error;
    } finally {
      releaseLock();
    }
  }

  /**
   * Deploys a new referral vault, records it, and returns the vault data.
   * @param {object} details - The details for deployment
   * @param {ObjectId} details.masterAccountId
   * @param {string} details.ownerAddress
   * @param {string} details.vaultName
   * @param {string} details.salt
   * @param {string} details.predictedAddress
   * @returns {Promise<Object>} The newly created vault document
   */
  async deployVault(details) {
    this.logger.debug('[ReferralVaultService] Initiating on-chain referral vault deployment with details:', { details });
    const { masterAccountId, ownerAddress, vaultName, salt, predictedAddress } = details;

    try {
      // DEBUG: Log the actual signer address being used
      const signerAddress = this.ethereumService.getSigner().address;
      this.logger.debug('[ReferralVaultService] EthereumService signer address:', signerAddress);
      
      this.logger.debug('[ReferralVaultService] Sending transaction to ethereumService.write with params:', {
        contractAddress: this.contractConfig.address,
        functionName: 'charterFund',
        ownerAddress,
        salt,
        signerAddress
      });

      // --- PREFLIGHT STATIC CALL ---------------------------------------------------------
      // Perform a callStatic to detect custom reverts (e.g. Vanity) before we spend gas.
      try {
        const foundationContract = this.ethereumService.getContract(
          this.contractConfig.address,
          this.contractConfig.abi,
          true // Use signer for static call to simulate marshal authorization
        );

        // 1. Verify on-chain predicted address matches our local prediction
        const onChainPredicted = await foundationContract.computeCharterAddress.staticCall(ownerAddress, salt);
        if (onChainPredicted.toLowerCase() !== predictedAddress.toLowerCase()) {
          this.logger.error('[ReferralVaultService] computeCharterAddress mismatch', { onChainPredicted, predictedAddress });
          throw new Error('PREDICTION_MISMATCH');
        }

        // 2. Run charterFund as a static call to catch custom reverts (Vanity, etc.)
        await foundationContract.charterFund.staticCall(ownerAddress, salt);
      } catch (staticErr) {
        // Attempt to decode the custom error name using the contract Interface.
        let decodedErrorName = 'UnknownError';
        try {
          const iface = new ethers.Interface(this.contractConfig.abi);
          const parsed = iface.parseError(staticErr.data || staticErr.error?.data || staticErr);
          decodedErrorName = parsed?.name || decodedErrorName;
        } catch (_) {/* fallthrough */}

        this.logger.error('[ReferralVaultService] Preflight charterFund call reverted:', { decodedErrorName, message: staticErr.message });

        // Map known custom errors to application-level codes.
        if (decodedErrorName === 'Vanity') {
          throw new Error('VANITY_PREFIX_MISMATCH');
        }
        if (decodedErrorName === 'UnauthorizedCallContext') {
          throw new Error('UNAUTHORIZED_CALL');
        }
        // Otherwise rethrow the original error
        throw staticErr;
      }

      // --- END PREFLIGHT -----------------------------------------------------------------

      // 1. Send the transaction via the operator wallet using the 'write' method
      const txResponse = await this.ethereumService.write(
        this.contractConfig.address,
        this.contractConfig.abi,
        'charterFund',
        ownerAddress,
        salt
      );

      this.logger.debug(`[ReferralVaultService] Vault deployment transaction sent. Hash: ${txResponse.hash}`, {
        txHash: txResponse.hash,
        owner: ownerAddress,
        predictedAddress: predictedAddress,
      });

      // 3. Create the initial database record with a 'PENDING_DEPLOYMENT' status
      const newVaultData = {
        master_account_id: masterAccountId,
        vault_name: vaultName,
        owner_address: ownerAddress,
        vault_address: predictedAddress, // We store the predicted address
        salt: salt,
        deployment_tx_hash: txResponse.hash,
        created_at: new Date(),
        status: 'PENDING_DEPLOYMENT',
      };

      const savedVault = await this.creditLedgerDb.createReferralVault(newVaultData);

      this.logger.debug('[ReferralVaultService] Vault record created with pending status.', { savedVault });

      // We don't wait for confirmation here. A separate process will listen for the
      // `VaultCreated` event and update the status to 'ACTIVE'.
      return savedVault;

    } catch (error) {
      this.logger.error(`[ReferralVaultService] On-chain vault deployment failed for owner ${ownerAddress}.`, {
        error: error.message,
        stack: error.stack,
      });
      this.logger.error('[ReferralVaultService] Error during vault deployment transaction:', { 
        errorMessage: error.message,
        errorStack: error.stack,
        details 
      });
      throw new Error('Failed to send vault deployment transaction.');
    }
  }

  /**
   * Finalizes a vault deployment after the on-chain transaction is confirmed.
   * @param {string} txHash - The deployment transaction hash
   * @param {string} vaultAddress - The actual address of the created vault from the event
   */
  async finalizeDeployment(txHash, vaultAddress) {
    this.logger.debug(`[ReferralVaultService] Finalizing vault deployment for tx: ${txHash}`);

    const vault = await this.creditLedgerDb.findReferralVaultByTxHash(txHash);

    if (!vault) {
      this.logger.error(`[ReferralVaultService] Could not find a pending vault for tx hash: ${txHash}. This may be a race condition or an orphan event.`);
      return;
    }

    if (vault.status === 'ACTIVE') {
      this.logger.warn(`[ReferralVaultService] Vault for tx ${txHash} is already active. Ignoring event.`);
      return;
    }

    // It's good practice to verify the address from the event matches the predicted one
    if (vault.vault_address.toLowerCase() !== vaultAddress.toLowerCase()) {
      this.logger.error(`[ReferralVaultService] Mismatch between predicted vault address (${vault.vault_address}) and on-chain address (${vaultAddress}) for tx ${txHash}. Manual review needed.`);
      await this.creditLedgerDb.updateReferralVaultStatus(vault._id, 'ADDRESS_MISMATCH');
      
      // WebSocket Notification
      if (this.depositNotificationService && this.depositNotificationService.webSocketService) {
        const sent = this.depositNotificationService.webSocketService.sendToUser(vault.master_account_id, {
          type: 'referralVaultUpdate',
          payload: {
            status: 'failed',
            reason: 'Address mismatch during deployment verification.',
            txHash: vault.deployment_tx_hash
          }
        });
        if (!sent) {
          this.logger.warn(`[ReferralVaultService] Failed to send referralVaultUpdate notification to user ${vault.master_account_id} - user may be offline`);
        }
      }
      return;
    }
    
    await this.creditLedgerDb.updateReferralVaultStatus(vault._id, 'ACTIVE');

    this.logger.info(`[ReferralVaultService] Successfully activated vault ${vaultAddress} (ID: ${vault._id})`);

    // WebSocket Notification
    if (this.depositNotificationService && this.depositNotificationService.webSocketService) {
      const sent = this.depositNotificationService.webSocketService.sendToUser(vault.master_account_id, {
        type: 'referralVaultUpdate',
        payload: {
          status: 'active',
          vaultAddress: vault.vault_address,
          vaultName: vault.vault_name,
          txHash: vault.deployment_tx_hash,
        }
      });
      if (sent) {
        this.logger.debug(`[ReferralVaultService] Sent referralVaultUpdate WebSocket notification to user ${vault.master_account_id}`);
      } else {
        this.logger.warn(`[ReferralVaultService] Failed to send referralVaultUpdate notification to user ${vault.master_account_id} - user may be offline`);
      }
    }
  }

  /**
   * Checks for vault deployments that have been pending for too long and marks them as failed.
   * @returns {Promise<void>}
   */
  async checkStaleDeployments() {
    try {
      const pendingVaults = await this.creditLedgerDb.findMany({
        type: 'REFERRAL_VAULT',
        status: 'PENDING_DEPLOYMENT'
      });
      if (!pendingVaults || pendingVaults.length === 0) {
        return;
      }

      const STALE_DEPLOYMENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
      const now = Date.now();
      let staleCount = 0;

      for (const vault of pendingVaults) {
        const createdAt = vault.created_at || vault.createdAt;
        if (!createdAt) {
          this.logger.warn(`[ReferralVaultService] Vault ${vault._id} has no created_at timestamp, skipping stale check`);
          continue;
        }

        const ageMs = now - new Date(createdAt).getTime();
        if (ageMs > STALE_DEPLOYMENT_TIMEOUT_MS) {
          await this.creditLedgerDb.updateReferralVaultStatus(vault._id, 'FAILED', {
            failure_reason: 'Deployment timed out after 30 minutes'
          });
          staleCount++;
        }
      }

      if (staleCount > 0) {
        this.logger.info(`[ReferralVaultService] Marked ${staleCount} stale vault deployments as failed`);
      }
    } catch (error) {
      this.logger.error('[ReferralVaultService] Error checking for stale vault deployments:', error);
    }
  }
}

module.exports = ReferralVaultService;

