// Updated structure with points flow, status tracking, final point deduction, and considerations for future load measurement.
const { taskQueue, waiting, lobby } = require('../bot/bot');
const { enqueueTask } = require('./helpers/queueHelp')
const { saveGen } = require('../../db/mongodb')
 
let retryQueue = [];
let successBucket = [];
const MAX_RETRIES = 3;
const BACKOFF_FACTOR = 2;
let cleaningFlag = false; // Global flag to track lobby cleanup

// Each task will have a log for tracking statuses and timestamps
let statusLogs = {};

// Helper functions assumed available:
// - sendContent(task)
// - reEnqueueTask(task)
// - updateTaskStatus(task, status)
// - processMenuUpdates()
// - addLogo(task)
// - calculatePoints(task)
// - finalizePoints(task)
// - refundPoints(task)

// Enqueue a new task and add initial points
// function enqueueTask(task) {
//     taskQueue.push({ ...task, retries: 0 });
//     updateTaskStatus(task, 'queued'); // Initial status
//     processQueue();
// }

// Process the main task queue
async function processQueue() {
    if (cleaningFlag) {
        console.log('Lobby cleanup in progress. Slowing down task processing.');
        return;
    }
    if (taskQueue.length > 0 && waitingQueue.length < 10) {
        const task = taskQueue.shift();
        waitingQueue.push(task);
        updateTaskStatus(task, 'started');
        await routeTaskStatus(task);
    }
}

// Route task based on status
async function routeTaskStatus(task) {
    const { status } = task;
    if (cleaningFlag) {
        console.log('Deferring task processing due to lobby cleanup.');
        return;
    }
    switch (status) {
        case 'success':
            successBucket.push(task); // Move to success bucket for later
            break;
        case 'failed':
        case 'timeout':
        case 'canceled':
            handleRetries(task);
            break;
        default:
            updateWaitingArray(task); // Just update the waiting array
            break;
    }
}

// Handle retries for failed/timed-out/canceled tasks
function handleRetries(task) {
    if (!task.retryCount) task.retryCount = 1;
    else task.retryCount++;

    if (task.retryCount <= MAX_RETRIES) {
        console.log(`Re-enqueueing task ${task.run_id} (Retry ${task.retryCount})`);
        reEnqueueTask(task);
    } else {
        console.error(`Max retries reached for task ${task.run_id}. Removing from queue.`);
        refundPoints(task); // Refund points if task ultimately fails
        removeTaskFromQueues(task.run_id);
    }
}

// Process the success bucket in batches
async function processSuccessBucket() {
    if (successBucket.length > 0 && !cleaningFlag) {
        const batchSize = 5; // Process in batches of 5
        const batch = successBucket.splice(0, batchSize);
        for (const task of batch) {
            await sendContentWithRetry(task);
        }
    }
}

// Send content to the user with exponential back-off retry
async function sendContentWithRetry(task) {
    let attempt = task.retries + 1;
    const delay = Math.pow(BACKOFF_FACTOR, attempt) * 1000;

    try {
        sent = await sendContent(task);
        if(sent){
            console.log(`👍 Successfully sent content for task ${task.run_id}`);
            saveGen(task)
            finalizePoints(task); // Finalize points after successful delivery
            removeTaskFromQueues(task.run_id);
        } else {
            
        }
        
    } catch (error) {
        console.error(`Attempt ${attempt} failed for task ${task.run_id}: ${error.message}`);
        if (attempt < MAX_RETRIES) {
            task.retries = attempt;
            retryQueue.push(task);
            setTimeout(() => retrySendContent(), delay);
        } else {
            console.error(`Maximum retry attempts reached for task ${task.run_id}`);
            refundPoints(task); // Refund points after max retries fail
            removeTaskFromQueues(task.run_id);
        }
    }
}

// Retry sending content
function retrySendContent() {
    if (retryQueue.length > 0) {
        const task = retryQueue.shift();
        sendContentWithRetry(task);
    }
}

// Remove a task from all queues
function removeTaskFromQueues(run_id) {
    [taskQueue, waitingQueue, retryQueue, successBucket].forEach(queue => {
        const index = queue.findIndex(task => task.run_id === run_id);
        if (index !== -1) {
            queue.splice(index, 1);
        }
    });
    delete statusLogs[run_id]; // Clean up status log for this task
}

// Track status changes with timestamps
function updateTaskStatus(task, status) {
    const timestamp = new Date().toISOString();
    if (!statusLogs[task.run_id]) statusLogs[task.run_id] = [];
    statusLogs[task.run_id].push({ status, timestamp });
    task.status = status;
}

// Start periodic processing for success bucket
function startSuccessProcessing() {
    setInterval(() => processSuccessBucket(), 1000); // Process every second
}

// Track lobby cleanup (pseudo code, adapt as needed)
function checkForCleanup() {
    setInterval(() => {
        // Set cleaningFlag to true when lobby cleanup is about to start
        cleaningFlag = true;
        console.log('Preparing for lobby cleanup. Pausing success processing.');
        setTimeout(() => cleaningFlag = false, 5000); // Simulate cleanup taking 5s
    }, 900000); // Every 15 minutes
}

// Start processing
startSuccessProcessing();
checkForCleanup();

module.exports = {
    enqueueTask,
    processQueue,
    routeTaskStatus,
    processSuccessBucket,
    handleRetries,
    removeTaskFromQueues,
    updateTaskStatus
};