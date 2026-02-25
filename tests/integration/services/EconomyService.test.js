/**
 * EconomyService unit tests
 *
 * Tests:
 *   1. getUserWalletAddress() - returns primary wallet, first wallet, null
 *   2. spend() - deducts in correct order (lowest funding_rate first)
 *   3. spend() - throws INSUFFICIENT_FUNDS when no deposits
 *   4. spend() - wallet fallback when no masterAccountId deposits
 *   5. creditPoints() - calls createRewardCreditEntry with correct payload
 *   6. updateExp() - calls updateExperience with correct args
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { EconomyService } = require('../../../src/core/services/store/economy/EconomyService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_ID = '649d9bc2381f3f90f7777e99';
const FAKE_WALLET = '0xABCDEF1234567890';

function makeDeposit(id, pointsRemaining, fundingRate = 0) {
  const { ObjectId } = require('mongodb');
  return {
    _id: new ObjectId(id || '649d9bc2381f3f90f7777e01'),
    points_remaining: pointsRemaining,
    funding_rate_applied: fundingRate,
    token_address: '0xTOKEN',
  };
}

/** Minimal transaction mock — runs the callback synchronously */
function makeTransactionLedger(deposits) {
  const deductions = [];
  return {
    findActiveDepositsForUser: async () => deposits,
    findActiveDepositsForWalletAddress: async () => [],
    deductPointsFromDeposit: async (id, amount) => {
      deductions.push({ id: id.toString(), amount });
      const dep = deposits.find(d => d._id.toString() === id.toString());
      if (dep) dep.points_remaining -= amount;
    },
    withTransaction: async (fn) => fn({}),
    _deductions: deductions,
  };
}

function makeUserCore(wallets = []) {
  return { findUserCoreById: async () => ({ wallets }) };
}

