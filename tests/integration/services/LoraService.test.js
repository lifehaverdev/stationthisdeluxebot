/**
 * LoraService unit tests
 *
 * Tests:
 *   getTriggerMapData() - replaces GET /internal/v1/data/lora/trigger-map-data
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { LoraService } = require('../../../src/core/services/store/lora/LoraService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_USER_ID = '649d9bc2381f3f90f7777a01';
const FAKE_LORA_ID_1 = '649d9bc2381f3f90f7777b01';
const FAKE_LORA_ID_2 = '649d9bc2381f3f90f7777b02';

function makePublicLora(overrides = {}) {
  return {
    _id: { toString: () => FAKE_LORA_ID_1 },
    slug: 'my-lora',
    triggerWords: ['myperson'],
    cognates: [],
    defaultWeight: 0.8,
    ownedBy: null,
    updatedAt: new Date('2024-01-01'),
    checkpoint: 'FLUX',
    ...overrides,
  };
}

function makeLoraModelsDb({ publicLoras = [], findByIdResult = null } = {}) {
  return {
    findMany: async () => publicLoras,
    findById: async () => findByIdResult,
  };
}

function makeLoraPermissionsDb({ permissions = [] } = {}) {
  return {
    listAccessibleLoRAs: async () => permissions,
  };
}

function makeLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LoraService', () => {

  describe('getTriggerMapData() — public map (no userId)', () => {

    test('returns empty object when no public LoRAs', async () => {
      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({ publicLoras: [] }),
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(null);
      assert.deepEqual(result, {});
    });

    test('builds trigger map from public LoRA trigger words', async () => {
      const lora = makePublicLora();
      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({ publicLoras: [lora] }),
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(null);
      assert.ok(result['myperson'], 'trigger key should exist');
      assert.equal(result['myperson'].length, 1);
      assert.equal(result['myperson'][0].slug, 'my-lora');
      assert.equal(result['myperson'][0].access, 'public');
      assert.equal(result['myperson'][0].checkpoint, 'FLUX');
    });

    test('trigger keys are lowercased', async () => {
      const lora = makePublicLora({ triggerWords: ['MyPerson'] });
      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({ publicLoras: [lora] }),
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(null);
      assert.ok(result['myperson'], 'key should be lowercase');
      assert.equal(result['MyPerson'], undefined);
    });

    test('cognates are indexed under their word key', async () => {
      const lora = makePublicLora({
        triggerWords: ['reallylongname'],
        cognates: [{ word: 'shortname', replaceWith: 'reallylongname' }],
      });
      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({ publicLoras: [lora] }),
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(null);
      assert.ok(result['shortname'], 'cognate key should exist');
      assert.equal(result['shortname'][0].isCognate, true);
      assert.equal(result['shortname'][0].replaceWithBaseTrigger, 'reallylongname');
    });

    test('LoRA with no triggers and no cognates is skipped', async () => {
      const lora = makePublicLora({ triggerWords: [], cognates: [] });
      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({ publicLoras: [lora] }),
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(null);
      assert.deepEqual(result, {});
    });

  });

  describe('getTriggerMapData() — with userId (private LoRA merge)', () => {

    test('returns public map when user has no permissions', async () => {
      const lora = makePublicLora();
      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({ publicLoras: [lora] }),
        loraPermissionsDb: makeLoraPermissionsDb({ permissions: [] }),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(FAKE_USER_ID);
      assert.ok(result['myperson']);
      assert.equal(result['myperson'][0].access, 'public');
    });

    test('private LoRA is merged into trigger map', async () => {
      const publicLora = makePublicLora();
      const privateLora = {
        _id: { toString: () => FAKE_LORA_ID_2 },
        slug: 'private-lora',
        triggerWords: ['secretstyle'],
        cognates: [],
        defaultWeight: 1.0,
        ownedBy: { toString: () => FAKE_USER_ID },
        updatedAt: new Date('2024-01-02'),
        checkpoint: 'SD1.5',
      };

      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({
          publicLoras: [publicLora],
          findByIdResult: privateLora,
        }),
        loraPermissionsDb: makeLoraPermissionsDb({
          permissions: [{ loraId: { toString: () => FAKE_LORA_ID_2 } }],
        }),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(FAKE_USER_ID);
      assert.ok(result['secretstyle'], 'private trigger should be in map');
      assert.equal(result['secretstyle'][0].access, 'private');
      assert.equal(result['secretstyle'][0].slug, 'private-lora');
    });

    test('skips private permission if LoRA is already in public cache', async () => {
      const publicLora = makePublicLora();
      let findByIdCalled = false;
      const loraModelsDb = {
        findMany: async () => [publicLora],
        findById: async () => { findByIdCalled = true; return null; },
      };

      const service = new LoraService({
        loraModelsDb,
        loraPermissionsDb: makeLoraPermissionsDb({
          permissions: [{ loraId: { toString: () => FAKE_LORA_ID_1 } }], // same as public
        }),
        logger: makeLogger(),
      });

      await service.getTriggerMapData(FAKE_USER_ID);
      assert.equal(findByIdCalled, false, 'findById should not be called for public LoRAs');
    });

    test('does not mutate the cached public map', async () => {
      const publicLora = makePublicLora();
      const privateLora = {
        _id: { toString: () => FAKE_LORA_ID_2 },
        slug: 'private-lora',
        triggerWords: ['uniqueprivatetrigger'],
        cognates: [],
        defaultWeight: 1.0,
        ownedBy: null,
        updatedAt: new Date(),
        checkpoint: 'FLUX',
      };

      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({
          publicLoras: [publicLora],
          findByIdResult: privateLora,
        }),
        loraPermissionsDb: makeLoraPermissionsDb({
          permissions: [{ loraId: { toString: () => FAKE_LORA_ID_2 } }],
        }),
        logger: makeLogger(),
      });

      // First call with user — should add private trigger
      const userResult = await service.getTriggerMapData(FAKE_USER_ID);
      assert.ok(userResult['uniqueprivatetrigger']);

      // Second call without user — private trigger should NOT appear
      const publicResult = await service.getTriggerMapData(null);
      assert.equal(publicResult['uniqueprivatetrigger'], undefined, 'public cache must not be mutated');
    });

  });

  describe('getTriggerMapData() — caching', () => {

    test('second call uses cache and does not re-query DB', async () => {
      let findManyCalls = 0;
      const loraModelsDb = {
        findMany: async () => { findManyCalls++; return [makePublicLora()]; },
        findById: async () => null,
      };

      const service = new LoraService({
        loraModelsDb,
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      await service.getTriggerMapData(null);
      await service.getTriggerMapData(null);

      assert.equal(findManyCalls, 1, 'DB should only be queried once within TTL');
    });

    test('invalidatePublicCache() forces re-fetch on next call', async () => {
      let findManyCalls = 0;
      const loraModelsDb = {
        findMany: async () => { findManyCalls++; return [makePublicLora()]; },
        findById: async () => null,
      };

      const service = new LoraService({
        loraModelsDb,
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      await service.getTriggerMapData(null);
      service.invalidatePublicCache();
      await service.getTriggerMapData(null);

      assert.equal(findManyCalls, 2, 'DB should be re-queried after invalidation');
    });

  });

  describe('getTriggerMapData() — error handling', () => {

    test('returns empty map when DB throws on first public fetch', async () => {
      const loraModelsDb = {
        findMany: async () => { throw new Error('DB down'); },
        findById: async () => null,
      };

      const service = new LoraService({
        loraModelsDb,
        loraPermissionsDb: makeLoraPermissionsDb(),
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(null);
      assert.deepEqual(result, {});
    });

    test('returns public map when private LoRA fetch throws', async () => {
      const service = new LoraService({
        loraModelsDb: makeLoraModelsDb({ publicLoras: [makePublicLora()] }),
        loraPermissionsDb: {
          listAccessibleLoRAs: async () => { throw new Error('Permissions DB down'); },
        },
        logger: makeLogger(),
      });

      const result = await service.getTriggerMapData(FAKE_USER_ID);
      // Should still have the public trigger
      assert.ok(result['myperson'], 'public map should be returned even on private fetch error');
    });

  });

});
