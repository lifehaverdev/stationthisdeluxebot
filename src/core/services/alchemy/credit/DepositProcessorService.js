/**
 * DepositProcessorService
 *
 * Handles all deposit events from the CreditVault contract.
 * Two paths:
 *   1. Frontend-initiated: match to a pre-staged QUOTED ledger entry, award quoted points
 *   2. Direct deposit: live-price the token, risk assess if needed, calculate and award points
 *
 * All deposits are final (non-refundable). Points are awarded immediately.
 */
const { getFundingRate } = require('../tokenConfig');
const tokenDecimalService = require('../../tokenDecimalService');

const USD_TO_POINTS_CONVERSION_RATE = 0.000337;

class DepositProcessorService {
  constructor(
    ethereumService,
    creditLedgerDb,
    priceFeedService,
    nftPriceService,
    depositNotificationService,
    eventDeduplicationService,
    contractConfig,
    logger,
    userCoreDb = null,
    internalApiClient = null
  ) {
    this.ethereumService = ethereumService;
    this.creditLedgerDb = creditLedgerDb;
    this.priceFeedService = priceFeedService;
    this.nftPriceService = nftPriceService;
    this.depositNotificationService = depositNotificationService;
    this.eventDeduplicationService = eventDeduplicationService;
    this.contractConfig = contractConfig;
    this.logger = logger || console;
    this.userCoreDb = userCoreDb;
    this.internalApiClient = internalApiClient;
  }

  /**
   * Processes a Payment event from the CreditVault contract.
   *
   * Payment(address indexed payer, bytes32 indexed referralKey,
   *         address token, uint256 amount,
   *         uint256 protocolAmount, uint256 referralAmount)
   *
   * @param {object} decodedLog - Decoded Payment event
   * @param {string} transactionHash - Normalized tx hash
   * @param {number} blockNumber - Block number
   * @param {number} logIndex - Log index
   */
  async processPaymentEvent(decodedLog, transactionHash, blockNumber, logIndex) {
    const { payer, referralKey, token, amount, protocolAmount, referralAmount } = decodedLog;
    const depositorAddress = (payer || '').toLowerCase();
    const tokenAddress = (token || '').toLowerCase();
    const amountStr = amount.toString();

    this.logger.info(`[DepositProcessorService] Processing Payment event`, {
      tx: transactionHash, payer: depositorAddress, token: tokenAddress,
      amount: amountStr, referralKey, protocolAmount: protocolAmount?.toString(),
      referralAmount: referralAmount?.toString()
    });

    // Check for existing entry (idempotency)
    const existingEntry = await this.creditLedgerDb.findLedgerEntryByTxHash(transactionHash);
    if (existingEntry && existingEntry.status === 'CONFIRMED') {
      this.logger.debug(`[DepositProcessorService] Skipping tx ${transactionHash} — already confirmed.`);
      return;
    }

    // Resolve user account
    const masterAccountId = await this._resolveUserAccount(depositorAddress);

    // Try to match a pre-staged quote
    const quotedEntry = await this.creditLedgerDb.findQuotedEntry(depositorAddress, tokenAddress, amountStr);

    if (quotedEntry) {
      await this._confirmFromQuote(quotedEntry, transactionHash, blockNumber, logIndex, referralKey, protocolAmount, referralAmount, masterAccountId);
    } else {
      await this._confirmFromLivePricing(depositorAddress, tokenAddress, amountStr, transactionHash, blockNumber, logIndex, referralKey, protocolAmount, referralAmount, masterAccountId);
    }

    // Mark as processed for deduplication
    if (this.eventDeduplicationService) {
      this.eventDeduplicationService.markProcessed(transactionHash);
    }
  }

  /**
   * Frontend-initiated path: match to a pre-staged quote and award quoted points.
   * @private
   */
  async _confirmFromQuote(quotedEntry, transactionHash, blockNumber, logIndex, referralKey, protocolAmount, referralAmount, masterAccountId) {
    const pointsCredited = quotedEntry.points_quoted;

    this.logger.info(`[DepositProcessorService] Matched pre-staged quote ${quotedEntry._id} for tx ${transactionHash}. Awarding ${pointsCredited} points.`);

    await this.creditLedgerDb.transitionQuoteToConfirmed(quotedEntry._id, {
      deposit_tx_hash: transactionHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: this.contractConfig.address,
      master_account_id: masterAccountId,
      referral_key: referralKey || null,
      protocol_amount_wei: protocolAmount?.toString() || '0',
      referral_amount_wei: referralAmount?.toString() || '0',
      points_credited: pointsCredited,
      points_remaining: pointsCredited,
      // Carry forward pricing snapshot from quote
      funding_rate_applied: quotedEntry.pricing_snapshot?.fundingRate,
      gross_deposit_usd: quotedEntry.pricing_snapshot?.grossUsd,
      adjusted_gross_deposit_usd: quotedEntry.pricing_snapshot?.netAfterFundingRate,
      user_credited_usd: quotedEntry.pricing_snapshot?.userReceivesUsd,
    });

    // Notify user
    if (masterAccountId && this.depositNotificationService) {
      this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'confirmed', {
        deposit_tx_hash: transactionHash,
        points_credited: pointsCredited,
        user_credited_usd: quotedEntry.pricing_snapshot?.userReceivesUsd,
        originalTxHashes: [transactionHash],
      });
    }

