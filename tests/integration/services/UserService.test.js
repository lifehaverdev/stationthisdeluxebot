/**
 * UserService unit tests
 *
 * Tests:
 *   1. findOrCreate() - returns { masterAccountId, user, isNewUser }, validates inputs
 *   2. findById()     - returns user or null
 *   3. findByPlatformId() - returns user or null
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { UserService } = require('../../../src/core/services/store/users/UserService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_USER_ID = '649d9bc2381f3f90f7777e10';

function makeUserCoreDb() {
  let storedUser = null;
  const findOrCreateCalls = [];
  const findByIdCalls = [];
  const findByPlatformCalls = [];

  return {
    setStoredUser: (u) => { storedUser = u; },
    findOrCreateByPlatformId: async (platform, platformId, additionalData) => {
      findOrCreateCalls.push({ platform, platformId, additionalData });
      if (storedUser) return { user: storedUser, isNew: false };
      const newUser = { _id: new ObjectId(FAKE_USER_ID), platformIdentities: { [platform]: platformId } };
      return { user: newUser, isNew: true };
    },
    findUserCoreById: async (masterAccountId) => {
      findByIdCalls.push(masterAccountId);
      return storedUser;
    },
    findUserCoreByPlatformId: async (platform, platformId) => {
      findByPlatformCalls.push({ platform, platformId });
      return storedUser;
    },
    _findOrCreateCalls: findOrCreateCalls,
    _findByIdCalls: findByIdCalls,
    _findByPlatformCalls: findByPlatformCalls,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UserService', () => {

  describe('findOrCreate()', () => {
    test('returns existing user with masterAccountId and isNewUser=false', async () => {
      const userCoreDb = makeUserCoreDb();
      const fakeUser = { _id: new ObjectId(FAKE_USER_ID), isAdmin: false };
      userCoreDb.setStoredUser(fakeUser);

      const service = new UserService({ userCoreDb });
      const result = await service.findOrCreate({ platform: 'telegram', platformId: '12345' });

      assert.equal(result.masterAccountId, FAKE_USER_ID);
      assert.deepEqual(result.user, fakeUser);
      assert.equal(result.isNewUser, false);
    });

    test('returns new user with isNewUser=true when not found', async () => {
      const userCoreDb = makeUserCoreDb();
      const service = new UserService({ userCoreDb });

      const result = await service.findOrCreate({ platform: 'telegram', platformId: '99999' });

      assert.ok(result.masterAccountId, 'should return masterAccountId');
      assert.equal(result.isNewUser, true);
      assert.ok(result.user, 'should return user object');
    });

    test('passes platformContext to userCoreDb', async () => {
      const userCoreDb = makeUserCoreDb();
      const service = new UserService({ userCoreDb });
      const ctx = { firstName: 'Alice', username: 'alice' };

      await service.findOrCreate({ platform: 'telegram', platformId: '111', platformContext: ctx });

      assert.equal(userCoreDb._findOrCreateCalls.length, 1);
      assert.deepEqual(userCoreDb._findOrCreateCalls[0].additionalData, ctx);
    });

    test('defaults platformContext to {} when omitted', async () => {
      const userCoreDb = makeUserCoreDb();
      const service = new UserService({ userCoreDb });

      await service.findOrCreate({ platform: 'telegram', platformId: '222' });

      assert.deepEqual(userCoreDb._findOrCreateCalls[0].additionalData, {});
    });

    test('throws when platform is missing', async () => {
      const service = new UserService({ userCoreDb: makeUserCoreDb() });
      await assert.rejects(() => service.findOrCreate({ platformId: '123' }), /platform/i);
    });

    test('throws when platformId is missing', async () => {
      const service = new UserService({ userCoreDb: makeUserCoreDb() });
      await assert.rejects(() => service.findOrCreate({ platform: 'telegram' }), /platformId/i);
    });

    test('throws when platform is empty string', async () => {
      const service = new UserService({ userCoreDb: makeUserCoreDb() });
      await assert.rejects(() => service.findOrCreate({ platform: '  ', platformId: '123' }), /platform/i);
    });
  });

  describe('findById()', () => {
    test('returns user when found', async () => {
      const userCoreDb = makeUserCoreDb();
      const fakeUser = { _id: new ObjectId(FAKE_USER_ID), isAdmin: true };
      userCoreDb.setStoredUser(fakeUser);

      const service = new UserService({ userCoreDb });
      const result = await service.findById(FAKE_USER_ID);
      assert.deepEqual(result, fakeUser);
    });

    test('returns null when not found', async () => {
      const userCoreDb = makeUserCoreDb();
      userCoreDb.setStoredUser(null);

      const service = new UserService({ userCoreDb });
      const result = await service.findById(FAKE_USER_ID);
      assert.equal(result, null);
    });

    test('returns null when masterAccountId is falsy', async () => {
      const service = new UserService({ userCoreDb: makeUserCoreDb() });
      const result = await service.findById(null);
      assert.equal(result, null);
    });
  });

  describe('findByPlatformId()', () => {
    test('returns user when found', async () => {
      const userCoreDb = makeUserCoreDb();
      const fakeUser = { _id: new ObjectId(FAKE_USER_ID) };
      userCoreDb.setStoredUser(fakeUser);

      const service = new UserService({ userCoreDb });
      const result = await service.findByPlatformId('telegram', '12345');
      assert.deepEqual(result, fakeUser);
    });

    test('returns null when not found', async () => {
      const userCoreDb = makeUserCoreDb();
      userCoreDb.setStoredUser(null);

      const service = new UserService({ userCoreDb });
      const result = await service.findByPlatformId('telegram', '99999');
      assert.equal(result, null);
    });

    test('returns null when platform or platformId is missing', async () => {
      const service = new UserService({ userCoreDb: makeUserCoreDb() });
      assert.equal(await service.findByPlatformId(null, '123'), null);
      assert.equal(await service.findByPlatformId('telegram', null), null);
    });
  });
});
