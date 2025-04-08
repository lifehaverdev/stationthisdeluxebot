/**
 * Command Router Tests
 * 
 * Tests for the command router and registry system.
 */

const { CommandRegistry, CommandRouter, middleware } = require('../index');

describe('CommandRegistry', () => {
  let registry;
  
  beforeEach(() => {
    registry = new CommandRegistry();
  });
  
  test('should register a command', () => {
    const command = {
      name: 'test',
      description: 'Test command',
      execute: () => {}
    };
    
    expect(registry.register(command)).toBe(true);
    expect(registry.has('test')).toBe(true);
    expect(registry.size).toBe(1);
  });
  
  test('should retrieve a registered command', () => {
    const command = {
      name: 'test',
      description: 'Test command',
      execute: () => {}
    };
    
    registry.register(command);
    const retrieved = registry.get('test');
    
    expect(retrieved).toEqual(command);
  });
  
  test('should register command aliases', () => {
    const command = {
      name: 'test',
      description: 'Test command',
      aliases: ['t', 'testing'],
      execute: () => {}
    };
    
    registry.register(command);
    expect(registry.has('t')).toBe(true);
    expect(registry.has('testing')).toBe(true);
    expect(registry.get('t')).toEqual(command);
    expect(registry.get('testing')).toEqual(command);
  });
  
  test('should categorize commands', () => {
    const command1 = {
      name: 'test1',
      description: 'Test command 1',
      metadata: { category: 'utils' },
      execute: () => {}
    };
    
    const command2 = {
      name: 'test2',
      description: 'Test command 2',
      metadata: { category: 'utils' },
      execute: () => {}
    };
    
    const command3 = {
      name: 'test3',
      description: 'Test command 3',
      metadata: { category: 'admin' },
      execute: () => {}
    };
    
    registry.register(command1);
    registry.register(command2);
    registry.register(command3);
    
    const utilsCommands = registry.getByCategory('utils');
    const adminCommands = registry.getByCategory('admin');
    
    expect(utilsCommands.length).toBe(2);
    expect(adminCommands.length).toBe(1);
    expect(utilsCommands).toContainEqual(command1);
    expect(utilsCommands).toContainEqual(command2);
    expect(adminCommands).toContainEqual(command3);
  });
  
  test('should unregister a command', () => {
    const command = {
      name: 'test',
      description: 'Test command',
      aliases: ['t', 'testing'],
      metadata: { category: 'utils' },
      execute: () => {}
    };
    
    registry.register(command);
    expect(registry.has('test')).toBe(true);
    
    registry.unregister('test');
    expect(registry.has('test')).toBe(false);
    expect(registry.has('t')).toBe(false);
    expect(registry.has('testing')).toBe(false);
    expect(registry.getByCategory('utils')).toEqual([]);
  });
});

