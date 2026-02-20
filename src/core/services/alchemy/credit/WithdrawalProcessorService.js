/**
 * WithdrawalProcessorService
 * 
 * Handles withdrawal request initiation and processing.
 * Processes withdrawal request events and validates withdrawal requests.
 */
const { getCustodyKey, splitCustodyAmount } = require('../contractUtils');
const { getGroupKey, acquireGroupLock } = require('./groupLockUtils');

class WithdrawalProcessorService {
  constructor(
    ethereumService,
    creditLedgerDb,
    internalApiClient,
    withdrawalExecutionService,
    contractConfig,
    logger
  ) {
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.internalApiClient = internalApiClient;
    this.withdrawalExecutionService = withdrawalExecutionService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Initiates a withdrawal request for a user.
   * @param {string} userAddress - The Ethereum address of the user requesting withdrawal
   * @param {string} tokenAddress - The token contract address to withdraw
   * @param {string} fundAddress - The fund address (optional, defaults to main vault)
   * @returns {Promise<{success: boolean, message: string, txHash?: string}>}
   */
  async initiateWithdrawal(userAddress, tokenAddress, fundAddress) {
    this.logger.debug(`[WithdrawalProcessorService] Processing withdrawal request for user ${userAddress} and token ${tokenAddress}`);

    try {
      // 1. Verify user account exists
      let masterAccountId;
      try {
        const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${userAddress}`);
        masterAccountId = response.data.masterAccountId;
        this.logger.debug(`[WithdrawalProcessorService] User found. MasterAccountId: ${masterAccountId}`);
      } catch (error) {
        if (error.response?.status === 404) {
          return { success: false, message: 'No user account found for this address.' };
        }
        throw error;
      }

      // 2. Get user's current credit balance and collateral value
      const custodyKey = getCustodyKey(userAddress, tokenAddress);
      const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
      const { userOwned: collateralAmount } = splitCustodyAmount(custodyValue);

      if (collateralAmount === 0n) {
        return { success: false, message: 'No collateral found for withdrawal.' };
      }

      // 3. Record the withdrawal request on-chain
      this.logger.debug(`[WithdrawalProcessorService] Recording withdrawal request on-chain for user ${userAddress}`);
      const txResponse = await this.ethereumService.write(
        this.contractConfig.address,
        this.contractConfig.abi,
        'recordRescissionRequest',
        userAddress,
        tokenAddress
      );

      // Wait for confirmation
      const receipt = await this.ethereumService.waitForConfirmation(txResponse);
      if (!receipt || !receipt.hash) {
        throw new Error('Failed to get valid receipt for withdrawal request transaction');
      }

      // Create withdrawal request entry in ledger
      await this.creditLedgerDb.createWithdrawalRequest({
        request_tx_hash: receipt.hash,
        request_block_number: receipt.blockNumber,
        vault_account: fundAddress || this.contractConfig.address,
        user_address: userAddress,
        token_address: tokenAddress,
        master_account_id: masterAccountId,
        status: 'PENDING_PROCESSING',
        collateral_amount_wei: collateralAmount.toString()
      });

      return {
        success: true,
        message: 'Withdrawal request recorded successfully.',
        txHash: receipt.hash
      };

    } catch (error) {
      this.logger.error(`[WithdrawalProcessorService] Error processing withdrawal request:`, error);
      throw error;
    }
  }

  /**
   * Processes a withdrawal request event from a webhook.
   * @param {object} decodedLog - The decoded withdrawal event log
   * @param {string} transactionHash - The transaction hash
   * @param {number} blockNumber - The block number
   * @returns {Promise<void>}
   */
  async processWithdrawalRequest(decodedLog, transactionHash, blockNumber) {
    const { fundAddress, user: userAddress, token: tokenAddress } = decodedLog;

    // Check for existing request through internal API
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/ledger/withdrawals/${transactionHash}`);
      if (response.data.request) {
        this.logger.debug(`[WithdrawalProcessorService] Withdrawal request ${transactionHash} already processed`);
        return;
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
      // 404 means request doesn't exist, continue processing
    }

    // Get user's master account ID
    let masterAccountId;
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${userAddress}`);
      masterAccountId = response.data.masterAccountId;
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`[WithdrawalProcessorService] No user account found for address ${userAddress}`);
        return;
      }
      throw error;
    }

    // Get current collateral amount
    const custodyKey = getCustodyKey(userAddress, tokenAddress);
    const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
    const { userOwned: collateralAmount } = splitCustodyAmount(custodyValue);

    // Create withdrawal request through internal API
    await this.internalApiClient.post('/internal/v1/data/ledger/withdrawals', {
      request_tx_hash: transactionHash,
      request_block_number: blockNumber,
      vault_account: fundAddress,
      user_address: userAddress,
      token_address: tokenAddress,
      master_account_id: masterAccountId,
      collateral_amount_wei: collateralAmount.toString()
    });

    // Trigger immediate processing
    await this.withdrawalExecutionService.executeWithdrawal(transactionHash);
  }

  /**
   * Validates a withdrawal request.
   * @param {string} userAddress - The user address
   * @param {string} tokenAddress - The token address
   * @param {bigint} amount - The withdrawal amount
   * @returns {Promise<boolean>} True if valid
   */
  async validateWithdrawal(userAddress, tokenAddress, amount) {
    // Get current collateral amount
    const custodyKey = getCustodyKey(userAddress, tokenAddress);
    const custodyValue = await this.ethereumService.read(this.contractConfig.address, this.contractConfig.abi, 'custody', custodyKey);
    const { userOwned: collateralAmount } = splitCustodyAmount(custodyValue);

    return collateralAmount >= amount;
  }
}

module.exports = WithdrawalProcessorService;

