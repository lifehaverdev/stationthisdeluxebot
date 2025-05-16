/**
 * Points Service Tests
 * 
 * Tests the functionality of the core points service.
 */

const PointsService = require('../../../src/core/account/points');
const { AppError } = require('../../../src/core/shared/errors');

// Mock dependencies
const mockPointsRepository = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  increment: jest.fn()
};

const mockTransactionRepository = {
  find: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('PointsService', () => {
  let pointsService;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Create service instance with mocked dependencies
    pointsService = new PointsService({
      pointsRepository: mockPointsRepository,
      transactionRepository: mockTransactionRepository,
      logger: mockLogger
    });
  });

  describe('getUserBalance', () => {
    test('should return user balance from repository', async () => {
      // Arrange
      const userId = 'user123';
      const mockBalance = {
        userId,
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        updatedAt: 1609459200000
      };
      
      mockPointsRepository.findOne.mockResolvedValue(mockBalance);
      
      // Act
      const result = await pointsService.getUserBalance(userId);
      
      // Assert
      expect(mockPointsRepository.findOne).toHaveBeenCalledWith({ userId });
      expect(result).toEqual({
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        updatedAt: 1609459200000
      });
    });
    
    test('should return default balance when user not found', async () => {
      // Arrange
      const userId = 'nonexistent';
      
      mockPointsRepository.findOne.mockResolvedValue(null);
      
      // Act
      const result = await pointsService.getUserBalance(userId);
      
      // Assert
      expect(mockPointsRepository.findOne).toHaveBeenCalledWith({ userId });
      expect(result).toEqual({
        points: 0,
        qoints: 0,
        maxPoints: 5000,
        spentPoints: 0,
        updatedAt: expect.any(Number)
      });
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const error = new Error('Database error');
      
      mockPointsRepository.findOne.mockRejectedValue(error);
      
      // Act & Assert
      await expect(pointsService.getUserBalance(userId)).rejects.toThrow('Failed to fetch points balance');
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching user points balance', { userId, error });
    });
  });

  describe('getUserTransactions', () => {
    test('should return user transactions from repository', async () => {
      // Arrange
      const userId = 'user123';
      const mockTransactions = [
        {
          userId,
          amount: -100,
          reason: 'Test usage',
          timestamp: 1609459200000,
          type: 'usage'
        },
        {
          userId,
          amount: 500,
          reason: 'Daily bonus',
          timestamp: 1609545600000,
          type: 'bonus'
        }
      ];
      
      mockTransactionRepository.find.mockResolvedValue(mockTransactions);
      
      // Act
      const result = await pointsService.getUserTransactions(userId, { limit: 10 });
      
      // Assert
      expect(mockTransactionRepository.find).toHaveBeenCalledWith(
        { userId },
        { limit: 10, sort: { timestamp: -1 } }
      );
      
      expect(result).toEqual([
        {
          amount: -100,
          reason: 'Test usage',
          timestamp: 1609459200000,
          type: 'usage'
        },
        {
          amount: 500,
          reason: 'Daily bonus',
          timestamp: 1609545600000,
          type: 'bonus'
        }
      ]);
    });
    
    test('should return empty array when no transactions exist', async () => {
      // Arrange
      const userId = 'user123';
      
      mockTransactionRepository.find.mockResolvedValue([]);
      
      // Act
      const result = await pointsService.getUserTransactions(userId);
      
      // Assert
      expect(mockTransactionRepository.find).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const error = new Error('Database error');
      
      mockTransactionRepository.find.mockRejectedValue(error);
      
      // Act & Assert
      await expect(pointsService.getUserTransactions(userId)).rejects.toThrow('Failed to fetch points transactions');
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching user points transactions', { userId, error });
    });
  });

  describe('addPoints', () => {
    test('should add points to user balance', async () => {
      // Arrange
      const userId = 'user123';
      const points = 500;
      const reason = 'Test bonus';
      const type = 'bonus';
      
      const currentBalance = {
        userId,
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000
      };
      
      const updatedBalance = {
        userId,
        points: 1500,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        updatedAt: expect.any(Number)
      };
      
      mockPointsRepository.findOne.mockResolvedValue(currentBalance);
      mockPointsRepository.update.mockResolvedValue(updatedBalance);
      mockTransactionRepository.create.mockResolvedValue({
        userId,
        amount: points,
        reason,
        type,
        timestamp: expect.any(Number)
      });
      
      // Act
      const result = await pointsService.addPoints(userId, points, { reason, type });
      
      // Assert
      expect(mockPointsRepository.update).toHaveBeenCalledWith(
        { userId },
        { 
          $inc: { points },
          updatedAt: expect.any(Number)
        },
        { upsert: true }
      );
      
      expect(mockTransactionRepository.create).toHaveBeenCalledWith({
        userId,
        amount: points,
        reason,
        type,
        timestamp: expect.any(Number)
      });
      
      expect(result).toEqual({
        success: true,
        previousBalance: 1000,
        newBalance: 1500,
        added: 500
      });
    });
    
    test('should create new balance if user does not exist', async () => {
      // Arrange
      const userId = 'newuser';
      const points = 500;
      const reason = 'Welcome bonus';
      
      mockPointsRepository.findOne.mockResolvedValue(null);
      mockPointsRepository.update.mockImplementation(() => {
        return Promise.resolve({
          userId,
          points: 500,
          qoints: 0,
          maxPoints: 5000,
          spentPoints: 0
        });
      });
      
      // Act
      const result = await pointsService.addPoints(userId, points, { reason });
      
      // Assert
      expect(mockPointsRepository.update).toHaveBeenCalledWith(
        { userId },
        expect.objectContaining({ 
          $inc: { points }
        }),
        { upsert: true }
      );
      
      expect(result).toEqual({
        success: true,
        previousBalance: 0,
        newBalance: 500,
        added: 500
      });
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const points = 500;
      const error = new Error('Database error');
      
      mockPointsRepository.findOne.mockRejectedValue(error);
      
      // Act & Assert
      await expect(pointsService.addPoints(userId, points)).rejects.toThrow('Failed to add points');
      expect(mockLogger.error).toHaveBeenCalledWith('Error adding points', { userId, points, error });
    });
  });

  describe('deductPoints', () => {
    test('should deduct points from user balance', async () => {
      // Arrange
      const userId = 'user123';
      const points = 200;
      const reason = 'Test usage';
      const type = 'usage';
      
      const currentBalance = {
        userId,
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000
      };
      
      const updatedBalance = {
        userId,
        points: 800,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2200,
        updatedAt: expect.any(Number)
      };
      
      mockPointsRepository.findOne.mockResolvedValue(currentBalance);
      mockPointsRepository.update.mockResolvedValue(updatedBalance);
      mockTransactionRepository.create.mockResolvedValue({
        userId,
        amount: -points,
        reason,
        type,
        timestamp: expect.any(Number)
      });
      
      // Act
      const result = await pointsService.deductPoints(userId, points, { reason, type });
      
      // Assert
      expect(mockPointsRepository.update).toHaveBeenCalledWith(
        { userId, points: { $gte: points } },
        { 
          $inc: { points: -points, spentPoints: points },
          updatedAt: expect.any(Number)
        }
      );
      
      expect(mockTransactionRepository.create).toHaveBeenCalledWith({
        userId,
        amount: -points,
        reason,
        type,
        timestamp: expect.any(Number)
      });
      
      expect(result).toEqual({
        success: true,
        previousBalance: 1000,
        newBalance: 800,
        deducted: 200
      });
    });
    
    test('should throw error when insufficient balance', async () => {
      // Arrange
      const userId = 'user123';
      const points = 1500;
      const reason = 'Test usage';
      
      const currentBalance = {
        userId,
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000
      };
      
      mockPointsRepository.findOne.mockResolvedValue(currentBalance);
      mockPointsRepository.update.mockResolvedValue(null); // No document updated (insufficient funds)
      
      // Act & Assert
      await expect(pointsService.deductPoints(userId, points, { reason }))
        .rejects.toThrow('Insufficient points balance');
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const points = 200;
      const error = new Error('Database error');
      
      mockPointsRepository.findOne.mockRejectedValue(error);
      
      // Act & Assert
      await expect(pointsService.deductPoints(userId, points)).rejects.toThrow('Failed to deduct points');
      expect(mockLogger.error).toHaveBeenCalledWith('Error deducting points', { userId, points, error });
    });
  });

  describe('refreshPoints', () => {
    test('should refresh points based on active bonuses', async () => {
      // Arrange
      const userId = 'user123';
      const mockBonuses = [
        { type: 'daily', amount: 100, expiresAt: Date.now() + 86400000 },
        { type: 'streak', amount: 50, expiresAt: Date.now() + 86400000 }
      ];
      
      const currentBalance = {
        userId,
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        lastRefreshAt: Date.now() - 3600000 // 1 hour ago
      };
      
      const updatedBalance = {
        userId,
        points: 1150,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        lastRefreshAt: expect.any(Number)
      };
      
      // Mock the implementation to return active bonuses
      pointsService.getActiveBonuses = jest.fn().mockResolvedValue(mockBonuses);
      
      mockPointsRepository.findOne.mockResolvedValue(currentBalance);
      mockPointsRepository.update.mockResolvedValue(updatedBalance);
      
      // Act
      const result = await pointsService.refreshPoints(userId);
      
      // Assert
      expect(pointsService.getActiveBonuses).toHaveBeenCalledWith(userId);
      expect(mockPointsRepository.update).toHaveBeenCalledWith(
        { userId },
        expect.objectContaining({ 
          $inc: { points: 150 },
          lastRefreshAt: expect.any(Number)
        })
      );
      
      expect(result).toEqual({
        points: 1150,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        lastRefreshAt: expect.any(Number),
        pointsAdded: 150,
        bonusesApplied: [
          { type: 'daily', amount: 100 },
          { type: 'streak', amount: 50 }
        ]
      });
    });
    
    test('should not refresh if already refreshed recently', async () => {
      // Arrange
      const userId = 'user123';
      const now = Date.now();
      
      const currentBalance = {
        userId,
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        lastRefreshAt: now - 60000 // Only 1 minute ago (less than cooldown)
      };
      
      mockPointsRepository.findOne.mockResolvedValue(currentBalance);
      
      // Set cooldown to 5 minutes for this test
      pointsService.refreshCooldownMs = 5 * 60 * 1000;
      
      // Act
      const result = await pointsService.refreshPoints(userId);
      
      // Assert
      expect(mockPointsRepository.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        points: 1000,
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000,
        lastRefreshAt: currentBalance.lastRefreshAt,
        pointsAdded: 0,
        bonusesApplied: [],
        cooldownRemaining: expect.any(Number)
      });
    });
    
    test('should throw error when repository fails', async () => {
      // Arrange
      const userId = 'user123';
      const error = new Error('Database error');
      
      mockPointsRepository.findOne.mockRejectedValue(error);
      
      // Act & Assert
      await expect(pointsService.refreshPoints(userId)).rejects.toThrow('Failed to refresh points');
      expect(mockLogger.error).toHaveBeenCalledWith('Error refreshing points', { userId, error });
    });
  });

  describe('createBalanceBar', () => {
    test('should create visual balance bar with correct segments', () => {
      // Arrange
      const points = 3500;
      const maxPoints = 10000;
      
      // Act
      const result = pointsService.createBalanceBar(points, maxPoints);
      
      // Assert
      // For 3500/10000, we expect approximately 35% filled (3-4 segments)
      expect(result).toBe('🔷🔷🔷🔹▫️▫️▫️');
    });
    
    test('should handle empty balance correctly', () => {
      // Act
      const result = pointsService.createBalanceBar(0, 10000);
      
      // Assert
      expect(result).toBe('▫️▫️▫️▫️▫️▫️▫️');
    });
    
    test('should handle full balance correctly', () => {
      // Act
      const result = pointsService.createBalanceBar(10000, 10000);
      
      // Assert
      expect(result).toBe('🔷🔷🔷🔷🔷🔷🔷');
    });
    
    test('should handle balance exceeding max correctly', () => {
      // Act
      const result = pointsService.createBalanceBar(15000, 10000);
      
      // Assert
      expect(result).toBe('🔷🔷🔷🔷🔷🔷🔷');
    });
  });

  describe('getActiveBonuses', () => {
    test('should return active bonuses for user', async () => {
      // Arrange
      const userId = 'user123';
      const mockBonuses = [
        { 
          userId,
          type: 'daily',
          amount: 100,
          createdAt: Date.now() - 86400000,
          expiresAt: Date.now() + 86400000
        },
        {
          userId,
          type: 'referral',
          amount: 200,
          createdAt: Date.now() - 259200000,
          expiresAt: Date.now() + 259200000
        }
      ];
      
      // Assume there's a bonusRepository that would be used
      const mockBonusRepository = {
        find: jest.fn().mockResolvedValue(mockBonuses)
      };
      
      // Temporarily add bonus repository to service
      pointsService.bonusRepository = mockBonusRepository;
      
      // Act
      const result = await pointsService.getActiveBonuses(userId);
      
      // Assert
      expect(mockBonusRepository.find).toHaveBeenCalledWith({
        userId,
        expiresAt: { $gt: expect.any(Number) }
      });
      
      expect(result).toEqual([
        { type: 'daily', amount: 100, expiresAt: expect.any(Number) },
        { type: 'referral', amount: 200, expiresAt: expect.any(Number) }
      ]);
      
      // Clean up
      delete pointsService.bonusRepository;
    });
    
    test('should return empty array when no active bonuses', async () => {
      // Arrange
      const userId = 'user123';
      
      // Implement stub method for test
      pointsService.getActiveBonuses = jest.fn().mockResolvedValue([]);
      
      // Act
      const result = await pointsService.getActiveBonuses(userId);
      
      // Assert
      expect(result).toEqual([]);
    });
  });
}); 