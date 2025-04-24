/**
 * Account Service Tests
 * 
 * Tests the functionality of the core account service.
 */

const AccountService = require('../../../src/core/account/service');

// Mock dependencies
const mockUserRepository = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn()
};

const mockApiKeyRepository = {
  find: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('AccountService', () => {
  let accountService;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Create service instance with mocked dependencies
    accountService = new AccountService({
      userRepository: mockUserRepository,
      apiKeyRepository: mockApiKeyRepository,
      logger: mockLogger
    });
  });

  describe('getUserProfile', () => {
    test('should return user profile from repository', async () => {
      // Arrange
      const userId = 'user123';
      const mockUser = {
        name: 'Test User',
        username: 'testuser',
        createdAt: 1609459200000, // 2021-01-01
        verified: true,
        email: 'test@example.com'
      };
      
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      
      // Act
      const result = await accountService.getUserProfile(userId);
      
      // Assert
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ userId });
      expect(result).toEqual({
        name: 'Test User',
        username: 'testuser',
        createdAt: 1609459200000,
        verified: true,
        email: 'test@example.com'
      });
    });
    
    test('should return default profile when user not found', async () => {
      // Arrange
      const userId = 'nonexistent';
      const currentTime = Date.now();
      
      mockUserRepository.findOne.mockResolvedValue(null);
      
      // Act
      const result = await accountService.getUserProfile(userId);
      
      // Assert
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ userId });
      expect(result.name).toBeNull();
      expect(result.username).toBeNull();
      expect(result.verified).toBe(false);
      // Timestamp should be approximately now
      expect(result.createdAt).toBeGreaterThanOrEqual(currentTime - 1000);
      expect(result.createdAt).toBeLessThanOrEqual(currentTime + 1000);
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const error = new Error('Database error');
      
      mockUserRepository.findOne.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.getUserProfile(userId)).rejects.toThrow('Failed to fetch profile');
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching user profile', { userId, error });
    });
  });

  describe('updateUserProfile', () => {
    test('should update user profile with valid fields', async () => {
      // Arrange
      const userId = 'user123';
      const profileData = {
        name: 'Updated User',
        username: 'updateduser',
        email: 'updated@example.com',
        invalidField: 'should be ignored' // Should be ignored
      };
      
      const updatedProfile = {
        name: 'Updated User',
        username: 'updateduser',
        email: 'updated@example.com',
        createdAt: 1609459200000,
        verified: true
      };
      
      mockUserRepository.update.mockResolvedValue(true);
      mockUserRepository.findOne.mockResolvedValue(updatedProfile);
      
      // Act
      const result = await accountService.updateUserProfile(userId, profileData);
      
      // Assert
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { userId },
        {
          name: 'Updated User',
          username: 'updateduser',
          email: 'updated@example.com'
        }
      );
      
      // Should not contain invalid fields
      expect(mockUserRepository.update.mock.calls[0][1]).not.toHaveProperty('invalidField');
      
      expect(result).toEqual(updatedProfile);
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const profileData = { name: 'Updated User' };
      const error = new Error('Database error');
      
      mockUserRepository.update.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.updateUserProfile(userId, profileData)).rejects.toThrow('Failed to update profile');
      expect(mockLogger.error).toHaveBeenCalledWith('Error updating user profile', { userId, error });
    });
  });

  describe('getUserPreferences', () => {
    test('should return user preferences from repository', async () => {
      // Arrange
      const userId = 'user123';
      const mockUser = {
        preferences: {
          notifications: false,
          language: 'es',
          theme: 'dark'
        }
      };
      
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      
      // Act
      const result = await accountService.getUserPreferences(userId);
      
      // Assert
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ userId });
      expect(result).toEqual({
        notifications: false,
        language: 'es',
        theme: 'dark'
      });
    });
    
    test('should return default preferences when user not found', async () => {
      // Arrange
      const userId = 'nonexistent';
      
      mockUserRepository.findOne.mockResolvedValue(null);
      
      // Act
      const result = await accountService.getUserPreferences(userId);
      
      // Assert
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ userId });
      expect(result).toEqual({
        notifications: true,
        language: 'en',
        theme: 'default'
      });
    });
    
    test('should return default preferences when user has no preferences', async () => {
      // Arrange
      const userId = 'user123';
      const mockUser = {
        name: 'Test User'
        // No preferences field
      };
      
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      
      // Act
      const result = await accountService.getUserPreferences(userId);
      
      // Assert
      expect(result).toEqual({
        notifications: true,
        language: 'en',
        theme: 'default'
      });
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const error = new Error('Database error');
      
      mockUserRepository.findOne.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.getUserPreferences(userId)).rejects.toThrow('Failed to fetch preferences');
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching user preferences', { userId, error });
    });
  });

  describe('updateUserPreferences', () => {
    test('should update preferences for existing user', async () => {
      // Arrange
      const userId = 'user123';
      const preferencesData = {
        notifications: false,
        language: 'fr',
        theme: 'light',
        invalidField: 'should be ignored' // Should be ignored
      };
      
      const existingUser = {
        userId,
        preferences: {
          notifications: true,
          language: 'en',
          theme: 'default'
        }
      };
      
      const updatedPreferences = {
        notifications: false,
        language: 'fr',
        theme: 'light'
      };
      
      mockUserRepository.findOne.mockResolvedValue(existingUser);
      mockUserRepository.update.mockResolvedValue(true);
      
      // Mock the second call to findOne when getUserPreferences is called
      mockUserRepository.findOne.mockImplementationOnce(() => {
        return Promise.resolve(existingUser);
      }).mockImplementationOnce(() => {
        return Promise.resolve({
          userId,
          preferences: updatedPreferences
        });
      });
      
      // Act
      const result = await accountService.updateUserPreferences(userId, preferencesData);
      
      // Assert
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { userId },
        { 
          preferences: {
            notifications: false,
            language: 'fr',
            theme: 'light'
          }
        }
      );
      
      expect(result).toEqual(updatedPreferences);
    });
    
    test('should create user with preferences if user does not exist', async () => {
      // Arrange
      const userId = 'newuser';
      const preferencesData = {
        notifications: false,
        language: 'de'
      };
      
      const currentTime = Date.now();
      
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(true);
      
      // For the second call in getUserPreferences
      mockUserRepository.findOne.mockImplementationOnce(() => {
        return Promise.resolve(null);
      }).mockImplementationOnce(() => {
        return Promise.resolve({
          userId,
          preferences: preferencesData
        });
      });
      
      // Act
      const result = await accountService.updateUserPreferences(userId, preferencesData);
      
      // Assert
      expect(mockUserRepository.create).toHaveBeenCalledWith({
        userId,
        createdAt: expect.any(Number),
        preferences: {
          notifications: false,
          language: 'de'
        }
      });
      
      // Verify createdAt is around current time
      const createdAt = mockUserRepository.create.mock.calls[0][0].createdAt;
      expect(createdAt).toBeGreaterThanOrEqual(currentTime - 1000);
      expect(createdAt).toBeLessThanOrEqual(currentTime + 1000);
      
      expect(result).toEqual({
        notifications: false,
        language: 'de',
        theme: 'default' // default value for missing preference
      });
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const preferencesData = { notifications: false };
      const error = new Error('Database error');
      
      mockUserRepository.findOne.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.updateUserPreferences(userId, preferencesData)).rejects.toThrow('Failed to update preferences');
      expect(mockLogger.error).toHaveBeenCalledWith('Error updating user preferences', { userId, error });
    });
  });

  describe('getUserApiKeys', () => {
    test('should return formatted API keys list', async () => {
      // Arrange
      const userId = 'user123';
      const mockApiKeys = [
        {
          id: 'key1',
          name: 'Test Key 1',
          key: 'sk-abcdefghijklmnop',
          createdAt: 1609459200000,
          lastUsed: 1609545600000
        },
        {
          id: 'key2',
          name: 'Test Key 2',
          key: 'sk-qrstuvwxyz123456',
          createdAt: 1609632000000,
          lastUsed: null
        }
      ];
      
      mockApiKeyRepository.find.mockResolvedValue(mockApiKeys);
      
      // Act
      const result = await accountService.getUserApiKeys(userId);
      
      // Assert
      expect(mockApiKeyRepository.find).toHaveBeenCalledWith({ userId });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'key1',
        name: 'Test Key 1',
        createdAt: 1609459200000,
        lastUsed: 1609545600000,
        truncatedKey: 'sk-a...mnop'
      });
      expect(result[1]).toEqual({
        id: 'key2',
        name: 'Test Key 2',
        createdAt: 1609632000000,
        lastUsed: null,
        truncatedKey: 'sk-q...3456'
      });
    });
    
    test('should return empty array when no API keys exist', async () => {
      // Arrange
      const userId = 'user123';
      
      mockApiKeyRepository.find.mockResolvedValue([]);
      
      // Act
      const result = await accountService.getUserApiKeys(userId);
      
      // Assert
      expect(mockApiKeyRepository.find).toHaveBeenCalledWith({ userId });
      expect(result).toEqual([]);
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const error = new Error('Database error');
      
      mockApiKeyRepository.find.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.getUserApiKeys(userId)).rejects.toThrow('Failed to fetch API keys');
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching user API keys', { userId, error });
    });
  });

  describe('generateApiKey', () => {
    test('should generate and store new API key', async () => {
      // Arrange
      const userId = 'user123';
      const keyName = 'New API Key';
      const currentTime = Date.now();
      
      // Mock Math.random for predictable key generation
      const originalRandom = Math.random;
      Math.random = jest.fn()
        .mockReturnValueOnce(0.1)
        .mockReturnValueOnce(0.2)
        .mockReturnValueOnce(0.3)
        .mockReturnValueOnce(0.4);
      
      mockApiKeyRepository.create.mockImplementation((data) => {
        return Promise.resolve({ ...data, id: 'newkey123' });
      });
      
      // Act
      const result = await accountService.generateApiKey(userId, keyName);
      
      // Restore Math.random
      Math.random = originalRandom;
      
      // Assert
      expect(mockApiKeyRepository.create).toHaveBeenCalledWith({
        userId,
        name: keyName,
        key: expect.stringMatching(/^sk-[a-z0-9]+$/),
        createdAt: expect.any(Number),
        lastUsed: null
      });
      
      // Verify createdAt is around current time
      const createdAt = mockApiKeyRepository.create.mock.calls[0][0].createdAt;
      expect(createdAt).toBeGreaterThanOrEqual(currentTime - 1000);
      expect(createdAt).toBeLessThanOrEqual(currentTime + 1000);
      
      expect(result).toEqual({
        id: 'newkey123',
        name: keyName,
        key: expect.stringMatching(/^sk-[a-z0-9]+$/),
        createdAt: expect.any(Number)
      });
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const keyName = 'New API Key';
      const error = new Error('Database error');
      
      mockApiKeyRepository.create.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.generateApiKey(userId, keyName)).rejects.toThrow('Failed to generate API key');
      expect(mockLogger.error).toHaveBeenCalledWith('Error generating API key', { userId, error });
    });
  });

  describe('deleteApiKey', () => {
    test('should delete API key from repository', async () => {
      // Arrange
      const userId = 'user123';
      const keyId = 'key123';
      
      mockApiKeyRepository.delete.mockResolvedValue(true);
      
      // Act
      const result = await accountService.deleteApiKey(userId, keyId);
      
      // Assert
      expect(mockApiKeyRepository.delete).toHaveBeenCalledWith({ userId, id: keyId });
      expect(result).toBe(true);
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const keyId = 'key123';
      const error = new Error('Database error');
      
      mockApiKeyRepository.delete.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.deleteApiKey(userId, keyId)).rejects.toThrow('Failed to delete API key');
      expect(mockLogger.error).toHaveBeenCalledWith('Error deleting API key', { userId, keyId, error });
    });
  });

  describe('deleteUserAccount', () => {
    test('should delete user account and all associated data', async () => {
      // Arrange
      const userId = 'user123';
      
      mockApiKeyRepository.deleteMany.mockResolvedValue(true);
      mockUserRepository.delete.mockResolvedValue(true);
      
      // Act
      const result = await accountService.deleteUserAccount(userId);
      
      // Assert
      expect(mockApiKeyRepository.deleteMany).toHaveBeenCalledWith({ userId });
      expect(mockUserRepository.delete).toHaveBeenCalledWith({ userId });
      expect(result).toBe(true);
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const error = new Error('Database error');
      
      mockApiKeyRepository.deleteMany.mockRejectedValue(error);
      
      // Act & Assert
      await expect(accountService.deleteUserAccount(userId)).rejects.toThrow('Failed to delete user account');
      expect(mockLogger.error).toHaveBeenCalledWith('Error deleting user account', { userId, error });
    });
  });
}); 