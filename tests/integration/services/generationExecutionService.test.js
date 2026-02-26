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

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { GenerationExecutionService } = require('../../../src/core/services/generationExecutionService');

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
      createGenerationOutput: async () => ({ _id: 'gen-123', masterAccountId: 'user-1' }),
      updateGenerationOutput: async () => ({}),
      findGenerationById: async () => ({}),
    },
    ...overrides,
  };
}

function makeToolRegistry(tool = mockTool) {
  return {
    getToolById: () => tool,
    findByCommand: () => null,
    getAllTools: () => [tool],
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

describe('GenerationExecutionService', () => {
  describe('validation', () => {
    test('returns 400 when toolId is missing', async () => {
      const svc = new GenerationExecutionService({ toolRegistry: makeToolRegistry(), db: makeDb() });
      const result = await svc.execute({ toolId: null, inputs: {}, user: { masterAccountId: 'u1' } });
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
      const result = await svc.execute({ toolId: 'unknown', inputs: {}, user: { masterAccountId: 'u1' } });
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
      const result = await svc.execute({ toolId: 'test-tool', inputs: {}, user: { masterAccountId: 'u1', platform: 'web' } });
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
        user: { masterAccountId: 'u1', platform: 'web' },
      });
      assert.equal(result.statusCode, 200);
      assert.ok(result.body.generationId, 'generationId should be defined');
      assert.equal(result.body.status, 'completed');
    });
  });
});
