/**
 * Command Adapter Tests
 * 
 * Tests for the platform-specific command adapters.
 */

const { CommandRouter, AbstractCommandAdapter, TelegramCommandAdapter } = require('../index');
const { CommandRegistry } = require('../registry');
const { AppError } = require('../../shared/errors');

describe('AbstractCommandAdapter', () => {
  let router;
  
  beforeEach(() => {
    // Create a new router with a new registry instance for each test
    const registry = new CommandRegistry();
    router = new CommandRouter({ registry });
  });
  
  test('should require a router', () => {
    expect(() => new AbstractCommandAdapter()).toThrow('Command router is required');
  });
  
  test('should store the router reference', () => {
    const adapter = new AbstractCommandAdapter({ router });
    expect(adapter.router).toBe(router);
  });
  
  test('should throw on abstract methods', () => {
    const adapter = new AbstractCommandAdapter({ router });
    
    expect(() => adapter.convertRequest({})).toThrow('convertRequest method must be implemented');
    expect(() => adapter.convertResponse({}, {})).toThrow('convertResponse method must be implemented');
    expect(() => adapter.convertError(new Error(), {})).toThrow('convertError method must be implemented');
  });
});

describe('TelegramCommandAdapter', () => {
  let router;
  let adapter;
  
  beforeEach(() => {
    // Create a new router with a new registry instance for each test
    const registry = new CommandRegistry();
    router = new CommandRouter({ registry });
    
    // Register the test command
    router.registry.register({
      name: 'test',
      description: 'Test command',
      execute: () => ({ result: 'Success' })
    });
    
    adapter = new TelegramCommandAdapter({ router });
  });
  
  test('should convert text message to command request', () => {
    const message = {
      text: '/test param1 param2',
      from: { id: 123, username: 'testuser', first_name: 'Test', last_name: 'User' },
      chat: { id: 456 },
      message_id: 789
    };
    
    const request = adapter.convertRequest(message);
    
    expect(request.command).toBe('test');
    expect(request.context.userId).toBe('123');
    expect(request.context.chatId).toBe(456);
    expect(request.context.parameters.text).toBe('param1 param2');
  });
  
  test('should convert JSON parameters in text message', () => {
    const message = {
      text: '/test {"key":"value","nested":{"prop":true}}',
      from: { id: 123, username: 'testuser', first_name: 'Test', last_name: 'User' },
      chat: { id: 456 },
      message_id: 789
    };
    
    const request = adapter.convertRequest(message);
    
    expect(request.command).toBe('test');
    expect(request.context.parameters).toEqual({ key: 'value', nested: { prop: true } });
  });
  
  test('should convert media message with caption', () => {
    const message = {
      caption: '/test with caption',
      from: { id: 123, username: 'testuser', first_name: 'Test', last_name: 'User' },
      chat: { id: 456 },
      message_id: 789,
      photo: [{ file_id: 'photo123', width: 100, height: 100 }]
    };
    
    const request = adapter.convertRequest(message);
    
    expect(request.command).toBe('test');
    expect(request.context.parameters.text).toBe('with caption');
    expect(request.context.parameters.media.type).toBe('photo');
    expect(request.context.parameters.media.items).toEqual([{ file_id: 'photo123', width: 100, height: 100 }]);
  });
  
  test('should convert callback query', () => {
    const message = {
      from: { id: 123, username: 'testuser', first_name: 'Test', last_name: 'User' },
      callback_query: {
        data: JSON.stringify({ command: 'test', params: { option: 'yes' } })
      }
    };
    
    const request = adapter.convertRequest(message);
    
    expect(request.command).toBe('test');
    expect(request.context.parameters).toEqual({ option: 'yes' });
    expect(request.context.telegram.isCallback).toBe(true);
  });
  
  test('should handle invalid message object', () => {
    expect(() => adapter.convertRequest(null)).toThrow('Invalid Telegram message');
    expect(() => adapter.convertRequest('string')).toThrow('Invalid Telegram message');
  });
  
  test('should convert command response to Telegram format', () => {
    const message = {
      from: { id: 123 },
      chat: { id: 456 }
    };
    
    const response = adapter.convertResponse({ text: 'Command result', format: 'markdown' }, message);
    
    expect(response.chatId).toBe(456);
    expect(response.text).toBe('Command result');
    expect(response.options.parse_mode).toBe('Markdown');
  });
  
  test('should handle string response', () => {
    const message = {
      from: { id: 123 },
      chat: { id: 456 }
    };
    
    const response = adapter.convertResponse('Simple result', message);
    
    expect(response.chatId).toBe(456);
    expect(response.text).toBe('Simple result');
  });
  
  test('should handle keyboard in response', () => {
    const message = {
      from: { id: 123 },
      chat: { id: 456 }
    };
    
    const commandResponse = {
      text: 'Select an option',
      keyboard: [[{ text: 'Option 1', callback_data: 'opt1' }]]
    };
    
    const response = adapter.convertResponse(commandResponse, message);
    
    expect(response.text).toBe('Select an option');
    expect(response.options.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Option 1', callback_data: 'opt1' }]]
    });
  });
  
  test('should convert error to Telegram format', () => {
    const message = {
      from: { id: 123 },
      chat: { id: 456 }
    };
    
    const error = new Error('Something went wrong');
    const response = adapter.convertError(error, message);
    
    expect(response.chatId).toBe(456);
    expect(response.text).toBe('❌ Error: Something went wrong');
    expect(response.options.parse_mode).toBe('Markdown');
  });
  
  test('should handle AppError with user message', () => {
    const message = {
      from: { id: 123 },
      chat: { id: 456 }
    };
    
    const error = new AppError('Internal error', {
      userMessage: 'User-friendly error message'
    });
    
    const response = adapter.convertError(error, message);
    
    expect(response.text).toBe('❌ Error: User-friendly error message');
  });
  
  test('should handle request through the adapter', async () => {
    // Mock router.execute
    router.execute = jest.fn().mockResolvedValue({ result: 'Success' });
    
    const message = {
      text: '/test param',
      from: { id: 123, username: 'testuser' },
      chat: { id: 456 },
      message_id: 789
    };
    
    const response = await adapter.handleRequest(message);
    
    expect(router.execute).toHaveBeenCalledWith('test', expect.any(Object));
    expect(response.chatId).toBe(456);
    expect(response.text).toContain('Success');
  });
  
  test('should handle errors during request processing', async () => {
    // Mock router.execute to throw an error
    router.execute = jest.fn().mockRejectedValue(new Error('Command failed'));
    
    const message = {
      text: '/test param',
      from: { id: 123, username: 'testuser' },
      chat: { id: 456 },
      message_id: 789
    };
    
    const response = await adapter.handleRequest(message);
    
    expect(router.execute).toHaveBeenCalled();
    expect(response.chatId).toBe(456);
    expect(response.text).toBe('❌ Error: Command failed');
  });
}); 