    this.logger.info(`[DepositProcessorService] Quote-matched deposit confirmed: tx=${transactionHash}, points=${pointsCredited}`);
  }

  /**
   * Direct deposit path: live-price the token, calculate points, create and confirm.
   * @private
   */
  async _confirmFromLivePricing(depositorAddress, tokenAddress, amountStr, transactionHash, blockNumber, logIndex, referralKey, protocolAmount, referralAmount, masterAccountId) {
    this.logger.info(`[DepositProcessorService] No staged quote found for tx ${transactionHash}. Using live pricing.`);

    // Get live price
    const priceInUsd = await this.priceFeedService.getPriceInUsd(tokenAddress);
    if (!priceInUsd || priceInUsd <= 0) {
      this.logger.error(`[DepositProcessorService] Price unavailable for token ${tokenAddress}. Creating ERROR entry for tx ${transactionHash}.`);
      await this._createErrorEntry(depositorAddress, tokenAddress, amountStr, transactionHash, blockNumber, logIndex, referralKey, masterAccountId, 'Price feed unavailable');
      return;
    }

    const fundingRate = getFundingRate(tokenAddress);
    const grossDepositUsd = tokenDecimalService.calculateUsdValue(amountStr, tokenAddress, priceInUsd);
    const adjustedGrossDepositUsd = grossDepositUsd * fundingRate;
    const userCreditedUsd = adjustedGrossDepositUsd;
    const pointsCredited = Math.max(0, Math.floor(userCreditedUsd / USD_TO_POINTS_CONVERSION_RATE));

    this.logger.debug(`[DepositProcessorService] Live pricing for tx ${transactionHash}:`, {
      priceInUsd, fundingRate, grossDepositUsd, adjustedGrossDepositUsd, pointsCredited
    });

    // Create confirmed entry directly (no intermediate state)
    const ledgerEntry = {
      deposit_tx_hash: transactionHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: this.contractConfig.address,
      depositor_address: depositorAddress,
      master_account_id: masterAccountId,
      token_address: tokenAddress,
      deposit_amount_wei: amountStr,
      chain_id: String(this.ethereumService.chainId || '1'),
      referral_key: referralKey || null,
      protocol_amount_wei: protocolAmount?.toString() || '0',
      referral_amount_wei: referralAmount?.toString() || '0',
      funding_rate_applied: fundingRate,
      gross_deposit_usd: grossDepositUsd,
      adjusted_gross_deposit_usd: adjustedGrossDepositUsd,
      user_credited_usd: userCreditedUsd,
      points_credited: pointsCredited,
      points_remaining: pointsCredited,
      status: 'CONFIRMED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.creditLedgerDb.insertOne(ledgerEntry);

    // Notify user
    if (masterAccountId && this.depositNotificationService) {
      this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'confirmed', {
        deposit_tx_hash: transactionHash,
        points_credited: pointsCredited,
        user_credited_usd: userCreditedUsd,
        originalTxHashes: [transactionHash],
      });
    }

    this.logger.info(`[DepositProcessorService] Live-priced deposit confirmed: tx=${transactionHash}, points=${pointsCredited}`);
  }

  /**
   * Creates an ERROR ledger entry for deposits that can't be priced.
   * @private
   */
  async _createErrorEntry(depositorAddress, tokenAddress, amountStr, transactionHash, blockNumber, logIndex, referralKey, masterAccountId, reason) {
    const entry = {
      deposit_tx_hash: transactionHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: this.contractConfig.address,
      depositor_address: depositorAddress,
      master_account_id: masterAccountId,
      token_address: tokenAddress,
      deposit_amount_wei: amountStr,
      chain_id: String(this.ethereumService.chainId || '1'),
      referral_key: referralKey || null,
      status: 'ERROR',
      failure_reason: reason,
      points_credited: 0,
      points_remaining: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.creditLedgerDb.insertOne(entry);

    if (masterAccountId && this.depositNotificationService) {
      this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'failed', {
        deposit_tx_hash: transactionHash,
        reason,
        originalTxHashes: [transactionHash],
      });
    }
  }

  /**
   * Processes an NFTReceived event (ERC721 sent directly to vault).
   * NFT deposits don't have referral info — they come through safeTransferFrom.
   *
   * @param {object} decodedLog - Decoded NFTReceived event
   * @param {string} transactionHash - Normalized tx hash
   * @param {number} blockNumber - Block number
   * @param {number} logIndex - Log index
   */
  async processNftDepositEvent(decodedLog, transactionHash, blockNumber, logIndex) {
    const { from, token, tokenId } = decodedLog;
    const depositorAddress = (from || '').toLowerCase();
    const tokenAddress = (token || '').toLowerCase();

    this.logger.info(`[DepositProcessorService] Processing NFT deposit: token=${tokenAddress}, tokenId=${tokenId}, from=${depositorAddress}, tx=${transactionHash}`);

    // Idempotency
    const existing = await this.creditLedgerDb.findLedgerEntryByTxHash(transactionHash);
    if (existing && existing.status === 'CONFIRMED') {
      this.logger.debug(`[DepositProcessorService] Skipping NFT deposit tx ${transactionHash} — already confirmed.`);
      return;
    }

    const masterAccountId = await this._resolveUserAccount(depositorAddress);

    // Get NFT floor price
    let priceInUsd = 0;
    try {
      priceInUsd = await this.nftPriceService.getFloorPriceInUsd(tokenAddress);
    } catch (err) {
      this.logger.warn(`[DepositProcessorService] NFT floor price unavailable for ${tokenAddress}:`, err.message);
    }

    if (!priceInUsd || priceInUsd <= 0) {
      await this._createErrorEntry(depositorAddress, tokenAddress, '1', transactionHash, blockNumber, logIndex, null, masterAccountId, 'NFT floor price unavailable');
      return;
    }

    const fundingRate = getFundingRate(tokenAddress);
    const grossDepositUsd = priceInUsd;
    const adjustedGrossDepositUsd = grossDepositUsd * fundingRate;
    const pointsCredited = Math.max(0, Math.floor(adjustedGrossDepositUsd / USD_TO_POINTS_CONVERSION_RATE));

    const entry = {
      deposit_tx_hash: transactionHash,
      deposit_log_index: logIndex,
      deposit_block_number: blockNumber,
      vault_account: this.contractConfig.address,
      depositor_address: depositorAddress,
      master_account_id: masterAccountId,
      token_address: tokenAddress,
      token_id: tokenId?.toString(),
      deposit_amount_wei: '1',
      deposit_type: 'NFT',
      chain_id: String(this.ethereumService.chainId || '1'),
      funding_rate_applied: fundingRate,
      gross_deposit_usd: grossDepositUsd,
      adjusted_gross_deposit_usd: adjustedGrossDepositUsd,
      user_credited_usd: adjustedGrossDepositUsd,
      points_credited: pointsCredited,
      points_remaining: pointsCredited,
      status: 'CONFIRMED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.creditLedgerDb.insertOne(entry);

    if (this.eventDeduplicationService) {
      this.eventDeduplicationService.markProcessed(transactionHash);
    }

    if (masterAccountId && this.depositNotificationService) {
      this.depositNotificationService.notifyDepositUpdate(masterAccountId, 'confirmed', {
        deposit_tx_hash: transactionHash,
        points_credited: pointsCredited,
        originalTxHashes: [transactionHash],
      });
    }

    this.logger.info(`[DepositProcessorService] NFT deposit confirmed: tx=${transactionHash}, points=${pointsCredited}`);
  }

  /**
   * Processes an ERC1155TokenReceived event.
   * @param {object} decodedLog - Decoded ERC1155TokenReceived event
   * @param {string} transactionHash - Normalized tx hash
   * @param {number} blockNumber - Block number
   * @param {number} logIndex - Log index
   */
  async processErc1155DepositEvent(decodedLog, transactionHash, blockNumber, logIndex) {
    // For now, treat ERC1155 the same as ERC721 but log the amount/id
    const { from, token, id, amount } = decodedLog;
    this.logger.info(`[DepositProcessorService] ERC1155 deposit: token=${token}, id=${id}, amount=${amount}, from=${from}, tx=${transactionHash}`);

    // Reuse NFT flow with the token address
    await this.processNftDepositEvent({ from, token, tokenId: id }, transactionHash, blockNumber, logIndex);
  }

  /**
   * Resolves a wallet address to a master account ID.
   * Returns null if the wallet is not registered (direct contract user without account).
   * @param {string} address - Wallet address
   * @returns {Promise<string|null>}
   * @private
   */
  async _resolveUserAccount(address) {
    // Try direct DB lookup first
    if (this.userCoreDb) {
      try {
        const user = await this.userCoreDb.findOne({ 'wallets.address': address.toLowerCase() });
        if (user) return user._id.toString();
      } catch (err) {
        this.logger.warn(`[DepositProcessorService] userCoreDb lookup failed for ${address}:`, err.message);
      }
    }

    // Fall back to internal API
    if (this.internalApiClient) {
      try {
        const response = await this.internalApiClient.get(`/internal/v1/data/wallets/lookup?address=${address}`);
        return response.data.masterAccountId || null;
      } catch (err) {
        if (err.response?.status === 404) return null;
        this.logger.warn(`[DepositProcessorService] Wallet lookup API failed for ${address}:`, err.message);
      }
    }

    return null;
  }
}

module.exports = DepositProcessorService;
