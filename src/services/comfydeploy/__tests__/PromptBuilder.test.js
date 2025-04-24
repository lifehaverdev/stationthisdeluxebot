/**
 * PromptBuilder Unit Tests
 */

const PromptBuilder = require('../PromptBuilder');
const { GenerationRequest } = require('../../../core/generation/models');

describe('PromptBuilder', () => {
  let promptBuilder;
  
  beforeEach(() => {
    // Create a simple mock for the getBasePromptByName function
    const getBasePromptByName = jest.fn((name) => `base prompt for ${name}`);
    
    // Create a new PromptBuilder instance with test defaults
    promptBuilder = new PromptBuilder({
      getBasePromptByName,
      defaultSettings: {
        WIDTH: 1024,
        HEIGHT: 1024,
        STEPS: 30,
        CFG: 7
      },
      baseNegPrompt: 'test negative prompt'
    });
  });
  
  describe('_processPromptText', () => {
    it('should prioritize original input_prompt from settings.inputs', async () => {
      // Arrange
      const promptObj = {
        type: 'MAKE',
        prompt: 'original object prompt',
        userPrompt: 'user prompt part',
        settings: {
          inputs: {
            input_prompt: 'direct input prompt from settings.inputs'
          },
          prompt: 'settings prompt field'
        }
      };
      
      // Act
      await promptBuilder._processPromptText(promptObj);
      
      // Assert
      expect(promptObj.finalPrompt).toBe('direct input prompt from settings.inputs');
    });
    
    it('should use settings.input_prompt as second priority', async () => {
      // Arrange
      const promptObj = {
        type: 'MAKE',
        prompt: 'original object prompt',
        userPrompt: 'user prompt part',
        settings: {
          input_prompt: 'input_prompt from settings',
          prompt: 'settings prompt field'
        }
      };
      
      // Act
      await promptBuilder._processPromptText(promptObj);
      
      // Assert
      expect(promptObj.finalPrompt).toBe('input_prompt from settings');
    });
    
    it('should use settings.prompt as third priority', async () => {
      // Arrange
      const promptObj = {
        type: 'MAKE',
        prompt: 'original object prompt',
        userPrompt: 'user prompt part',
        settings: {
          prompt: 'settings prompt field'
        }
      };
      
      // Act
      await promptBuilder._processPromptText(promptObj);
      
      // Assert
      expect(promptObj.finalPrompt).toBe('settings prompt field');
    });
    
    it('should use promptObj.prompt as fourth priority', async () => {
      // Arrange
      const promptObj = {
        type: 'MAKE',
        prompt: 'original object prompt',
        userPrompt: 'user prompt part'
      };
      
      // Act
      await promptBuilder._processPromptText(promptObj);
      
      // Assert
      expect(promptObj.finalPrompt).toBe('original object prompt');
    });
    
    it('should only fall back to composition as last resort', async () => {
      // Arrange
      const promptObj = {
        type: 'MAKE',
        prompt: '',
        userPrompt: 'user prompt part'
      };
      
      // Act
      await promptBuilder._processPromptText(promptObj);
      
      // Assert
      expect(promptObj.finalPrompt).toBe(' , user prompt part, ');
    });
  });
  
  describe('_finalizeRequest', () => {
    it('should ensure input_prompt is set correctly in final request', () => {
      // Arrange
      const promptObj = {
        type: 'MAKE',
        prompt: 'original prompt',
        finalPrompt: 'processed final prompt',
        settings: {
          inputs: {
            input_prompt: 'direct API input prompt'
          }
        },
        deploymentIds: ['test-id-1', 'test-id-2']
      };
      
      // Mock the filterPrimitiveParameters function
      const mockFilterModule = {
        filterPrimitiveParameters: jest.fn(inputs => inputs)
      };
      jest.mock('../utils/normalizeParameters', () => mockFilterModule, { virtual: true });
      
      // Mock the _filterToRequiredParameters method
      promptBuilder._filterToRequiredParameters = jest.fn(inputs => inputs);
      
      // Act
      const result = promptBuilder._finalizeRequest(promptObj);
      
      // Assert
      expect(result.inputs.input_prompt).toBe('direct API input prompt');
    });
    
    it('should handle the correct prompt priority order in the final request', () => {
      // Arrange - without settings.inputs.input_prompt
      const promptObj = {
        type: 'MAKE',
        prompt: 'original prompt',
        finalPrompt: 'processed final prompt',
        settings: {
          prompt: 'settings prompt field'
        },
        deploymentIds: ['test-id-1', 'test-id-2']
      };
      
      // Mock the filterPrimitiveParameters function
      const mockFilterModule = {
        filterPrimitiveParameters: jest.fn(inputs => inputs)
      };
      jest.mock('../utils/normalizeParameters', () => mockFilterModule, { virtual: true });
      
      // Mock the _filterToRequiredParameters method
      promptBuilder._filterToRequiredParameters = jest.fn(inputs => inputs);
      
      // Act
      const result = promptBuilder._finalizeRequest(promptObj);
      
      // Assert - should use finalPrompt as second priority
      expect(result.inputs.input_prompt).toBe('processed final prompt');
    });
  });
  
  describe('complete request flow', () => {
    it('should correctly handle MAKE workflow with direct prompt input', async () => {
      // Arrange
      const request = new GenerationRequest({
        type: 'MAKE',
        prompt: 'nake sexy beautiful large breasted blonde elf',
        settings: {
          inputs: {
            input_prompt: 'nake sexy beautiful large breasted blonde elf',
            input_negative_prompt: 'bad quality, worst quality'
          }
        }
      });
      
      const userContext = {
        userId: 'test-user',
        balance: 1000
      };
      
      const deploymentInfo = {
        ids: ['test-deployment-1', 'test-deployment-2'],
        inputs: {
          width: 1024,
          height: 1024
        }
      };
      
      // Mock dependencies
      promptBuilder._filterToRequiredParameters = jest.fn(inputs => inputs);
      
      // Mock the filterPrimitiveParameters function
      const mockFilterModule = {
        filterPrimitiveParameters: jest.fn(inputs => inputs)
      };
      jest.mock('../utils/normalizeParameters', () => mockFilterModule, { virtual: true });
      
      // Act
      const result = await promptBuilder.build(request, userContext, deploymentInfo);
      
      // Assert
      expect(result.inputs.input_prompt).toBe('nake sexy beautiful large breasted blonde elf');
      expect(result.deploymentId).toBeDefined();
    });
  });
}); 