/**
 * Collection of custom format validators for JSON Schema validation
 */
class FormatValidators {
  constructor() {
    this.validators = new Map();
    
    // Register default format validators
    this.addValidator('email', this.emailValidator);
    this.addValidator('uri', this.uriValidator);
    this.addValidator('date-time', this.dateTimeValidator);
    this.addValidator('uuid', this.uuidValidator);
    this.addValidator('hostname', this.hostnameValidator);
    this.addValidator('ipv4', this.ipv4Validator);
    this.addValidator('ipv6', this.ipv6Validator);
  }

  /**
   * Add a custom format validator
   * @param {string} format - Format name
   * @param {Function} validatorFn - Function that accepts a value and returns boolean
   * @returns {FormatValidators} this instance for chaining
   * @throws {Error} If format name is invalid or validator is not a function
   */
  addValidator(format, validatorFn) {
    if (!format || typeof format !== 'string') {
      throw new Error('Format name must be a non-empty string');
    }
    
    if (typeof validatorFn !== 'function') {
      throw new Error('Validator must be a function');
    }
    
    this.validators.set(format, validatorFn);
    return this;
  }

  /**
   * Get a validator by format name
   * @param {string} format - Format name
   * @returns {Function|undefined} Validator function or undefined if not found
   */
  getValidator(format) {
    return this.validators.get(format);
  }

  /**
   * Remove a validator
   * @param {string} format - Format name to remove
   * @returns {boolean} True if removed, false if not found
   */
  removeValidator(format) {
    return this.validators.delete(format);
  }

  /**
   * Check if a validator exists
   * @param {string} format - Format name
   * @returns {boolean} True if validator exists
   */
  hasValidator(format) {
    return this.validators.has(format);
  }

  /**
   * Email format validator
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  emailValidator(value) {
    if (typeof value !== 'string') return false;
    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  }

  /**
   * URI format validator
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  uriValidator(value) {
    if (typeof value !== 'string') return false;
    
    // Basic validation for URI format
    // Check for common issues before trying URL constructor
    if (!value.includes('://')) return false;
    if (value.match(/^[a-z]+:\/\/[^\/]/i) === null) return false;
    
    try {
      new URL(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Date-time format validator (ISO 8601)
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  dateTimeValidator(value) {
    if (typeof value !== 'string') return false;
    const date = new Date(value);
    return !isNaN(date.getTime()) && value.includes('T');
  }

  /**
   * UUID format validator
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  uuidValidator(value) {
    if (typeof value !== 'string') return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  }

  /**
   * Hostname format validator
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  hostnameValidator(value) {
    if (typeof value !== 'string') return false;
    const hostnameRegex = /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)*$/i;
    return hostnameRegex.test(value) && value.length <= 255;
  }

  /**
   * IPv4 format validator
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  ipv4Validator(value) {
    if (typeof value !== 'string') return false;
    const ipv4Regex = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(value);
  }

  /**
   * IPv6 format validator
   * @param {string} value - Value to validate
   * @returns {boolean} True if valid
   */
  ipv6Validator(value) {
    if (typeof value !== 'string') return false;
    // Basic IPv6 validation - this is a simplified version
    const ipv6Regex = /^(([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:)|([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:)|([0-9a-f]{1,4}:){5}((:[0-9a-f]{1,4}){1,2}|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:)|([0-9a-f]{1,4}:){4}((:[0-9a-f]{1,4}){1,3}|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:)|([0-9a-f]{1,4}:){3}((:[0-9a-f]{1,4}){1,4}|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:)|([0-9a-f]{1,4}:){2}((:[0-9a-f]{1,4}){1,5}|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:)|([0-9a-f]{1,4}:){1}((:[0-9a-f]{1,4}){1,6}|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:)|:((:[0-9a-f]{1,4}){1,7}|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))$/i;
    return ipv6Regex.test(value);
  }
}

module.exports = { FormatValidators }; 