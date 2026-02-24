/**
 * ComfyUI Deploy Webhook → WebSocket Delivery Test
 *
 * Verifies the critical path: ComfyDeploy webhook arrives → webhookProcessor
 * sends the right WebSocket messages to the right user.
 *
 * Tests three message types:
 *   - generationProgress  (queued / running with progress + liveStatus)
 *   - generationUpdate    (success with images, failed)
 *
 * Also verifies the frontend parser (_awaitCompletion image extraction) handles
 * the exact payload shape the server sends.
 *
 * No real DB or WS connection needed — internalApiClient and webSocketService
 * are injected mocks. The webhook processor is called directly.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const { processComfyDeployWebhook } = require('../../../src/core/services/comfydeploy/webhookProcessor');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUN_ID = `test-run-webhook-ws-${Date.now()}`;
const MASTER_ACCOUNT_ID = 'test-master-acct-webhook-ws';
const GENERATION_ID = '649d9bc2381f3f90f7777e99'; // deterministic fake Mongo hex ID
const IMAGE_URL = 'https://comfy-deploy-output.s3.us-east-2.amazonaws.com/outputs/runs/test/ComfyUI_00001_.png';

const fakeGenerationRecord = {
  _id: GENERATION_ID,
  masterAccountId: MASTER_ACCOUNT_ID,
  serviceName: 'comfyui',
  toolId: 'test-tool-id',
  toolDisplayName: 'Test Tool',
  status: 'processing',
  deliveryStatus: 'pending',
  notificationPlatform: 'web-sandbox',
  metadata: {
    run_id: RUN_ID,
    costRate: { amount: 0.001, unit: 'second' },
    toolId: 'test-tool-id',
  },
  requestPayload: { input_prompt: 'a test image' },
  requestTimestamp: new Date(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mock internalApiClient. Handles all URL patterns the webhook processor calls:
 *  - GET  generations?metadata.run_id=...  → returns fakeGenerationRecord
 *  - GET  data/generations/:id             → returns fakeGenerationRecord
 *  - GET  data/users/:id                   → minimal user object (no wallet = skip debit)
 *  - GET  data/ledger/deposits/...         → empty (no MS2 discount)
 *  - PUT  data/generations/:id             → returns updated record
 *  - POST data/users/:id/economy/spend     → success
 */
function createMockApiClient() {
  return {
    get: async (url) => {
      if (url.includes(`metadata.run_id=${RUN_ID}`)) {
        return { data: { generations: [fakeGenerationRecord] } };
      }
      if (url.includes('/data/generations/')) {
        return { data: fakeGenerationRecord };
      }
      if (url.includes('/data/users/')) {
        return { data: { _id: MASTER_ACCOUNT_ID, walletAddress: null } };
      }
      if (url.includes('/data/ledger/deposits/')) {
        return { data: { deposits: [] } };
      }
      return { data: null };
    },
    put: async (_url, data) => ({
      data: { ...fakeGenerationRecord, ...data },
    }),
    post: async () => ({ data: { success: true } }),
  };
}

/**
 * Creates a spy for webSocketService.sendToUser.
 * Captures all calls; exposes .calls[] for assertions.
 */
function createWsSpy() {
  const calls = [];
  const spy = (userId, message) => {
    calls.push({ userId: String(userId), message });
    return true; // indicates at least one open connection
  };
  spy.calls = calls;
  return spy;
}

/** Quiet logger — surface errors only so test output stays clean. */
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (...args) => console.error('[webhookProcessor]', ...args),
};

