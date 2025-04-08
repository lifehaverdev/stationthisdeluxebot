/**
 * Command Registry
 * 
 * Central registry for all commands in the system.
 * Manages command registration, discovery, and metadata.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');

class CommandRegistry {
  /**
   * Singleton instance
   * @type {CommandRegistry}
   */
  static #instance;

  /**
   * Get the singleton instance of CommandRegistry
   * @returns {CommandRegistry}
   */
  static getInstance() {
    if (!CommandRegistry.#instance) {
      CommandRegistry.#instance = new CommandRegistry();
    }
    return CommandRegistry.#instance;
  }

  /**
   * Create a new CommandRegistry
   */
  constructor() {
    /**
     * Map of command names to command definitions
     * @type {Map<string, Object>}
     */
    this.commands = new Map();
    
    /**
     * Map of command aliases to command names
     * @type {Map<string, string>}
     */
    this.aliases = new Map();
    
    /**
     * Map of command categories
     * @type {Map<string, Set<string>>}
     */
    this.categories = new Map();
  }

  /**
   * Register a command in the registry
   * @param {Object} command - Command definition
   * @param {string} command.name - Command name
   * @param {string} command.description - Command description
   * @param {Function} command.execute - Command execution function
   * @param {Object} [command.metadata] - Additional command metadata
   * @param {string[]} [command.aliases] - Command aliases
   * @returns {boolean} True if registration was successful
   */
  register(command) {
    // Validate command structure
    if (!command || typeof command !== 'object') {
      throw new AppError('Invalid command definition', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_COMMAND_DEFINITION'
      });
    }

    if (!command.name || typeof command.name !== 'string') {
      throw new AppError('Command must have a name', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'MISSING_COMMAND_NAME'
      });
    }

    if (!command.execute || typeof command.execute !== 'function') {
      throw new AppError(`Command '${command.name}' must have an execute function`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'MISSING_COMMAND_EXECUTE'
      });
    }

    // Check if command already exists
    if (this.commands.has(command.name)) {
      throw new AppError(`Command '${command.name}' is already registered`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMMAND_ALREADY_REGISTERED'
      });
    }

    // Register command
    this.commands.set(command.name, command);

    // Register aliases
    if (Array.isArray(command.aliases)) {
      command.aliases.forEach(alias => {
        if (this.aliases.has(alias)) {
          console.warn(`Alias '${alias}' for command '${command.name}' already exists for command '${this.aliases.get(alias)}'. Overwriting.`);
        }
        this.aliases.set(alias, command.name);
      });
    }

    // Register category
    if (command.metadata && command.metadata.category) {
      const category = command.metadata.category;
      if (!this.categories.has(category)) {
        this.categories.set(category, new Set());
      }
      this.categories.get(category).add(command.name);
    }

    return true;
  }

  /**
   * Unregister a command from the registry
   * @param {string} commandName - Name of the command to unregister
   * @returns {boolean} True if unregistration was successful
   */
  unregister(commandName) {
    if (!this.commands.has(commandName)) {
      return false;
    }

    const command = this.commands.get(commandName);

    // Remove command
    this.commands.delete(commandName);

    // Remove aliases
    if (Array.isArray(command.aliases)) {
      command.aliases.forEach(alias => {
        if (this.aliases.get(alias) === commandName) {
          this.aliases.delete(alias);
        }
      });
    }

    // Remove from category
    if (command.metadata && command.metadata.category) {
      const category = command.metadata.category;
      if (this.categories.has(category)) {
        this.categories.get(category).delete(commandName);
        if (this.categories.get(category).size === 0) {
          this.categories.delete(category);
        }
      }
    }

    return true;
  }

  /**
   * Get a command by name or alias
   * @param {string} nameOrAlias - Command name or alias
   * @returns {Object|null} Command definition or null if not found
   */
  get(nameOrAlias) {
    // Check if it's a direct command name
    if (this.commands.has(nameOrAlias)) {
      return this.commands.get(nameOrAlias);
    }

    // Check if it's an alias
    if (this.aliases.has(nameOrAlias)) {
      const commandName = this.aliases.get(nameOrAlias);
      return this.commands.get(commandName);
    }

    return null;
  }

  /**
   * Get all commands
   * @returns {Object[]} Array of all registered commands
   */
  getAll() {
    return Array.from(this.commands.values());
  }

  /**
   * Get all commands in a category
   * @param {string} category - Category name
   * @returns {Object[]} Array of commands in the category
   */
  getByCategory(category) {
    if (!this.categories.has(category)) {
      return [];
    }

    const commandNames = Array.from(this.categories.get(category));
    return commandNames.map(name => this.commands.get(name)).filter(Boolean);
  }

  /**
   * Get all categories
   * @returns {string[]} Array of category names
   */
  getCategories() {
    return Array.from(this.categories.keys());
  }

  /**
   * Check if a command exists
   * @param {string} nameOrAlias - Command name or alias
   * @returns {boolean} True if command exists
   */
  has(nameOrAlias) {
    return this.commands.has(nameOrAlias) || this.aliases.has(nameOrAlias);
  }

  /**
   * Get count of registered commands
   * @returns {number} Number of registered commands
   */
  get size() {
    return this.commands.size;
  }

  /**
   * Clear all registered commands
   */
  clear() {
    this.commands.clear();
    this.aliases.clear();
    this.categories.clear();
  }
}

module.exports = {
  CommandRegistry
}; 