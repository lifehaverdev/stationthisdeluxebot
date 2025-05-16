/**
 * Settings Workflow Tests
 * 
 * Tests for the platform-agnostic settings workflow
 */

// Mock services
const mockSession = {
  sessions: {},
  getSession: jest.fn((userId) => {
    if (!mockSession.sessions[userId]) {
      mockSession.sessions[userId] = {
        userId,
        balance: 1000000,
        input_width: 1024,
        input_height: 1024,
        batch_size: 1,
        steps: 30,
        cfg_scale: 6,
        strength: 0.75,
        prompt: "test prompt",
        negative_prompt: "test negative prompt",
        user_prompt: "",
        seed: -1,
        input_image: null,
        input_control_image: null,
        input_pose_image: null,
        input_style_image: null,
        checkpoint: "default"
      };
    }
    return mockSession.sessions[userId];
  }),
  setValue: jest.fn((userId, key, value) => {
    if (!mockSession.sessions[userId]) {
      mockSession.getSession(userId);
    }
    mockSession.sessions[userId][key] = value;
    return mockSession.sessions[userId];
  }),
  getValue: jest.fn((userId, key, defaultValue) => {
    if (!mockSession.sessions[userId]) {
      return defaultValue;
    }
    return mockSession.sessions[userId][key] !== undefined 
      ? mockSession.sessions[userId][key] 
      : defaultValue;
  })
};

