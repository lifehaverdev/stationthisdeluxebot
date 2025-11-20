/**
 * DonationProcessorService
 * 
 * Handles donation event processing and instant credit application.
 * Donations receive instant credit without requiring on-chain confirmation.
 */
const { getDonationFundingRate } = require('../tokenConfig');
const tokenDecimalService = require('../../tokenDecimalService');
const USD_TO_POINTS_CONVERSION_RATE = 0.000337;

class DonationProcessorService {
  constructor(ethereumService, creditLedgerDb, priceFeedService, internalApiClient, depositNotificationService, eventDeduplicationService, contractConfig, logger) {
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.priceFeedService = priceFeedService;
    this.internalApiClient = internalApiClient;
    this.depositNotificationService = depositNotificationService;
    this.eventDeduplicationService = eventDeduplicationService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Processes a donation event and applies instant credit.
   * @param {object} decodedLog - The decoded donation event log
   * @param {string} transactionHash - The transaction hash
   * @param {number} blockNumber - The block number
   * @param {number} logIndex - The log index
   * @returns {Promise<void>}
   */
  async processDonationEvent(decodedLog, transactionHash, blockNumber, logIndex) {
    const { funder: user, token, amount } = decodedLog;

    // Check duplicate
    try {
      const resp = await this.internalApiClient.get(`/internal/v1/data/ledger/entries/${transactionHash}`);
      if (resp.data.entry) {
        this.logger.info(`[DonationProcessorService] Skipping donation event for tx ${transactionHash}; already processed.`);
        return;
      }
    } catch (err) {
      if (err.response?.status !== 404) throw err;
    }

    // Lookup user account
    let masterAccountId;
    try {
      const resp = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${user}`);
      masterAccountId = resp.data.masterAccountId;
    } catch (err) {
      if (err.response?.status === 404) {
        this.logger.warn(`[DonationProcessorService] Donation from unknown wallet ${user}; ignoring.`);
        return;
      }
      throw err;
    }

    // Price & funding rate
    const priceInUsd = await this.priceFeedService.getPriceInUsd(token);
    if (priceInUsd === 0) {
      // Abort processing – price feed unavailable
      this.logger.error(`[DonationProcessorService] Price feed unavailable for token ${token}. Marking donation tx ${transactionHash} as ERROR.`);

      const failureEntry = {
        deposit_tx_hash: transactionHash,
        deposit_log_index: logIndex,
        deposit_block_number: blockNumber,
        vault_account: this.contractConfig.address || '0x0000000000000000000000000000000000000000',
        depositor_address: user,
        master_account_id: masterAccountId,
        token_address: token,
        deposit_amount_wei: amount.toString(),
        deposit_type: 'TOKEN_DONATION',
        status: 'ERROR',
        failure_reason: 'Price feed unavailable',
        funding_rate_applied: getDonationFundingRate(token),
        gross_deposit_usd: 0,
        adjusted_gross_deposit_usd: 0,
        user_credited_usd: 0,
        points_credited: 0,
        points_remaining: 0,
      };
      await this.creditLedgerDb.createLedgerEntry(failureEntry);
      this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'error', failureEntry);
      return;
    }

    const fundingRate = getDonationFundingRate(token);

    // Use centralized decimal service for consistent token handling
    const grossDepositUsd = tokenDecimalService.calculateUsdValue(amount, token, priceInUsd);

    this.logger.info(`[DonationProcessorService] Donation processing for token ${token}:`, {
      amount: amount.toString(),
      priceInUsd,
      grossDepositUsd,
      fundingRate
    });

    const adjustedGrossDepositUsd = grossDepositUsd * fundingRate;
    const userCreditedUsd = adjustedGrossDepositUsd;
    const pointsCredited = Math.floor(userCreditedUsd / USD_TO_POINTS_CONVERSION_RATE);

    const ledgerEntryBase = {
      deposit_tx_hash: transactionHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: this.contractConfig?.address || '0x0000000000000000000000000000000000000000',
      depositor_address: user,
      master_account_id: masterAccountId,
      token_address: token,
      deposit_amount_wei: amount.toString(),
      deposit_type: 'TOKEN_DONATION',
      funding_rate_applied: fundingRate,
      gross_deposit_usd: grossDepositUsd,
      adjusted_gross_deposit_usd: adjustedGrossDepositUsd,
      user_credited_usd: userCreditedUsd,
      points_credited: pointsCredited,
      points_remaining: pointsCredited,
    };

    // Some DB schemas override status to a default. Persist first then explicitly mark CONFIRMED.
    await this.creditLedgerDb.createLedgerEntry({ ...ledgerEntryBase, status: 'PENDING_CONFIRMATION' });
    await this.creditLedgerDb.updateLedgerStatus(transactionHash, 'CONFIRMED');

    // Mark transaction as processed
    if (this.eventDeduplicationService) {
      this.eventDeduplicationService.markProcessed(transactionHash);
    }

    // Notify user
    this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'confirmed', ledgerEntryBase);

    this.logger.info(`[DonationProcessorService] Donation processed instantly for user ${masterAccountId}. Points credited: ${pointsCredited}`);
  }

  /**
   * Applies instant credit for a donation (used internally).
   * @param {string} masterAccountId - The user's master account ID
   * @param {bigint} amount - The donation amount in wei
   * @param {string} token - The token address
   * @returns {Promise<number>} The points credited
   */
  async applyInstantCredit(masterAccountId, amount, token) {
    const priceInUsd = await this.priceFeedService.getPriceInUsd(token);
    if (priceInUsd === 0) {
      throw new Error(`Price feed unavailable for token ${token}`);
    }

    const fundingRate = getDonationFundingRate(token);
    const grossDepositUsd = tokenDecimalService.calculateUsdValue(amount, token, priceInUsd);
    const adjustedGrossDepositUsd = grossDepositUsd * fundingRate;
    const pointsCredited = Math.floor(adjustedGrossDepositUsd / USD_TO_POINTS_CONVERSION_RATE);

    return pointsCredited;
  }
}

module.exports = DonationProcessorService;

