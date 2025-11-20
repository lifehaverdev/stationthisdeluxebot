/**
 * DepositProcessorService
 * 
 * Handles deposit event processing, group processing, and user account verification.
 * Processes individual deposit events and groups them for confirmation.
 */
const { ethers } = require('ethers');

class DepositProcessorService {
  constructor(
    ethereumService,
    creditLedgerDb,
    internalApiClient,
    depositConfirmationService,
    magicAmountLinkingService,
    eventDeduplicationService,
    contractConfig,
    logger
  ) {
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.internalApiClient = internalApiClient;
    this.depositConfirmationService = depositConfirmationService;
    this.magicAmountLinkingService = magicAmountLinkingService;
    this.eventDeduplicationService = eventDeduplicationService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Processes a single deposit event.
   * @param {object} decodedLog - The decoded deposit event log
   * @param {string} transactionHash - The transaction hash
   * @param {number} blockNumber - The block number
   * @param {number} logIndex - The log index
   * @returns {Promise<void>}
   */
  async processDepositEvent(decodedLog, transactionHash, blockNumber, logIndex) {
    const normalizedTxHash = transactionHash.toLowerCase();
    let { fundAddress, user, token, amount } = decodedLog;

    // Check for existing entry
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/ledger/entries/${normalizedTxHash}`);
      if (response.data.entry) {
        this.logger.info(`[DepositProcessorService] Skipping deposit event for tx ${normalizedTxHash} as it's already acknowledged.`);
        return;
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
      // 404 means entry doesn't exist, continue processing
    }

    // Handle magic amount linking
    if (this.magicAmountLinkingService) {
      const wasHandledByLinking = await this.magicAmountLinkingService.checkMagicAmount(user, token, amount.toString());
      if (wasHandledByLinking) {
        this.logger.info(`[DepositProcessorService] Deposit from tx ${normalizedTxHash} was a magic amount and has been fully processed.`);
        return;
      }
    }

    // Validate vault account
    if (!fundAddress || !ethers.isAddress(fundAddress)) {
      this.logger.warn(`[DepositProcessorService] 'fundAddress' not found or invalid in event for tx ${normalizedTxHash}. Assuming deposit to main vault.`);
      fundAddress = this.contractConfig.address;
    }

    // Create ledger entry through internal API
    await this.internalApiClient.post('/internal/v1/data/ledger/entries', {
      deposit_tx_hash: normalizedTxHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: fundAddress,
      depositor_address: user,
      token_address: token,
      deposit_amount_wei: amount.toString()
    });

    // Mark transaction as processed
    if (this.eventDeduplicationService) {
      this.eventDeduplicationService.markProcessed(normalizedTxHash);
    }

    this.logger.info(`[DepositProcessorService] Successfully acknowledged new deposit from webhook: ${normalizedTxHash}`);
  }

  /**
   * Processes a group of deposits for confirmation.
   * @param {Array<object>} deposits - Array of deposit ledger entries
   * @returns {Promise<void>}
   */
  async processDepositGroup(deposits) {
    if (!deposits || deposits.length === 0) {
      return;
    }

    await this.depositConfirmationService.confirmDepositGroup(deposits);
  }

  /**
   * Verifies that a user account exists for the given address.
   * @param {string} address - The user's Ethereum address
   * @returns {Promise<string|null>} The master account ID, or null if not found
   */
  async verifyUserAccount(address) {
    try {
      const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${address}`);
      return response.data.masterAccountId;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }
}

module.exports = DepositProcessorService;

