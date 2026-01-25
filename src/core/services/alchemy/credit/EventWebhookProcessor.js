/**
 * EventWebhookProcessor
 * 
 * Handles webhook routing and event decoding.
 * Routes incoming webhook events to appropriate processors based on event type.
 */
class EventWebhookProcessor {
  constructor(
    ethereumService,
    depositProcessorService,
    donationProcessorService,
    withdrawalProcessorService,
    referralVaultService,
    eventDeduplicationService,
    depositConfirmationService,
    contractConfig,
    logger
  ) {
    this.ethereumService = ethereumService;
    this.depositProcessorService = depositProcessorService;
    this.donationProcessorService = donationProcessorService;
    this.withdrawalProcessorService = withdrawalProcessorService;
    this.referralVaultService = referralVaultService;
    this.eventDeduplicationService = eventDeduplicationService;
    this.depositConfirmationService = depositConfirmationService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
  }

  /**
   * Processes an incoming webhook payload and routes events to appropriate handlers.
   * @param {object} webhookPayload - The raw payload from the Alchemy webhook
   * @returns {Promise<{success: boolean, message: string, detail: object|null}>}
   */
  async processWebhook(webhookPayload) {
    this.logger.info('[EventWebhookProcessor] Processing incoming Alchemy webhook...');

    // Handle cases where the relevant data might be nested inside a 'payload' property
    const eventPayload = webhookPayload.payload || webhookPayload;

    if (eventPayload.type !== 'GRAPHQL' || !eventPayload.event?.data?.block?.logs) {
      this.logger.warn('[EventWebhookProcessor] Webhook payload is not a valid GraphQL block log notification or is malformed.', { payloadKeys: Object.keys(eventPayload || {}) });
      return { success: false, message: 'Invalid payload structure. Expected GraphQL block logs.', detail: null };
    }

    const logs = eventPayload.event.data.block.logs;
    this.logger.info(`[EventWebhookProcessor] Webhook contains ${logs.length} event logs to process.`);

    // Get event fragments for all events we're interested in
    const depositEventFragment = this.ethereumService.getEventFragment('ContributionRecorded', this.contractConfig.abi);
    const donationEventFragment = this.ethereumService.getEventFragment('Donation', this.contractConfig.abi);
    const withdrawalEventFragment = this.ethereumService.getEventFragment('RescissionRequested', this.contractConfig.abi);
    const vaultCreatedEventFragment = this.ethereumService.getEventFragment('FundChartered', this.contractConfig.abi);

    if (!depositEventFragment || !donationEventFragment || !withdrawalEventFragment || !vaultCreatedEventFragment) {
      this.logger.error("[EventWebhookProcessor] Event fragments not found in ABI. Cannot process webhook.");
      return { success: false, message: "Server configuration error: ABI issue.", detail: null };
    }

    const depositEventHash = this.ethereumService.getEventTopic(depositEventFragment);
    const donationEventHash = this.ethereumService.getEventTopic(donationEventFragment);
    const withdrawalEventHash = this.ethereumService.getEventTopic(withdrawalEventFragment);
    const vaultCreatedEventHash = this.ethereumService.getEventTopic(vaultCreatedEventFragment);

    let processedDeposits = 0;
    let processedDonations = 0;
    let processedWithdrawals = 0;
    let processedVaultCreations = 0;

    // Parent block number is available on the GraphQL wrapper itself (applies to all logs)
    const parentBlockNumber = eventPayload.event?.data?.block?.number || null;

    for (const log of logs) {
      const { transaction, topics, data, index: logIndex } = log;
      const { hash: transactionHash } = transaction;
      const normalizedTxHash = transactionHash.toLowerCase();

      // Check for duplicates
      if (this.eventDeduplicationService && this.eventDeduplicationService.isDuplicate(normalizedTxHash)) {
        this.logger.info(`[EventWebhookProcessor] Skipping duplicate webhook event for tx ${normalizedTxHash} (recently processed)`);
        continue;
      }

      try {
        if (topics[0] === donationEventHash) {
          // Process donation event (instant credit)
          const decodedLog = this.ethereumService.decodeEventLog(donationEventFragment, data, topics, this.contractConfig.abi);
          await this.donationProcessorService.processDonationEvent(decodedLog, normalizedTxHash, parentBlockNumber, logIndex);
          processedDonations++;
        } else if (topics[0] === depositEventHash) {
          // Process deposit event
          const decodedLog = this.ethereumService.decodeEventLog(depositEventFragment, data, topics, this.contractConfig.abi);
          await this.depositProcessorService.processDepositEvent(decodedLog, normalizedTxHash, parentBlockNumber, logIndex);
          processedDeposits++;
        } else if (topics[0] === withdrawalEventHash) {
          // Process withdrawal event
          const decodedLog = this.ethereumService.decodeEventLog(withdrawalEventFragment, data, topics, this.contractConfig.abi);
          await this.withdrawalProcessorService.processWithdrawalRequest(decodedLog, normalizedTxHash, parentBlockNumber);
          processedWithdrawals++;
        } else if (topics[0] === vaultCreatedEventHash) {
          // Process vault creation event
          const decodedLog = this.ethereumService.decodeEventLog(vaultCreatedEventFragment, data, topics, this.contractConfig.abi);
          await this.referralVaultService.finalizeDeployment(normalizedTxHash, decodedLog.fundAddress);
          processedVaultCreations++;
        }
      } catch (error) {
        this.logger.error(`[EventWebhookProcessor] Error processing event from tx ${normalizedTxHash}:`, error);
        // Continue processing other logs
      }
    }

    // If any deposits were processed, trigger the processing pipeline
    if (processedDeposits > 0) {
      this.logger.info(`[EventWebhookProcessor] Triggering processing of pending deposits...`);
      await this.processPendingConfirmations();
    }

    return {
      success: true,
      message: `Processed ${processedDeposits} deposits, ${processedDonations} donations, ${processedVaultCreations} vault creations, and ${processedWithdrawals} withdrawals.`,
      detail: { processedDeposits, processedDonations, processedWithdrawals, processedVaultCreations }
    };
  }

