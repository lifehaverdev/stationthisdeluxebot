/**
 * Jest configuration for the project
 */
module.exports = {
  // The root directory that Jest should scan for tests and modules
  rootDir: './',
  
  // The test environment that will be used for testing
  testEnvironment: 'node',
  
  // Directories that Jest should search for test files
  testMatch: [
    "**/tests/**/*.test.js",
    "**/tests/**/*.spec.js"
  ],
  
  // Files to ignore during testing
  testPathIgnorePatterns: [
    '/node_modules/'
  ],
  
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  
  // Collect test coverage information
  collectCoverage: false,
  
  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",
  
  // Indicates which files should be tested for coverage
  collectCoverageFrom: [
    "src/**/*.js",
    "!**/node_modules/**"
  ],
  
  // The maximum amount of workers used to run tests
  maxWorkers: "50%",
  
  // Verbose output for test results
  verbose: true,
}; 