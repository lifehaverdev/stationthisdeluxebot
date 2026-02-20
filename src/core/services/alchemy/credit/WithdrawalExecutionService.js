/**
 * WithdrawalExecutionService
 * 
 * Handles withdrawal execution, fee calculation, and admin withdrawal handling.
 * Executes withdrawals on-chain and updates ledger status.
 */
const { ethers } = require('ethers');
const tokenDecimalService = require('../../tokenDecimalService');
const { getGroupKey, acquireGroupLock } = require('./groupLockUtils');
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
   * Executes an admin withdrawal (no fees).
   * @private
   */
  async executeAdminWithdrawal(request) {
    const { user_address: userAddress, token_address: tokenAddress, collateral_amount_wei: collateralAmountWei } = request;

    this.logger.info(`[WithdrawalExecutionService] Processing admin withdrawal for ${userAddress}`);
    
    // SECURITY: Calculate USD value for audit logging (even though fee is 0)
    const chainId = String(this.ethereumService.chainId || '1');
    const riskAssessment = await this.tokenRiskEngine.assessCollateral(tokenAddress, BigInt(collateralAmountWei), chainId);
    const withdrawalValueUsd = tokenDecimalService.calculateUsdValue(BigInt(collateralAmountWei), tokenAddress, riskAssessment.price);
    
    // SECURITY: Log admin withdrawal attempt for audit trail
    this.logger.warn(`[WithdrawalExecutionService] ADMIN WITHDRAWAL: User ${userAddress}, Amount: ${collateralAmountWei} wei (${withdrawalValueUsd.toFixed(2)} USD), Token: ${tokenAddress}, Request: ${request.request_tx_hash}`);
    
    const amount = BigInt(collateralAmountWei);
    const metadata = ethers.toUtf8Bytes('ADMIN_WITHDRAWAL');
    
    // Prepare multicall data: [allocate, remit]
    const { Interface } = require('ethers');
    const iface = new Interface(this.contractConfig.abi);
    const allocateData = iface.encodeFunctionData('allocate', [userAddress, tokenAddress, amount]);
    const remitData = iface.encodeFunctionData('remit', [userAddress, tokenAddress, amount, 0, metadata]);
    
    // Execute multicall
    const txResponse = await this.ethereumService.write(
      this.contractConfig.address,
      this.contractConfig.abi,
      'multicall',
      [[allocateData, remitData]]
    );
    
    const receipt = await this.ethereumService.waitForConfirmation(txResponse);
    if (!receipt || !receipt.hash) {
      throw new Error('Failed to get valid receipt for admin withdrawal transaction');
    }
    
    // SECURITY: Calculate actual gas cost for audit logging
    const actualGasCostEth = receipt.gasUsed * (receipt.gasPrice || receipt.effectiveGasPrice);
    const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
    const actualGasCostUsd = parseFloat(tokenDecimalService.formatTokenAmount(actualGasCostEth, NATIVE_ETH_ADDRESS)) * ethPriceInUsd;
    
    // Update request status with proper accounting
    await this.creditLedgerDb.updateWithdrawalRequestStatus(request.request_tx_hash, 'COMPLETED', {
      withdrawal_tx_hash: receipt.hash,
      withdrawal_amount_wei: amount.toString(),
      fee_wei: '0',
      withdrawal_value_usd: withdrawalValueUsd,
      gas_cost_usd: actualGasCostUsd,
      is_admin_withdrawal: true
    });
    
    this.logger.warn(`[WithdrawalExecutionService] ADMIN WITHDRAWAL COMPLETED: ${userAddress}, Tx: ${receipt.hash}, Amount: ${withdrawalValueUsd.toFixed(2)} USD`);
    
    // Admin Activity Notification
    if (this.adminActivityService) {
      this.adminActivityService.emitWithdrawalProcessed({
        masterAccountId: request.master_account_id,
        depositorAddress: userAddress,
        tokenAddress: tokenAddress,
        amount: amount.toString(),
        txHash: receipt.hash,
        chainId: '1'
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

