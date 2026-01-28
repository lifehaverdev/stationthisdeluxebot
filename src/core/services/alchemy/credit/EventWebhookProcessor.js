// Configuration for reconciliation
const MONGODB_WRITE_DELAY_MS = 500; // Delay to ensure MongoDB write is visible across replicas
const STUCK_DEPOSIT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - deposits older than this are considered stuck
const MAX_RETRY_ATTEMPTS = 3;

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

    // Track processing attempts to prevent infinite retry loops
    this.processingAttempts = new Map();
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
   * @param {boolean} isReconciliation - Whether this is a reconciliation run (affects retry logic)
   * @private
   */
  async processPendingConfirmations(isReconciliation = false) {
    const creditLedgerDb = this.depositConfirmationService.creditLedgerDb;

    // Delay to ensure MongoDB write is visible across replicas
    await new Promise(resolve => setTimeout(resolve, MONGODB_WRITE_DELAY_MS));

    const pendingDepositsAll = await creditLedgerDb.findProcessableEntries();
    const pendingDeposits = pendingDepositsAll.filter(d => d.deposit_type !== 'TOKEN_DONATION');

    if (pendingDeposits.length === 0) {
      this.logger.info('[EventWebhookProcessor] No pending deposits found after webhook processing.');
      return { processed: 0, failed: 0, skipped: 0 };
    }

    this.logger.info(`[EventWebhookProcessor] Found ${pendingDeposits.length} pending deposits to confirm.`);

    // Group deposits by user and token
    const groupedDeposits = new Map();
    for (const deposit of pendingDeposits) {
      const key = `${deposit.depositor_address.toLowerCase()}-${deposit.token_address.toLowerCase()}`;
      if (!groupedDeposits.has(key)) {
        groupedDeposits.set(key, []);
      }
      groupedDeposits.get(key).push(deposit);
    }

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    // Process each group with error isolation
    for (const [groupKey, deposits] of groupedDeposits.entries()) {
      // Check retry attempts for this group
      const attemptKey = deposits.map(d => d.deposit_tx_hash).sort().join(',');
      const attempts = this.processingAttempts.get(attemptKey) || 0;

      if (attempts >= MAX_RETRY_ATTEMPTS && !isReconciliation) {
        this.logger.warn(`[EventWebhookProcessor] Skipping group ${groupKey} - max retry attempts (${MAX_RETRY_ATTEMPTS}) reached.`);
        skipped += deposits.length;
        continue;
      }

      try {
        this.logger.info(`[EventWebhookProcessor] Processing deposit group: ${groupKey} (${deposits.length} deposits, attempt ${attempts + 1})`);
        await this.depositConfirmationService.confirmDepositGroup(deposits);
        processed += deposits.length;
        // Clear retry counter on success
        this.processingAttempts.delete(attemptKey);
      } catch (error) {
        failed += deposits.length;
        this.processingAttempts.set(attemptKey, attempts + 1);
        this.logger.error(`[EventWebhookProcessor] Failed to process group ${groupKey} (attempt ${attempts + 1}):`, {
          error: error.message,
          depositHashes: deposits.map(d => d.deposit_tx_hash),
          willRetry: attempts + 1 < MAX_RETRY_ATTEMPTS
        });

        // Mark deposits with ERROR status if max attempts reached
        if (attempts + 1 >= MAX_RETRY_ATTEMPTS) {
          this.logger.error(`[EventWebhookProcessor] Max retries reached for group ${groupKey}. Marking deposits as ERROR.`);
          for (const deposit of deposits) {
            try {
              await creditLedgerDb.updateLedgerStatus(deposit.deposit_tx_hash, 'ERROR', {
                failure_reason: `Processing failed after ${MAX_RETRY_ATTEMPTS} attempts: ${error.message}`,
                last_error: error.message,
                last_attempt_at: new Date()
              });
            } catch (updateError) {
              this.logger.error(`[EventWebhookProcessor] Failed to update deposit status to ERROR:`, updateError);
            }
          }
        }
      }
    }

    this.logger.info(`[EventWebhookProcessor] Processing complete. Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}`);
    return { processed, failed, skipped };
  }

  /**
   * Reconciles stuck PENDING_CONFIRMATION deposits.
   * This should be called periodically (e.g., every 5 minutes) to catch any deposits
   * that got stuck due to transient failures or race conditions.
   * @returns {Promise<{reconciled: number, stillStuck: number}>}
   */
  async reconcileStuckDeposits() {
    this.logger.info('[EventWebhookProcessor] Starting reconciliation of stuck deposits...');
    const creditLedgerDb = this.depositConfirmationService.creditLedgerDb;

    const pendingDepositsAll = await creditLedgerDb.findProcessableEntries();
    const now = Date.now();

    // Filter for deposits that are older than the threshold
    const stuckDeposits = pendingDepositsAll.filter(d => {
      const createdAt = new Date(d.createdAt).getTime();
      const age = now - createdAt;
      return age > STUCK_DEPOSIT_THRESHOLD_MS && d.deposit_type !== 'TOKEN_DONATION';
    });

    if (stuckDeposits.length === 0) {
      this.logger.info('[EventWebhookProcessor] No stuck deposits found during reconciliation.');
      return { reconciled: 0, stillStuck: 0 };
    }

    this.logger.warn(`[EventWebhookProcessor] Found ${stuckDeposits.length} stuck deposits older than ${STUCK_DEPOSIT_THRESHOLD_MS / 1000}s. Attempting reconciliation...`);

    // Log details of stuck deposits for debugging
    for (const deposit of stuckDeposits) {
      const age = Math.round((now - new Date(deposit.createdAt).getTime()) / 1000);
      this.logger.info(`[EventWebhookProcessor] Stuck deposit: ${deposit.deposit_tx_hash} (${deposit.token_address}), age: ${age}s, status: ${deposit.status}`);
    }

    // Reset retry counters for stuck deposits (they've been stuck long enough to warrant a fresh try)
    for (const deposit of stuckDeposits) {
      const attemptKey = deposit.deposit_tx_hash;
      this.processingAttempts.delete(attemptKey);
    }

    // Group and process with reconciliation flag
    const groupedDeposits = new Map();
    for (const deposit of stuckDeposits) {
      const key = `${deposit.depositor_address.toLowerCase()}-${deposit.token_address.toLowerCase()}`;
      if (!groupedDeposits.has(key)) {
        groupedDeposits.set(key, []);
      }
      groupedDeposits.get(key).push(deposit);
    }

    let reconciled = 0;
    let stillStuck = 0;

    for (const [groupKey, deposits] of groupedDeposits.entries()) {
      try {
        this.logger.info(`[EventWebhookProcessor] Reconciling stuck group: ${groupKey} (${deposits.length} deposits)`);
        await this.depositConfirmationService.confirmDepositGroup(deposits);
        reconciled += deposits.length;
      } catch (error) {
        stillStuck += deposits.length;
        this.logger.error(`[EventWebhookProcessor] Reconciliation failed for group ${groupKey}:`, error.message);
      }
    }

    this.logger.info(`[EventWebhookProcessor] Reconciliation complete. Reconciled: ${reconciled}, Still stuck: ${stillStuck}`);
    return { reconciled, stillStuck };
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

