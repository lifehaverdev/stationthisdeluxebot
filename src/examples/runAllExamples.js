/**
 * Main file that imports and runs all SessionAdapter examples
 */

// Import all examples
const { runCommandHandlerExample } = require('./commandHandlerExample');
const { runWebhookHandlerExample } = require('./webhookHandlerExample');
const { runRateLimiterExample } = require('./rateLimiterExample');
const { runPreferencesManagerExample } = require('./preferencesManagerExample');
const { runFeatureFlagsExample } = require('./featureFlagsExample');

/**
 * Run all examples sequentially
 */
async function runAllExamples() {
  try {
    console.log('====================================');
    console.log('🚀 Running SessionAdapter Examples 🚀');
    console.log('====================================\n');

    // Command Handler Example
    console.log('\n=== 📋 COMMAND HANDLER EXAMPLE ===');
    await runCommandHandlerExample();

    // Webhook Handler Example 
    console.log('\n\n=== 🔗 WEBHOOK HANDLER EXAMPLE ===');
    await runWebhookHandlerExample();

    // Rate Limiter Example
    console.log('\n\n=== ⏱️ RATE LIMITER EXAMPLE ===');
    await runRateLimiterExample();

    // Preferences Manager Example
    console.log('\n\n=== ⚙️ PREFERENCES MANAGER EXAMPLE ===');
    await runPreferencesManagerExample();

    // Feature Flags Example
    console.log('\n\n=== 🚩 FEATURE FLAGS EXAMPLE ===');
    await runFeatureFlagsExample();

    console.log('\n====================================');
    console.log('✅ All examples completed successfully!');
    console.log('====================================');

  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run all examples if this file is executed directly
if (require.main === module) {
  runAllExamples();
}

module.exports = { runAllExamples }; 