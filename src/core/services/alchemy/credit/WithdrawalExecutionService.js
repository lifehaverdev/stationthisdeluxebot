/**
 * WithdrawalExecutionService
 * 
 * Handles withdrawal execution, fee calculation, and admin withdrawal handling.
 * Executes withdrawals on-chain and updates ledger status.
 */
const { ethers } = require('ethers');
const tokenDecimalService = require('../../tokenDecimalService');
const { getGroupKey, acquireGroupLock } = require('./groupLockUtils');
const { getCustodyKey, splitCustodyAmount } = require('../contractUtils');
const { contracts: contractRegistry } = require('../../../contracts');
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

class WithdrawalExecutionService {
  constructor(
    ethereumService,
    creditLedgerDb,
    priceFeedService,
    tokenRiskEngine,
    adminOperationsService,
    adminActivityService,
    contractConfig,
    logger
  ) {
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.priceFeedService = priceFeedService;
    this.tokenRiskEngine = tokenRiskEngine;
    this.adminOperationsService = adminOperationsService;
    this.adminActivityService = adminActivityService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Executes a withdrawal request.
   * @param {string} requestTxHash - The withdrawal request transaction hash
   * @returns {Promise<void>}
   */
  async executeWithdrawal(requestTxHash) {
    this.logger.debug(`[WithdrawalExecutionService] Processing withdrawal request ${requestTxHash}`);

    const request = await this.creditLedgerDb.findWithdrawalRequestByTxHash(requestTxHash);
    if (!request) {
      throw new Error(`Withdrawal request ${requestTxHash} not found`);
    }

    if (request.status !== 'PENDING_PROCESSING') {
      this.logger.debug(`[WithdrawalExecutionService] Request ${requestTxHash} is not in PENDING_PROCESSING state`);
      return;
    }

    // SECURITY: Acquire lock to prevent concurrent processing of same withdrawal
    const withdrawalKey = `withdrawal-${request.user_address.toLowerCase()}-${request.token_address.toLowerCase()}`;
    const releaseLock = await acquireGroupLock(withdrawalKey);
    
    try {
      // Re-check status after acquiring lock (double-check pattern)
      const recheckRequest = await this.creditLedgerDb.findWithdrawalRequestByTxHash(requestTxHash);
      if (!recheckRequest || recheckRequest.status !== 'PENDING_PROCESSING') {
        this.logger.debug(`[WithdrawalExecutionService] Request ${requestTxHash} status changed while acquiring lock`);
        return;
      }

      const { user_address: userAddress, token_address: tokenAddress, vault_account: fundAddress, collateral_amount_wei: collateralAmountWei } = recheckRequest;

      // Check if this is an admin withdrawal
      const isAdmin = await this.adminOperationsService.isAdmin(userAddress);
      
      if (isAdmin) {
        await this.executeAdminWithdrawal(recheckRequest);
        return;
      }

      // Regular user withdrawal
      await this.executeRegularWithdrawal(recheckRequest);

    } catch (error) {
      this.logger.error(`[WithdrawalExecutionService] Error processing withdrawal request:`, error);
      await this.creditLedgerDb.updateWithdrawalRequestStatus(requestTxHash, 'ERROR', {
        failure_reason: error.message,
        error_details: error.stack
      });
      throw error;
    } finally {
      releaseLock();
    }
  }

  /**
   * Executes a regular user withdrawal.
   * @private
   */
  async executeRegularWithdrawal(request) {
    const { user_address: userAddress, token_address: tokenAddress, collateral_amount_wei: collateralAmountWei } = request;

    // 1. Get current token price for fee calculation
    const chainId = String(this.ethereumService.chainId || '1');
    const riskAssessment = await this.tokenRiskEngine.assessCollateral(tokenAddress, BigInt(collateralAmountWei), chainId);
    if (!riskAssessment.isSafe) {
      await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'FAILED', {
        failure_reason: 'Token risk assessment failed',
        error_details: riskAssessment.reason
      });
      return;
    }

    // 2. Calculate withdrawal amount and fee
    const estimatedGasCostUsd = await this.ethereumService.estimateGasCostInUsd(
      this.contractConfig.address,
      this.contractConfig.abi,
      'remit',
      userAddress,
      tokenAddress,
      collateralAmountWei,
      0,
      '0x'
    );

    const withdrawalValueUsd = tokenDecimalService.calculateUsdValue(BigInt(collateralAmountWei), tokenAddress, riskAssessment.price);
    if (estimatedGasCostUsd >= withdrawalValueUsd) {
      await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'REJECTED_UNPROFITABLE', {
        failure_reason: `Gas cost (${estimatedGasCostUsd} USD) exceeds withdrawal value (${withdrawalValueUsd} USD)`
      });
      return;
    }

