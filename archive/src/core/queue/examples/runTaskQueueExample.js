/**
 * Run Task Queue Example
 * 
 * Simple script to run the task queue example
 */

const { runTaskQueueExample } = require('./taskQueueExample');

console.log('Starting task queue example runner...');

runTaskQueueExample()
  .then(() => {
    console.log('Example run completed successfully');
  })
  .catch(error => {
    console.error('Error running task queue example:', error);
    process.exit(1);
  }); 