const mockPoints = {
  calculateCost: jest.fn(() => 100),
  hasEnoughPoints: jest.fn(() => true),
  deductPoints: jest.fn(() => true),
  refundPoints: jest.fn(() => true)
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

// Import the settings workflow
const createSettingsWorkflow = require('../../src/workflows/settings');

describe('Settings Workflow', () => {
  // Create an instance of the workflow with mocked dependencies
  const settingsWorkflow = createSettingsWorkflow({
    session: mockSession,
    points: mockPoints,
    logger: mockLogger
  });
  
  // Test user ID to use across tests
  const TEST_USER_ID = '5472638766';
  
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.sessions = {};
  });
  
  describe('getAllSettings', () => {
    test('should return all settings for a user', () => {
      // Arrange
      mockSession.getSession(TEST_USER_ID);
      
      // Act
      const result = settingsWorkflow.getAllSettings(TEST_USER_ID);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.settings).toBeDefined();
      expect(result.limits).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalled();
      expect(mockSession.getSession).toHaveBeenCalledWith(TEST_USER_ID);
    });
    
    test('should handle errors', () => {
      // Arrange
      mockSession.getSession.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      // Act
      const result = settingsWorkflow.getAllSettings(TEST_USER_ID);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('updateSetting', () => {
    test('should update input_width setting', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'input_width', 512);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('input_width');
      expect(result.newValue).toBe(512);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'input_width', 512);
    });
    
    test('should validate and reject invalid input_width', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'input_width', 'invalid');
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should update batch_size setting', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'batch_size', 2);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('batch_size');
      expect(result.newValue).toBe(2);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'batch_size', 2);
    });
    
    test('should validate and reject invalid batch_size', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'batch_size', -1);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should update steps setting', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'steps', 20);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('steps');
      expect(result.newValue).toBe(20);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'steps', 20);
    });
    
    test('should validate and reject invalid steps', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'steps', 'invalid');
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should update cfg_scale setting', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'cfg_scale', 7.5);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('cfg_scale');
      expect(result.newValue).toBe(7.5);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'cfg_scale', 7.5);
    });
    
    test('should validate and reject invalid cfg_scale', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'cfg_scale', 31);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should update strength setting', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'strength', 0.5);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('strength');
      expect(result.newValue).toBe(0.5);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'strength', 0.5);
    });
    
    test('should validate and reject invalid strength', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'strength', 2);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should update seed setting', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'seed', 123456);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('seed');
      expect(result.newValue).toBe(123456);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'seed', 123456);
    });
    
    test('should accept -1 as a valid seed value', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'seed', -1);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('seed');
      expect(result.newValue).toBe(-1);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'seed', -1);
    });
    
    test('should update prompt settings', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'prompt', 'New test prompt');
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('prompt');
      expect(result.newValue).toBe('New test prompt');
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'prompt', 'New test prompt');
    });
    
    test('should update image URL settings', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'input_image', 'https://example.com/image.jpg');
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.setting).toBe('input_image');
      expect(result.newValue).toBe('https://example.com/image.jpg');
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'input_image', 'https://example.com/image.jpg');
    });
    
    test('should handle unknown settings', () => {
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'unknown_setting', 'value');
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should handle errors during update', () => {
      // Arrange
      mockSession.setValue.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      // Act
      const result = settingsWorkflow.updateSetting(TEST_USER_ID, 'prompt', 'New test prompt');
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('updateMultipleSettings', () => {
    test('should update multiple settings at once', () => {
      // Act
      const result = settingsWorkflow.updateMultipleSettings(TEST_USER_ID, {
        input_width: 512,
        input_height: 512,
        steps: 20
      });
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.settings).toBeDefined();
      expect(result.settings.input_width).toBe(512);
      expect(result.settings.input_height).toBe(512);
      expect(result.settings.steps).toBe(20);
      expect(mockSession.setValue).toHaveBeenCalledTimes(3);
    });
    
    test('should handle invalid settings', () => {
      // Act
      const result = settingsWorkflow.updateMultipleSettings(TEST_USER_ID, {
        input_width: 512,
        unknown_setting: 'value'
      });
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.settings).toBeDefined();
      expect(result.settings.input_width).toBe(512);
      expect(result.results.input_width.success).toBe(true);
      expect(result.results.unknown_setting.success).toBe(false);
      expect(mockSession.setValue).toHaveBeenCalledTimes(1);
    });
    
    test('should handle non-object parameter', () => {
      // Act
      const result = settingsWorkflow.updateMultipleSettings(TEST_USER_ID, 'not an object');
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should handle errors', () => {
      // Arrange
      mockSession.getSession.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      // Act
      const result = settingsWorkflow.updateMultipleSettings(TEST_USER_ID, {
        input_width: 512
      });
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('resetSettings', () => {
    test('should reset all settings to defaults', () => {
      // Arrange
      mockSession.sessions[TEST_USER_ID] = {
        userId: TEST_USER_ID,
        balance: 1000000,
        input_width: 512,
        input_height: 512,
        batch_size: 2,
        steps: 20,
        cfg_scale: 7.5,
        strength: 0.5,
        prompt: "custom prompt",
        negative_prompt: "custom negative",
        user_prompt: "custom user prompt",
        seed: 123456,
        input_image: "https://example.com/image.jpg",
        input_control_image: "https://example.com/control.jpg",
        input_pose_image: "https://example.com/pose.jpg",
        input_style_image: "https://example.com/style.jpg",
        checkpoint: "custom_checkpoint"
      };
      
      // Act
      const result = settingsWorkflow.resetSettings(TEST_USER_ID);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.settings).toBeDefined();
      expect(result.settings.input_width).toBe(1024);
      expect(result.settings.input_height).toBe(1024);
      expect(result.settings.batch_size).toBe(1);
      expect(result.settings.steps).toBe(30);
      expect(result.settings.cfg_scale).toBe(6);
      expect(result.settings.strength).toBe(0.75);
      expect(result.settings.prompt).toBe("");
      expect(result.settings.negative_prompt).toBe("");
      expect(result.settings.user_prompt).toBe("");
      expect(result.settings.seed).toBe(-1);
      expect(result.settings.input_image).toBe(null);
      expect(result.settings.input_control_image).toBe(null);
      expect(result.settings.input_pose_image).toBe(null);
      expect(result.settings.input_style_image).toBe(null);
      expect(result.settings.checkpoint).toBe("default");
      expect(mockSession.setValue).toHaveBeenCalledTimes(15);
    });
    
    test('should handle errors during reset', () => {
      // Arrange
      mockSession.setValue.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      // Act
      const result = settingsWorkflow.resetSettings(TEST_USER_ID);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('setSize', () => {
    test('should set width and height in one operation', () => {
      // Act
      const result = settingsWorkflow.setSize(TEST_USER_ID, 512, 768);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.width).toBe(512);
      expect(result.height).toBe(768);
      expect(result.settings).toBeDefined();
      expect(mockSession.setValue).toHaveBeenCalledTimes(2);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'input_width', 512);
      expect(mockSession.setValue).toHaveBeenCalledWith(TEST_USER_ID, 'input_height', 768);
    });
    
    test('should validate and reject invalid size values', () => {
      // Act
      const result = settingsWorkflow.setSize(TEST_USER_ID, 'invalid', 768);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should validate against maximum size', () => {
      // Arrange
      mockSession.sessions[TEST_USER_ID] = {
        userId: TEST_USER_ID,
        balance: 0 // This will give a max size of 1024
      };
      
      // Act
      const result = settingsWorkflow.setSize(TEST_USER_ID, 1025, 768);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSession.setValue).not.toHaveBeenCalled();
    });
    
    test('should handle errors', () => {
      // Arrange
      mockSession.setValue.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      // Act
      const result = settingsWorkflow.setSize(TEST_USER_ID, 512, 768);
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('calculateMaxSize, calculateMaxBatch, calculateMaxSteps', () => {
    test('should calculate max size based on balance', () => {
      // Arrange
      mockSession.sessions[TEST_USER_ID] = {
        userId: TEST_USER_ID,
        balance: 1000000
      };
      
      // Act
      const result = settingsWorkflow.calculateMaxSize(TEST_USER_ID);
      
      // Assert
      expect(result).toBe(2048); // Since 1000000 / 1000 + 1024 = 2024, which is capped at 2048
    });
    
    test('should calculate max batch based on balance', () => {
      // Arrange
      mockSession.sessions[TEST_USER_ID] = {
        userId: TEST_USER_ID,
        balance: 5000000
      };
      
      // Act
      const result = settingsWorkflow.calculateMaxBatch(TEST_USER_ID);
      
      // Assert
      expect(result).toBe(6); // Since 5000000 / 1000000 + 1 = 6, which is at the limit
    });
    
    test('should calculate max steps based on balance', () => {
      // Arrange
      mockSession.sessions[TEST_USER_ID] = {
        userId: TEST_USER_ID,
        balance: 10000000
      };
      
      // Act
      const result = settingsWorkflow.calculateMaxSteps(TEST_USER_ID);
      
      // Assert
      expect(result).toBe(40); // Since 10000000 / 1000000 + 30 = 40, below cap of 48
    });
  });
}); 