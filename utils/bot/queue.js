
const { taskQueue, waiting } = require('../bot/bot');
const { generate } = require('../../commands/make')
const {
    sendMessage,
    sendPhoto,
    sendAnimation,
    sendVideo,
    // safeExecute
} = require('../utils');
const { addWaterMark } = require('../../commands/waterMark')
const fs = require('fs');

// let taskQueue = []
// let waiting = []
let isSorting = false; 
//
// LOBBY AND QUEUE
//
function enqueueTask(task) {
    // Retrieve user ID from the task message
    const userId = task.message.from.id;
    // Count how many tasks are in the queue from the same user
    const count = taskQueue.filter(t => t.message.from.id === userId).length;
    // Check if the user has already 4 tasks in the queue
    if (count >= 5) {
        console.log(`Task not enqueued. User ${task.message.from.first_name} has reached the maximum task limit.`);
        sendMessage(task.message,"You have 5 things in the queue rn, chill out. Try setting batch or something damn.")
        return; // Exit the function without enqueuing the new task
    }
    taskQueue.push(task);
    task.timestamp = Date.now()
    console.log(`Task enqueued for ${task.message.from.first_name}:`);
    //console.log(task.promptObj.type,task.promptObj.prompt)
    if (!isSorting && taskQueue.length > 1) {
        // isSorting = true;
        sortTaskQueue();
        isSorting = false;
    }
    if (taskQueue.length === 1) {
        // If queue was empty, start processing tasks
        processQueue();
    }
}
function sortTaskQueue() {
        if (isSorting) {
        console.log('currently sorting')
        return; // Exit if sorting is already in progress
    }
    isSorting = true;
    try {
        taskQueue.sort((a, b) => {
            // Check if a.promptObj and b.promptObj exist
            if (!a.promptObj || !b.promptObj) {
                console.warn('promptObj is undefined for some items:', a, b);
                return 0; // No change in order
            }

            const balanceA = a.promptObj.balance || 0;
            const balanceB = b.promptObj.balance || 0;

            // Check if balanceA and balanceB are of the same type
            if (typeof balanceA !== 'number' || typeof balanceB !== 'number') {
                console.warn('balance is not a number for some items:', a, b);
                return 0; // No change in order
            }

            const timestampA = a.timestamp || 0;
            const timestampB = b.timestamp || 0;

            // Calculate waiting time for each task
            const waitingTimeA = Date.now() - timestampA;
            const waitingTimeB = Date.now() - timestampB;

            // If waiting time is over 20 seconds, prioritize it regardless of balance
            if (waitingTimeA >= 20000 && waitingTimeB < 20000) {
                return -1; // Move a to the front
            } else if (waitingTimeB >= 20000 && waitingTimeA < 20000) {
                return 1; // Move b to the front
            }

            // If waiting times are less than 20 seconds, prioritize based on balance
            // If balance is the same, sort by longer waiting time first
            if (balanceB === balanceA) {
                return waitingTimeB - waitingTimeA; // Longer waiting time first
            }

            return balanceB - balanceA; // Descending order by balance
        });
 
        } catch (error) {
            console.error('Error sorting taskQueue:', error);
        }
}

async function processQueue() {
    if (taskQueue.length > 0 && waiting.length < 7) {
        const task = taskQueue[0];
        waitlist(task);
        //console.log(taskQueue);
        // Find the index of the processed task based on its timestamp
        const taskIndexToRemove = taskQueue.findIndex(t => t.timestamp === task.timestamp);

        // Check if the task still exists at the found index
        if (taskIndexToRemove !== -1 && taskQueue[taskIndexToRemove].timestamp === task.timestamp) {
            // Remove the task from the queue
            taskQueue.splice(taskIndexToRemove, 1);
        }
        processQueue(); // Continue processing next task
    } else {
        if(taskQueue.length == 0 && waiting.length == 0){
            console.log('queues empty');
        } else if (taskQueue.length == 0 && waiting.length > 0){
            console.log('queue empty, waiting')
        } else if (taskQueue.length > 0 && waiting.length > 7) {
            console.log('we are full full')
        }
        //console.log('All queue processed , or waitlist full')
        //console.log('Waitlist',waiting.length);
        //console.log('Tasks',taskQueue.length);
    }
}

