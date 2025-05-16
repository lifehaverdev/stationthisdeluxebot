/**
 * User service tests
 */

// Define test data
const existingUser = {
  core: {
    userId: 'existing-user',
    username: 'existinguser',
    createdAt: new Date().toISOString()
  },
  economy: {
    userId: 'existing-user',
    totalSpent: 0,
    purchases: []
  },
  preferences: {
    userId: 'existing-user',
    settings: {}
  }
};

// Mock events module
jest.mock('../../../src/core/shared/events', () => {
  const eventMock = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
  };
  return {
    // Default export
    __esModule: true,
    default: eventMock,
    // Named exports
    events: eventMock,
    publish: eventMock.publish,
    subscribe: eventMock.subscribe,
    unsubscribe: eventMock.unsubscribe
  };
});

// Mock entire modules
jest.mock('../../../src/core/user/repository');
jest.mock('../../../src/core/user/models', () => {
  const actual = jest.requireActual('../../../src/core/user/models');
  return {
    ...actual,
    User: jest.fn().mockImplementation((data = {}) => {
      return {
        core: {
          userId: data.userId || '',
          username: data.username || '',
          createdAt: data.createdAt || new Date().toISOString(),
          toJSON: jest.fn().mockReturnValue(data)
        },
        economy: {
          userId: data.userId || '',
          points: data.points || 0,
          doints: data.doints || 0,
          qoints: data.qoints || 0
        },
        preferences: {
          userId: data.userId || '',
          settings: data.settings || {}
        },
        getId: jest.fn().mockReturnValue(data.userId),
        toJSON: jest.fn().mockReturnValue(data)
      };
    })
  };
});

// Importing after mocking to get the mocked version
const { UserService, User } = require('../../../src/core/user');
const eventBus = require('../../../src/core/shared/events').default;

// For testing verification
const events = eventBus;

// Mock a repository instance for our tests
const mockRepository = {
  findById: jest.fn(async (userId) => {
    if (userId === 'existing-user') {
      return existingUser;
    }
    return null;
  }),
  create: jest.fn(async (userData) => {
    return new User({
      userId: userData.userId,
      username: userData.username,
      createdAt: new Date().toISOString()
    });
  }),
  updateById: jest.fn(async (userId, updates) => {
    if (userId === 'existing-user') {
      const updatedUser = new User({
        ...existingUser,
        ...updates,
        userId: 'existing-user'
      });
      return updatedUser;
    }
    return null;
  }),
  deleteById: jest.fn(async (userId) => {
    if (userId === 'existing-user') {
      return true;
    }
    return false;
  }),
  find: jest.fn(async () => [])
};

describe('UserService', () => {
  let userService;
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Create a new instance directly with our mocked repository
    userService = new UserService({ userRepository: mockRepository });
  });
  
  describe('createUser', () => {
    test('should create a new user', async () => {
      // Arrange
      const userData = {
        userId: 'test-user-id',
        username: 'testuser'
      };
      
      // Act
      const result = await userService.createUser(userData);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.core.userId).toBe('test-user-id');
      expect(result.core.username).toBe('testuser');
      expect(mockRepository.create).toHaveBeenCalledTimes(1);
      expect(events.publish).toHaveBeenCalledWith('user:created', expect.objectContaining({
        userId: 'test-user-id'
      }));
    });
    
    test('should throw error if user already exists', async () => {
      // Arrange
      const userData = {
        userId: 'existing-user',
        username: 'existinguser'
      };
      
      // Act & Assert
      await expect(userService.createUser(userData))
        .rejects.toThrow('User with ID existing-user already exists');
      expect(mockRepository.create).not.toHaveBeenCalled();
    });
  });
  
  describe('getUserById', () => {
    test('should return user if found', async () => {
      // Arrange
      const userId = 'existing-user';
      
      // Act
      const result = await userService.getUserById(userId);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.core.userId).toBe('existing-user');
      expect(mockRepository.findById).toHaveBeenCalledWith('existing-user');
    });
    
    test('should return null if user not found', async () => {
      // Arrange
      const userId = 'non-existent-user';
      mockRepository.findById.mockResolvedValueOnce(null);
      
      // Act
      const result = await userService.getUserById(userId);
      
      // Assert
      expect(result).toBeNull();
    });
  });
  
  describe('updateUser', () => {
    test('should update user successfully', async () => {
      // Arrange
      const userId = 'existing-user';
      const updates = {
        username: 'updateduser',
        preferences: {
          theme: 'dark'
        }
      };
      
      // Act
      const result = await userService.updateUser(userId, updates);
      
      // Assert
      expect(result).toBeDefined();
      expect(mockRepository.updateById).toHaveBeenCalledWith(userId, updates);
      expect(events.publish).toHaveBeenCalledWith('user:updated', expect.objectContaining({
        userId: 'existing-user'
      }));
    });
    
    test('should return null if user not found', async () => {
      // Arrange
      const userId = 'non-existent-user';
      const updates = { username: 'newname' };
      
      mockRepository.updateById.mockResolvedValueOnce(null);
      
      // Act
      const result = await userService.updateUser(userId, updates);
      
      // Assert
      expect(result).toBeNull();
      expect(mockRepository.updateById).toHaveBeenCalledWith(userId, updates);
    });
  });
  
  describe('deleteUser', () => {
    test('should delete user successfully', async () => {
      // Arrange
      const userId = 'existing-user';
      
      // Act
      const result = await userService.deleteUser(userId);
      
      // Assert
      expect(result).toBe(true);
      expect(mockRepository.deleteById).toHaveBeenCalledWith('existing-user');
      expect(events.publish).toHaveBeenCalledWith('user:deleted', expect.objectContaining({
        userId: 'existing-user'
      }));
    });
    
    test('should return false if user not found', async () => {
      // Arrange
      const userId = 'non-existent-user';
      mockRepository.deleteById.mockResolvedValueOnce(false);
      
      // Act
      const result = await userService.deleteUser(userId);
      
      // Assert
      expect(result).toBe(false);
      expect(mockRepository.deleteById).toHaveBeenCalledWith('non-existent-user');
    });
  });
}); 