function makeUserEconomy() {
  const calls = [];
  return {
    updateExperience: async (oid, expChange) => {
      calls.push({ oid: oid.toString(), expChange });
      return { matchedCount: 1 };
    },
    _calls: calls,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EconomyService', () => {

  describe('getUserWalletAddress()', () => {
    test('returns primary wallet address when isPrimary is set', async () => {
      const wallets = [
        { address: '0xSECONDARY', isPrimary: false },
        { address: '0xPRIMARY', isPrimary: true },
      ];
      const service = new EconomyService({ userCoreDb: makeUserCore(wallets) });
      const addr = await service.getUserWalletAddress(FAKE_ID);
      assert.equal(addr, '0xPRIMARY');
    });

    test('returns first wallet when no isPrimary flag', async () => {
      const wallets = [
        { address: '0xFIRST', isPrimary: false },
        { address: '0xSECOND', isPrimary: false },
      ];
      const service = new EconomyService({ userCoreDb: makeUserCore(wallets) });
      const addr = await service.getUserWalletAddress(FAKE_ID);
      assert.equal(addr, '0xFIRST');
    });

    test('returns null when user has no wallets', async () => {
      const service = new EconomyService({ userCoreDb: makeUserCore([]) });
      const addr = await service.getUserWalletAddress(FAKE_ID);
      assert.equal(addr, null);
    });

    test('returns null when user is not found', async () => {
      const userCore = { findUserCoreById: async () => null };
      const service = new EconomyService({ userCoreDb: userCore });
      const addr = await service.getUserWalletAddress(FAKE_ID);
      assert.equal(addr, null);
    });
  });

  describe('spend()', () => {
    test('deducts points from deposits sorted by lowest funding_rate first', async () => {
      const d1 = makeDeposit('649d9bc2381f3f90f7777e01', 500, 0.05);
      const d2 = makeDeposit('649d9bc2381f3f90f7777e02', 500, 0.01);
      const d3 = makeDeposit('649d9bc2381f3f90f7777e03', 500, 0.03);
      const ledger = makeTransactionLedger([d1, d2, d3]);

      const service = new EconomyService({
        creditLedgerDb: ledger,
        userCoreDb: makeUserCore([]),
      });

      const summary = await service.spend(FAKE_ID, { pointsToSpend: 600 });

      // d2 (rate 0.01) should be drained first, then d3 (rate 0.03)
      assert.equal(summary[0].fundingRate, 0.01);
      assert.equal(summary[0].pointsDeducted, 500);
      assert.equal(summary[1].fundingRate, 0.03);
      assert.equal(summary[1].pointsDeducted, 100);
    });

    test('throws INSUFFICIENT_FUNDS when user has no active deposits', async () => {
      const ledger = {
        findActiveDepositsForUser: async () => [],
        findActiveDepositsForWalletAddress: async () => [],
        withTransaction: async (fn) => fn({}),
      };
      const service = new EconomyService({
        creditLedgerDb: ledger,
        userCoreDb: makeUserCore([]),
      });

      await assert.rejects(
        () => service.spend(FAKE_ID, { pointsToSpend: 100 }),
        (err) => {
          assert.equal(err.code, 'INSUFFICIENT_FUNDS');
          return true;
        }
      );
    });

    test('throws INSUFFICIENT_FUNDS when points are insufficient', async () => {
      const dep = makeDeposit('649d9bc2381f3f90f7777e01', 50, 0);
      const ledger = makeTransactionLedger([dep]);
      const service = new EconomyService({
        creditLedgerDb: ledger,
        userCoreDb: makeUserCore([]),
      });

      await assert.rejects(
        () => service.spend(FAKE_ID, { pointsToSpend: 200 }),
        (err) => {
          assert.equal(err.code, 'INSUFFICIENT_FUNDS');
          return true;
        }
      );
    });

    test('falls back to wallet-based deposits when masterAccountId has none', async () => {
      const walletDeposit = makeDeposit('649d9bc2381f3f90f7777e04', 300, 0);
      let walletQueried = false;
      const ledger = {
        findActiveDepositsForUser: async () => [],
        findActiveDepositsForWalletAddress: async (addr) => {
          walletQueried = true;
          assert.equal(addr, FAKE_WALLET);
          return [walletDeposit];
        },
        deductPointsFromDeposit: async (id, amount) => {
          walletDeposit.points_remaining -= amount;
        },
        withTransaction: async (fn) => fn({}),
      };
      const service = new EconomyService({
        creditLedgerDb: ledger,
        userCoreDb: makeUserCore([{ address: FAKE_WALLET, isPrimary: true }]),
      });

      const summary = await service.spend(FAKE_ID, { pointsToSpend: 100 });
      assert.ok(walletQueried, 'should have queried wallet deposits');
      assert.equal(summary[0].pointsDeducted, 100);
    });

    test('throws if pointsToSpend is not a positive integer', async () => {
      const service = new EconomyService({ creditLedgerDb: {}, userCoreDb: makeUserCore([]) });
      await assert.rejects(() => service.spend(FAKE_ID, { pointsToSpend: -1 }));
      await assert.rejects(() => service.spend(FAKE_ID, { pointsToSpend: 0 }));
      await assert.rejects(() => service.spend(FAKE_ID, { pointsToSpend: 1.5 }));
    });
  });

  describe('creditPoints()', () => {
    test('calls createRewardCreditEntry with correct payload', async () => {
      let captured;
      const ledger = {
        createRewardCreditEntry: async (payload) => {
          captured = payload;
          return { insertedId: 'newEntryId' };
        },
      };
      const service = new EconomyService({ creditLedgerDb: ledger });

      const result = await service.creditPoints(FAKE_ID, {
        points: 50,
        description: 'Test reward',
        rewardType: 'TEST_TYPE',
        relatedItems: { foo: 'bar' },
      });

      assert.equal(result.entryId, 'newEntryId');
      assert.equal(captured.points, 50);
      assert.equal(captured.description, 'Test reward');
      assert.equal(captured.rewardType, 'TEST_TYPE');
      assert.deepEqual(captured.relatedItems, { foo: 'bar' });
      assert.equal(captured.masterAccountId.toString(), FAKE_ID);
    });

    test('throws if points is not a positive integer', async () => {
      const service = new EconomyService({ creditLedgerDb: {} });
      await assert.rejects(() => service.creditPoints(FAKE_ID, { points: 0, description: 'x', rewardType: 'X' }));
      await assert.rejects(() => service.creditPoints(FAKE_ID, { points: -5, description: 'x', rewardType: 'X' }));
    });

    test('throws if description is missing', async () => {
      const service = new EconomyService({ creditLedgerDb: {} });
      await assert.rejects(() => service.creditPoints(FAKE_ID, { points: 10, rewardType: 'X' }));
    });

    test('throws if rewardType is missing', async () => {
      const service = new EconomyService({ creditLedgerDb: {} });
      await assert.rejects(() => service.creditPoints(FAKE_ID, { points: 10, description: 'x' }));
    });
  });

  describe('updateExp()', () => {
    test('calls updateExperience with masterAccountId and expChange', async () => {
      const userEconomy = makeUserEconomy();
      const service = new EconomyService({ userEconomyDb: userEconomy });

      await service.updateExp(FAKE_ID, 42);

      assert.equal(userEconomy._calls.length, 1);
      assert.equal(userEconomy._calls[0].oid, FAKE_ID);
      assert.equal(userEconomy._calls[0].expChange, 42);
    });

    test('allows negative expChange', async () => {
      const userEconomy = makeUserEconomy();
      const service = new EconomyService({ userEconomyDb: userEconomy });

      await service.updateExp(FAKE_ID, -10);
      assert.equal(userEconomy._calls[0].expChange, -10);
    });

    test('throws if expChange is not an integer', async () => {
      const userEconomy = makeUserEconomy();
      const service = new EconomyService({ userEconomyDb: userEconomy });

      await assert.rejects(() => service.updateExp(FAKE_ID, 'not-a-number'));
    });
  });
});
