/**
 * Discord Status Command Integration Test
 * 
 * Tests the status command implementation for the Discord platform.
 */

const { describe, it, expect, jest: jestImport, beforeEach } = require('@jest/globals');
const createStatusCommandHandler = require('../../../src/platforms/discord/commands/statusCommand');

describe('Discord Status Command', () => {
  // Mock dependencies
  const mockClient = {
    user: {
      tag: 'StationThis#1234'
    }
  };
  
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn()
  };
  
  // Sample app start time for consistent testing
  const mockStartTime = new Date('2023-05-01T12:00:00Z');
  
  // Recreate the handler before each test
  let statusCommandHandler;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create a fresh handler for each test
    statusCommandHandler = createStatusCommandHandler({
      client: mockClient,
      appStartTime: mockStartTime,
      logger: mockLogger
    });
  });
  
  it('should successfully handle status command and return formatted uptime', async () => {
    // Mock Discord interaction
    const mockInteraction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
    
    // Mock current date to return a specific time after start time
    const realDateNow = Date.now;
    Date.now = jest.fn(() => new Date('2023-05-01T13:30:45Z').getTime());
    
    try {
      // Execute the command
      await statusCommandHandler(mockInteraction);
      
      // Verify interaction was acknowledged
      expect(mockInteraction.deferReply).toHaveBeenCalled();
      
      // Verify response was sent
      expect(mockInteraction.editReply).toHaveBeenCalled();
      
      // Get the embed from the reply
      const replyArgs = mockInteraction.editReply.mock.calls[0][0];
      expect(replyArgs).toHaveProperty('embeds');
      expect(replyArgs.embeds).toHaveLength(1);
      
      const embed = replyArgs.embeds[0];
      
      // Check embed properties
      expect(embed.title).toBe('🟢 StationThis Bot Status');
      expect(embed.color).toBe(0x00FF00);
      
      // Find the uptime field
      const uptimeField = embed.fields.find(field => field.name === '🕒 Uptime');
      expect(uptimeField).toBeDefined();
      expect(uptimeField.value).toBe('1 hour, 30 minutes, 45 seconds');
      
      // Check bot user field
      const botUserField = embed.fields.find(field => field.name === '🤖 Bot User');
      expect(botUserField).toBeDefined();
      expect(botUserField.value).toBe('StationThis#1234');
    } finally {
      // Restore the original Date.now
      Date.now = realDateNow;
    }
  });
  
  it('should handle errors gracefully', async () => {
    // Mock interaction that throws an error when editReply is called
    const mockInteraction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockRejectedValue(new Error('Network error')),
      deferred: true
    };
    
    // Execute the command
    await statusCommandHandler(mockInteraction);
    
    // Verify error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error in status command:',
      expect.any(Error)
    );
    
    // Verify fallback response attempt
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      'Sorry, an error occurred while fetching application status.'
    );
  });
  
  it('should use non-deferred reply if interaction is not deferred', async () => {
    // Mock interaction that throws an error before being deferred
    const mockInteraction = {
      deferReply: jest.fn().mockRejectedValue(new Error('Cannot defer')),
      reply: jest.fn().mockResolvedValue(undefined),
      deferred: false
    };
    
    // Execute the command
    await statusCommandHandler(mockInteraction);
    
    // Verify error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error in status command:',
      expect.any(Error)
    );
    
    // Verify fallback response via reply instead of editReply
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: 'Sorry, an error occurred while fetching application status.',
      ephemeral: true
    });
  });
}); 