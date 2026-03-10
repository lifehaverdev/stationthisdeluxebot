/**
 * loraResolutionService unit tests
 *
 * Tests text parsing, lora syntax generation, weight handling, and
 * conflict resolution of resolveLoraTriggers() without hitting the database.
 *
 * Strategy: seed the internal cache directly via triggerMapCache so we
 * never call loraService.getTriggerMapData().
 *
 * Also tests setLoraStrength() for modifying weights in backend prompts.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// We reach into the module's cache via the exported refreshTriggerMapCache,
// but seeding requires access to the private Map. We do that by monkey-patching
// the module-level singleton through node's require cache.
const loraService = require('../../../src/core/services/store/lora/LoraService');

// Stub loraService.getTriggerMapData before loraResolutionService loads
// (loraResolutionService calls it during cache fetch).
const originalGetTriggerMapData = loraService.loraService?.getTriggerMapData?.bind(loraService.loraService);

const {
  resolveLoraTriggers,
  refreshTriggerMapCache,
  setLoraStrength,
} = require('../../../src/core/services/loraResolutionService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const OWNER_ID = 'user-abc123';
const CACHE_KEY_PUBLIC = 'public';

/**
 * Build a minimal lora record.
 */
function makeLora(overrides = {}) {
  return {
    slug: 'my-lora-slug',
    modelId: 'model-001',
    access: 'public',
    ownerAccountId: null,
    defaultWeight: 1.0,
    checkpoint: 'FLUX',
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

/**
 * Inject a fake trigger map into loraService so the next cache-miss fetch
 * returns our data. Clears the cache so a fresh fetch happens.
 *
 * entries: [[triggerWord, LoRAInfo[]], ...]
 */
function seedTriggerMap(entries, masterAccountId) {
  const fakeData = Object.fromEntries(entries);
  if (loraService.loraService) {
    loraService.loraService.getTriggerMapData = async () => fakeData;
  }
  refreshTriggerMapCache(masterAccountId); // force re-fetch on next call
}

beforeEach(() => {
  // Reset after each test so a stale cache doesn't bleed across tests
  refreshTriggerMapCache();
});

// ── resolveLoraTriggers: exact output format ───────────────────────────────────

describe('resolveLoraTriggers — exact output format', () => {

  test('trigger word → lora tag inserted before word, space before tag not after', async () => {
    // "illustration of a beautiful girl in milady style"
    //   → "illustration of a beautiful girl in <lora:miladyLoraName:1>milady style"
    //
    // Key observations:
    //   - lora tag is prepended to the trigger word (no space between tag and word)
    //   - the space that preceded the trigger now precedes the tag
    //   - weight 1.0 serialises as "1" (JS drops trailing decimal zeros)
    seedTriggerMap([['milady', [makeLora({ slug: 'miladyLoraName', defaultWeight: 1.0 })]]], OWNER_ID);

    const result = await resolveLoraTriggers(
      'illustration of a beautiful girl in milady style',
      OWNER_ID,
    );

    assert.equal(
      result.modifiedPrompt,
      'illustration of a beautiful girl in <lora:miladyLoraName:1>milady style',
    );
  });

  test('trigger:weight syntax — colon+weight consumed, bare trigger word remains', async () => {
    // "milady:0.5" → the :0.5 is parsed as user weight, bare "milady" is re-emitted
    seedTriggerMap([['milady', [makeLora({ slug: 'miladyLoraName', defaultWeight: 1.0 })]]], OWNER_ID);

    const result = await resolveLoraTriggers(
      'illustration of a beautiful girl in milady:0.5 style',
      OWNER_ID,
    );

    assert.equal(
      result.modifiedPrompt,
      'illustration of a beautiful girl in <lora:miladyLoraName:0.5>milady style',
    );
    assert.equal(result.appliedLoras[0].weight, 0.5);
  });

});

// ── resolveLoraTriggers: basic substitution ────────────────────────────────────

describe('resolveLoraTriggers — basic trigger substitution', () => {

  test('returns prompt unchanged when no triggers match', async () => {
    seedTriggerMap([['knownstyle', [makeLora({ slug: 'known-style' })]]], OWNER_ID);

    const prompt = 'a simple landscape painting';
    const result = await resolveLoraTriggers(prompt, OWNER_ID);

    assert.equal(result.modifiedPrompt, prompt);
    assert.equal(result.appliedLoras.length, 0);
  });

  test('is case-insensitive for trigger word matching', async () => {
    seedTriggerMap([['mysurrealist', [makeLora({ slug: 'my-surrealist', defaultWeight: 1.0 })]]], OWNER_ID);

    const result = await resolveLoraTriggers('MYSURREALIST abstract art', OWNER_ID);

    assert.ok(result.modifiedPrompt.includes('<lora:my-surrealist:'), `Got: ${result.modifiedPrompt}`);
    assert.equal(result.appliedLoras.length, 1);
  });

  test('rawPrompt is always the original unmodified input', async () => {
    seedTriggerMap([['glitch', [makeLora({ slug: 'glitch-lora', defaultWeight: 0.7 })]]], OWNER_ID);

    const prompt = 'glitch art style';
    const result = await resolveLoraTriggers(prompt, OWNER_ID);

    assert.equal(result.rawPrompt, prompt);
    assert.notEqual(result.modifiedPrompt, prompt);
  });

  test('uses defaultWeight when no weight is specified', async () => {
    seedTriggerMap([['vintage', [makeLora({ slug: 'vintage-lora', defaultWeight: 0.65 })]]], OWNER_ID);

    const result = await resolveLoraTriggers('vintage photo', OWNER_ID);

    assert.ok(result.modifiedPrompt.includes('<lora:vintage-lora:0.65>'), `Got: ${result.modifiedPrompt}`);
  });

});

// ── resolveLoraTriggers: dot/exclamation weight modifiers ─────────────────────

describe('resolveLoraTriggers — dot/exclamation weight modifiers', () => {

  // Default weight 1.0 for all tests in this group
  function miladyDeps() {
    return [['milady', [makeLora({ slug: 'miladyLoraName', defaultWeight: 1.0 })]]];
  }

  test('milady. → defaultWeight - 0.2', async () => {
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('illustration of milady. style', OWNER_ID);
    assert.equal(result.modifiedPrompt, 'illustration of <lora:miladyLoraName:0.8>milady style');
    assert.equal(result.appliedLoras[0].weight, 0.8);
  });

  test('milady.. → defaultWeight - 0.4', async () => {
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('illustration of milady.. style', OWNER_ID);
    assert.equal(result.modifiedPrompt, 'illustration of <lora:miladyLoraName:0.6>milady style');
    assert.equal(result.appliedLoras[0].weight, 0.6);
  });

  test('milady... → defaultWeight - 0.6', async () => {
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('illustration of milady... style', OWNER_ID);
    assert.equal(result.modifiedPrompt, 'illustration of <lora:miladyLoraName:0.4>milady style');
    assert.equal(result.appliedLoras[0].weight, 0.4);
  });

  test('milady! → defaultWeight + 0.2', async () => {
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('illustration of milady! style', OWNER_ID);
    assert.equal(result.modifiedPrompt, 'illustration of <lora:miladyLoraName:1.2>milady style');
    assert.equal(result.appliedLoras[0].weight, 1.2);
  });

  test('milady!! → defaultWeight + 0.4', async () => {
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('illustration of milady!! style', OWNER_ID);
    assert.equal(result.modifiedPrompt, 'illustration of <lora:miladyLoraName:1.4>milady style');
    assert.equal(result.appliedLoras[0].weight, 1.4);
  });

  test('milady!!! → defaultWeight + 0.6', async () => {
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('illustration of milady!!! style', OWNER_ID);
    assert.equal(result.modifiedPrompt, 'illustration of <lora:miladyLoraName:1.6>milady style');
    assert.equal(result.appliedLoras[0].weight, 1.6);
  });

  test('dots/exclamations are consumed — not in output prompt', async () => {
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('milady.. portrait', OWNER_ID);
    assert.ok(!result.modifiedPrompt.includes('..'), `Dots should be gone: ${result.modifiedPrompt}`);
    assert.ok(!result.modifiedPrompt.includes('!!!'), `Exclamations should be gone: ${result.modifiedPrompt}`);
  });

  test('explicit :weight takes priority over dot/exclamation modifier', async () => {
    // milady:0.5 is explicit weight — dots/exclamations are not parsed if :weight present
    seedTriggerMap(miladyDeps(), OWNER_ID);
    const result = await resolveLoraTriggers('milady:0.5 portrait', OWNER_ID);
    assert.equal(result.appliedLoras[0].weight, 0.5);
  });

});

// ── resolveLoraTriggers: user-specified weights ────────────────────────────────

describe('resolveLoraTriggers — user-specified weights', () => {

  test('handles decimal weights without leading zero (trigger:.4)', async () => {
    seedTriggerMap([['neonstyle', [makeLora({ slug: 'neon-style', defaultWeight: 1.0 })]]], OWNER_ID);

    const result = await resolveLoraTriggers('neonstyle:.4 city', OWNER_ID);

    assert.ok(result.modifiedPrompt.includes('<lora:neon-style:0.4>'), `Got: ${result.modifiedPrompt}`);
    assert.equal(result.appliedLoras[0].weight, 0.4);
  });

  test('skips lora substitution when user-specified weight is 0', async () => {
    seedTriggerMap([['glitch', [makeLora({ slug: 'glitch-lora', defaultWeight: 1.0 })]]], OWNER_ID);

    const result = await resolveLoraTriggers('glitch:0 art', OWNER_ID);

    assert.ok(!result.modifiedPrompt.includes('<lora:'), `Should not have lora tag, got: ${result.modifiedPrompt}`);
    assert.equal(result.appliedLoras.length, 0);
  });

});

// ── resolveLoraTriggers: duplicate triggers ────────────────────────────────────

describe('resolveLoraTriggers — duplicate triggers', () => {

  test('applies a lora only once when trigger appears multiple times', async () => {
    seedTriggerMap([['vintage', [makeLora({ slug: 'vintage-filter', defaultWeight: 0.9 })]]], OWNER_ID);

    const result = await resolveLoraTriggers('vintage portrait vintage background', OWNER_ID);

    const tagCount = (result.modifiedPrompt.match(/<lora:vintage-filter:/g) || []).length;
    assert.equal(tagCount, 1, `Expected 1 lora tag, got ${tagCount}: ${result.modifiedPrompt}`);
    assert.equal(result.appliedLoras.length, 1);
  });

});

// ── resolveLoraTriggers: existing inline lora tags ────────────────────────────

describe('resolveLoraTriggers — existing inline lora tags', () => {

  test('preserves valid inline <lora:slug:weight> tags that exist in the map', async () => {
    seedTriggerMap([['known-slug', [makeLora({ slug: 'known-slug' })]]], OWNER_ID);

    const prompt = 'some art <lora:known-slug:0.7> vibes';
    const result = await resolveLoraTriggers(prompt, OWNER_ID);

    assert.ok(result.modifiedPrompt.includes('<lora:known-slug:0.7>'), `Got: ${result.modifiedPrompt}`);
  });

  test('strips inline tags for slugs not in the trigger map', async () => {
    // Map must be non-empty (avoids early-exit path) but not contain the secret slug
    seedTriggerMap([['other-trigger', [makeLora({ slug: 'other-lora' })]]], OWNER_ID);

    const prompt = 'art <lora:secret-slug:0.9> style';
    const result = await resolveLoraTriggers(prompt, OWNER_ID);

    assert.ok(!result.modifiedPrompt.includes('<lora:secret-slug:'), `Got: ${result.modifiedPrompt}`);
    assert.ok(result.warnings.some(w => w.includes('unknown or inaccessible')));
  });

});

// ── resolveLoraTriggers: trailing punctuation ──────────────────────────────────

describe('resolveLoraTriggers — trailing punctuation', () => {

  test('preserves comma after trigger word', async () => {
    seedTriggerMap([['watercolor', [makeLora({ slug: 'watercolor-lora', defaultWeight: 0.85 })]]], OWNER_ID);

    const result = await resolveLoraTriggers('beautiful watercolor, soft edges', OWNER_ID);

    assert.ok(result.modifiedPrompt.includes(','), `Comma missing from: ${result.modifiedPrompt}`);
    assert.ok(result.modifiedPrompt.includes('<lora:watercolor-lora:0.85>'));
  });

});

// ── resolveLoraTriggers: lorahash_ triggers ────────────────────────────────────

describe('resolveLoraTriggers — lorahash_ triggers', () => {

  test('does not re-add base token text for lorahash_ triggers', async () => {
    const hashTrigger = 'lorahash_abc123def';
    seedTriggerMap([[hashTrigger, [makeLora({ slug: 'hash-lora', defaultWeight: 1.0 })]]], OWNER_ID);

    const result = await resolveLoraTriggers(`photo ${hashTrigger} portrait`, OWNER_ID);

    assert.ok(!result.modifiedPrompt.includes(hashTrigger), `Hash trigger should be replaced, got: ${result.modifiedPrompt}`);
    assert.ok(result.modifiedPrompt.includes('<lora:hash-lora:'));
  });

});

// ── resolveLoraTriggers: conflict resolution ───────────────────────────────────

describe('resolveLoraTriggers — conflict resolution', () => {

  test('prefers private lora owned by the user over public lora', async () => {
    seedTriggerMap([
      ['foxstyle', [
        makeLora({ slug: 'public-fox', access: 'public', ownerAccountId: null }),
        makeLora({ slug: 'private-fox', access: 'private', ownerAccountId: OWNER_ID }),
      ]],
    ], OWNER_ID);

    const result = await resolveLoraTriggers('foxstyle portrait', OWNER_ID);

    assert.ok(result.modifiedPrompt.includes('<lora:private-fox:'), `Expected private lora, got: ${result.modifiedPrompt}`);
    assert.ok(!result.modifiedPrompt.includes('<lora:public-fox:'));
  });

  test('adds warning when multiple public loras match a trigger', async () => {
    seedTriggerMap([
      ['ambiguous', [
        makeLora({ slug: 'lora-a', access: 'public', updatedAt: new Date('2024-01-01') }),
        makeLora({ slug: 'lora-b', access: 'public', updatedAt: new Date('2023-01-01') }),
      ]],
    ], OWNER_ID);

    const result = await resolveLoraTriggers('ambiguous art', OWNER_ID);

    assert.ok(result.warnings.some(w => w.includes('Multiple public LoRAs')));
  });

  test('picks the most recently updated lora when multiple public loras exist', async () => {
    seedTriggerMap([
      ['landscape', [
        makeLora({ slug: 'old-landscape', access: 'public', updatedAt: new Date('2022-01-01') }),
        makeLora({ slug: 'new-landscape', access: 'public', updatedAt: new Date('2024-06-01') }),
      ]],
    ], OWNER_ID);

    const result = await resolveLoraTriggers('landscape painting', OWNER_ID);

    assert.ok(result.modifiedPrompt.includes('<lora:new-landscape:'), `Got: ${result.modifiedPrompt}`);
  });

});

// ── resolveLoraTriggers: base model filtering ──────────────────────────────────

describe('resolveLoraTriggers — base model filtering', () => {

  test('only applies FLUX loras when toolBaseModel is FLUX', async () => {
    seedTriggerMap([
      ['dynamo', [
        makeLora({ slug: 'flux-dynamo', checkpoint: 'FLUX' }),
        makeLora({ slug: 'sd15-dynamo', checkpoint: 'SD1.5' }),
      ]],
    ], OWNER_ID);

    const result = await resolveLoraTriggers('dynamo art', OWNER_ID, 'FLUX');

    assert.ok(result.modifiedPrompt.includes('<lora:flux-dynamo:'), `Got: ${result.modifiedPrompt}`);
    assert.ok(!result.modifiedPrompt.includes('<lora:sd15-dynamo:'));
  });

  test('only applies SD1.5 loras when toolBaseModel is SD1.5', async () => {
    seedTriggerMap([
      ['fantasy', [
        makeLora({ slug: 'flux-fantasy', checkpoint: 'FLUX' }),
        makeLora({ slug: 'sd15-fantasy', checkpoint: 'SD1.5' }),
      ]],
    ], OWNER_ID);

    const result = await resolveLoraTriggers('fantasy art', OWNER_ID, 'SD1.5');

    assert.ok(result.modifiedPrompt.includes('<lora:sd15-fantasy:'), `Got: ${result.modifiedPrompt}`);
    assert.ok(!result.modifiedPrompt.includes('<lora:flux-fantasy:'));
  });

  test('falls back to no lora when no checkpoint matches base model', async () => {
    seedTriggerMap([
      ['exclusive', [makeLora({ slug: 'flux-exclusive', checkpoint: 'FLUX' })]],
    ], OWNER_ID);

    const result = await resolveLoraTriggers('exclusive portrait', OWNER_ID, 'SD1.5');

    assert.ok(!result.modifiedPrompt.includes('<lora:'), `Got: ${result.modifiedPrompt}`);
    assert.equal(result.appliedLoras.length, 0);
  });

});

// ── resolveLoraTriggers: empty/edge cases ──────────────────────────────────────

describe('resolveLoraTriggers — empty / edge cases', () => {

  test('returns prompt unchanged when triggerMap is empty', async () => {
    seedTriggerMap([], OWNER_ID);

    const prompt = 'a basic prompt with no triggers';
    const result = await resolveLoraTriggers(prompt, OWNER_ID);

    assert.equal(result.modifiedPrompt, prompt);
    assert.equal(result.appliedLoras.length, 0);
    assert.equal(result.rawPrompt, prompt);
  });

});

// ── setLoraStrength ────────────────────────────────────────────────────────────
// Operates on backend prompts (which already contain <lora:...> tags).
// Users never see this syntax — it's generated by resolveLoraTriggers and
// consumed by the image generation backend.

describe('setLoraStrength — modify weight of existing lora tag in backend prompt', () => {

  test('updates weight of an existing lora tag', () => {
    const prompt = 'some art <lora:cool-style:0.8> vibes';
    const result = setLoraStrength(prompt, 'cool-style', 0.5);

    assert.ok(result.includes('<lora:cool-style:0.5>'), `Got: ${result}`);
    assert.ok(!result.includes('<lora:cool-style:0.8>'));
  });

  test('returns prompt unchanged when slug not found', () => {
    const prompt = 'some art <lora:other-lora:0.8> vibes';
    const result = setLoraStrength(prompt, 'cool-style', 0.5);

    assert.equal(result, prompt);
  });

  test('updates only the matching slug when multiple lora tags present', () => {
    const prompt = 'art <lora:alpha:1> and <lora:beta:0.9> style';
    const result = setLoraStrength(prompt, 'beta', 0.3);

    assert.ok(result.includes('<lora:alpha:1>'), `Alpha should be unchanged: ${result}`);
    assert.ok(result.includes('<lora:beta:0.3>'), `Beta should be updated: ${result}`);
  });

  test('handles weight of 0 (disables lora without removing tag)', () => {
    const prompt = '<lora:my-lora:0.8> portrait';
    const result = setLoraStrength(prompt, 'my-lora', 0);

    assert.ok(result.includes('<lora:my-lora:0>'), `Got: ${result}`);
  });

  test('preserves the rest of the prompt when updating weight', () => {
    const prompt = 'beautiful <lora:painting-style:0.7> watercolor landscape';
    const result = setLoraStrength(prompt, 'painting-style', 1.2);

    assert.ok(result.includes('beautiful'), `Got: ${result}`);
    assert.ok(result.includes('watercolor landscape'), `Got: ${result}`);
    assert.ok(result.includes('<lora:painting-style:1.2>'));
  });

  test('handles slugs with hyphens correctly', () => {
    const prompt = 'photo <lora:my-complex-slug:0.6> style';
    const result = setLoraStrength(prompt, 'my-complex-slug', 0.9);

    assert.ok(result.includes('<lora:my-complex-slug:0.9>'), `Got: ${result}`);
  });

});
