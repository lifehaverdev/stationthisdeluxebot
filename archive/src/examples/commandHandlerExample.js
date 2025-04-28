/**
 * Command Handler Example
 * 
 * Demonstrates how to implement a command handler system that uses
 * the SessionManager to access and update user session data.
 */

const { createSessionManager } = require('../services/sessionManager');
const { ErrorHandler } = require('../core/shared/errors');
const EventEmitter = require('events');

/**
 * Command Handler class that uses SessionManager to store command usage statistics
 * and provide user-specific contextual data
 */
class CommandHandler extends EventEmitter {
  /**
   * Creates a new CommandHandler instance
   * @param {Object} options Configuration options
   * @param {Object} options.sessionManager SessionManager instance
   * @param {Function} [options.logger] Logging function
   */
  constructor(options) {
    super();
    
    if (!options.sessionManager) {
      throw new Error('sessionManager is required');
    }
    
    this.sessionManager = options.sessionManager;
    this.logger = options.logger || console.log;
    this.errorHandler = new ErrorHandler();
    
    // Store command registry
    this.commands = new Map();
    
    // Register built-in commands
    this.registerCommand('help', this.handleHelpCommand.bind(this), 'Show available commands');
    this.registerCommand('stats', this.handleStatsCommand.bind(this), 'Show your command usage statistics');
  }
  
  /**
   * Register a new command
   * @param {string} commandName Command name
   * @param {Function} handler Command handler function
   * @param {string} description Command description
   */
  registerCommand(commandName, handler, description) {
    this.commands.set(commandName, {
      name: commandName,
      handler,
      description
    });
  }
  
  /**
   * Process a command from a user
   * @param {string} userId User ID
   * @param {string} commandText Command text
   * @returns {Promise<string>} Command result
   */
  async processCommand(userId, commandText) {
    try {
      // Get user session data
      const userData = await this.sessionManager.getUserData(userId);
      
      // Parse command (first word is command name, rest are args)
      const parts = commandText.trim().split(/\s+/);
      const commandName = parts[0].toLowerCase();
      const args = parts.slice(1);
      
      // Check if command exists
      const command = this.commands.get(commandName);
      if (!command) {
        return `Unknown command: ${commandName}. Type 'help' to see available commands.`;
      }
      
      // Track command usage in session
      await this._trackCommandUsage(userId, commandName);
      
      // Execute command
      this.emit('command:executing', { userId, commandName, args });
      const result = await command.handler(userId, args, userData);
      this.emit('command:executed', { userId, commandName, args, success: true });
      
      return result;
    } catch (error) {
      // Handle error
      const appError = this.errorHandler.handleError(error, {
        component: 'CommandHandler',
        operation: 'processCommand',
        context: { userId, commandText }
      });
      
      this.emit('command:error', { userId, error: appError });
      return `Error executing command: ${appError.message}`;
    }
  }
  
  /**
   * Track command usage in user session
   * @param {string} userId User ID
   * @param {string} commandName Command name
   * @private
   */
  async _trackCommandUsage(userId, commandName) {
    try {
      // Get user data
      const userData = await this.sessionManager.getUserData(userId);
      
      // Initialize command stats if not exists
      const commandStats = userData.commandStats || {};
      const count = (commandStats[commandName] || 0) + 1;
      
      // Update command stats
      await this.sessionManager.updateUserData(userId, {
        commandStats: {
          ...commandStats,
          [commandName]: count
        },
        lastCommand: {
          name: commandName,
          executedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      // Just log error but don't break command execution
      this.logger(`Failed to track command usage: ${error.message}`);
    }
  }
  
  /**
   * Handle help command
   * @param {string} userId User ID
   * @param {Array<string>} args Command arguments
   * @returns {string} Help text
   */
  async handleHelpCommand(userId, args) {
    const helpLines = ['Available commands:'];
    
    // Add all commands to help text
    for (const [name, command] of this.commands.entries()) {
      helpLines.push(`${name} - ${command.description}`);
    }
    
    return helpLines.join('\n');
  }
  
  /**
   * Handle stats command
   * @param {string} userId User ID
   * @param {Array<string>} args Command arguments
   * @param {Object} userData User data from session
   * @returns {string} Stats text
   */
  async handleStatsCommand(userId, args, userData) {
    const commandStats = userData.commandStats || {};
    
    if (Object.keys(commandStats).length === 0) {
      return "You haven't used any commands yet.";
    }
    
    const statsLines = ['Your command usage:'];
    
    // Add all command stats to output
    for (const [name, count] of Object.entries(commandStats)) {
      statsLines.push(`${name}: ${count} times`);
    }
    
    return statsLines.join('\n');
  }
}

/**
 * Run the command handler example
 */
async function runCommandHandlerExample() {
  console.log('Starting Command Handler example...');
  
  // Create session manager
  const sessionManager = createSessionManager({
    defaults: {
      commandStats: {},
      preferences: {
        theme: 'dark',
        notifications: true
      }
    }
  });
  
  // Create command handler
  const commandHandler = new CommandHandler({
    sessionManager
  });
  
  // Register custom command
  commandHandler.registerCommand('profile', async (userId, args, userData) => {
    return `User Profile:
ID: ${userId}
Theme: ${userData.preferences?.theme || 'default'}
Commands used: ${Object.keys(userData.commandStats || {}).length}
`;
  }, 'Show your profile information');
  
  // Log command events
  commandHandler.on('command:executing', (data) => {
    console.log(`Executing command: ${data.commandName} for user ${data.userId}`);
  });
  
  commandHandler.on('command:executed', (data) => {
    console.log(`Command executed: ${data.commandName} for user ${data.userId}`);
  });
  
  commandHandler.on('command:error', (data) => {
    console.error(`Command error for user ${data.userId}: ${data.error.message}`);
  });
  
  try {
    // Simulate user commands
    const userId = 'example-user';
    
    // Command 1: Help
    console.log('\n--- User sends: help ---');
    let response = await commandHandler.processCommand(userId, 'help');
    console.log('Response:', response);
    
    // Command 2: Unknown command
    console.log('\n--- User sends: unknown ---');
    response = await commandHandler.processCommand(userId, 'unknown');
    console.log('Response:', response);
    
    // Command 3: Profile
    console.log('\n--- User sends: profile ---');
    response = await commandHandler.processCommand(userId, 'profile');
    console.log('Response:', response);
    
    // Command 4: Stats (after using a few commands)
    console.log('\n--- User sends: stats ---');
    response = await commandHandler.processCommand(userId, 'stats');
    console.log('Response:', response);
    
    // Get session data
    console.log('\n--- User session data ---');
    const userData = await sessionManager.getUserData(userId);
    console.log('Command stats:', userData.commandStats);
    console.log('Last command:', userData.lastCommand);
    
    console.log('\nCommand Handler example completed successfully!');
  } catch (error) {
    console.error('Example failed:', error);
  }
}

module.exports = {
  CommandHandler,
  runCommandHandlerExample
}; 