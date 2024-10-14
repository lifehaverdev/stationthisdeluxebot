
const { taskQueue, waiting, successors, lobby, failures } = require('../bot/bot');
const { generate } = require('../../commands/make')
const {
    sendMessage,
    sendPhoto,
    sendAnimation,
    sendVideo,
    sendDocument,
    react
    // safeExecute
} = require('../utils');
const { addPoints } = require('./points')
const { addWaterMark } = require('../../commands/waterMark')
const fs = require('fs');
const { saveGen } = require('../../db/mongodb');

//
// LOBBY AND QUEUE
//

function capUserRequests(userId, message) {
    let cap = false;
    // Count how many tasks are in the queue from the same user
    const count = taskQueue.filter(t => t.promptObj.userId === userId).length;
    //console.log('task message in enqueue',task.message)
    // Check if the user has already 5 tasks in the queue
    if (count >= 5) {
        console.log(`Task not enqueued. User ${task.message.from.first_name} has reached the maximum task limit.`);
        react(message, "😭");
        cap = true; // Exit the function without enqueuing the new task
    }
    return cap;
}
 
function handleEnqueueRegen(task) {
    // Check if this is a regeneration task by looking for a `isRegen` flag in the promptObj
    const isRegenTask = task.promptObj.isRegen || false;
    const userId = task.promptObj.userId
    // Add the promptObj to the user's runs array, pushing down other runs and removing the 5th if necessary
    if (!isRegenTask) {
        if (!lobby[userId].runs) {
            lobby[userId].runs = [task.promptObj];
        }
        // Insert the new run at the beginning of the runs array
        lobby[userId].runs.unshift(task.promptObj);
        // Keep the array at a max length of 5
        if (lobby[userId].runs.length > 5) {
            lobby[userId].runs.pop();
        }
    }
}

function enqueueTask(task) {
    //console.log('task in enqueueTask',task)
    // Retrieve user ID from the task message
    const userId = task.promptObj.userId;
    
    //make sure we dont let anyone spam too hard
    if(capUserRequests(userId,task.message)) return
    //make sure we are handling user runs key value
    handleEnqueueRegen(task)
    
    // Update doints for the user
    // Giving these placeholder doints makes it so that you can't spam requests without instant cost
    if (lobby[userId]) {
        lobby[userId].doints = (lobby[userId].doints || 0) + 100;
        // adding this to promptObj makes sure we take them off when it is deliver
        task.promptObj.dointsAdded = 100;
    }

    // Add the task to the queue, which is waiting to be request
    taskQueue.push(task);
    task.timestamp = Date.now();
    task.status = 'thinking';

    // If queue was empty, start processing tasks
    if (taskQueue.length === 1) {
        processQueue();
    }
}

//processQueue takes tasks that have been prepared for request and puts them into waitlist
async function processQueue() {
    const WAITLISTMAX = 10;
    if (taskQueue.length > 0 && waiting.length < WAITLISTMAX) {
        //console.log('we got a live one')
        const task = taskQueue[0];
        waitlist(task);
        
        const taskIndexToRemove = taskQueue.findIndex(t => t.timestamp === task.timestamp);

        // Check if the task still exists at the found index
        if (taskIndexToRemove !== -1 && taskQueue[taskIndexToRemove].timestamp === task.timestamp) {
            // Remove the task from the queue
            taskQueue.splice(taskIndexToRemove, 1);
            if(taskIndexToRemove != 0){
                console.log("THAT THING WHERE THE TASK YOU CALLED AT THE BEGINNING OF THE FUNCTION ISNT THE SAE INDEX IN THE TASK QUEUE ARRAY JUST HAPPENED AND ITS A GOOD THING YOU KEP THE FUNCTION AALL COMPLICATED THANKS DEV")
            }
        }
        processQueue(); // Continue processing next task
    } 
    // else {
    //     if(taskQueue.length == 0 && waiting.length == 0){
    //         //console.log('NO TASKQUEUE NO WAITING. we take deep breath... sigh');
    //     } else if (taskQueue.length == 0 && waiting.length > 0){
    //         //console.log('NO TASKQUQUE but waiting ... ',waiting.length)
    //     } else if (taskQueue.length > 0 && waiting.length > WAITLISTMAX) {
    //         //console.log('WAITLIST FULL, TAKE A NUMBER AND HAVE A SEAT ... ',taskQueue.length,' in line, ',waiting.length,' being served.')
    //     }
    //     //console.log('All queue processed , or waitlist full')
    //     //console.log('Waitlist',waiting.length);
    //     //console.log('Tasks',taskQueue.length);
    // }
}