async function waitlist(task){
    const { message, promptObj } = task;
    let run_id;
    switch (promptObj.type){
        case 'MS3':
            console.log('we make ms3 pls')
            // if(promptObj.balance < 1000000){
            //     sendMessage(message,'you cant make a video if you dont have 1M LOL')
            //     return
            // }
            run_id = await generate(promptObj);
            break;
        case 'MAKE':   
        case 'MAKE_STYLE':
        case 'MAKE_CONTROL_STYLE':
        case 'MAKE_CONTROL':
        case 'MS2':
        case 'MS2_CONTROL':
        case 'MS2_CONTROL_STYLE':
        case 'MS2_STYLE':
        case 'PFP':
        case 'PFP_STYLE':
        case 'PFP_CONTROL_STYLE':
        case 'PFP_CONTROL':
        case 'INTERROGATE':
        case 'MAKE3':
            run_id = await generate(promptObj);
            break;
    }
    if(run_id != -1 && run_id != undefined){
        //console.log('we have run id',run_id);
        task = {
            ...task,
            run_id: run_id,
            timestamp: Date.now(),
        };
        waiting.push(task);
        console.log(`Task enqueued for ${message.from.first_name}`);
    } else {
        console.log('no run id');
        sendMessage(message,'ah it didnt take. send your prompt to dev')
    }
    
}

// Define a set to keep track of run_ids being processed
const processingRunIds = new Set();
const processingQueue = {};

