/**
 * AnalyticsEventsAdapter Tests
 */

const { AnalyticsEventsAdapter, createAnalyticsEventsAdapter } = require('../../../src/core/analytics/analyticsEventsAdapter');
const { EVENT_TYPES } = require('../../../db/models/analyticsEvents');

// Mock SessionAdapter
const mockSessionAdapter = {
  getUserSessionData: jest.fn(async (userId) => {
    if (userId === 'user_with_data') {
      return {
        userId: 'user_with_data',
        verified: true,
        kickedAt: new Date(2023, 1, 1),
        lastTouch: Date.now() - 60000,
        wallet: 'mock-wallet-address'
      };
    }
    return null;
  }),
  updateUserSession: jest.fn(async () => true),
  updateUserActivity: jest.fn(async () => true)
};

// Mock logging function
const mockLogFunction = jest.fn();

describe('AnalyticsEventsAdapter', () => {
  let adapter;
  
  beforeEach(() => {
    // Reset mocks
    mockSessionAdapter.getUserSessionData.mockClear();
    mockLogFunction.mockClear();
    
    // Create adapter with mocks
    adapter = new AnalyticsEventsAdapter({
      sessionAdapter: mockSessionAdapter,
      logToConsole: true,
      logFunction: mockLogFunction
    });
  });
  
  describe('Basic functionality', () => {
    test('should be instantiated with the correct properties', () => {
      expect(adapter.sessionAdapter).toBe(mockSessionAdapter);
      expect(adapter.logToConsole).toBe(true);
      expect(adapter.logFunction).toBe(mockLogFunction);
      expect(adapter.collectionsName).toBe('history');
    });
    
    test('should log events when logging is enabled', async () => {
      const query = { userId: '123', type: 'test' };
      const event = { userId: '123', data: { test: true } };
      const options = { upsert: true };
      
      await adapter._logEvent(query, event, options);
      
      expect(mockLogFunction).toHaveBeenCalledWith(
        '[AnalyticsEventsAdapter] Would save event:',
        expect.objectContaining({
          collection: 'history',
          query,
          event,
          options
        })
      );
    });
    
    test('should not log events when logging is disabled', async () => {
      adapter.logToConsole = false;
      
      await adapter._logEvent({ test: true }, { data: {} });
      
      expect(mockLogFunction).not.toHaveBeenCalled();
    });
    
    test('updateOne should call _logEvent', async () => {
      const spy = jest.spyOn(adapter, '_logEvent');
      const query = { userId: '123' };
      const event = { data: { test: true } };
      const options = { upsert: true };
      
      await adapter.updateOne(query, event, options);
      
      expect(spy).toHaveBeenCalledWith(query, event, options);
    });
  });
  
  describe('Tracking methods', () => {
    test('trackUserJoin should get user data from SessionAdapter', async () => {
      const userId = 'user_with_data';
      const username = 'testuser';
      
      await adapter.trackUserJoin(userId, username, false);
      
      expect(mockSessionAdapter.getUserSessionData).toHaveBeenCalledWith(userId);
      expect(mockLogFunction).toHaveBeenCalled();
      
      // Extract the event data from the mock call
      const callArg = mockLogFunction.mock.calls[0][1];
      expect(callArg.event.userId).toBe(userId);
      expect(callArg.event.username).toBe(username);
      expect(callArg.event.data.verified).toBe(true);
      expect(callArg.event.data.eventType).toBe('check_in');
    });
    
    test('trackUserKick should get user data from SessionAdapter', async () => {
      const userId = 'user_with_data';
      const username = 'testuser';
      const reason = 'test_reason';
      
      await adapter.trackUserKick(userId, username, reason);
      
      expect(mockSessionAdapter.getUserSessionData).toHaveBeenCalledWith(userId);
      expect(mockLogFunction).toHaveBeenCalled();
      
      // Extract the event data from the mock call
      const callArg = mockLogFunction.mock.calls[0][1];
      expect(callArg.event.userId).toBe(userId);
      expect(callArg.event.username).toBe(username);
      expect(callArg.event.data.reason).toBe(reason);
      expect(callArg.event.data.eventType).toBe('kicked');
    });
    
    test('trackVerification should get wallet from SessionAdapter', async () => {
      const userId = 'user_with_data';
      const message = { from: { id: userId, username: 'testuser' } };
      
      await adapter.trackVerification(message, true);
      
      expect(mockSessionAdapter.getUserSessionData).toHaveBeenCalledWith(userId);
      expect(mockLogFunction).toHaveBeenCalled();
      
      // Extract the event data from the mock call
      const callArg = mockLogFunction.mock.calls[0][1];
      expect(callArg.event.userId).toBe(userId);
      expect(callArg.event.data.success).toBe(true);
      expect(callArg.event.data.wallet).toBe('mock-wallet-address');
    });
    
    test('trackCommand should correctly process command data', async () => {
      const message = { 
        from: { id: '123', username: 'testuser' },
        chat: { id: '456', type: 'private' },
        text: '/test arg1 arg2',
        message_id: 789
      };
      
      await adapter.trackCommand(message, '/test', false);
      
      expect(mockLogFunction).toHaveBeenCalled();
      
      // Extract the event data from the mock call
      const callArg = mockLogFunction.mock.calls[0][1];
      expect(callArg.event.userId).toBe('123');
      expect(callArg.event.data.command).toBe('/test');
      expect(callArg.event.data.hasArgs).toBe(true);
      expect(callArg.event.data.isCustomCommand).toBe(false);
    });
  });
  
  describe('Factory function', () => {
    test('createAnalyticsEventsAdapter should create an instance', () => {
      const adapter = createAnalyticsEventsAdapter({ sessionAdapter: mockSessionAdapter });
      
      expect(adapter).toBeInstanceOf(AnalyticsEventsAdapter);
      expect(adapter.sessionAdapter).toBe(mockSessionAdapter);
    });
  });
}); 