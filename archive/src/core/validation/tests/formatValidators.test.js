const { FormatValidators } = require('../formatValidators');

describe('FormatValidators', () => {
  let formatValidators;

  beforeEach(() => {
    formatValidators = new FormatValidators();
  });

  describe('constructor', () => {
    it('should initialize with default validators', () => {
      expect(formatValidators.hasValidator('email')).toBe(true);
      expect(formatValidators.hasValidator('uri')).toBe(true);
      expect(formatValidators.hasValidator('date-time')).toBe(true);
      expect(formatValidators.hasValidator('uuid')).toBe(true);
      expect(formatValidators.hasValidator('hostname')).toBe(true);
      expect(formatValidators.hasValidator('ipv4')).toBe(true);
      expect(formatValidators.hasValidator('ipv6')).toBe(true);
    });
  });

  describe('addValidator', () => {
    it('should add a custom validator', () => {
      const customValidator = (value) => typeof value === 'number' && value > 0;
      formatValidators.addValidator('positive-number', customValidator);
      
      expect(formatValidators.hasValidator('positive-number')).toBe(true);
      expect(formatValidators.getValidator('positive-number')).toBe(customValidator);
    });

    it('should allow method chaining', () => {
      const result = formatValidators.addValidator('custom', () => true);
      expect(result).toBe(formatValidators);
    });

    it('should throw error for invalid format name', () => {
      expect(() => formatValidators.addValidator('', () => true)).toThrow('Format name must be a non-empty string');
      expect(() => formatValidators.addValidator(null, () => true)).toThrow('Format name must be a non-empty string');
      expect(() => formatValidators.addValidator(123, () => true)).toThrow('Format name must be a non-empty string');
    });

    it('should throw error for invalid validator function', () => {
      expect(() => formatValidators.addValidator('custom', 'not-a-function')).toThrow('Validator must be a function');
      expect(() => formatValidators.addValidator('custom', 123)).toThrow('Validator must be a function');
      expect(() => formatValidators.addValidator('custom', null)).toThrow('Validator must be a function');
    });
  });

  describe('getValidator', () => {
    it('should return validator function for existing format', () => {
      const validator = formatValidators.getValidator('email');
      expect(typeof validator).toBe('function');
    });

    it('should return undefined for non-existing format', () => {
      const validator = formatValidators.getValidator('non-existing');
      expect(validator).toBeUndefined();
    });
  });

  describe('removeValidator', () => {
    it('should remove existing validator', () => {
      expect(formatValidators.hasValidator('email')).toBe(true);
      
      const result = formatValidators.removeValidator('email');
      
      expect(result).toBe(true);
      expect(formatValidators.hasValidator('email')).toBe(false);
    });

    it('should return false for non-existing validator', () => {
      const result = formatValidators.removeValidator('non-existing');
      expect(result).toBe(false);
    });
  });

  describe('hasValidator', () => {
    it('should return true for existing validator', () => {
      expect(formatValidators.hasValidator('email')).toBe(true);
    });

    it('should return false for non-existing validator', () => {
      expect(formatValidators.hasValidator('non-existing')).toBe(false);
    });
  });

  describe('emailValidator', () => {
    it('should validate valid email addresses', () => {
      const validator = formatValidators.getValidator('email');
      
      expect(validator('user@example.com')).toBe(true);
      expect(validator('user.name@example.co.uk')).toBe(true);
      expect(validator('user+tag@example.com')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      const validator = formatValidators.getValidator('email');
      
      expect(validator('not-an-email')).toBe(false);
      expect(validator('user@')).toBe(false);
      expect(validator('@example.com')).toBe(false);
      expect(validator('user@.com')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(null)).toBe(false);
    });
  });

  describe('uriValidator', () => {
    it('should validate valid URIs', () => {
      const validator = formatValidators.getValidator('uri');
      
      expect(validator('https://example.com')).toBe(true);
      expect(validator('http://localhost:3000')).toBe(true);
      expect(validator('ftp://files.example.org/pub')).toBe(true);
    });

    it('should reject invalid URIs', () => {
      const validator = formatValidators.getValidator('uri');
      
      expect(validator('not-a-uri')).toBe(false);
      expect(validator('http:/example.com')).toBe(false);
      expect(validator('://example.com')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(null)).toBe(false);
    });
  });

  describe('dateTimeValidator', () => {
    it('should validate valid ISO 8601 date-times', () => {
      const validator = formatValidators.getValidator('date-time');
      
      expect(validator('2023-01-01T12:00:00Z')).toBe(true);
      expect(validator('2023-01-01T12:00:00.123Z')).toBe(true);
      expect(validator('2023-01-01T12:00:00+01:00')).toBe(true);
    });

    it('should reject invalid date-times', () => {
      const validator = formatValidators.getValidator('date-time');
      
      expect(validator('2023-01-01')).toBe(false); // No time part
      expect(validator('not-a-date')).toBe(false);
      expect(validator('12:00:00')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(null)).toBe(false);
    });
  });

  describe('uuidValidator', () => {
    it('should validate valid UUIDs', () => {
      const validator = formatValidators.getValidator('uuid');
      
      expect(validator('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(validator('123E4567-E89B-12D3-A456-426614174000')).toBe(true); // Case insensitive
    });

    it('should reject invalid UUIDs', () => {
      const validator = formatValidators.getValidator('uuid');
      
      expect(validator('not-a-uuid')).toBe(false);
      expect(validator('123e4567e89b12d3a456426614174000')).toBe(false); // No dashes
      expect(validator('123e4567-e89b-12d3-a456-42661417400')).toBe(false); // Too short
      expect(validator(123)).toBe(false);
      expect(validator(null)).toBe(false);
    });
  });

  describe('hostnameValidator', () => {
    it('should validate valid hostnames', () => {
      const validator = formatValidators.getValidator('hostname');
      
      expect(validator('example.com')).toBe(true);
      expect(validator('sub.example.com')).toBe(true);
      expect(validator('example')).toBe(true);
      expect(validator('sub-domain.example.com')).toBe(true);
    });

    it('should reject invalid hostnames', () => {
      const validator = formatValidators.getValidator('hostname');
      
      expect(validator('-example.com')).toBe(false); // Starts with hyphen
      expect(validator('example-.com')).toBe(false); // Ends with hyphen
      expect(validator('example..com')).toBe(false); // Double dot
      expect(validator(123)).toBe(false);
      expect(validator(null)).toBe(false);
    });
  });

  describe('ipv4Validator', () => {
    it('should validate valid IPv4 addresses', () => {
      const validator = formatValidators.getValidator('ipv4');
      
      expect(validator('192.168.0.1')).toBe(true);
      expect(validator('127.0.0.1')).toBe(true);
      expect(validator('255.255.255.255')).toBe(true);
      expect(validator('0.0.0.0')).toBe(true);
    });

    it('should reject invalid IPv4 addresses', () => {
      const validator = formatValidators.getValidator('ipv4');
      
      expect(validator('256.0.0.1')).toBe(false); // Out of range
      expect(validator('192.168.0')).toBe(false); // Too few octets
      expect(validator('192.168.0.1.1')).toBe(false); // Too many octets
      expect(validator('not-an-ip')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(null)).toBe(false);
    });
  });

  describe('ipv6Validator', () => {
    it('should validate valid IPv6 addresses', () => {
      const validator = formatValidators.getValidator('ipv6');
      
      expect(validator('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
      expect(validator('::1')).toBe(true);
      expect(validator('2001:db8::')).toBe(true);
    });

    it('should reject invalid IPv6 addresses', () => {
      const validator = formatValidators.getValidator('ipv6');
      
      expect(validator('2001:db8:g::')).toBe(false); // Invalid character
      expect(validator('not-an-ip')).toBe(false);
      expect(validator(123)).toBe(false);
      expect(validator(null)).toBe(false);
    });
  });
}); 