const { ValidationError } = require('../../../../src/core/shared/errors/AppError');

describe('constructor', () => {
  it('should set validationErrors property from parameter', () => {
    const validationErrors = [
      { field: 'username', message: 'Username is required' },
      { field: 'email', message: 'Invalid email format' }
    ];
    
    const error = new ValidationError('Validation failed', { validationErrors });
    
    expect(Array.isArray(error.validationErrors)).toBe(true);
    expect(error.validationErrors).toEqual(validationErrors);
  });
  
  it('should initialize with empty array when no validationErrors provided', () => {
    const error = new ValidationError('Validation failed');
    
    expect(Array.isArray(error.validationErrors)).toBe(true);
    expect(error.validationErrors).toEqual([]);
  });
}); 