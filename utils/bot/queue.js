
const { generate, fetchOutput } = require('../../commands/make')
const {
    sendMessage,
    sendPhoto,
    sendAnimation,
    sendVideo,
    // safeExecute
} = require('../utils');

let taskQueue = []
let waiting = []
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
    if (count >= 2) {
        console.log(`Task not enqueued. User ${task.message.from.first_name} has reached the maximum task limit.`);
        sendMessage(task.message,"You have 2 things in the queue rn, chill out. Try setting batch or something damn.")
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
    if (taskQueue.length > 0 && waiting.length < 3) {
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
        console.log('All queue processed , or waitlist full')
        console.log('Waitlist',waiting.length);
        console.log('Tasks',taskQueue.length);
    }
}

async function waitlist(task){
    const { message, promptObj } = task;
    let run_id;
    let checkback;
    switch (promptObj.type){
        case 'MS3':
            console.log('we make ms3 pls')
            if(promptObj.balance < 1000000){
                sendMessage(message,'you cant make a video if you dont have 1M LOL')
                return
            }
            run_id = await generate(promptObj);
            break;
        case 'MAKE':   
        case 'MS2':
            run_id = await generate(promptObj);
            break;
    }
    if(run_id != -1 && run_id != undefined){
        console.log('we have run id',run_id);
        const safeCheckBack = scheduleCheckback(checkback);
        task = {
            ...task,
            run_id: run_id,
            timestamp: Date.now(),
            checkback: safeCheckBack // default checkback time is 5000ms (5 seconds)
        };
        waiting.push(task);
        console.log(`Task enqueued for ${message.from.first_name}`);
        //setTimeout(()=>processWaitlist(task),safeCheckBack)
    } else {
        console.log('no run id');
        sendMessage(message,'ah it didnt take. send your prompt to dev')
    }
    
}

function scheduleCheckback(checkBack) {
    // Iterate through the tasks in the waitlist
    const now = Date.now();
    let currentTarget = now + checkBack;
    for (let i = 0; i < waiting.length; i++){
        const existingTarget = waiting[i].timestamp + waiting[i].checkback;
        if(currentTarget < existingTarget + 5000){currentTarget = existingTarget +5000}
    }
    // Schedule the next task processing after 5 seconds
    return currentTarget - now;
}

// Define a set to keep track of run_ids being processed
const processingRunIds = new Set();
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
            // url: error.request ? JSON.stringify(error.request) : '',
            // request: error.request.path? error.request.path : ''
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
// async function processWaitlist(task) {
//     const removeIndex = (run_id) => {
//         try{
//             // Find the index of the task in the waiting list
//             const index = waiting.findIndex(task => task.run_id === run_id);
    
//             // If the task is found, remove it from the waiting list
//             if (index !== -1) {
//                 waiting.splice(index, 1);
//                 console.log(`Task with ID ${run_id} removed from the waiting list.`);
//             } else {
//                 console.warn(`Task with ID ${run_id} not found in the waiting list.`);
//             }
//         } catch (error) {
//             console.error('Error removing task:', error);
//         }
//     }

//     const { run_id, timestamp, checkback } = task;

//     // Calculate the next scheduled check time
//     const nextCheckTime = timestamp + checkback;

//     // Calculate the delay until the next checkback
//     const delay = nextCheckTime - Date.now();

//     // Check if NOW is greater than nextCheckTime
//     if (Date.now() >= nextCheckTime) {
//         try {
//             // Check if the run_id is already being processed
//             if (!processingRunIds.has(run_id)) {
//                 // Add the run_id to the processing set before processing the task
//                 processingRunIds.add(run_id);

//                 // Check the status of the task using run_id
//                 let adjustedCheckback;
//                 const { progress, status, imgUrls } = await fetchOutput(run_id);
//                 adjustedCheckback = progress > 0.9 ? 5 * 1000 : task.checkback;

