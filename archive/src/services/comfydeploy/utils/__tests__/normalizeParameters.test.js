/**
 * Tests for parameter normalization utility
 */

const {
  normalizeParameterKey,
  normalizeParameterKeys,
  normalizeTemplateParameters,
  normalizeAPIParameters,
  normalizeUIParameters
} = require('../normalizeParameters');

describe('Parameter Normalization Utility', () => {
  describe('normalizeParameterKey', () => {
    test('adds input_ prefix if not present', () => {
      expect(normalizeParameterKey('width')).toBe('input_width');
      expect(normalizeParameterKey('prompt')).toBe('input_prompt');
    });

    test('preserves existing input_ prefix', () => {
      expect(normalizeParameterKey('input_width')).toBe('input_width');
      expect(normalizeParameterKey('input_prompt')).toBe('input_prompt');
    });

    test('handles edge cases', () => {
      expect(normalizeParameterKey('')).toBe('');
      expect(normalizeParameterKey(null)).toBeNull();
      expect(normalizeParameterKey(undefined)).toBeUndefined();
    });
  });

  describe('normalizeParameterKeys', () => {
    test('normalizes top-level keys', () => {
      const params = {
        width: 1024,
        height: 768,
        input_seed: 42
      };

      const normalized = normalizeParameterKeys(params);
      expect(normalized).toEqual({
        input_width: 1024,
        input_height: 768,
        input_seed: 42
      });
    });

    test('skips numeric keys', () => {
      const params = {
        1: 'prompt',
        2: 'width',
        width: 1024
      };

      const normalized = normalizeParameterKeys(params);
      expect(normalized).toEqual({
        1: 'prompt',
        2: 'width',
        input_width: 1024
      });
    });

    test('handles nested objects when shallow=false', () => {
      const params = {
        settings: {
          width: 1024,
          height: 768
        },
        input_prompt: 'test'
      };

      const normalized = normalizeParameterKeys(params);
      expect(normalized).toEqual({
        input_settings: {
          input_width: 1024,
          input_height: 768
        },
        input_prompt: 'test'
      });
    });

    test('ignores nested objects when shallow=true', () => {
      const params = {
        settings: {
          width: 1024,
          height: 768
        },
        input_prompt: 'test'
      };

      const normalized = normalizeParameterKeys(params, { shallow: true });
      expect(normalized).toEqual({
        input_settings: {
          width: 1024,
          height: 768
        },
        input_prompt: 'test'
      });
    });

    test('respects ignoreKeys option', () => {
      const params = {
        width: 1024,
        height: 768,
        type: 'MAKE'
      };

      const normalized = normalizeParameterKeys(params, { ignoreKeys: ['type'] });
      expect(normalized).toEqual({
        input_width: 1024,
        input_height: 768,
        type: 'MAKE'
      });
    });
  });

  describe('normalizeTemplateParameters', () => {
    test('normalizes template input keys', () => {
      const template = {
        name: 'test-template',
        inputs: {
          prompt: { type: 'string', required: true },
          negative_prompt: { type: 'string', required: false },
          input_width: { type: 'number', default: 1024 }
        }
      };

      const normalized = normalizeTemplateParameters(template);
      expect(normalized).toEqual({
        name: 'test-template',
        inputs: {
          input_prompt: { type: 'string', required: true },
          input_negative_prompt: { type: 'string', required: false },
          input_width: { type: 'number', default: 1024 }
        }
      });
    });

    test('preserves numeric keys in inputs', () => {
      const template = {
        inputs: {
          1: { type: 'string', label: 'Prompt' },
          prompt: { type: 'string', required: true }
        }
      };

      const normalized = normalizeTemplateParameters(template);
      expect(normalized).toEqual({
        inputs: {
          1: { type: 'string', label: 'Prompt' },
          input_prompt: { type: 'string', required: true }
        }
      });
    });
  });

  describe('normalizeAPIParameters', () => {
    test('normalizes input parameters in API request payload', () => {
      const requestPayload = {
        deployment_id: '10f46770-f89c-47ba-8b06-57c82d3b9bfc',
        inputs: {
          prompt: 'test prompt',
          input_width: 1024,
          height: 768
        }
      };

      const normalized = normalizeAPIParameters(requestPayload);
      expect(normalized).toEqual({
        deployment_id: '10f46770-f89c-47ba-8b06-57c82d3b9bfc',
        inputs: {
          input_prompt: 'test prompt',
          input_width: 1024,
          input_height: 768
        }
      });
    });

    test('handles missing inputs', () => {
      const requestPayload = {
        deployment_id: '10f46770-f89c-47ba-8b06-57c82d3b9bfc'
      };

      const normalized = normalizeAPIParameters(requestPayload);
      expect(normalized).toEqual({
        deployment_id: '10f46770-f89c-47ba-8b06-57c82d3b9bfc'
      });
    });
  });

  describe('normalizeUIParameters', () => {
    test('extracts and normalizes UI parameters', () => {
      const uiParams = {
        prompt: 'test prompt',
        width: 1024,
        height: 768,
        inputs: {
          input_seed: 42,
          steps: 30,
          1: 'prompt',
          2: 'width'
        }
      };

      const normalized = normalizeUIParameters(uiParams);
      expect(normalized).toEqual({
        input_prompt: 'test prompt',
        input_width: 1024,
        input_height: 768,
        input_seed: 42,
        input_steps: 30
      });
    });

    test('handles missing inputs object', () => {
      const uiParams = {
        prompt: 'test prompt',
        width: 1024,
        height: 768
      };

      const normalized = normalizeUIParameters(uiParams);
      expect(normalized).toEqual({
        input_prompt: 'test prompt',
        input_width: 1024,
        input_height: 768
      });
    });
  });
}); 