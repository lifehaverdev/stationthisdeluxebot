const { Validator } = require('./validator');
const { SchemaRegistry } = require('./schemaRegistry');
const { FormatValidators } = require('./formatValidators');

// Create default instances
const defaultRegistry = new SchemaRegistry();
const defaultFormatValidators = new FormatValidators();
const defaultValidator = new Validator({
  registry: defaultRegistry,
  formatValidators: defaultFormatValidators
});

module.exports = {
  // Classes
  Validator,
  SchemaRegistry,
  FormatValidators,
  
  // Default instances
  defaultValidator,
  defaultRegistry,
  defaultFormatValidators
}; 