async function retryOperation(operation, ...args) {
    let attempts = 0;
    let success = false;
    const maxAttempts = 3;
    const delay = 6000;

    while (attempts < maxAttempts && !success) {
        try {
            await operation(...args);
            success = true;
        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed:`, {
            message: error.message ? error.message : '',
            name: error.name ? error.name : '',
            code: error.code ? error.code : '',
        });
            attempts++;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    if (!success) {
        console.error('Maximum retry attempts reached.');
    }
    return success
}

const TWENTY_MINUTES = 20 * 60 * 1000;

function removeStaleTasks() {
    const now = Date.now();
    for (let i = waiting.length - 1; i >= 0; i--) {
        if ((now - waiting[i].timestamp) > TWENTY_MINUTES) {
            waiting.splice(i, 1); // Remove stale tasks
        }
    }
}

async function processWaitlist(status, run_id, outputs) {

    removeStaleTasks();

    // Avoid processing the same task multiple times
    if (processingRunIds.has(run_id)) {
        if (!processingQueue[run_id]) {
            processingQueue[run_id] = [];
        }
        processingQueue[run_id].push({ status, outputs });
        console.log(`Task with run_id ${run_id} is already being processed. Added to queue.`);
        return;
    }

    // Add the run_id to the set of processing tasks
    processingRunIds.add(run_id);

    try {
        // Check the "waiting" task array for a matching ID
        const taskIndex = waiting.findIndex(task => task.run_id === run_id);

        if (taskIndex === -1) {
            console.error('Task with run_id not found in the waiting array.');
            processingRunIds.delete(run_id);
            return;
        }

        const task = waiting[taskIndex];
        const run = { status, run_id, outputs };

        // Handle sending the content to the user via handleTaskCompletion
        const result = await handleTaskCompletion(task, run);
        // Remove the corresponding task from the waiting array only if successfully processed
        if (result == 'success') {
            // console.log('before removing task',waiting.length)
            waiting.splice(taskIndex, 1);
            // console.log('after removing task',waiting.length);
            console.log(`Task with run_id ${run_id} removed from the waiting array.`);
        } else if (result == 'failed') {
            console.error(`Failed to send task with run_id ${run_id}, not removing from waiting array.`);
            waiting.splice(taskIndex, 1);
        } else if (result == 'not sent'){
            const secondResult = await handleTaskCompletion(task, run);
            if(secondResult){
                waiting.splice(taskIndex, 1);
            } 
        } else {
            console.log(`Task with run_id ${run_id} is incomplete, not removing from waiting array.`);
        }

    } catch (err) {
        console.error('Exception in processWaitlist:', err);
    } finally {
        // Remove the run_id from the set of processing tasks
        processingRunIds.delete(run_id);

        // Process the next task in the queue for this run_id, if any
        if (processingQueue[run_id] && processingQueue[run_id].length > 0) {
            const nextTask = processingQueue[run_id].shift();
            processWaitlist(nextTask.status, run_id, nextTask.outputs);
            // Clean up the processingQueue if empty
            if (processingQueue[run_id].length === 0) {
                delete processingQueue[run_id];
            }
        }
    }
    processQueue();
}

async function handleTaskCompletion(task, run) {
    const { message, promptObj } = task;
    const { status, outputs } = run;
    const possibleTypes = ["images", "gifs", "videos", "text"];
    let urls = [];
    let texts = [];
    let sent = true;

    const operation = async () => {
        
        // If outputs are present, process them
        if (outputs && outputs.length > 0) {
            console.log("Outputs found:", outputs.length);
            outputs.forEach(outputItem => {
                possibleTypes.forEach(type => {
                    if (outputItem.data && outputItem.data[type] && outputItem.data[type].length > 0) {
                        if (type === 'text') {
                            texts = outputItem.data[type]; // Directly assign the text array
                        } else {
                            outputItem.data[type].forEach(dataItem => {
                                const url = dataItem.url;
                                const fileType = extractType(url);
                                urls.push({ type: fileType, url });
                                console.log(`${fileType.toUpperCase()} URL:`, url);
                            });
                        }
                    }
                });
            });

            for (const { url, type } of urls) {
                try {
                    let fileToSend = url;
                    if (promptObj.waterMark && type === 'image') {
                        fileToSend = await addWaterMark(url); // Watermark the image
                    }
                    const mediaResponse = await sendMedia(message, fileToSend, type, promptObj.waterMark);
                    if (!mediaResponse) sent = false;
                } catch (err) {
                    console.error('Error sending media:', err.message || err);
                }
            }

            for (const text of texts) {
                try {
                    const mediaResponse = await sendMessage(message, text);
                    if (!mediaResponse) sent = false;
                } catch (err) {
                    console.error('Error sending text:', err.message || err);
                }
            }
        } else {
            console.log(`No outputs to process for status: ${status}`);
        }
    };

    if (status === 'success') {
        task.status = 'success'
        const operationSuccess = await retryOperation(operation);
        //console.log('operationSuccess value after  retry operation',operationSuccess)
        //console.log('sent? ',sent);
        return operationSuccess && sent ? 'success' : 'not sent';
    } else if (status === 'failed'){
      return 'failed';  
    } else {
        if (status === undefined || status === 'undefined') {
            task.status = 'thinking';
        } else {
            task.status = status;
        }
        return 'incomplete'; 
    }
}

async function sendMedia(message, fileToSend, type, waterMark) {
    if (type === 'image') {
        console.log('Sending photo:', fileToSend);
        const response = await sendPhoto(message, fileToSend);
        if (waterMark) {
            fs.unlinkSync(fileToSend); // Remove the temporary watermarked file
        }
        return response;
    } else if (type === 'gif') {
        console.log('Sending animation:', fileToSend);
        return await sendAnimation(message, fileToSend);
    } else if (type === 'video') {
        console.log('Sending video:', fileToSend);
        return await sendVideo(message, fileToSend);
    } else {
        console.error(`Unknown URL type for URL: ${fileToSend}`);
        return null;
    }
}


function extractType(url) {
    if (!url) {
        console.error('extractType: URL is undefined or null');
        return 'unknown';
    }
    const extension = url.split('.').pop().toLowerCase();
    switch (extension) {
        case 'jpg':
        case 'jpeg':
        case 'png':
            return 'image';
        case 'gif':
            return 'gif';
        case 'mp4':
        case 'avi':
        case 'mov':
            return 'video';
        default:
            return 'unknown';
    }
}

// Export variables and functions
module.exports = {
    processingRunIds,
    waiting,
    taskQueue,
    enqueueTask,
    sortTaskQueue,
    processWaitlist
    // Add other exports here if needed
};