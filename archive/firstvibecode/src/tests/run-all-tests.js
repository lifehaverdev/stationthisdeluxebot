/**
 * Test Suite Runner
 * 
 * This script runs all integration test suites to verify functionality
 * of the different components of the station bot.
 */

// Import test modules
const path = require('path');
const { execSync } = require('child_process');

async function runJestTest(testPath, testName, options = {}) {
  console.log(`\n📝 RUNNING ${testName}`);
  console.log('-'.repeat(testName.length + 9));

  try {
    let command = `npx jest "${testPath}"`;
    
    // Add --testPathPattern for non-standard test files
    if (options.usePathPattern) {
      command = `npx jest --testPathPattern="${testPath}"`;
    }
    
    // Add testRegex option for non-standard test files
    if (options.useTestRegex) {
      command = `npx jest --testRegex="${testPath}"`;
    }
    
    // Add any other options
    if (options.extraArgs) {
      command += ` ${options.extraArgs}`;
    }
    
    // Run the test using Jest CLI
    execSync(command, { stdio: 'inherit' });
    console.log(`\n✅ ${testName} completed successfully\n`);
    return true;
  } catch (error) {
    console.error(`\n❌ ${testName} failed\n`);
    return false;
  }
}

async function runAllTests() {
  console.log('🧪 STARTING ALL INTEGRATION TESTS 🧪');
  console.log('====================================\n');

  // Run ComfyDeploy tests
  await runJestTest(
    'src/tests/comfydeploy-test.js',
    'COMFYDEPLOY INTEGRATION TESTS',
    { useTestRegex: true }
  );

  // Run Telegram media tests
  await runJestTest(
    'src/tests/telegram-media-test.js',
    'TELEGRAM MEDIA INTEGRATION TESTS',
    { useTestRegex: true }
  );

  // Run Points Service tests
  await runJestTest(
    'tests/core/points/points-service.test.js',
    'POINTS SERVICE TESTS'
  );

  // Run Points Jest tests
  await runJestTest(
    'tests/core/points/points.test.js',
    'POINTS JEST TESTS'
  );

  // Run Task Points Service tests
  await runJestTest(
    'tests/core/points/task-points-service.test.js',
    'TASK POINTS SERVICE TESTS'
  );

  // Run Workflow tests
  await runJestTest(
    'src/core/workflow/tests',
    'WORKFLOW TESTS'
  );

  // Add more test suites here as they are created
  
  console.log('\n====================================');
  console.log('🎉 ALL TESTS COMPLETED 🎉');
}

// Run all tests
runAllTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
}); 