//makes request for the task and updates waiting array
async function waitlist(task){
    const { message, promptObj } = task;

    let run_id;
    run_id = await generate(promptObj);

    if(run_id != -1 && run_id != undefined){
        task = {
            ...task,
            run_id: run_id,
            timestamp: Date.now(),
        };
        waiting.push(task);
        console.log(`⭐️${message.from.first_name} asked for ${run_id}`);
    } else {
        console.log('no run id');
        react(message,"😨")
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

const TEN_MINUTES = 10 * 60 * 1000;

function removeStaleTasks() {
    const now = Date.now();
    for (let i = waiting.length - 1; i >= 0; i--) {
        //console.log('what is waiting looking like',waiting[i])
        if ((now - waiting[i].timestamp) > TEN_MINUTES) {
            waiting.splice(i, 1); // Remove stale tasks
        }
    }
}

function statusRouter(task, taskIndex, status) {
    switch(status) {
        case 'success':
            //add success to success bucket take off waiting
            task.runningStop = Date.now()
            successors.push(task)
            waiting.splice(taskIndex, 1)
            break;
        case 'running':
            task.status = status;
            task.runningStart = Date.now()
            break;
        case 'failed':
        case 'timeout':
        case 'cancelled':
            //re-enqueue new task
            enqueueTask(task)
            waiting.splice(taskIndex, 1);
            break;
        case undefined:
        case null:
        case 'undefined':
            task.status = 'thinking..'
            break;
        default: 
            //update waiting array task status
            task.status = status;
            break;
    }
}

async function deliver() {
    //console.log('❤️')
    if(successors.length > 0){
        const task = successors[0];
        const run_id = task.run_id;
        successors.shift()
        try {
            // Handle sending the content to the user via handleTaskCompletion
            console.log('send to handleTaskCompletion')
            let result;
            if(task.backOff > Date.now()){
                result = await handleTaskCompletion(task);
            } else {
                successors.push(task)
                return
            }
            
            // Remove the corresponding task from the waiting array only if successfully processed
            if (result == 'success') {
                console.log(`👍 ${task.promptObj.username} ${run_id}`);
            } else if (result == 'not sent') {
                console.error(`Failed to send task with run_id ${run_id}, not removing from waiting array.`);
                if(task.deliveryFail > 0){
                    if(task.deliveryFail > 2){
                        failures.push(task)
                        sendMessage(task.message, 'i... i failed you.')
                        //successors.shift()
                        return
                    }
                    //increment deliverfail and send to back of send line
                    task.deliverFail += 1;
                } else {
                    task.deliveryFail = 1;
                }
                task.backOff = Date.now() + task.deliveryFail * task.deliveryFail * 2000
                successors.push(task)
            } 
        } catch (err) {
            console.error('Exception in deliver:', err);
        } 
    } 
}

async function processWaitlist(status, run_id, outputs) {

    removeStaleTasks();

    try {
        // Check the "waiting" task array for a matching ID
        const taskIndex = waiting.findIndex(task => task.run_id === run_id);

        if (taskIndex === -1) {
            console.error('Task with run_id not found in the waiting array.');
            return;
        }

        const task = waiting[taskIndex];
        task.status = status;
        const run = { status, run_id, outputs };
        task.final = run

        statusRouter(task,taskIndex,status)

    } catch (err) {
        console.error('Exception in processWaitlist:', err);
    } 
    processQueue();
}

async function handleTaskCompletion(task) {
    const { message, promptObj } = task;
    const run = task.final;
    const { status, outputs } = run;
    const possibleTypes = ["images", "gifs", "videos", "text", "tags"];
    let urls = [];
    let texts = [];
    let tags = [];
    let sent = true;

    const operation = async () => {
        
        // If outputs are present, process them
        if (outputs && outputs.length > 0) {
            //console.log("Outputs found:", outputs.length);
            outputs.forEach(outputItem => {
                possibleTypes.forEach(type => {
                    if (outputItem.data && outputItem.data[type] && outputItem.data[type].length > 0) {
                        if (type === 'text') {
                            texts = outputItem.data[type]; // Directly assign the text array
                        } else if (type === 'tags') {
                            tags = outputItem.data[type]; // Directly assign the text array
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
                    //console.log(promptObj.waterMark)
                    if ((promptObj.balance == '' || promptObj.balance < 200000 || promptObj.forceLogo) && type === 'image') {
                        promptObj.waterMark = 'mslogo'
                        fileToSend = await addWaterMark(url,promptObj.waterMark); // Watermark the image
                    }
                    const mediaResponse = await sendMedia(message, fileToSend, type, promptObj);
                    if (!mediaResponse) sent = false;
                } catch (err) {
                    console.error('Error sending media:', err.message || err);
                }
                if(urls.length>1){
                    await sleep(250);
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

            for (const text of tags) {
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
        await operation();
        if(sent){
            addPoints(task)
            const out = {
                urls: urls,
                tags: tags,
                texts: texts
            }
            saveGen({task,run,out})
            return 'success'
        } else {
            return 'not sent'
        }
        //return operationSuccess && sent ? 'success' : 'not sent';
    } else {
        if (status === undefined || status === 'undefined') {
            task.status = 'thinking';
        }
        return 'incomplete'; 
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

async function sendMedia(message, fileToSend, type, promptObj) {
    let options = {};
    if (type === 'image') {
        if(promptObj.type == 'RMBG' || promptObj.type == 'UPSCALE'){
            const response = await sendDocument(message, fileToSend, options);
            return response
        }
        console.log('Sending photo:', fileToSend);
        
        if(lobby[message.from.id].advancedUser && message.chat.id > 0) options = {caption: promptObj.lastSeed}
        const response = await sendPhoto(message, fileToSend, options);
        if (response && (promptObj.balance == '' || promptObj.balance < 200000 || promptObj.forceLogo)){
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

setInterval(deliver, 2000)

// Export variables and functions
module.exports = {
    processingRunIds,
    waiting,
    taskQueue,
    enqueueTask,
    processWaitlist,
    //deliver
    // Add other exports here if needed
};