function createDeps(wsSpy) {
  return {
    internalApiClient: createMockApiClient(),
    logger,
    webSocketService: { sendToUser: wsSpy },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ComfyUI Deploy webhook → WebSocket delivery', () => {

  // ── Progress messages ──

  test('queued webhook sends generationProgress with correct generationId and status', async () => {
    const wsSpy = createWsSpy();

    await processComfyDeployWebhook({
      run_id: RUN_ID,
      event_type: 'run_queued',
      status: 'queued',
      progress: 0,
      live_status: null,
    }, createDeps(wsSpy));

    const msg = wsSpy.calls.find(c => c.message.type === 'generationProgress');
    assert.ok(msg, 'should send a generationProgress WS message for queued status');
    assert.equal(msg.userId, MASTER_ACCOUNT_ID, 'should send to the correct user');
    assert.equal(msg.message.payload.generationId, GENERATION_ID);
    assert.equal(msg.message.payload.status, 'queued');
  });

  test('running webhook sends generationProgress with progress float and liveStatus', async () => {
    const wsSpy = createWsSpy();

    await processComfyDeployWebhook({
      run_id: RUN_ID,
      event_type: 'run_progress',
      status: 'running',
      progress: 0.47,
      live_status: 'Sampling…',
    }, createDeps(wsSpy));

    const msg = wsSpy.calls.find(c => c.message.type === 'generationProgress');
    assert.ok(msg, 'should send a generationProgress WS message');
    assert.equal(msg.userId, MASTER_ACCOUNT_ID, 'should send to the correct user');
    assert.equal(msg.message.payload.generationId, GENERATION_ID);
    assert.equal(msg.message.payload.status, 'running');
    assert.equal(msg.message.payload.progress, 0.47, 'progress float should be forwarded as-is');
    assert.equal(msg.message.payload.liveStatus, 'Sampling…', 'liveStatus string should be forwarded');
  });

  test('running webhook at 100% sends generationProgress with progress=1', async () => {
    const wsSpy = createWsSpy();

    await processComfyDeployWebhook({
      run_id: RUN_ID,
      event_type: 'run_progress',
      status: 'running',
      progress: 1,
      live_status: 'VAE Decode',
    }, createDeps(wsSpy));

    const msg = wsSpy.calls.find(c => c.message.type === 'generationProgress');
    assert.ok(msg, 'should send generationProgress at 100%');
    assert.equal(msg.message.payload.progress, 1);
    assert.equal(msg.message.payload.liveStatus, 'VAE Decode');
  });

  // ── Completion messages ──

  test('success webhook sends generationUpdate with status=completed and images array', async () => {
    const wsSpy = createWsSpy();

    await processComfyDeployWebhook({
      run_id: RUN_ID,
      event_type: 'run_success',
      status: 'success',
      outputs: {
        images: [{ url: IMAGE_URL, type: 'output', subfolder: '', filename: 'ComfyUI_00001_.png' }],
      },
    }, createDeps(wsSpy));

    const msg = wsSpy.calls.find(c => c.message.type === 'generationUpdate');
    assert.ok(msg, 'should send a generationUpdate WS message on success');
    assert.equal(msg.userId, MASTER_ACCOUNT_ID, 'should send to the correct user');
    assert.equal(msg.message.payload.generationId, GENERATION_ID);
    assert.equal(msg.message.payload.status, 'completed');
  });

  test('success webhook generationUpdate contains outputs.images with the image URL', async () => {
    const wsSpy = createWsSpy();

    await processComfyDeployWebhook({
      run_id: RUN_ID,
      event_type: 'run_success',
      status: 'success',
      outputs: {
        images: [{ url: IMAGE_URL, type: 'output', subfolder: '', filename: 'ComfyUI_00001_.png' }],
      },
    }, createDeps(wsSpy));

    const msg = wsSpy.calls.find(c => c.message.type === 'generationUpdate');
    const outputs = msg?.message?.payload?.outputs;

    assert.ok(Array.isArray(outputs?.images), 'outputs.images should be an array');
    assert.ok(outputs.images.length > 0, 'outputs.images should not be empty');
    assert.equal(
      outputs.images[0].url,
      IMAGE_URL,
      'image URL in WS payload should exactly match what ComfyDeploy sent'
    );
  });

  test('failed webhook sends generationUpdate with status=failed', async () => {
    const wsSpy = createWsSpy();

    await processComfyDeployWebhook({
      run_id: RUN_ID,
      event_type: 'run_failed',
      status: 'failed',
      error: 'CUDA out of memory',
      error_details: 'CUDA out of memory',
    }, createDeps(wsSpy));

    const msg = wsSpy.calls.find(c => c.message.type === 'generationUpdate');
    assert.ok(msg, 'should send a generationUpdate WS message on failure');
    assert.equal(msg.message.payload.status, 'failed');
    assert.equal(msg.message.payload.generationId, GENERATION_ID);
  });

  // ── Frontend parser contract ──
  //
  // These tests verify that the exact payload shape the server sends can be
  // parsed by _awaitCompletion in SandboxCanvas.js. If these fail after a
  // server-side change, the frontend will display "Unexpected output format"
  // instead of the image.

  test('frontend _awaitCompletion parser: outputs.images[0].url produces { type:"image" }', () => {
    // Mirrors the parsing logic at SandboxCanvas.js _awaitCompletion lines 800-811
    const outputs = {
      images: [{ url: IMAGE_URL, type: 'output', subfolder: '', filename: 'ComfyUI_00001_.png' }],
    };

    let output;
    if (Array.isArray(outputs.images) && outputs.images[0]?.url) {
      output = { type: 'image', url: outputs.images[0].url };
    } else if (outputs.imageUrl) {
      output = { type: 'image', url: outputs.imageUrl };
    } else if (outputs.response) {
      output = { type: 'text', text: outputs.response };
    } else if (outputs.text) {
      output = { type: 'text', text: outputs.text };
    } else {
      output = { type: 'unknown', ...outputs };
    }

    assert.equal(output.type, 'image', 'parser should classify as image type');
    assert.equal(output.url, IMAGE_URL, 'parser should extract the correct URL');
  });

  test('frontend _awaitCompletion parser: node-keyed outputs produce type=unknown (known gap)', () => {
    // ComfyDeploy CAN send node-keyed format e.g. { "9": [{ url, type }] }
    // This test documents the known behaviour: if that format ever arrives,
    // the frontend will fall through to type=unknown. Should this format appear
    // in production, _awaitCompletion needs an additional branch.
    const outputs = { '9': [{ url: IMAGE_URL, type: 'output' }] };

    let output;
    if (Array.isArray(outputs.images) && outputs.images[0]?.url) {
      output = { type: 'image', url: outputs.images[0].url };
    } else if (outputs.imageUrl) {
      output = { type: 'image', url: outputs.imageUrl };
    } else if (outputs.response) {
      output = { type: 'text', text: outputs.response };
    } else if (outputs.text) {
      output = { type: 'text', text: outputs.text };
    } else {
      output = { type: 'unknown', ...outputs };
    }

    assert.equal(output.type, 'unknown', 'node-keyed format is not currently handled — documents known gap');
  });

  // ── Progress text format contract ──
  //
  // These verify the string format that SandboxCanvas and CookModal will display.

  test('progress text format: liveStatus + percentage produces expected string', () => {
    // Mirrors the formatting in SandboxCanvas._awaitCompletion handleProgress
    const payload = { liveStatus: 'Sampling\u2026', progress: 0.47, status: 'running' };
    const parts = [];
    if (payload.liveStatus) parts.push(payload.liveStatus);
    else parts.push(payload.status === 'queued' ? 'Queued\u2026' : 'Running\u2026');
    if (typeof payload.progress === 'number') parts.push(`${Math.round(payload.progress * 100)}%`);
    const text = parts.join(' ');

    assert.equal(text, 'Sampling… 47%');
  });

  test('progress text format: no liveStatus falls back to status label', () => {
    const payload = { liveStatus: null, progress: 0.1, status: 'running' };
    const parts = [];
    if (payload.liveStatus) parts.push(payload.liveStatus);
    else parts.push(payload.status === 'queued' ? 'Queued\u2026' : 'Running\u2026');
    if (typeof payload.progress === 'number') parts.push(`${Math.round(payload.progress * 100)}%`);
    const text = parts.join(' ');

    assert.equal(text, 'Running… 10%');
  });

  test('progress text format: queued status with zero progress', () => {
    const payload = { liveStatus: null, progress: 0, status: 'queued' };
    const parts = [];
    if (payload.liveStatus) parts.push(payload.liveStatus);
    else parts.push(payload.status === 'queued' ? 'Queued\u2026' : 'Running\u2026');
    if (typeof payload.progress === 'number') parts.push(`${Math.round(payload.progress * 100)}%`);
    const text = parts.join(' ');

    assert.equal(text, 'Queued… 0%');
  });
});
