/**
 * DepositConfirmationService
 * 
 * Handles on-chain confirmation of deposits, credit calculation, and gas cost estimation.
 * Processes groups of deposits for the same user-token pair atomically.
 */
const { ethers } = require('ethers');
const { getCustodyKey, splitCustodyAmount } = require('../contractUtils');
const tokenDecimalService = require('../../tokenDecimalService');
const { getFundingRate } = require('../tokenConfig');
const { getGroupKey, acquireGroupLock } = require('./groupLockUtils');
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const USD_TO_POINTS_CONVERSION_RATE = 0.000337;

// MS2 is our native token - we accept deposits regardless of gas profitability
// as long as they have some minimum value (platform strategic decision)
const MS2_TOKEN_ADDRESS = '0x98ed411b8cf8536657c660db8aa55d9d4baaf820';
const MS2_MINIMUM_VALUE_USD = 0.02; // Accept MS2 deposits worth at least 2 cents

class DepositConfirmationService {
  constructor(
    ethereumService,
    creditLedgerDb,
    priceFeedService,
    tokenRiskEngine,
    internalApiClient,
    depositNotificationService,
    eventDeduplicationService,
    contractConfig,
    spellPaymentService,
    adminActivityService,
    logger
  ) {
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.priceFeedService = priceFeedService;
    this.tokenRiskEngine = tokenRiskEngine;
    this.internalApiClient = internalApiClient;
    this.depositNotificationService = depositNotificationService;
    this.eventDeduplicationService = eventDeduplicationService;
    this.contractConfig = contractConfig;
    this.spellPaymentService = spellPaymentService;
    this.adminActivityService = adminActivityService;
    this.logger = logger || console;
  }

