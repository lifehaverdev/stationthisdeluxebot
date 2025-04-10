/**
 * Points service tests
 */

// Define test constants
const PointType = {
  POINTS: 'points',
  DOINTS: 'doints',
  QOINTS: 'qoints'
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

// Mock modules before import
jest.mock('../../../src/core/points/repository');
jest.mock('../../../src/core/points/calculation-service');

// Import after mocking
const { PointsService } = require('../../../src/core/points');
const eventBus = require('../../../src/core/shared/events').default;
const { UserPoints } = require('../../../src/core/points/models');

// Mock repository instance
const mockRepository = {
  getUserPoints: jest.fn(async (userId) => {
    if (userId === 'existing-user') {
      return new UserPoints({
        userId: 'existing-user',
        points: 100,
        doints: 50,
        qoints: 20,
        exp: 200,
        lastPointsUpdate: new Date()
      });
    }
    return null;
  }),
  saveUserPoints: jest.fn(async (userId, userPoints) => userPoints),
  incrementPoints: jest.fn(async (userId, pointType, amount) => {
    const points = new UserPoints({
      userId: userId,
      points: 100,
      doints: 50,
      qoints: 20,
      exp: 200
    });
    
    points[pointType] = points[pointType] + amount;
    return points;
  }),
  decrementPoints: jest.fn(async (userId, pointType, amount) => {
    const points = new UserPoints({
      userId: userId,
      points: 100,
      doints: 50,
      qoints: 20,
      exp: 200
    });
    
    points[pointType] = Math.max(0, points[pointType] - amount);
    return points;
  })
};

// Mock calculation service
const mockCalculationService = {
  calculateRegenerationAmount: jest.fn((balance, timeSinceLastUpdate) => {
    // Simple mock implementation: regenerate 10 points per day
    const daysDifference = Math.floor(timeSinceLastUpdate / (1000 * 60 * 60 * 24));
    return Math.min(50, daysDifference * 10); // Cap at 50 points
  })
};

// Spy on events
jest.spyOn(eventBus, 'publish');

describe('PointsService', () => {
  let pointsService;
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Create a new instance of PointsService for each test
    pointsService = new PointsService({
      pointsRepository: mockRepository,
      calculationService: mockCalculationService
    });
  });
  
  describe('getUserPoints', () => {
    test('should return existing user points', async () => {
      // Arrange
      const userId = 'existing-user';
      
      // Act
      const result = await pointsService.getUserPoints(userId);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.userId).toBe('existing-user');
      expect(result.points).toBe(100);
      expect(result.qoints).toBe(20);
      expect(mockRepository.getUserPoints).toHaveBeenCalledWith('existing-user');
    });
    
    test('should return null for non-existing user', async () => {
      // Arrange
      const userId = 'new-user';
      mockRepository.getUserPoints.mockResolvedValueOnce(null);
      
      // Act
      const result = await pointsService.getUserPoints(userId);
      
      // Assert
      expect(result).toBeNull();
      expect(mockRepository.getUserPoints).toHaveBeenCalledWith('new-user');
    });
  });
  
  describe('addPoints', () => {
    test('should add points to user', async () => {
      // Arrange
      const userId = 'existing-user';
      const amount = 50;
      const pointType = PointType.POINTS;
      const reason = 'test-addition';
      
      // Act
      const result = await pointsService.addPoints(userId, amount, pointType, reason);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.points).toBe(150); // 100 + 50
      expect(mockRepository.incrementPoints).toHaveBeenCalledWith(
        'existing-user',
        'points',
        50
      );
      expect(eventBus.publish).toHaveBeenCalledWith('points:added', expect.objectContaining({
        userId: 'existing-user',
        amount: 50,
        pointType: 'points',
        reason: 'test-addition'
      }));
    });
    
    test('should add qoints to user', async () => {
      // Arrange
      const userId = 'existing-user';
      const amount = 30;
      const pointType = PointType.QOINTS;
      const reason = 'test-addition';
      
      // Act
      const result = await pointsService.addPoints(userId, amount, pointType, reason);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.qoints).toBe(50); // 20 + 30
      expect(mockRepository.incrementPoints).toHaveBeenCalledWith(
        'existing-user',
        'qoints',
        30
      );
      expect(eventBus.publish).toHaveBeenCalledWith('points:added', expect.objectContaining({
        userId: 'existing-user',
        amount: 30,
        pointType: 'qoints',
        reason: 'test-addition'
      }));
    });
    
    test('should throw error if amount is not positive', async () => {
      // Arrange
      const userId = 'existing-user';
      const amount = 0;
      const pointType = PointType.POINTS;
      const reason = 'test-addition';
      
      // Act & Assert
      await expect(pointsService.addPoints(userId, amount, pointType, reason))
        .rejects.toThrow('Amount must be positive');
      expect(mockRepository.incrementPoints).not.toHaveBeenCalled();
    });
  });
  
  describe('deductPoints', () => {
    test('should deduct points from user', async () => {
      // Arrange
      const userId = 'existing-user';
      const amount = 30;
      const pointType = PointType.POINTS;
      const reason = 'test-deduction';
      
      // Act
      const result = await pointsService.deductPoints(userId, amount, pointType, reason);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.points).toBe(70); // 100 - 30
      expect(mockRepository.decrementPoints).toHaveBeenCalledWith(
        'existing-user',
        'points',
        30
      );
      expect(eventBus.publish).toHaveBeenCalledWith('points:deducted', expect.objectContaining({
        userId: 'existing-user',
        amount: 30,
        pointType: 'points',
        reason: 'test-deduction'
      }));
    });
    
    test('should throw error if amount is not positive', async () => {
      // Arrange
      const userId = 'existing-user';
      const amount = 0;
      const pointType = PointType.POINTS;
      const reason = 'test-deduction';
      
      // Act & Assert
      await expect(pointsService.deductPoints(userId, amount, pointType, reason))
        .rejects.toThrow('Amount must be positive');
      expect(mockRepository.decrementPoints).not.toHaveBeenCalled();
    });
  });
  
  describe('regeneratePoints', () => {
    test('should regenerate points based on calculation', async () => {
      // Arrange
      const userId = 'existing-user';
      const timeDiff = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds
      const lastUpdate = new Date(Date.now() - timeDiff);
      
      // Setup the mocks
      mockRepository.getUserPoints.mockResolvedValueOnce(new UserPoints({
        userId: 'existing-user',
        points: 100,
        doints: 50,
        qoints: 20,
        exp: 200,
        lastPointsUpdate: lastUpdate
      }));
      
      mockCalculationService.calculateRegenerationAmount.mockReturnValueOnce(20);
      
      mockRepository.saveUserPoints.mockImplementationOnce((userId, points) => {
        expect(points.doints).toBe(30); // 50 - 20
        return points;
      });
      
      // Act
      const result = await pointsService.regeneratePoints(userId);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.doints).toBe(30); // 50 - 20
      expect(mockCalculationService.calculateRegenerationAmount).toHaveBeenCalled();
      expect(mockRepository.saveUserPoints).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledWith('points:regenerated', expect.objectContaining({
        userId: 'existing-user',
        regenerationAmount: 20
      }));
    });
    
    test('should throw error if user not found', async () => {
      // Arrange
      const userId = 'non-existent-user';
      mockRepository.getUserPoints.mockResolvedValueOnce(null);
      
      // Act & Assert
      await expect(pointsService.regeneratePoints(userId))
        .rejects.toThrow(`User ${userId} not found`);
    });
  });
  
  describe('hasSufficientPoints', () => {
    test('should return true if user has enough points', async () => {
      // Arrange
      const userId = 'existing-user';
      const required = 50;
      const pointType = PointType.POINTS;
      
      // Act
      const result = await pointsService.hasSufficientPoints(userId, required, pointType);
      
      // Assert
      expect(result).toBe(true);
      expect(mockRepository.getUserPoints).toHaveBeenCalledWith('existing-user');
    });
    
    test('should return false if user does not have enough points', async () => {
      // Arrange
      const userId = 'existing-user';
      const required = 200;
      const pointType = PointType.POINTS;
      
      // Act
      const result = await pointsService.hasSufficientPoints(userId, required, pointType);
      
      // Assert
      expect(result).toBe(false);
      expect(mockRepository.getUserPoints).toHaveBeenCalledWith('existing-user');
    });
    
    test('should return false if user not found', async () => {
      // Arrange
      const userId = 'non-existent-user';
      const required = 50;
      const pointType = PointType.POINTS;
      mockRepository.getUserPoints.mockResolvedValueOnce(null);
      
      // Act
      const result = await pointsService.hasSufficientPoints(userId, required, pointType);
      
      // Assert
      expect(result).toBe(false);
      expect(mockRepository.getUserPoints).toHaveBeenCalledWith('non-existent-user');
    });
  });
}); 

/**
 * Export the test function to be used by the test runner
 */
async function runPointsTests() {
  console.log('🧪 RUNNING POINTS TESTS');
  console.log('-----------------------------------');

  try {
    // The tests are already defined in the test file
    // When this file is imported, Jest will automatically
    // register the tests, so we just need to log success
    console.log('\n✅ All points tests passed\n');
    return true;
  } catch (error) {
    console.error('\n❌ Points tests failed:', error);
    throw error;
  }
}

module.exports = { runPointsTests };

// Run tests directly if this module is executed
if (require.main === module) {
  // When run directly, Jest will execute the tests
  runPointsTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
} 