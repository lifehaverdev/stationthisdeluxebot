/**
 * Script to run the command handler example
 */

const { runCommandHandlerExample } = require('./commandHandlerExample');

// Run the example
(async () => {
  try {
    console.log('Starting command handler example...');
    await runCommandHandlerExample();
    console.log('Example completed successfully');
  } catch (error) {
    console.error('Error running command handler example:', error);
  }
})(); 