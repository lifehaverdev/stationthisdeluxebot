/**
 * TaskQueue Example
 * 
 * This example demonstrates how to use the TaskQueueService for managing
 * asynchronous tasks, including tracking their lifecycle and handling
 * failures and retry logic.
 */

const { createTaskQueueService } = require('../TaskQueueService');
const eventBus = require('../../shared/events').default;

// Simple task handlers
const taskHandlers = {
  // A successful task handler
  'IMAGE_GENERATION': async (task) => {
    console.log(`[IMAGE_GENERATION] Processing task ${task.id}...`);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return success with outputs
    return {
      success: true,
      outputs: [
        { 
          type: 'image',
          url: `https://example.com/images/generated-${Date.now()}.jpg`
        }
      ]
    };
  },
  
  // A task handler that sometimes fails
  'TEXT_ANALYSIS': async (task) => {
    console.log(`[TEXT_ANALYSIS] Processing task ${task.id}...`);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Randomly fail 30% of the time
    if (Math.random() < 0.3) {
      return {
        success: false,
        error: 'Analysis engine failed to process text',
        reason: 'engine_failure'
      };
    }
    
    // Return success with outputs
    return {
      success: true,
      outputs: [
        { 
          type: 'text',
          content: `Analysis results for "${task.text || 'sample text'}"`
        }
      ]
    };
  },
  
  // A task that always fails
  'FAILING_TASK': async (task) => {
    console.log(`[FAILING_TASK] Processing task ${task.id}...`);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Always fail
    return {
      success: false,
      error: 'This task type always fails',
      reason: 'intentional_failure'
    };
  }
};

/**
 * Run the TaskQueue example
 */
async function runTaskQueueExample() {
  console.log('Starting TaskQueue example...');
  
  // Create a TaskQueueService with custom options
  const queueService = createTaskQueueService({
    maxConcurrentTasks: 2,
    taskTimeout: 5000, // 5 seconds
    autoRetry: true,
    maxRetries: 2,
    taskHandlers
  });
  
  // Set up event listeners
  const unsubscribers = [
    eventBus.subscribe('task:enqueued', event => {
      console.log(`Task enqueued: ${event.data.task.id} (${event.data.task.type})`);
    }),
    
    eventBus.subscribe('task:processing', event => {
      console.log(`Task processing: ${event.data.task.id}`);
    }),
    
    eventBus.subscribe('task:completed', event => {
      console.log(`Task completed: ${event.data.task.id}`);
    }),
    
    eventBus.subscribe('task:failed', event => {
      console.log(`Task failed: ${event.data.task.id} - ${event.data.task.error}`);
    }),
    
    eventBus.subscribe('task:retry', event => {
      console.log(`Task retry: ${event.data.task.id} (attempt ${event.data.attempt})`);
    })
  ];
  
  // Queue some example tasks
  const tasks = [
    // Image generation tasks
    { 
      userId: '123',
      type: 'IMAGE_GENERATION',
      prompt: 'A beautiful sunset over the mountains'
    },
    { 
      userId: '123',
      type: 'IMAGE_GENERATION',
      prompt: 'A futuristic city with flying cars'
    },
    
    // Text analysis tasks
    { 
      userId: '456',
      type: 'TEXT_ANALYSIS',
      text: 'This is a sample text to analyze for sentiment and topics.'
    },
    
    // Failing task
    { 
      userId: '789',
      type: 'FAILING_TASK',
      data: 'This task will fail and be retried'
    }
  ];
  
  // Enqueue the tasks
  const results = [];
  for (const task of tasks) {
    const result = await queueService.enqueueTask(task);
    results.push(result);
    console.log(`Enqueued task with ID: ${result.taskId}`);
  }
  
  // Show initial queue metrics
  console.log('\nInitial queue metrics:');
  console.log(queueService.getMetrics());
  
  // Wait for all tasks to complete or fail
  console.log('\nWaiting for tasks to process...');
  await waitForCompletion(queueService, results.map(r => r.taskId));
  
  // Show final queue metrics
  console.log('\nFinal queue metrics:');
  console.log(queueService.getMetrics());
  
  // Cleanup
  unsubscribers.forEach(unsubscribe => unsubscribe());
  queueService.dispose();
  
  console.log('\nTaskQueue example completed');
}

/**
 * Wait for all tasks to complete or fail
 * @param {TaskQueueService} queueService - Queue service
 * @param {Array<string>} taskIds - Task IDs to wait for
 * @returns {Promise<void>}
 */
async function waitForCompletion(queueService, taskIds) {
  const maxWaitTimeMs = 10000; // 10 seconds
  const startTime = Date.now();
  
  while (true) {
    // Check if all tasks are completed or failed
    const allDone = taskIds.every(taskId => {
      const status = queueService.getTaskStatus(taskId);
      return !status || status.status === 'success' || 
             status.status === 'failed' || 
             status.status === 'cancelled';
    });
    
    if (allDone) {
      console.log('All tasks have completed or failed');
      break;
    }
    
    // Check timeout
    if (Date.now() - startTime > maxWaitTimeMs) {
      console.log('Timed out waiting for task completion');
      break;
    }
    
    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Run the example directly if this script is executed
if (require.main === module) {
  runTaskQueueExample()
    .catch(err => console.error('Error running example:', err));
}

module.exports = { runTaskQueueExample }; 