describe('CommandRouter', () => {
  let router;
  let registry;
  
  beforeEach(() => {
    registry = new CommandRegistry();
    router = new CommandRouter({ registry });
  });
  
  test('should execute a command', async () => {
    const execute = jest.fn().mockResolvedValue({ result: 'success' });
    const command = {
      name: 'test',
      description: 'Test command',
      execute
    };
    
    registry.register(command);
    
    const context = { userId: '123', parameters: { value: 'test' } };
    const result = await router.execute('test', context);
    
    expect(execute).toHaveBeenCalled();
    expect(result).toEqual({ result: 'success' });
  });
  
  test('should apply middleware', async () => {
    const execute = jest.fn().mockResolvedValue({ result: 'success' });
    const command = {
      name: 'test',
      description: 'Test command',
      execute
    };
    
    registry.register(command);
    
    const middlewareFn = jest.fn((context, next) => {
      context.middlewareApplied = true;
      return next();
    });
    
    router.use(middlewareFn);
    
    const context = { userId: '123', parameters: { value: 'test' } };
    await router.execute('test', context);
    
    expect(middlewareFn).toHaveBeenCalled();
    expect(execute.mock.calls[0][0].middlewareApplied).toBe(true);
  });
  
  test('should emit events during execution', async () => {
    const command = {
      name: 'test',
      description: 'Test command',
      execute: () => ({ result: 'success' })
    };
    
    registry.register(command);
    
    const beforeExecute = jest.fn();
    const afterExecute = jest.fn();
    
    router.on('before-execute', beforeExecute);
    router.on('after-execute', afterExecute);
    
    await router.execute('test', { userId: '123' });
    
    expect(beforeExecute).toHaveBeenCalled();
    expect(afterExecute).toHaveBeenCalled();
  });
  
  test('should track metrics', async () => {
    const command = {
      name: 'test',
      description: 'Test command',
      execute: () => ({ result: 'success' })
    };
    
    registry.register(command);
    
    await router.execute('test', { userId: '123' });
    const metrics = router.getCommandMetrics('test');
    
    expect(metrics.totalExecutions).toBe(1);
    expect(metrics.totalErrors).toBe(0);
    expect(metrics.lastExecutionTime).toBeGreaterThanOrEqual(0);
  });
  
  test('should handle command not found', async () => {
    const notFoundHandler = jest.fn();
    router.on('not-found', notFoundHandler);
    
    await expect(router.execute('nonexistent', { userId: '123' }))
      .rejects.toThrow('Command \'nonexistent\' not found');
    
    expect(notFoundHandler).toHaveBeenCalled();
  });
  
  test('should handle errors in commands', async () => {
    const originalConsoleError = console.error;
    console.error = jest.fn();
    
    const errorHandler = jest.fn();
    router.on('error', errorHandler);
    
    const command = {
      name: 'test',
      description: 'Test command',
      execute: () => {
        throw new Error('Command failed');
      }
    };
    
    registry.register(command);
    
    await expect(router.execute('test', { userId: '123' }))
      .rejects.toThrow('Command failed');
    
    expect(errorHandler).toHaveBeenCalled();
    
    const metrics = router.getCommandMetrics('test');
    expect(metrics.totalErrors).toBe(1);
    expect(metrics.lastError).toBeDefined();
    
    console.error = originalConsoleError;
  });
});

describe('Middleware System', () => {
  let router;
  let registry;
  
  beforeEach(() => {
    registry = new CommandRegistry();
    router = new CommandRouter({ registry });
    
    registry.register({
      name: 'test',
      description: 'Test command',
      execute: (context) => ({
        result: 'success',
        context
      })
    });
  });
  
  test('should apply multiple middleware in order', async () => {
    const middleware1 = jest.fn((context, next) => {
      context.middleware1 = true;
      return next();
    });
    
    const middleware2 = jest.fn((context, next) => {
      context.middleware2 = true;
      return next();
    });
    
    router.use(middleware1);
    router.use(middleware2);
    
    const result = await router.execute('test', { userId: '123' });
    
    expect(middleware1).toHaveBeenCalled();
    expect(middleware2).toHaveBeenCalled();
    expect(result.context.middleware1).toBe(true);
    expect(result.context.middleware2).toBe(true);
  });
  
  test('should allow middleware to short-circuit', async () => {
    const shortCircuitMiddleware = jest.fn((context, next) => {
      return { shortCircuited: true };
    });
    
    const nextMiddleware = jest.fn((context, next) => {
      return next();
    });
    
    router.use(shortCircuitMiddleware);
    router.use(nextMiddleware);
    
    const result = await router.execute('test', { userId: '123' });
    
    expect(shortCircuitMiddleware).toHaveBeenCalled();
    expect(nextMiddleware).not.toHaveBeenCalled();
    expect(result).toEqual({ shortCircuited: true });
  });
  
  test('should handle errors in middleware', async () => {
    const originalConsoleError = console.error;
    console.error = jest.fn();
    
    const errorMiddleware = jest.fn((context, next) => {
      throw new Error('Middleware error');
    });
    
    router.use(errorMiddleware);
    
    await expect(router.execute('test', { userId: '123' }))
      .rejects.toThrow('Middleware error');
    
    expect(errorMiddleware).toHaveBeenCalled();
    
    console.error = originalConsoleError;
  });
}); 