//                 if (status === 'success' && imgUrls) {
//                     // Task completed successfully, handle the output
//                     if(await handleTaskCompletion(task, { progress, status, imgUrls })){
//                         removeIndex(run_id);
//                     }
//                     processingRunIds.delete(run_id);
//                 } else if (status === 'failed' || status === 'timeout') {
//                     console.error('Task failed:', task.message);
//                     // Remove the failed task from waiting
//                     sendMessage(task.message,'Oh no it failed ):')
//                     removeIndex(run_id);
//                     processingRunIds.delete(run_id);
//                 } else {
//                     // Continue checking after the adjusted checkback time
//                     setTimeout(()=>processWaitlist(task), adjustedCheckback);
//                     processingRunIds.delete(run_id);
//                 }

//                 // Remove the run_id from the processing set after handling completion
                
//             } else {
//                 console.log(`Task with run_id ${run_id} is already being processed. Skipping.`);
//             }
//         } catch (error) {
//             console.error('Error fetching workflow status:', error);
//         }
//     } else {
//         // Set a timeout to come back and process the queue when the next checkback is due
//         //actually dont do that
//         //setTimeout(processWaitlist, delay);
//     }
//     processQueue();
// }

async function processWaitlist(status, run_id, outputs) {
    // Check the "waiting" task array for a matching ID
    
    const taskIndex = waiting.findIndex(task => task.run_id === run_id);
    
    if (taskIndex === -1) {
        console.error('Task with run_id not found in the waiting array.');
        return;
    }

    const task = waiting[taskIndex];
    const run = {
        status, run_id, outputs
    }
    // Handle sending the content to the user via handleTaskCompletion
    const response = await handleTaskCompletion(task, run);
    console.log(response)

    // Remove the corresponding task from the waiting array
    if(status == 'success'){
        waiting.splice(taskIndex, 1);
    }
    
    // Continue processing tasks
    processQueue();
}
// [
//     {
//         "id":"f944b0c4-52f1-4968-afff-f1e5d9302783",
//         "run_id":"626a641b-d64d-4e0b-86d7-5a114d76f72f",
//         "data":
//             {
//                 "images":
//                     [
//                         {
//                             "type":"output",
//                             "filename":"2024-05-25_101159_00001_.png",
//                             "subfolder":"",
//                             "url":"https://storage.comfydeploy.com/outputs/runs/626a641b-d64d-4e0b-86d7-5a114d76f72f/2024-05-25_101159_00001_.png"
//                         }
//                     ]
//             },
//         "created_at":"2024-05-28T20:51:15.294Z",
//         "updated_at":"2024-05-28T20:51:15.294Z"
//     }
// ]

async function handleTaskCompletion(task, run) {
    const { message } = task;
    const { status, outputs } = run;
    const possibleTypes = ["images", "gifs", "videos"];
    let urls = [];

    const operation = async () => {
        console.log("Outputs found:", outputs.length);
        outputs.forEach(outputItem => {
            possibleTypes.forEach(type => {
                if (outputItem.data && outputItem.data[type] && outputItem.data[type].length > 0) {
                    outputItem.data[type].forEach(dataItem => {
                        const url = dataItem.url;
                        const fileType = extractType(url);
                        urls.push({ type: fileType, url });
                        console.log(`${fileType.toUpperCase()} URL:`, url);
                    });
                }
            });
        });

        for (const { url, type } of urls) {
            if (type === 'image') {
                console.log('Message right before sending photo:', message);
                await sendPhoto(message, url);
            } else if (type === 'gif') {
                await sendAnimation(message, url);
            } else if (type === 'video') {
                await sendVideo(message, url);
            } else {
                console.error(`Unknown URL type for URL: ${url}`);
            }
        }
    };

    if (status === 'success') {
        return await retryOperation(operation); // Retry sending message/photo/video 3 times with a delay of 2 seconds between retries
    } else {
        task.status = status;
        //sendMessage(message, status);
    }
}
// Function to extract type from the URL or outputItem.type field
function extractType(url) {
    // Example logic to extract type from the URL or outputItem.type field
    const extension = url.split('.').pop().toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg' || extension === 'png') {
        return 'image';
    } else if (extension === 'gif') {
        return 'gif';
    } else if (extension === 'mp4' || extension === 'avi' || extension === 'mov') {
        return 'video';
    } else {
        // Default to 'unknown' type if extension is not recognized
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