  /**
   * Confirms a group of deposits for a unique user-token pair.
   * Reads the total unconfirmed balance from the contract and confirms it in a single transaction.
   * @param {Array<object>} deposits - An array of ledger entry documents for the same user and token
   * @returns {Promise<void>}
   */
  async confirmDepositGroup(deposits) {
    // All deposits in this group share the same user and token.
    const { depositor_address: user, token_address: token } = deposits[0];
    let masterAccountId = null;
    const originalTxHashes = deposits.map(d => d.deposit_tx_hash);
    const groupKey = getGroupKey(user, token);

    // --- Atomic group-level processing lock (prevents race conditions) ---
    const releaseLock = await acquireGroupLock(groupKey);
    
    try {
      // --- Debounce duplicate confirmation for this group (moved inside lock) ---
      let allInCache = originalTxHashes.every(txHash => 
        this.eventDeduplicationService ? this.eventDeduplicationService.isDuplicate(txHash) : false
      );
      if (allInCache) {
        this.logger.debug(`[DepositConfirmationService] Skipping confirmation for group (User: ${user}, Token: ${token}) because all txs are recently processed.`);
        return;
      }

      this.logger.debug(`[DepositConfirmationService] Processing group (User: ${user}, Token: ${token}). Involves ${deposits.length} deposits.`);
      this.logger.debug(`[DepositConfirmationService] Original deposit hashes in this group: ${originalTxHashes.join(', ')}`);

      // 0. READ `custody` state from contract to get the true total unconfirmed balance.
      this.logger.debug(`[DepositConfirmationService] Step 0: Reading unconfirmed balance from contract 'custody' state...`);
      const custodyKey = getCustodyKey(user, token);
      let custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
      let { userOwned: amount } = splitCustodyAmount(custodyValue);

      if (amount === 0n) {
        this.logger.warn(`[DepositConfirmationService] Contract reports 0 unconfirmed balance for this group. These deposits may have been confirmed in a previous run. Marking as stale.`);
        for (const deposit of deposits) {
          await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'CONFIRMED', { 
            failure_reason: 'Stale pending entry; contract unconfirmed balance was zero upon processing.' 
          });
          if (this.eventDeduplicationService) {
            this.eventDeduplicationService.markProcessed(deposit.deposit_tx_hash);
          }
        }
        return;
      }
      this.logger.debug(`[DepositConfirmationService] Contract reports a total unconfirmed balance of ${tokenDecimalService.formatTokenAmount(amount, token)} ${tokenDecimalService.getTokenMetadata(token).symbol} for this group.`);

      // 1. USER ACCOUNT VERIFICATION / CREATION
      this.logger.debug(`[DepositConfirmationService] Step 1: Ensuring user account exists for depositor ${user}...`);
      masterAccountId = await this.verifyUserAccount(user);
      if (!masterAccountId) {
        return; // Error already logged and deposits marked
      }

      // 2. DYNAMIC FUNDING RATE & RISK ASSESSMENT
      this.logger.debug(`[DepositConfirmationService] Step 2: Applying dynamic funding rate for token ${token}...`);
      const chainId = String(this.ethereumService.chainId || '1');
      const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount, chainId);
      if (!riskAssessment.isSafe) {
        for (const deposit of deposits) {
          await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'FAILED_RISK_ASSESSMENT', { 
            failure_reason: riskAssessment.reason 
          });
        }
        this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'failed', { 
          reason: riskAssessment.reason, 
          originalTxHashes 
        });
        return;
      }
      let priceInUsd = riskAssessment.price;
      
      // Validate price feed availability
      if (!priceInUsd || priceInUsd <= 0) {
        const reason = { failure_reason: 'Price feed unavailable for token' };
        this.logger.error(`[DepositConfirmationService] Price feed unavailable for token ${token}. Cannot process deposits.`);
        for (const deposit of deposits) {
          await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR', reason);
        }
        this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'failed', { 
          reason: reason.failure_reason, 
          originalTxHashes 
        });
        return;
      }
      
      const fundingRate = getFundingRate(token);
      let grossDepositUsd = tokenDecimalService.calculateUsdValue(amount, token, priceInUsd);
      let adjustedGrossDepositUsd = grossDepositUsd * fundingRate;
      this.logger.debug(`[DepositConfirmationService] Original Value: $${grossDepositUsd.toFixed(2)}, Rate: ${fundingRate}, Adjusted Value: $${adjustedGrossDepositUsd.toFixed(2)}.`);

      // 3. COLLATERAL & PROFITABILITY CHECKS
      this.logger.debug(`[DepositConfirmationService] Step 3: Assessing collateral and profitability for the total amount...`);
      const depositValueUsd = adjustedGrossDepositUsd;
      const { vault_account: vaultAccount } = deposits[0];

      // --- REFERRAL LOGIC ---
      let referralRewardUsd = 0;
      let referrerMasterAccountId = null;
      const isDefaultVault = vaultAccount.toLowerCase() === this.contractConfig.address.toLowerCase();

      if (!isDefaultVault) {
        this.logger.debug(`[DepositConfirmationService] Deposit made to a non-default vault: ${vaultAccount}. Checking for referral info...`);
        const referralVault = await this.creditLedgerDb.findReferralVaultByAddress(vaultAccount);
        if (referralVault && referralVault.master_account_id) {
          referrerMasterAccountId = referralVault.master_account_id.toString();
          // 5% reward of the total gross deposit value
          referralRewardUsd = grossDepositUsd * 0.05; 
          this.logger.info(`[DepositConfirmationService] Referral vault found for owner ${referrerMasterAccountId}. Calculated reward: $${referralRewardUsd.toFixed(4)} from gross value.`);
        } else {
          this.logger.warn(`[DepositConfirmationService] A non-default vault was used (${vaultAccount}), but no matching referral account was found.`);
        }
      }
      // --- END REFERRAL LOGIC ---
      
      const fundAddress = vaultAccount;
      const estimatedGasCostUsd = await this.estimateGasCost(amount, token, fundAddress, user);
      
      // MS2 is our native token - bypass profitability check if deposit has minimum value
      const isMS2Deposit = token.toLowerCase() === MS2_TOKEN_ADDRESS;
      const bypassProfitabilityCheck = isMS2Deposit && grossDepositUsd >= MS2_MINIMUM_VALUE_USD;

      if (bypassProfitabilityCheck) {
        this.logger.debug(`[DepositConfirmationService] MS2 native token deposit ($${grossDepositUsd.toFixed(4)}) - bypassing profitability check (gas: $${estimatedGasCostUsd.toFixed(4)})`);
      }

      if (estimatedGasCostUsd >= depositValueUsd && !bypassProfitabilityCheck) {
        const reason = {
          deposit_value_usd: depositValueUsd,
          failure_reason: `Estimated gas cost ($${estimatedGasCostUsd.toFixed(4)}) exceeded total unconfirmed deposit value ($${depositValueUsd.toFixed(2)}).`
        };
        for (const deposit of deposits) {
          await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
        }
        this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'failed', {
          reason: reason.failure_reason,
          originalTxHashes
        });
        return;
      }

      // 4. EXECUTE ON-CHAIN CONFIRMATION
      let gasFeeInWei;
      let escrowAmountForContract;

      if (bypassProfitabilityCheck) {
        // MS2 native token: platform absorbs gas cost, no deduction from deposit
        gasFeeInWei = 0n;
        escrowAmountForContract = amount;
        this.logger.debug(`[DepositConfirmationService] MS2 bypass: platform absorbing gas cost, full amount goes to escrow.`);
      } else {
        const estimatedGasCostEth = estimatedGasCostUsd / priceInUsd;
        gasFeeInWei = ethers.parseEther(estimatedGasCostEth.toFixed(18));
        escrowAmountForContract = amount - gasFeeInWei;

        if (escrowAmountForContract < 0n) {
          const reason = {
            deposit_value_usd: depositValueUsd,
            failure_reason: `Total fees (gas) exceeded total deposit value.`
          };
          for (const deposit of deposits) {
            await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
          }
          this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'failed', {
            reason: reason.failure_reason,
            originalTxHashes
          });
          return;
        }
      }

      // Re-verify custody balance before confirmation to prevent race conditions
      custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
      const { userOwned: amountRecheck } = splitCustodyAmount(custodyValue);
      
      if (amountRecheck !== amount) {
        this.logger.warn(`[DepositConfirmationService] Balance changed between read and confirmation. Original: ${amount.toString()}, Current: ${amountRecheck.toString()}. Recalculating...`);
        amount = amountRecheck;
        grossDepositUsd = tokenDecimalService.calculateUsdValue(amount, token, priceInUsd);
        adjustedGrossDepositUsd = grossDepositUsd * fundingRate;

        if (bypassProfitabilityCheck) {
          // MS2 native token: platform absorbs gas cost
          escrowAmountForContract = amount;
          gasFeeInWei = 0n;
        } else {
          const newEstimatedGasCostEth = estimatedGasCostUsd / priceInUsd;
          const newGasFeeInWei = ethers.parseEther(newEstimatedGasCostEth.toFixed(18));
          const newEscrowAmountForContract = amount - newGasFeeInWei;

          if (newEscrowAmountForContract < 0n) {
            const reason = { failure_reason: `Balance changed and new balance is insufficient after gas fees.` };
            for (const deposit of deposits) {
              await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
            }
            this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'failed', {
              reason: reason.failure_reason,
              originalTxHashes
            });
            return;
          }

          escrowAmountForContract = newEscrowAmountForContract;
          gasFeeInWei = newGasFeeInWei;
        }
      }
      
      this.logger.debug(`[DepositConfirmationService] Step 4: Sending on-chain confirmation for user ${user}. Total Net Escrow: ${parseFloat(tokenDecimalService.formatTokenAmount(escrowAmountForContract, token)).toFixed(6)} ${tokenDecimalService.getTokenMetadata(token).symbol}, Total Fee: ${parseFloat(tokenDecimalService.formatTokenAmount(gasFeeInWei, token)).toFixed(6)} ${tokenDecimalService.getTokenMetadata(token).symbol}`);
      
      const confirmationResult = await this.executeOnChainConfirmation(
        fundAddress,
        user,
        token,
        escrowAmountForContract,
        gasFeeInWei,
        masterAccountId,
        originalTxHashes
      );

      if (!confirmationResult.success) {
        return; // Error already handled
      }

      const { confirmationTxHash, confirmationReceipt } = confirmationResult;

      // 5. OFF-CHAIN CREDIT APPLICATION
      const actualGasCostEth = confirmationReceipt.gasUsed * (confirmationReceipt.gasPrice || confirmationReceipt.effectiveGasPrice);
      const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
      const actualGasCostUsd = parseFloat(tokenDecimalService.formatTokenAmount(actualGasCostEth, NATIVE_ETH_ADDRESS)) * ethPriceInUsd;
      const netAdjustedDepositUsd = adjustedGrossDepositUsd - actualGasCostUsd;
      
      if (netAdjustedDepositUsd < 0 && !bypassProfitabilityCheck) {
        this.logger.warn(`[DepositConfirmationService] Adjusted deposit value for group is negative after gas costs. Rejecting as unprofitable. Net adjusted value: ${netAdjustedDepositUsd}`);
        const reason = {
          failure_reason: `Adjusted deposit value was less than gas cost.`,
          original_deposit_usd: depositValueUsd,
          adjusted_deposit_usd: adjustedGrossDepositUsd,
          gas_cost_usd: actualGasCostUsd
        };
        for (const deposit of deposits) {
          await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'REJECTED_UNPROFITABLE', reason);
        }
        this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'failed', {
          reason: reason.failure_reason,
          originalTxHashes
        });
        return;
      }

      // For MS2 bypassed deposits with negative net value, credit minimum points
      if (netAdjustedDepositUsd < 0 && bypassProfitabilityCheck) {
        this.logger.debug(`[DepositConfirmationService] MS2 native token deposit has negative net value ($${netAdjustedDepositUsd.toFixed(4)}) but proceeding with minimum credit.`);
      }
      
      // For MS2 bypassed deposits with negative net, credit based on gross value minus a nominal fee
      // This ensures MS2 depositors always get something for their native token deposits
      let userCreditedUsd;
      if (bypassProfitabilityCheck && netAdjustedDepositUsd < 0) {
        // Credit at least 50% of gross deposit value for MS2 when gas exceeds deposit
        userCreditedUsd = Math.max(grossDepositUsd * 0.5, 0.01);
        this.logger.debug(`[DepositConfirmationService] MS2 bypass: crediting $${userCreditedUsd.toFixed(4)} (50% of gross) instead of negative net value.`);
      } else {
        userCreditedUsd = Math.max(netAdjustedDepositUsd, 0);
      }

      const platformCutUsd = grossDepositUsd * (1 - fundingRate);
      const finalReferralPayoutUsd = Math.min(platformCutUsd, referralRewardUsd);
      const netProtocolProfitUsd = platformCutUsd - finalReferralPayoutUsd;

      this.logger.debug(`[DepositConfirmationService] Step 5: Applying credit to user's off-chain account. Adj. Gross: $${adjustedGrossDepositUsd.toFixed(2)}, Gas: $${actualGasCostUsd.toFixed(2)}, Adj. Net: $${netAdjustedDepositUsd.toFixed(2)}, User Credit: $${userCreditedUsd.toFixed(2)}.`);
      this.logger.debug(`[DepositConfirmationService] Accounting Details -> Platform Cut: $${platformCutUsd.toFixed(4)}, Referral Payout: $${finalReferralPayoutUsd.toFixed(4)}, Net Protocol Profit: $${netProtocolProfitUsd.toFixed(4)}`);

      const points_credited = Math.floor(userCreditedUsd / USD_TO_POINTS_CONVERSION_RATE);
      const points_remaining = points_credited;

      this.logger.debug(`[DepositConfirmationService] Point Calculation -> User Credited USD: $${userCreditedUsd.toFixed(2)}, Points Credited: ${points_credited}`);
      
      // Process Referral Payout
      if (referrerMasterAccountId && finalReferralPayoutUsd > 0) {
        await this.processReferralPayout(
          referrerMasterAccountId,
          finalReferralPayoutUsd,
          vaultAccount,
          user,
          confirmationTxHash,
          fundingRate,
          depositValueUsd,
          adjustedGrossDepositUsd,
          amount,
          grossDepositUsd
        );
      }
      
      // 6. FINAL LEDGER UPDATE
      this.logger.debug(`[DepositConfirmationService] Step 6: Finalizing ${deposits.length} ledger entries for group.`);
      const finalStatus = {
        master_account_id: masterAccountId,
        deposit_type: 'TOKEN',
        gross_deposit_usd: depositValueUsd,
        funding_rate_applied: fundingRate,
        adjusted_gross_deposit_usd: adjustedGrossDepositUsd,
        gas_cost_usd: actualGasCostUsd,
        net_adjusted_deposit_usd: netAdjustedDepositUsd,
        user_credited_usd: userCreditedUsd,
        points_credited,
        points_remaining,
        referral_payout_usd: finalReferralPayoutUsd,
        net_protocol_profit_usd: netProtocolProfitUsd,
        referrer_master_account_id: referrerMasterAccountId,
        confirmation_tx_hash: confirmationTxHash,
      };

      for (const deposit of deposits) {
        await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'CONFIRMED', finalStatus);
        if (this.eventDeduplicationService) {
          this.eventDeduplicationService.markProcessed(deposit.deposit_tx_hash);
        }
      }

      this.logger.info(`[DepositConfirmationService] Successfully processed deposit group for user ${user} and token ${token}`);

      // Spell Payment Tracking
      await this.handleSpellPaymentTracking(confirmationTxHash, originalTxHashes, user, amount);

      // WebSocket Notification
      this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'confirmed', { 
        ...finalStatus, 
        originalTxHashes 
      });

      // Admin Activity Notification
      if (this.adminActivityService) {
        this.adminActivityService.emitDeposit({
          masterAccountId,
          depositorAddress: user,
          tokenAddress: token,
          amount: amount.toString(),
          points: points_credited,
          txHash: confirmationTxHash,
          chainId: '1'
        });
      }

    } catch (error) {
      const errorMessage = error.message || 'An unknown error occurred';
      this.logger.error(`[DepositConfirmationService] Unhandled error during confirmation for group (User: ${user}, Token: ${token}).`, error);

      const reason = { 
        failure_reason: 'An unexpected error occurred during group processing.', 
        error_details: errorMessage, 
        error_stack: error.stack 
      };
      for (const deposit of deposits) {
        await this.creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR', reason);
        if (this.eventDeduplicationService) {
          this.eventDeduplicationService.markProcessed(deposit.deposit_tx_hash);
        }
      }
      // Send failure notification if we know who the user is
      const fallbackMasterAccountId = masterAccountId || await this.verifyUserAccount(user);
      if (fallbackMasterAccountId) {
        this.depositNotificationService.notifyDepositUpdate(fallbackMasterAccountId, 'failed', { 
          reason: errorMessage, 
          originalTxHashes 
        });
      }
    } finally {
      releaseLock();
    }
  }

  /**
   * Verifies user account exists, creating it if necessary.
   * @param {string} user - The user address
   * @returns {Promise<string|null>} The master account ID, or null if failed
   */
  async verifyUserAccount(user) {
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${user}`);
      return response.data.masterAccountId;
    } catch (lookupErr) {
      if (lookupErr.response && lookupErr.response.status === 404) {
        // Attempt autocreation
        this.logger.warn(`[DepositConfirmationService] No user account found for ${user}. Attempting auto-create via find-or-create-by-wallet...`);
        try {
          const createResp = await this.internalApiClient.post(`/internal/v1/auth/find-or-create-by-wallet`, { address: user });
          return createResp.data.masterAccountId;
        } catch (createErr) {
          this.logger.error(`[DepositConfirmationService] Failed to auto-create user for wallet ${user}.`, createErr);
          return null;
        }
      } else {
        this.logger.error(`[DepositConfirmationService] Error looking up user.`, lookupErr);
        return null;
      }
    }
  }

  /**
   * Estimates gas cost for a deposit confirmation transaction.
   * @param {bigint} amount - The deposit amount
   * @param {string} token - The token address
   * @param {string} fundAddress - The fund/vault address
   * @param {string} user - The user address
   * @returns {Promise<number>} Estimated gas cost in USD
   */
  async estimateGasCost(amount, token, fundAddress, user) {
    return await this.ethereumService.estimateGasCostInUsd(
      this.contractConfig.address,
      this.contractConfig.abi,
      'commit',
      fundAddress,
      user,
      token,
      amount,
      0,
      '0x'
    );
  }

  /**
   * Calculates credit amount based on deposit amount, token, and funding rate.
   * @param {bigint} amount - The deposit amount in wei
   * @param {string} token - The token address
   * @param {number} fundingRate - The funding rate to apply
   * @returns {Promise<number>} The credit amount in USD
   */
  async calculateCredit(amount, token, fundingRate) {
    const chainId = String(this.ethereumService.chainId || '1');
    const riskAssessment = await this.tokenRiskEngine.assessCollateral(token, amount, chainId);
    if (!riskAssessment.isSafe) {
      throw new Error(`Risk assessment failed: ${riskAssessment.reason}`);
    }
    const priceInUsd = riskAssessment.price;
    const grossDepositUsd = tokenDecimalService.calculateUsdValue(amount, token, priceInUsd);
    return grossDepositUsd * fundingRate;
  }

  /**
   * Executes the on-chain confirmation transaction.
   * @param {string} fundAddress - The fund/vault address
   * @param {string} user - The user address
   * @param {string} token - The token address
   * @param {bigint} escrowAmount - The escrow amount
   * @param {bigint} gasFee - The gas fee
   * @param {string} masterAccountId - The master account ID
   * @param {Array<string>} originalTxHashes - The original transaction hashes
   * @returns {Promise<{success: boolean, confirmationTxHash?: string, confirmationReceipt?: object}>}
   */
  async executeOnChainConfirmation(fundAddress, user, token, escrowAmount, gasFee, masterAccountId, originalTxHashes) {
    const txResponse = await this.ethereumService.write(
      this.contractConfig.address,
      this.contractConfig.abi,
      'commit',
      fundAddress,
      user,
      token,
      escrowAmount,
      gasFee,
      '0x'
    );
    this.logger.debug(`[DepositConfirmationService] Transaction sent. On-chain hash: ${txResponse.hash}. Waiting for confirmation...`);

    // Send transaction status updates
    this.depositNotificationService.notifyTransactionStatus(masterAccountId, txResponse.hash, 'submitted', {
      originalTxHashes,
      message: 'Transaction submitted to blockchain, waiting for confirmation...'
    });

    this.depositNotificationService.notifyTransactionStatus(masterAccountId, txResponse.hash, 'pending', {
      originalTxHashes,
      message: 'Transaction is pending in mempool...'
    });

    const confirmingTimeout = setTimeout(() => {
      this.depositNotificationService.notifyTransactionStatus(masterAccountId, txResponse.hash, 'confirming', {
        originalTxHashes,
        message: 'Transaction is being confirmed...'
      });
    }, 2000);

    let confirmationReceipt;
    try {
      confirmationReceipt = await this.ethereumService.waitForConfirmation(txResponse);
      clearTimeout(confirmingTimeout);
    } catch (error) {
      clearTimeout(confirmingTimeout);
      this.logger.error(`[DepositConfirmationService] Error waiting for transaction confirmation: ${txResponse.hash}`, error);
      const reason = { failure_reason: error.message || 'Transaction confirmation failed or timed out.' };
      // Note: deposits array not available here, caller should handle
      this.depositNotificationService.notifyTransactionStatus(masterAccountId, txResponse.hash, 'failed', {
        originalTxHashes,
        error: reason.failure_reason,
        message: 'Transaction failed during confirmation'
      });
      return { success: false };
    }

    if (!confirmationReceipt || !confirmationReceipt.hash) {
      this.logger.error(`[DepositConfirmationService] CRITICAL: Failed to receive a valid receipt for group confirmation. Manual verification required for user: ${user}`);
      const reason = { failure_reason: 'Transaction sent but an invalid receipt was returned by the provider.' };
      this.depositNotificationService.notifyTransactionStatus(masterAccountId, txResponse.hash, 'failed', {
        originalTxHashes,
        error: reason.failure_reason,
        message: 'Transaction failed: Invalid receipt received'
      });
      return { success: false };
    }

    const confirmationTxHash = confirmationReceipt.hash;
    this.logger.info(`[DepositConfirmationService] On-chain group confirmation successful. Tx: ${confirmationTxHash}`);

    this.depositNotificationService.notifyTransactionStatus(masterAccountId, confirmationTxHash, 'confirmed', {
      originalTxHashes,
      receipt: {
        blockNumber: confirmationReceipt.blockNumber,
        gasUsed: confirmationReceipt.gasUsed.toString(),
        status: confirmationReceipt.status
      },
      message: 'Transaction confirmed successfully!'
    });

    return { success: true, confirmationTxHash, confirmationReceipt };
  }

  /**
   * Processes referral payout.
   * @private
   */
  async processReferralPayout(
    referrerMasterAccountId,
    finalReferralPayoutUsd,
    vaultAccount,
    user,
    confirmationTxHash,
    fundingRate,
    depositValueUsd,
    adjustedGrossDepositUsd,
    amount,
    grossDepositUsd
  ) {
    try {
      this.logger.info(`[DepositConfirmationService] Crediting referrer ${referrerMasterAccountId} with $${finalReferralPayoutUsd.toFixed(4)}.`);
      await this.internalApiClient.post(`/internal/v1/data/users/${referrerMasterAccountId}/economy/credit`, {
        amountUsd: finalReferralPayoutUsd,
        transactionType: 'REFERRAL_DEPOSIT_REWARD',
        description: `Referral reward from deposit by user ${user} to vault ${vaultAccount}.`,
        externalTransactionId: confirmationTxHash,
        metadata: {
          funding_rate: fundingRate,
          original_deposit_usd: depositValueUsd,
          adjusted_deposit_usd: adjustedGrossDepositUsd
        }
      });

      const depositAmountWei = amount.toString();
      const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
      if (!ethPriceInUsd || ethPriceInUsd <= 0) {
        throw new Error('Failed to fetch ETH price for referral reward conversion');
      }
      const rewardInEth = finalReferralPayoutUsd / ethPriceInUsd;
      const rewardInWei = ethers.parseEther(rewardInEth.toFixed(18)).toString();
      await this.creditLedgerDb.updateReferralVaultStats(vaultAccount, depositAmountWei, rewardInWei);
      this.logger.info(`[DepositConfirmationService] Successfully credited referrer and updated vault stats for ${vaultAccount}.`);
    } catch (error) {
      this.logger.error(`[DepositConfirmationService] CRITICAL: Failed to credit referral reward for vault ${vaultAccount} and referrer ${referrerMasterAccountId}. Requires manual intervention.`, error);
    }
  }

  /**
   * Handles spell payment tracking if applicable.
   * @private
   */
  async handleSpellPaymentTracking(confirmationTxHash, originalTxHashes, user, amount) {
    if (!this.spellPaymentService) return;

    try {
      let tracking = this.spellPaymentService.getPaymentTrackingByTxHash(confirmationTxHash);
      if (tracking) {
        this.logger.debug(`[DepositConfirmationService] Detected spell payment for transaction ${confirmationTxHash}`);
        await this.spellPaymentService.handleSpellPaymentEvent(
          null,
          { args: { user, amount, transactionHash: confirmationTxHash } },
          tracking.spellPaymentId
        );
      } else {
        for (const txHash of originalTxHashes) {
          tracking = this.spellPaymentService.getPaymentTrackingByTxHash(txHash);
          if (tracking) {
            this.logger.debug(`[DepositConfirmationService] Detected spell payment for original transaction ${txHash}`);
            await this.spellPaymentService.handleSpellPaymentEvent(
              null,
              { args: { user, amount, transactionHash: confirmationTxHash } },
              tracking.spellPaymentId
            );
            break;
          }
        }
      }
    } catch (error) {
      this.logger.error(`[DepositConfirmationService] Error handling spell payment tracking:`, error);
    }
  }
}

module.exports = DepositConfirmationService;
