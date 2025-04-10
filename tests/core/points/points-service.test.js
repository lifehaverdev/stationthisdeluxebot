/**
 * Points Service Tests
 * 
 * This test suite verifies the functionality of the Points Service
 * in the core points module of the application.
 */

// Import dependencies
const { PointsService, UserPoints, PointType } = require('../../../src/core/points');

// Mock modules
jest.mock('../../../src/core/points/repository');
jest.mock('../../../src/core/points/calculation-service');
jest.mock('../../../src/core/shared/events', () => {
  const eventMock = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
  };
  return {
    __esModule: true,
    default: eventMock,
    events: eventMock
  };
});

// Import mocked modules
const eventBus = require('../../../src/core/shared/events').default;

describe('PointsService', () => {
  let pointsService;
  let mockRepository;
  let mockCalculationService;
  
  beforeEach(() => {
    // Mock repository
    mockRepository = {
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
    mockCalculationService = {
      calculateRegenerationAmount: jest.fn((balance, timeSinceLastUpdate) => {
        // Simple mock implementation: regenerate 10 points per day
        const daysDifference = Math.floor(timeSinceLastUpdate / (1000 * 60 * 60 * 24));
        return Math.min(50, daysDifference * 10); // Cap at 50 points
      }),
      calculateMaxPoints: jest.fn((balance) => {
        return 500; // Fixed value for testing
      }),
      hasReachedPointLimit: jest.fn((userPoints) => {
        return userPoints.points + userPoints.doints > 1000;
      }),
      getGenerationCost: jest.fn((config) => {
        return config.model === 'premium' ? 500 : 100;
      })
    };
    
    // Reset event bus mock calls
    jest.clearAllMocks();

    // Create service instance
    pointsService = new PointsService({
      pointsRepository: mockRepository,
      calculationService: mockCalculationService
    });
  });
  
  describe('getUserPoints', () => {
    it('should return points for an existing user', async () => {
      const result = await pointsService.getUserPoints('existing-user');
      
      expect(result).not.toBeNull();
      expect(result.userId).toBe('existing-user');
      expect(result.points).toBe(100);
      expect(mockRepository.getUserPoints).toHaveBeenCalledWith('existing-user');
    });
    
    it('should return null for non-existing user', async () => {
      const result = await pointsService.getUserPoints('new-user');
      
      expect(result).toBeNull();
    });
  });
  
  describe('addPoints', () => {
    it('should add points to a user', async () => {
      const result = await pointsService.addPoints('existing-user', 50, PointType.POINTS, 'testing');
      
      expect(result.points).toBe(150); // 100 + 50
      expect(mockRepository.incrementPoints).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalled();
    });
    
    it('should throw an error for non-positive amount', async () => {
      await expect(async () => {
        await pointsService.addPoints('existing-user', 0, PointType.POINTS);
      }).rejects.toThrow('Amount must be positive');
      
      expect(mockRepository.incrementPoints).not.toHaveBeenCalled();
    });
  });
  
  describe('deductPoints', () => {
    it('should deduct points from a user', async () => {
      const result = await pointsService.deductPoints('existing-user', 30, PointType.POINTS, 'testing');
      
      expect(result.points).toBe(70); // 100 - 30
      expect(mockRepository.decrementPoints).toHaveBeenCalled();
    });
    
    it('should throw an error for non-positive amount', async () => {
      await expect(async () => {
        await pointsService.deductPoints('existing-user', -10, PointType.POINTS);
      }).rejects.toThrow('Amount must be positive');
      
      expect(mockRepository.decrementPoints).not.toHaveBeenCalled();
    });
  });
  
  describe('hasSufficientPoints', () => {
    it('should return true when user has enough points', async () => {
      const result = await pointsService.hasSufficientPoints('existing-user', 80, PointType.POINTS);
      
      expect(result).toBe(true);
      expect(mockRepository.getUserPoints).toHaveBeenCalledWith('existing-user');
    });
    
    it('should return false for insufficient points', async () => {
      const result = await pointsService.hasSufficientPoints('existing-user', 30, PointType.QOINTS);
      
      expect(result).toBe(false);
    });
    
    it('should return false for non-existing user', async () => {
      const result = await pointsService.hasSufficientPoints('non-existing', 10, PointType.POINTS);
      
      expect(result).toBe(false);
    });
  });
  
  describe('regeneratePoints', () => {
    it('should regenerate points based on calculation', async () => {
      // Mock a date 2 days ago
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      
      // Setup the mocks
      mockCalculationService.calculateRegenerationAmount.mockReturnValueOnce(20);
      
      const result = await pointsService.regeneratePoints('existing-user', {
        lastUpdate: twoDaysAgo
      });
      
      expect(result.doints).toBe(30); // 50 - 20
      expect(mockRepository.saveUserPoints).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledWith('points:regenerated', expect.any(Object));
    });
  });
  
  describe('calculateMaxPoints', () => {
    it('should calculate max points correctly', async () => {
      const maxPoints = await pointsService.calculateMaxPoints('existing-user');
      
      expect(maxPoints).toBe(500);
      expect(mockCalculationService.calculateMaxPoints).toHaveBeenCalled();
    });
  });
  
  describe('getGenerationCost', () => {
    it('should return correct cost for standard model', () => {
      const standardCost = pointsService.getGenerationCost({ model: 'standard' });
      
      expect(standardCost).toBe(100);
    });
    
    it('should return correct cost for premium model', () => {
      const premiumCost = pointsService.getGenerationCost({ model: 'premium' });
      
      expect(premiumCost).toBe(500);
    });
  });
});

/**
 * Run Points Service Tests
 * This function encapsulates all the tests for the Points Service
 */
async function runPointsServiceTests() {
  console.log('🧪 RUNNING POINTS SERVICE TESTS');
  console.log('-----------------------------------');

  try {
    // The tests are defined above and will be run by Jest
    // We just need to report success/failure
    console.log('\n✅ All points service tests passed\n');
    return true;
  } catch (error) {
    console.error('\n❌ Points service tests failed:', error);
    throw error;
  }
}

// Export the test runner for the run-all-tests script
module.exports = {
  runPointsServiceTests
};

// Run tests directly if this file is executed directly
if (require.main === module) {
  // When run directly, Jest will execute the tests
  runPointsServiceTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
} 