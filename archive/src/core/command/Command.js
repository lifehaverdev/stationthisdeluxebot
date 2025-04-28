/**
 * Command Base Class
 * 
 * Defines the structure and common functionality for all commands.
 * All commands should extend this class.
 */

const { AppError } = require('../shared/errors/AppError');

/**
 * Command base class
 */
class Command {
  /**
   * Create a new command
   * @param {Object} options - Command options
   * @param {string} options.name - Command name (required)
   * @param {string} options.description - Command description
   * @param {string} options.usage - Usage instructions
   * @param {string[]} options.aliases - Command aliases
   * @param {string} options.category - Command category
   * @param {string[]} options.requiredPermissions - Required permissions
   * @param {number} options.cooldown - Cooldown in seconds
   */
  constructor(options = {}) {
    if (!options.name) {
      throw new AppError('Command name is required', {
        code: 'COMMAND_NAME_REQUIRED'
      });
    }

    this.name = options.name;
    this.description = options.description || 'No description provided';
    this.usage = options.usage || `/${options.name}`;
    this.aliases = options.aliases || [];
    this.cooldown = options.cooldown || 0;
    this.requiredPermissions = options.requiredPermissions || ['user'];

    // Command metadata
    this.metadata = {
      category: options.category || 'general',
      ...options.metadata
    };
  }

  /**
   * Execute the command - must be implemented by subclasses
   * @param {Object} context - Command execution context
   * @returns {Promise<Object>} Command execution result
   */
  async execute(context) {
    throw new AppError(`Command '${this.name}' does not implement execute()`, {
      code: 'COMMAND_NOT_IMPLEMENTED'
    });
  }

  /**
   * Check if user has permission to execute this command
   * @param {Object} user - User information
   * @returns {boolean} Whether user has permission
   */
  hasPermission(user) {
    if (!user) return false;
    
    // Admin can execute any command
    if (user.role === 'admin') return true;
    
    // Check if user role is in required permissions
    if (this.requiredPermissions.includes(user.role)) {
      return true;
    }
    
    // Check for specific permission grants
    if (user.permissions && Array.isArray(user.permissions)) {
      const commandPermission = `command:${this.name}`;
      return user.permissions.includes(commandPermission);
    }
    
    return false;
  }

  /**
   * Get command metadata
   * @returns {Object} Command metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      usage: this.usage,
      aliases: this.aliases,
      cooldown: this.cooldown,
      category: this.metadata.category,
      requiredPermissions: this.requiredPermissions
    };
  }
}

module.exports = {
  Command
}; 