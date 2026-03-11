const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const DepositProcessorService = require('../../../src/core/services/alchemy/credit/DepositProcessorService');

describe('DepositProcessorService — magic amount wallet linking', () => {
  const MAGIC_AMOUNT = '62472512695822';
  const TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
  const DEPOSITOR = '0x7a5fd080d3b31de83f93b832e330012c7ef7953d';
  const TX_HASH = '0xdeadbeef';
  const REQUEST_ID = 'abc123requestid';
  const MASTER_ACCOUNT_ID = 'user001';

  function makeService({ walletLinkingService = null } = {}) {
    const creditLedgerDb = {
      findLedgerEntryByTxHash: async () => null,
      findQuotedEntry: async () => null,
      insertOne: async () => {},
    };
    const priceFeedService = {
      getPriceInUsd: async () => 3000,
    };
    const ethereumService = { chainId: '1' };
    const contractConfig = { address: '0xcreditvault' };
    const logger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

    return new DepositProcessorService(
      ethereumService,
      creditLedgerDb,
      priceFeedService,
      null,   // nftPriceService
      null,   // depositNotificationService
      null,   // eventDeduplicationService
      contractConfig,
      logger,
      null,   // userCoreDb
      null,   // internalApiClient
      walletLinkingService
    );
  }

  it('calls completeLinkingAndGenerateFirstApiKey when deposit matches a pending magic amount request', async () => {
    let completeLinkingCalled = false;
    let completeLinkingArgs = null;

    const walletLinkingService = {
      findPendingRequestByAmount: async (amount, token) => {
        if (amount === MAGIC_AMOUNT && token === TOKEN_ADDRESS) {
          return { _id: REQUEST_ID, master_account_id: MASTER_ACCOUNT_ID };
        }
        return null;
      },
      completeLinkingAndGenerateFirstApiKey: async (masterAccountId, requestId, walletAddress) => {
        completeLinkingCalled = true;
        completeLinkingArgs = { masterAccountId, requestId, walletAddress };
      },
    };

    const service = makeService({ walletLinkingService });

    await service.processPaymentEvent(
      { payer: DEPOSITOR, referralKey: '0x0', token: TOKEN_ADDRESS, amount: BigInt(MAGIC_AMOUNT), protocolAmount: BigInt(MAGIC_AMOUNT), referralAmount: 0n },
      TX_HASH, 100, 0
    );

    assert.equal(completeLinkingCalled, true, 'completeLinkingAndGenerateFirstApiKey should be called');
    assert.equal(completeLinkingArgs.masterAccountId, MASTER_ACCOUNT_ID);
    assert.equal(completeLinkingArgs.requestId, REQUEST_ID);
    assert.equal(completeLinkingArgs.walletAddress, DEPOSITOR);
  });

  it('does not call completeLinkingAndGenerateFirstApiKey when deposit amount does not match any pending request', async () => {
    let completeLinkingCalled = false;

    const walletLinkingService = {
      findPendingRequestByAmount: async () => null,
      completeLinkingAndGenerateFirstApiKey: async () => { completeLinkingCalled = true; },
    };

    const service = makeService({ walletLinkingService });

    await service.processPaymentEvent(
      { payer: DEPOSITOR, referralKey: '0x0', token: TOKEN_ADDRESS, amount: BigInt('999999999'), protocolAmount: BigInt('999999999'), referralAmount: 0n },
      TX_HASH, 100, 0
    );

    assert.equal(completeLinkingCalled, false, 'completeLinkingAndGenerateFirstApiKey should not be called for non-magic deposits');
  });

  it('still processes the deposit credit normally even when magic amount matches', async () => {
    let ledgerInserted = false;

    const walletLinkingService = {
      findPendingRequestByAmount: async () => ({ _id: REQUEST_ID, master_account_id: MASTER_ACCOUNT_ID }),
      completeLinkingAndGenerateFirstApiKey: async () => {},
    };

    const creditLedgerDb = {
      findLedgerEntryByTxHash: async () => null,
      findQuotedEntry: async () => null,
      insertOne: async () => { ledgerInserted = true; },
    };

    const service = new DepositProcessorService(
      { chainId: '1' }, creditLedgerDb, { getPriceInUsd: async () => 3000 },
      null, null, null, { address: '0xcreditvault' },
      { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
      null, null, walletLinkingService
    );

    await service.processPaymentEvent(
      { payer: DEPOSITOR, referralKey: '0x0', token: TOKEN_ADDRESS, amount: BigInt(MAGIC_AMOUNT), protocolAmount: BigInt(MAGIC_AMOUNT), referralAmount: 0n },
      TX_HASH, 100, 0
    );

    assert.equal(ledgerInserted, true, 'credit ledger entry should still be created for magic amount deposits');
  });
});
