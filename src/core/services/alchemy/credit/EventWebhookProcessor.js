/**
 * EventWebhookProcessor
 *
 * Handles webhook routing and event decoding for the CreditVault contract.
 * Routes incoming webhook events to the deposit processor based on event type.
 *
 * Events handled:
 *   - Payment:              Token/ETH deposits via pay()/payETH()
 *   - NFTReceived:          ERC721 tokens sent to the vault
 *   - ERC1155TokenReceived: ERC1155 tokens sent to the vault
 *   - ReferralRegistered:   New referral name registrations (tracking only)
 */
class EventWebhookProcessor {
  constructor(
    ethereumService,
    depositProcessorService,
    eventDeduplicationService,
    creditLedgerDb,
    contractConfig,
    logger
  ) {
    this.ethereumService = ethereumService;
    this.depositProcessorService = depositProcessorService;
    this.eventDeduplicationService = eventDeduplicationService;
    this.creditLedgerDb = creditLedgerDb;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Processes an incoming webhook payload and routes events to appropriate handlers.
   * @param {object} webhookPayload - The raw payload from the Alchemy webhook
   * @returns {Promise<{success: boolean, message: string, detail: object|null}>}
   */
  async processWebhook(webhookPayload) {
    this.logger.debug('[EventWebhookProcessor] Processing incoming Alchemy webhook...');

    const eventPayload = webhookPayload.payload || webhookPayload;

    if (eventPayload.type !== 'GRAPHQL' || !eventPayload.event?.data?.block?.logs) {
      this.logger.warn('[EventWebhookProcessor] Webhook payload is not a valid GraphQL block log notification or is malformed.', { payloadKeys: Object.keys(eventPayload || {}) });
      return { success: false, message: 'Invalid payload structure. Expected GraphQL block logs.', detail: null };
    }

    const logs = eventPayload.event.data.block.logs;
    this.logger.debug(`[EventWebhookProcessor] Webhook contains ${logs.length} event logs to process.`);

    // Get event fragments for the CreditVault contract
    const paymentFragment = this.ethereumService.getEventFragment('Payment', this.contractConfig.abi);
    const nftReceivedFragment = this.ethereumService.getEventFragment('NFTReceived', this.contractConfig.abi);
    const erc1155ReceivedFragment = this.ethereumService.getEventFragment('ERC1155TokenReceived', this.contractConfig.abi);
    const referralRegisteredFragment = this.ethereumService.getEventFragment('ReferralRegistered', this.contractConfig.abi);

    if (!paymentFragment) {
      this.logger.error('[EventWebhookProcessor] Payment event fragment not found in ABI. Cannot process webhook.');
      return { success: false, message: 'Server configuration error: Payment event not found in ABI.', detail: null };
    }

    const paymentHash = this.ethereumService.getEventTopic(paymentFragment);
    const nftReceivedHash = nftReceivedFragment ? this.ethereumService.getEventTopic(nftReceivedFragment) : null;
    const erc1155ReceivedHash = erc1155ReceivedFragment ? this.ethereumService.getEventTopic(erc1155ReceivedFragment) : null;
    const referralRegisteredHash = referralRegisteredFragment ? this.ethereumService.getEventTopic(referralRegisteredFragment) : null;

    let processedPayments = 0;
    let processedNfts = 0;
    let processedReferrals = 0;
    let skipped = 0;

    const parentBlockNumber = eventPayload.event?.data?.block?.number || null;

    for (const log of logs) {
      const { transaction, topics, data, index: logIndex } = log;
      const { hash: transactionHash } = transaction;
      const normalizedTxHash = transactionHash.toLowerCase();

      // Deduplication check
      if (this.eventDeduplicationService && this.eventDeduplicationService.isDuplicate(normalizedTxHash)) {
        this.logger.debug(`[EventWebhookProcessor] Skipping duplicate event for tx ${normalizedTxHash}`);
        skipped++;
        continue;
      }

      try {
        if (topics[0] === paymentHash) {
          const decodedLog = this.ethereumService.decodeEventLog(paymentFragment, data, topics, this.contractConfig.abi);
          await this.depositProcessorService.processPaymentEvent(decodedLog, normalizedTxHash, parentBlockNumber, logIndex);
          processedPayments++;

        } else if (nftReceivedHash && topics[0] === nftReceivedHash) {
          const decodedLog = this.ethereumService.decodeEventLog(nftReceivedFragment, data, topics, this.contractConfig.abi);
          await this.depositProcessorService.processNftDepositEvent(decodedLog, normalizedTxHash, parentBlockNumber, logIndex);
          processedNfts++;

        } else if (erc1155ReceivedHash && topics[0] === erc1155ReceivedHash) {
          const decodedLog = this.ethereumService.decodeEventLog(erc1155ReceivedFragment, data, topics, this.contractConfig.abi);
          await this.depositProcessorService.processErc1155DepositEvent(decodedLog, normalizedTxHash, parentBlockNumber, logIndex);
          processedNfts++;

        } else if (referralRegisteredHash && topics[0] === referralRegisteredHash) {
          const decodedLog = this.ethereumService.decodeEventLog(referralRegisteredFragment, data, topics, this.contractConfig.abi);
          await this._trackReferralRegistration(decodedLog, normalizedTxHash);
          processedReferrals++;
        }
      } catch (error) {
        this.logger.error(`[EventWebhookProcessor] Error processing event from tx ${normalizedTxHash}:`, error);
      }
    }

    return {
      success: true,
      message: `Processed ${processedPayments} payments, ${processedNfts} NFT deposits, ${processedReferrals} referral registrations. Skipped ${skipped} duplicates.`,
      detail: { processedPayments, processedNfts, processedReferrals, skipped }
    };
  }

  /**
   * Tracks a referral registration event for analytics.
   * @param {object} decodedLog - Decoded ReferralRegistered event
   * @param {string} txHash - Transaction hash
   * @private
   */
  async _trackReferralRegistration(decodedLog, txHash) {
    const { key, name, owner } = decodedLog;
    this.logger.info(`[EventWebhookProcessor] Referral registered: name="${name}", key=${key}, owner=${owner}, tx=${txHash}`);

    // Store in credit ledger for tracking
    try {
      await this.creditLedgerDb.createReferralVault({
        vault_name: name,
        referral_key: key,
        owner_address: owner,
        creation_tx_hash: txHash,
      });
    } catch (error) {
      // May already exist if re-processing
      this.logger.warn(`[EventWebhookProcessor] Failed to store referral registration (may be duplicate):`, error.message);
    }
  }
}

module.exports = EventWebhookProcessor;