  /**
   * Processes pending confirmations for deposits.
   * @private
   */
  async processPendingConfirmations() {
    // This delegates to DepositConfirmationService
    // We need to get pending deposits and process them
    const creditLedgerDb = this.depositConfirmationService.creditLedgerDb;

    // Small delay to ensure MongoDB write is visible (mitigates read-after-write race condition)
    await new Promise(resolve => setTimeout(resolve, 100));

    const pendingDepositsAll = await creditLedgerDb.findProcessableEntries();
    const pendingDeposits = pendingDepositsAll.filter(d => d.deposit_type !== 'TOKEN_DONATION');

    if (pendingDeposits.length === 0) {
      this.logger.info('[EventWebhookProcessor] No pending deposits found after webhook processing.');
      return;
    }

    this.logger.info(`[EventWebhookProcessor] Found ${pendingDeposits.length} pending deposits to confirm.`);

    // Group deposits by user and token
    const groupedDeposits = new Map();
    for (const deposit of pendingDeposits) {
      const key = `${deposit.depositor_address}-${deposit.token_address}`;
      if (!groupedDeposits.has(key)) {
        groupedDeposits.set(key, []);
      }
      groupedDeposits.get(key).push(deposit);
    }

    // Process each group
    for (const [groupKey, deposits] of groupedDeposits.entries()) {
      this.logger.info(`[EventWebhookProcessor] Processing deposit group: ${groupKey} (${deposits.length} deposits)`);
      await this.depositConfirmationService.confirmDepositGroup(deposits);
    }
  }

  /**
   * Routes a single event to the appropriate processor.
   * @param {object} log - The log object
   * @param {object} eventFragments - Map of event fragments
   * @returns {Promise<void>}
   */
  async routeEvent(log, eventFragments) {
    const { transaction, topics, data, index: logIndex } = log;
    const { hash: transactionHash } = transaction;
    const normalizedTxHash = transactionHash.toLowerCase();

    // Implementation would route based on event type
    // This is a helper method for more granular control if needed
    throw new Error('routeEvent not yet implemented - use processWebhook instead');
  }
}

module.exports = EventWebhookProcessor;