    const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
    if (!ethPriceInUsd || ethPriceInUsd <= 0) {
      throw new Error('Failed to fetch ETH price for fee calculation');
    }
    const estimatedGasCostEth = estimatedGasCostUsd / ethPriceInUsd;
    const feeInWei = ethers.parseEther(estimatedGasCostEth.toFixed(18));
    const withdrawalAmount = BigInt(collateralAmountWei) - feeInWei;

    if (withdrawalAmount <= 0n) {
      await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'REJECTED_UNPROFITABLE', {
        failure_reason: 'Fee would exceed withdrawal amount'
      });
      return;
    }

    // 3. Execute withdrawal
    this.logger.debug(`[WithdrawalExecutionService] Executing withdrawal for ${userAddress}. Amount: ${tokenDecimalService.formatTokenAmount(withdrawalAmount, '0x0000000000000000000000000000000000000000')} ETH, Fee: ${tokenDecimalService.formatTokenAmount(feeInWei, '0x0000000000000000000000000000000000000000')} ETH`);
    const txResponse = await this.ethereumService.write(
      this.contractConfig.address,
      this.contractConfig.abi,
      'remit',
      userAddress,
      tokenAddress,
      withdrawalAmount,
      feeInWei,
      '0x'
    );

    const receipt = await this.ethereumService.waitForConfirmation(txResponse);
    if (!receipt || !receipt.hash) {
      throw new Error('Failed to get valid receipt for withdrawal transaction');
    }

    // 4. Update request status
    await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'COMPLETED', {
      withdrawal_tx_hash: receipt.hash,
      withdrawal_amount_wei: withdrawalAmount.toString(),
      fee_wei: feeInWei.toString(),
      withdrawal_value_usd: withdrawalValueUsd,
      gas_cost_usd: estimatedGasCostUsd
    });

    this.logger.info(`[WithdrawalExecutionService] Successfully processed withdrawal request ${request.request_tx_hash}`);

    // Admin Activity Notification
    if (this.adminActivityService) {
      this.adminActivityService.emitWithdrawalProcessed({
        masterAccountId: request.master_account_id,
        depositorAddress: userAddress,
        tokenAddress: tokenAddress,
        amount: withdrawalAmount.toString(),
        txHash: receipt.hash,
        chainId: '1'
      });
    }
  }

  /**
   * Executes an admin withdrawal with seizure of all outstanding protocol-owed escrow,
   * covering both Foundation deposits and CharterFund (referral vault) deposits.
   *
   * Flow per vault:
   *   Foundation: commit(foundation, user, token, owedAmount, 0, 'ADMIN_SEIZURE')
   *   CharterFund: performCalldata(vault, commit(vault, user, token, owedAmount, 0, seizureAmount, 'ADMIN_SEIZURE'))
   *                performCalldata(vault, sweepProtocolFees(token))  ← moves vault fees → Foundation
   *
   * Final: allocate(admin, token, total) + remit(admin, token, total, 0, 'ADMIN_WITHDRAWAL')
   * @private
   */
  async executeAdminWithdrawal(request) {
    const { user_address: userAddress, token_address: tokenAddress } = request;
    const foundationAddress = this.contractConfig.address;

    this.logger.info(`[WithdrawalExecutionService] Processing admin withdrawal+seizure for ${userAddress}, token ${tokenAddress}`);

    const { Interface } = require('ethers');
    const foundationIface = new Interface(this.contractConfig.abi);
    const charterFundAbi = contractRegistry.charteredFund.abi;
    const charterFundIface = new Interface(charterFundAbi);
    const seizureMetadata = ethers.toUtf8Bytes('ADMIN_SEIZURE');

    // ── 1. Query all confirmed deposits for this token across all vaults ──────
    const allDeposits = await this.creditLedgerDb.findMany({
      status: 'CONFIRMED',
      token_address: tokenAddress.toLowerCase(),
      points_credited: { $gt: 0 },
    });

    // Group by vault_account (Foundation or a CharterFund address)
    const depositsByVault = new Map();
    for (const d of allDeposits) {
      const vault = (d.vault_account || foundationAddress).toLowerCase();
      if (!depositsByVault.has(vault)) depositsByVault.set(vault, []);
      depositsByVault.get(vault).push(d);
    }

    // ── 2. Build per-vault seizure calls + read existing vault protocol escrow ─
    const allCalls = [];
    let totalSeizureWei = 0n;
    let totalExistingVaultEscrow = 0n; // CharterFund protocol fees already accumulated

    for (const [vaultAddress, vaultDeposits] of depositsByVault) {
      const isFoundation = vaultAddress === foundationAddress.toLowerCase();
      const vaultAbi = isFoundation ? this.contractConfig.abi : charterFundAbi;
      const vaultContractAddress = isFoundation ? foundationAddress : vaultAddress;

      // Aggregate deposits per depositor within this vault
      const byDepositor = new Map();
      for (const d of vaultDeposits) {
        const addr = d.depositor_address.toLowerCase();
        if (!byDepositor.has(addr)) byDepositor.set(addr, []);
        byDepositor.get(addr).push(d);
      }

      let vaultSeizureWei = 0n;

      for (const [depositorAddress, deposits] of byDepositor) {
        // Ledger-owed = consumed fraction of each deposit
        let ledgerOwedWei = 0n;
        for (const d of deposits) {
          const depositAmount = BigInt(d.deposit_amount_wei || '0');
          const pointsCredited = BigInt(d.points_credited || '0');
          const pointsRemaining = BigInt(d.points_remaining || '0');
          if (pointsCredited > 0n && pointsRemaining < pointsCredited) {
            ledgerOwedWei += ((pointsCredited - pointsRemaining) * depositAmount) / pointsCredited;
          }
        }
        if (ledgerOwedWei === 0n) continue;

        // Cap at user's actual on-chain userOwned in this vault
        const custodyKey = getCustodyKey(depositorAddress, tokenAddress);
        const custodyValue = await this.ethereumService.read(vaultContractAddress, vaultAbi, 'custody', custodyKey);
        const { userOwned: onChainUserOwned } = splitCustodyAmount(custodyValue);
        const seizureAmount = ledgerOwedWei < onChainUserOwned ? ledgerOwedWei : onChainUserOwned;
        if (seizureAmount === 0n) continue;

        if (isFoundation) {
          allCalls.push(foundationIface.encodeFunctionData('commit', [
            foundationAddress,  // fundAddress = Foundation
            depositorAddress,
            tokenAddress,
            seizureAmount,
            0,                  // fee = 0, escrow itself is the seizure
            seizureMetadata,
          ]));
        } else {
          // CharterFund commit: protocolFee = seizureAmount, charterFee = 0
          // Full seized amount accumulates in CharterFund's protocol bucket for sweeping
          const commitData = charterFundIface.encodeFunctionData('commit', [
            vaultAddress,       // fundAddress = CharterFund
            depositorAddress,
            tokenAddress,
            seizureAmount,
            0,                  // charterFee = 0 for admin seizure
            seizureAmount,      // protocolFee = full amount → CharterFund protocol bucket
            seizureMetadata,
          ]);
          allCalls.push(foundationIface.encodeFunctionData('performCalldata', [vaultAddress, commitData]));
        }

        vaultSeizureWei += seizureAmount;
        this.logger.info(`[WithdrawalExecutionService] Seizure queued: ${depositorAddress} in ${isFoundation ? 'Foundation' : vaultAddress} owes ${seizureAmount} wei`);
      }

      totalSeizureWei += vaultSeizureWei;

      // For CharterFund vaults: read existing protocol escrow + add sweep call
      if (!isFoundation) {
        try {
          const vaultProtocolKey = getCustodyKey(vaultAddress, tokenAddress);
          const vaultProtocolValue = await this.ethereumService.read(vaultAddress, charterFundAbi, 'custody', vaultProtocolKey);
          const { escrow: existingVaultEscrow } = splitCustodyAmount(vaultProtocolValue);
          totalExistingVaultEscrow += existingVaultEscrow;

          // Sweep if there's anything to move (existing fees or new seizures)
          if (existingVaultEscrow > 0n || vaultSeizureWei > 0n) {
            const sweepData = charterFundIface.encodeFunctionData('sweepProtocolFees', [tokenAddress]);
            allCalls.push(foundationIface.encodeFunctionData('performCalldata', [vaultAddress, sweepData]));
            this.logger.info(`[WithdrawalExecutionService] Sweep queued for CharterFund ${vaultAddress}: existing=${existingVaultEscrow} + seized=${vaultSeizureWei}`);
          }
        } catch (e) {
          this.logger.warn(`[WithdrawalExecutionService] Could not read/sweep CharterFund ${vaultAddress}: ${e.message}`);
        }
      }
    }

    // ── 3. Get Foundation's current on-chain protocol escrow ──────────────────
    const protocolCustodyKey = getCustodyKey(foundationAddress, tokenAddress);
    const protocolCustodyValue = await this.ethereumService.read(foundationAddress, this.contractConfig.abi, 'custody', protocolCustodyKey);
    const { escrow: currentFoundationEscrow } = splitCustodyAmount(protocolCustodyValue);

    // Total = Foundation existing + Foundation seizures + CharterFund existing + CharterFund seizures
    const totalAmount = currentFoundationEscrow + totalSeizureWei + totalExistingVaultEscrow;

    if (totalAmount === 0n) {
      this.logger.warn(`[WithdrawalExecutionService] Admin withdrawal: nothing to withdraw for token ${tokenAddress}`);
      await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'COMPLETED', {
        withdrawal_amount_wei: '0',
        fee_wei: '0',
        withdrawal_value_usd: 0,
        gas_cost_usd: 0,
        is_admin_withdrawal: true,
        seizure_count: 0,
      });
      return;
    }

    // ── 4. SECURITY: audit log ────────────────────────────────────────────────
    const chainId = String(this.ethereumService.chainId || '1');
    const riskAssessment = await this.tokenRiskEngine.assessCollateral(tokenAddress, totalAmount, chainId);
    const withdrawalValueUsd = tokenDecimalService.calculateUsdValue(totalAmount, tokenAddress, riskAssessment.price);

    this.logger.warn(
      `[WithdrawalExecutionService] ADMIN WITHDRAWAL+SEIZURE: admin=${userAddress}, ` +
      `token=${tokenAddress}, foundationEscrow=${currentFoundationEscrow}, ` +
      `vaultEscrow=${totalExistingVaultEscrow}, seizures=${allCalls.length - depositsByVault.size + 2} (${totalSeizureWei} wei), ` +
      `total=${totalAmount} wei (~$${withdrawalValueUsd.toFixed(2)})`
    );

    // ── 5. Append allocate + remit and execute ────────────────────────────────
    const withdrawalMetadata = ethers.toUtf8Bytes('ADMIN_WITHDRAWAL');
    allCalls.push(foundationIface.encodeFunctionData('allocate', [userAddress, tokenAddress, totalAmount]));
    allCalls.push(foundationIface.encodeFunctionData('remit', [userAddress, tokenAddress, totalAmount, 0, withdrawalMetadata]));

    const txResponse = await this.ethereumService.write(
      foundationAddress,
      this.contractConfig.abi,
      'multicall',
      allCalls
    );

    const receipt = await this.ethereumService.waitForConfirmation(txResponse);
    if (!receipt || !receipt.hash) {
      throw new Error('Failed to get valid receipt for admin withdrawal transaction');
    }

    // ── 6. Record completion ──────────────────────────────────────────────────
    const actualGasCostEth = receipt.gasUsed * (receipt.gasPrice || receipt.effectiveGasPrice);
    const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
    const actualGasCostUsd = parseFloat(tokenDecimalService.formatTokenAmount(actualGasCostEth, NATIVE_ETH_ADDRESS)) * ethPriceInUsd;

    await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'COMPLETED', {
      withdrawal_tx_hash: receipt.hash,
      withdrawal_amount_wei: totalAmount.toString(),
      fee_wei: '0',
      withdrawal_value_usd: withdrawalValueUsd,
      gas_cost_usd: actualGasCostUsd,
      is_admin_withdrawal: true,
      seizure_count: totalSeizureWei > 0n ? 'multiple' : 0,
      seizure_amount_wei: totalSeizureWei.toString(),
    });

    this.logger.warn(
      `[WithdrawalExecutionService] ADMIN WITHDRAWAL COMPLETED: ${userAddress}, ` +
      `Tx: ${receipt.hash}, Amount: $${withdrawalValueUsd.toFixed(2)}, Seized: ${totalSeizureWei} wei`
    );

    if (this.adminActivityService) {
      this.adminActivityService.emitWithdrawalProcessed({
        masterAccountId: request.master_account_id,
        depositorAddress: userAddress,
        tokenAddress: tokenAddress,
        amount: totalAmount.toString(),
        txHash: receipt.hash,
        chainId: '1',
      });
    }
  }

  /**
   * Calculates withdrawal fee based on amount and token.
   * @param {bigint} amount - The withdrawal amount
   * @param {string} token - The token address
   * @returns {Promise<bigint>} The fee in wei
   */
  async calculateWithdrawalFee(amount, token) {
    const estimatedGasCostUsd = await this.ethereumService.estimateGasCostInUsd(
      this.contractConfig.address,
      this.contractConfig.abi,
      'remit',
      '0x0000000000000000000000000000000000000000', // placeholder
      token,
      amount,
      0,
      '0x'
    );

    const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
    if (!ethPriceInUsd || ethPriceInUsd <= 0) {
      throw new Error('Failed to fetch ETH price for fee calculation');
    }
    const estimatedGasCostEth = estimatedGasCostUsd / ethPriceInUsd;
    return ethers.parseEther(estimatedGasCostEth.toFixed(18));
  }
}

module.exports = WithdrawalExecutionService;

