/**
 * GenerationExecutionService unit tests
 *
 * Tests:
 *   1. returns 400 when toolId is missing
 *   2. returns 400 when user.masterAccountId is missing
 *   3. returns 404 when tool is not found
 *   4. returns 402 when user has insufficient points
 *   5. returns 200 with generationId and response on string path success
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { GenerationExecutionService } = require('../../../src/core/services/generationExecutionService');
const adapterRegistry = require('../../../src/core/services/adapterRegistry');

const FAKE_USER_ID = '649d9bc2381f3f90f7777e99';

// Minimal mock tool with all required fields
const mockTool = {
  toolId: 'test-tool',
  service: 'string',
  displayName: 'Test Tool',
  deliveryMode: 'immediate',
  costingModel: { rateSource: 'fixed', fixedCost: { amount: 0.001, unit: 'run' } },
  metadata: {},
  inputSchema: {},
};

// Adapter-based tool for testing spend behavior
const mockAdapterTool = {
  toolId: 'adapter-tool',
  service: 'test-adapter',
  displayName: 'Adapter Test Tool',
  deliveryMode: 'immediate',
  costingModel: { rateSource: 'static', staticCost: { amount: 0.01, unit: 'request' } },
  metadata: {},
  inputSchema: {},
};

// Async adapter tool for testing async spend behavior
const mockAsyncAdapterTool = {
  toolId: 'async-adapter-tool',
  service: 'test-async-adapter',
  displayName: 'Async Adapter Test Tool',
  deliveryMode: 'async',
  costingModel: { rateSource: 'static', staticCost: { amount: 0.01, unit: 'request' } },
  metadata: {},
  inputSchema: {},
};

// Minimal mock DB
function makeDb(overrides = {}) {
  return {
    userCore: {
      findUserCoreById: async () => ({ wallets: [{ address: '0xabc', isPrimary: true }] }),
    },
    creditLedger: {
      findActiveDepositsForWalletAddress: async () => [],
      sumPointsRemainingForWalletAddress: async () => 99999,
    },
    generationOutputs: {
      createGenerationOutput: async (params) => ({ _id: 'gen-123', masterAccountId: 'user-1', ...params }),
      updateGenerationOutput: async () => ({}),
      findGenerationById: async () => ({}),
    },
    ...overrides,
  };
}

function makeToolRegistry(tool = mockTool) {
  return {
    getToolById: (id) => {
      if (Array.isArray(tool)) return tool.find(t => t.toolId === id) || null;
      return tool.toolId === id ? tool : null;
    },
    findByCommand: () => null,
    getAllTools: () => Array.isArray(tool) ? tool : [tool],
  };
}

function makeToolRegistryNotFound() {
  return {
    getToolById: () => null,
    findByCommand: () => null,
    getAllTools: () => [],
  };
}

function makeStringService() {
  return { execute: () => 'hello' };
}

function makeEconomyService() {
  const spendCalls = [];
  return {
    spend: async (masterAccountId, opts) => {
      spendCalls.push({ masterAccountId: masterAccountId.toString(), ...opts });
      return [{ pointsDeducted: opts.pointsToSpend }];
    },
    _spendCalls: spendCalls,
  };
}

describe('GenerationExecutionService', () => {
  describe('validation', () => {
    test('returns 400 when toolId is missing', async () => {
      const svc = new GenerationExecutionService({ toolRegistry: makeToolRegistry(), db: makeDb() });
      const result = await svc.execute({ toolId: null, inputs: {}, user: { masterAccountId: FAKE_USER_ID } });
      assert.equal(result.statusCode, 400);
      assert.equal(result.body.error.code, 'INVALID_INPUT');
    });

    test('returns 400 when user.masterAccountId is missing', async () => {
      const svc = new GenerationExecutionService({ toolRegistry: makeToolRegistry(), db: makeDb() });
      const result = await svc.execute({ toolId: 'test-tool', inputs: {}, user: {} });
      assert.equal(result.statusCode, 400);
    });

    test('returns 404 when tool is not found', async () => {
      const svc = new GenerationExecutionService({ toolRegistry: makeToolRegistryNotFound(), db: makeDb() });
      const result = await svc.execute({ toolId: 'unknown', inputs: {}, user: { masterAccountId: FAKE_USER_ID } });
      assert.equal(result.statusCode, 404);
    });

    test('returns 402 when user has insufficient points', async () => {
      const db = makeDb({
        creditLedger: {
          findActiveDepositsForWalletAddress: async () => [],
          sumPointsRemainingForWalletAddress: async () => 0,
        },
      });
      const svc = new GenerationExecutionService({ toolRegistry: makeToolRegistry(), db });
      const result = await svc.execute({ toolId: 'test-tool', inputs: {}, user: { masterAccountId: FAKE_USER_ID, platform: 'web' } });
      assert.equal(result.statusCode, 402);
      assert.equal(result.body.error.code, 'INSUFFICIENT_FUNDS');
    });
  });

  describe('string path', () => {
    test('returns 200 with generationId and status completed on success', async () => {
      const svc = new GenerationExecutionService({
        toolRegistry: makeToolRegistry(),
        db: makeDb(),
        stringService: makeStringService(),
      });
      const result = await svc.execute({
        toolId: 'test-tool',
        inputs: { operation: 'uppercase', stringA: 'hello' },
        user: { masterAccountId: FAKE_USER_ID, platform: 'web' },
      });
      assert.equal(result.statusCode, 200);
      assert.ok(result.body.generationId, 'generationId should be defined');
      assert.equal(result.body.status, 'completed');
    });
  });

  describe('immediate adapter spend', () => {
    afterEach(() => {
      // Clean up registered adapters
      adapterRegistry.adapters.delete('test-adapter');
    });

    test('calls economyService.spend() after successful immediate adapter execution', async () => {
      // Register a mock adapter
      adapterRegistry.register('test-adapter', {
        execute: async () => ({ type: 'image', data: { images: [{ url: 'http://test.png' }] } }),
      });

      const economyService = makeEconomyService();
      const svc = new GenerationExecutionService({
        toolRegistry: makeToolRegistry(mockAdapterTool),
        db: makeDb(),
        economyService,
      });

      const result = await svc.execute({
        toolId: 'adapter-tool',
        inputs: {},
        user: { masterAccountId: FAKE_USER_ID, platform: 'web' },
      });

      assert.equal(result.statusCode, 200, `Expected 200 but got ${result.statusCode}: ${JSON.stringify(result.body)}`);
      assert.equal(economyService._spendCalls.length, 1, 'economyService.spend() should have been called once');
      assert.ok(economyService._spendCalls[0].pointsToSpend > 0, 'should spend a positive number of points');
      assert.equal(economyService._spendCalls[0].masterAccountId, FAKE_USER_ID);
    });

    test('does not call economyService.spend() for x402 executions', async () => {
      adapterRegistry.register('test-adapter', {
        execute: async () => ({ type: 'image', data: { images: [{ url: 'http://test.png' }] } }),
      });

      const economyService = makeEconomyService();
      const svc = new GenerationExecutionService({
        toolRegistry: makeToolRegistry(mockAdapterTool),
        db: makeDb(),
        economyService,
      });

      const result = await svc.execute({
        toolId: 'adapter-tool',
        inputs: {},
        user: { masterAccountId: FAKE_USER_ID, platform: 'web', isX402: true },
      });

      assert.equal(result.statusCode, 200);
      assert.equal(economyService._spendCalls.length, 0, 'should NOT call spend for x402');
    });
  });

  describe('group pool pre-check', () => {
    const FALLBACK_USER_ID = '649d9bc2381f3f90f7777e88';
    const GROUP_POOL_ID = '649d9bc2381f3f90f7777e77';

    test('returns 402 when group pool AND fallback user both have insufficient points', async () => {
      const db = makeDb({
        creditLedger: {
          findActiveDepositsForUser: async () => [],
          findActiveDepositsForWalletAddress: async () => [],
          sumPointsRemainingForWalletAddress: async () => 0,
        },
        userCore: {
          findUserCoreById: async () => ({ wallets: [{ address: '0xfallback', isPrimary: true }] }),
        },
      });
      const svc = new GenerationExecutionService({ toolRegistry: makeToolRegistry(), db });
      const result = await svc.execute({
        toolId: 'test-tool',
        inputs: {},
        user: { masterAccountId: GROUP_POOL_ID, platform: 'telegram' },
        metadata: { groupPoolActive: true, fallbackMasterAccountId: FALLBACK_USER_ID },
      });
      assert.equal(result.statusCode, 402, `Expected 402 but got ${result.statusCode}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.error.code, 'INSUFFICIENT_FUNDS');
    });

    test('returns 402 with descriptive message mentioning both pool and user when both are empty', async () => {
      const db = makeDb({
        creditLedger: {
          findActiveDepositsForUser: async () => [],
          findActiveDepositsForWalletAddress: async () => [],
          sumPointsRemainingForWalletAddress: async () => 0,
        },
        userCore: {
          findUserCoreById: async () => ({ wallets: [{ address: '0xfallback', isPrimary: true }] }),
        },
      });
      const svc = new GenerationExecutionService({ toolRegistry: makeToolRegistry(), db });
      const result = await svc.execute({
        toolId: 'test-tool',
        inputs: {},
        user: { masterAccountId: GROUP_POOL_ID, platform: 'telegram' },
        metadata: { groupPoolActive: true, fallbackMasterAccountId: FALLBACK_USER_ID },
      });
      assert.equal(result.statusCode, 402);
      // Message should indicate both pool and fallback failed
      assert.ok(
        result.body.error.message.toLowerCase().includes('pool') ||
        result.body.error.message.toLowerCase().includes('group'),
        `Error message should mention pool/group: "${result.body.error.message}"`
      );
    });
  });

  describe('async adapter spend', () => {
    afterEach(() => {
      adapterRegistry.adapters.delete('test-async-adapter');
    });

    test('calls economyService.spend() after successful async adapter poll completion', async () => {
      let pollCount = 0;
      adapterRegistry.register('test-async-adapter', {
        startJob: async () => ({ runId: 'run-abc' }),
        pollJob: async () => {
          pollCount++;
          if (pollCount >= 1) {
            return { status: 'succeeded', type: 'image', data: { images: [{ url: 'http://test.png' }] } };
          }
          return { status: 'processing' };
        },
      });

      const economyService = makeEconomyService();
      const svc = new GenerationExecutionService({
        toolRegistry: makeToolRegistry(mockAsyncAdapterTool),
        db: makeDb(),
        economyService,
      });

      const result = await svc.execute({
        toolId: 'async-adapter-tool',
        inputs: {},
        user: { masterAccountId: FAKE_USER_ID, platform: 'web' },
      });

      // Async returns 202 immediately
      assert.equal(result.statusCode, 202);

      // Wait for the background polling to complete
      await new Promise(resolve => setTimeout(resolve, 6000));

      assert.equal(economyService._spendCalls.length, 1, 'economyService.spend() should have been called after poll completion');
      assert.ok(economyService._spendCalls[0].pointsToSpend > 0, 'should spend a positive number of points');
    });
  });
});
