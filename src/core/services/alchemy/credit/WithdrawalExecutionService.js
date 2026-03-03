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
   * Two-phase execution:
   *
   * Phase 1 — per CharterFund vault (charterFund.multicall, direct marshal call):
   *   commit(charterFund, user, token, owedAmount, fee=0, metadata)
   *   remit(user, token, amount=0, fee=owedAmount, metadata)  ← drains user.escrow → vault protocol bucket
   *   sweepProtocolFees(token)  ← vault calls Foundation.creditProtocolEscrow, moves fees to Foundation
   *
   * Phase 2 — Foundation (Foundation.multicall):
   *   commit(Foundation, user, token, owedAmount, fee=0, metadata)  ← per Foundation depositor
   *   remit(user, token, amount=0, fee=owedAmount, metadata)
   *   allocate(admin, token, total)   ← total re-read after Phase 1 confirms
   *   remit(admin, token, total, 0, metadata)
   *
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
    const chainId = String(this.ethereumService.chainId || '1');
    const allDeposits = await this.creditLedgerDb.findMany({
      status: 'CONFIRMED',
      token_address: tokenAddress.toLowerCase(),
      chain_id: chainId,
      points_credited: { $gt: 0 },
    });

    // Group by vault_account. Treat null/zero address as Foundation.
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const depositsByVault = new Map();
    for (const d of allDeposits) {
      const raw = (d.vault_account || '').toLowerCase();
      const vault = (!raw || raw === ZERO_ADDRESS) ? foundationAddress.toLowerCase() : raw;
      if (!depositsByVault.has(vault)) depositsByVault.set(vault, []);
      depositsByVault.get(vault).push(d);
    }

    // ── 2. Build per-depositor seizure amounts for each vault ─────────────────
    // charterVaultCalls: Map<vaultAddress, encodedCall[]>
    // foundationCalls: encodedCall[]
    const charterVaultCalls = new Map();
    const foundationCalls = [];
    let totalFoundationSeizureWei = 0n;
    let charterSweptWei = 0n;      // seized via protocolFee+sweep → lands in Foundation.escrow
    let charterDirectExitWei = 0n;  // existing escrow drained via charter allocate+remit → admin wallet directly

    for (const [vaultAddress, vaultDeposits] of depositsByVault) {
      const isFoundation = vaultAddress === foundationAddress.toLowerCase();
      const vaultAbi = isFoundation ? this.contractConfig.abi : charterFundAbi;
      const vaultContractAddress = isFoundation ? foundationAddress : vaultAddress;

      const byDepositor = new Map();
      for (const d of vaultDeposits) {
        const addr = d.depositor_address.toLowerCase();
        if (!byDepositor.has(addr)) byDepositor.set(addr, []);
        byDepositor.get(addr).push(d);
      }

      const vaultCalls = isFoundation ? foundationCalls : [];
      let vaultFoundationSeizureWei = 0n;  // Foundation: all remit fees land in Foundation.escrow
      let vaultSweptWei = 0n;              // Charter: protocolFee routed via sweep → Foundation.escrow
      let vaultDirectExitWei = 0n;         // Charter: escrow drained via charter allocate+remit → admin wallet

      for (const [depositorAddress, deposits] of byDepositor) {
        let ledgerOwedWei = 0n;
        for (const d of deposits) {
          const depositAmount = BigInt(d.deposit_amount_wei || '0');
          const pointsCredited = BigInt(d.points_credited || '0');
          const pointsRemaining = BigInt(d.points_remaining || '0');
          if (pointsCredited > 0n && pointsRemaining < pointsCredited) {
            ledgerOwedWei += ((pointsCredited - pointsRemaining) * depositAmount) / pointsCredited;
          }
        }

        const custodyKey = getCustodyKey(depositorAddress, tokenAddress);
        let onChainUserOwned, onChainEscrow;
        try {
          const custodyValue = await this.ethereumService.read(vaultContractAddress, vaultAbi, 'custody', custodyKey);
          ({ userOwned: onChainUserOwned, escrow: onChainEscrow } = splitCustodyAmount(custodyValue));
        } catch (e) {
          this.logger.warn(`[WithdrawalExecutionService] Could not read custody for ${depositorAddress} in ${vaultContractAddress}: ${e.message} — skipping`);
          continue;
        }

        // How much new userOwned to commit (capped by what's on-chain)
        const seizureAmount = ledgerOwedWei < onChainUserOwned ? ledgerOwedWei : onChainUserOwned;

        // How much pre-existing escrow to drain (from prior partial seizures)
        const existingEscrow = onChainEscrow;

        if (seizureAmount === 0n && existingEscrow === 0n) continue;

        if (isFoundation) {
          if (seizureAmount > 0n) {
            // commit(fee=0): userOwned → user.escrow
            vaultCalls.push(foundationIface.encodeFunctionData('commit', [
              foundationAddress, depositorAddress, tokenAddress, seizureAmount, 0, seizureMetadata,
            ]));
          }
          // remit drains escrow (newly committed + any pre-existing) → Foundation.escrow
          const totalRemit = seizureAmount + existingEscrow;
          vaultCalls.push(foundationIface.encodeFunctionData('remit', [
            depositorAddress, tokenAddress, 0, totalRemit, seizureMetadata,
          ]));
          vaultFoundationSeizureWei += totalRemit;
        } else {
          // CharterFund seizure — two separate flows:
          //   Flow A: new seizure via commit(protocolFee) + sweepProtocolFees → Foundation.escrow
          //   Flow B: existing escrow (+ 1 wei dust) via charter allocate+remit → admin wallet directly
          const dustWei = seizureAmount > 0n ? 1n : 0n;

          if (seizureAmount > 0n) {
            // Flow A: commit(escrowAmount=1, protocolFee=seizureAmount-1)
            //   user.owned -= seizureAmount, user.escrow += 1
            //   custody[foundation][token].owned += (seizureAmount - 1)
            const protocolFee = seizureAmount - 1n;
            vaultCalls.push(charterFundIface.encodeFunctionData('commit', [
              vaultAddress, depositorAddress, tokenAddress, 1, 0, protocolFee, seizureMetadata,
            ]));
            vaultSweptWei += protocolFee;
          }

          // Flow B: drain escrow (existing + 1 wei dust from commit) via charter's own allocate+remit
          const escrowToDrain = existingEscrow + dustWei;
          if (escrowToDrain > 0n) {
            // remit(fee=escrowToDrain): user.escrow → custody[charterFund].escrow
            vaultCalls.push(charterFundIface.encodeFunctionData('remit', [
              depositorAddress, tokenAddress, 0, escrowToDrain, seizureMetadata,
            ]));
            // allocate: custody[charterFund].escrow → admin.escrow on charter fund
            vaultCalls.push(charterFundIface.encodeFunctionData('allocate', [
              userAddress, tokenAddress, escrowToDrain,
            ]));
            // remit(amount=escrowToDrain, fee=0): admin.escrow → ETH exits charter fund to admin wallet
            vaultCalls.push(charterFundIface.encodeFunctionData('remit', [
              userAddress, tokenAddress, escrowToDrain, 0, seizureMetadata,
            ]));
            vaultDirectExitWei += escrowToDrain;
          }
        }

        this.logger.info(`[WithdrawalExecutionService] Seizure queued: ${depositorAddress} in ${isFoundation ? 'Foundation' : vaultAddress} — new=${seizureAmount} wei, drainEscrow=${existingEscrow} wei`);
      }

      if (isFoundation) {
        totalFoundationSeizureWei += vaultFoundationSeizureWei;
      } else {
        charterSweptWei += vaultSweptWei;
        charterDirectExitWei += vaultDirectExitWei;
        // Sweep moves custody[foundation].owned → Foundation.escrow via creditProtocolEscrow
        if (vaultSweptWei > 0n) {
          vaultCalls.push(charterFundIface.encodeFunctionData('sweepProtocolFees', [tokenAddress]));
          this.logger.info(`[WithdrawalExecutionService] Sweep queued for CharterFund ${vaultAddress}: swept=${vaultSweptWei} wei, directExit=${vaultDirectExitWei} wei`);
        }
        if (vaultCalls.length > 0) charterVaultCalls.set(vaultAddress, vaultCalls);
      }
    }

    // ── 3. Phase 1: execute CharterFund multicalls (commit + remit + sweep per vault) ──
    for (const [vaultAddress, calls] of charterVaultCalls) {
      this.logger.info(`[WithdrawalExecutionService] Executing CharterFund multicall for ${vaultAddress} (${calls.length} calls)`);
      const txResponse = await this.ethereumService.write(
        vaultAddress,
        charterFundAbi,
        'multicall',
        calls
      );
      const receipt = await this.ethereumService.waitForConfirmation(txResponse);
      if (!receipt || !receipt.hash) {
        throw new Error(`Failed to get receipt for CharterFund multicall on ${vaultAddress}`);
      }
      this.logger.info(`[WithdrawalExecutionService] CharterFund ${vaultAddress} multicall confirmed: ${receipt.hash}`);
    }

    // ── 4. Re-read Foundation protocol escrow after sweeps have landed ─────────
    // custody[Foundation].escrow = fees accumulated from remit() calls → drain via allocate()
    // Note: custody[Foundation].userOwned is managed separately by contract owner via recoverProtocolOwned()
    const protocolCustodyKey = getCustodyKey(foundationAddress, tokenAddress);
    const protocolCustodyValue = await this.ethereumService.read(foundationAddress, this.contractConfig.abi, 'custody', protocolCustodyKey);
    const { escrow: currentFoundationEscrow } = splitCustodyAmount(protocolCustodyValue);

    // foundationAllocateAmount: what flows through Foundation allocate→remit
    //   currentFoundationEscrow includes pre-existing escrow + charter swept fees (read after step 3)
    //   totalFoundationSeizureWei = new seizure fees added by Foundation remits in this same multicall
    const foundationAllocateAmount = currentFoundationEscrow + totalFoundationSeizureWei;
    // grandTotal: everything extracted this run (Foundation allocate + charter direct exits)
    const grandTotal = foundationAllocateAmount + charterDirectExitWei;

    if (grandTotal === 0n && foundationCalls.length === 0) {
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

    // ── 5. Phase 2: Foundation multicall (seizures + allocate + remit) ──
    const totalCharterSeizureWei = charterSweptWei + charterDirectExitWei;
    const riskAssessment = await this.tokenRiskEngine.assessCollateral(tokenAddress, grandTotal, chainId);
    const withdrawalValueUsd = tokenDecimalService.calculateUsdValue(grandTotal, tokenAddress, riskAssessment.price);

    this.logger.warn(
      `[WithdrawalExecutionService] ADMIN WITHDRAWAL+SEIZURE: admin=${userAddress}, ` +
      `token=${tokenAddress}, foundationEscrow=${currentFoundationEscrow}, ` +
      `foundationSeizures=${totalFoundationSeizureWei} wei, charterSwept=${charterSweptWei} wei, ` +
      `charterDirectExit=${charterDirectExitWei} wei, grandTotal=${grandTotal} wei (~$${withdrawalValueUsd.toFixed(2)})`
    );

    const withdrawalMetadata = ethers.toUtf8Bytes('ADMIN_WITHDRAWAL');

    // Drain Foundation escrow: allocate → admin.escrow, then remit → admin wallet
    if (foundationAllocateAmount > 0n) {
      foundationCalls.push(foundationIface.encodeFunctionData('allocate', [userAddress, tokenAddress, foundationAllocateAmount]));
      foundationCalls.push(foundationIface.encodeFunctionData('remit', [userAddress, tokenAddress, foundationAllocateAmount, 0, withdrawalMetadata]));
    }

    let foundationTxHash = null;
    let actualGasCostEth = 0n;

    if (foundationCalls.length > 0) {
      const txResponse = await this.ethereumService.write(
        foundationAddress,
        this.contractConfig.abi,
        'multicall',
        foundationCalls
      );

      const receipt = await this.ethereumService.waitForConfirmation(txResponse);
      if (!receipt || !receipt.hash) {
        throw new Error('Failed to get valid receipt for Foundation withdrawal transaction');
      }
      foundationTxHash = receipt.hash;
      actualGasCostEth = receipt.gasUsed * (receipt.gasPrice || receipt.effectiveGasPrice);
    }

    // ── 6. Record completion ──────────────────────────────────────────────────
    const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
    const actualGasCostUsd = parseFloat(tokenDecimalService.formatTokenAmount(actualGasCostEth, NATIVE_ETH_ADDRESS)) * ethPriceInUsd;

    await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'COMPLETED', {
      withdrawal_tx_hash: foundationTxHash,
      withdrawal_amount_wei: grandTotal.toString(),
      fee_wei: '0',
      withdrawal_value_usd: withdrawalValueUsd,
      gas_cost_usd: actualGasCostUsd,
      is_admin_withdrawal: true,
      seizure_count: totalFoundationSeizureWei + totalCharterSeizureWei > 0n ? 'multiple' : 0,
      seizure_amount_wei: (totalFoundationSeizureWei + totalCharterSeizureWei).toString(),
    });

    this.logger.warn(
      `[WithdrawalExecutionService] ADMIN WITHDRAWAL COMPLETED: ${userAddress}, ` +
      `Tx: ${foundationTxHash || 'charter-only'}, Amount: $${withdrawalValueUsd.toFixed(2)}, ` +
      `Seized: foundation=${totalFoundationSeizureWei} charterSwept=${charterSweptWei} charterDirect=${charterDirectExitWei} wei`
    );

    if (this.adminActivityService) {
      this.adminActivityService.emitWithdrawalProcessed({
        masterAccountId: request.master_account_id,
        depositorAddress: userAddress,
        tokenAddress: tokenAddress,
        amount: grandTotal.toString(),
        txHash: foundationTxHash,
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

