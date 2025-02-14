const { taskQueue, waiting, successors, lobby, workspace, failures, getGroup } = require('../bot/bot');
const { generate } = require('../../commands/make')
const studioDB = require('../../db/models/studio');
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
//const { saveGen } = require('../../db/mongodb');
const { generateTripo } = require('../../commands/tripo');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const { UserStats } = require('../../db/index');
const userStats = new UserStats();
const GlobalStatusDB = require('../../db/models/globalStatus');
const globalStatusData = new GlobalStatusDB();
const { AnalyticsEvents, EVENT_TYPES } = require('../../db/models/analyticsEvents');
const analytics = new AnalyticsEvents();
const collectionCook = require('./handlers/collectionmode/collectionCook');
collectionCook.setEnqueueTask(enqueueTask);
//
// LOBBY AND QUEUE
//

function capUserRequests(userId, message) {
    let cap = false;
    // Count how many tasks are in the queue from the same user
    const count = taskQueue.filter(t => t.promptObj.userId === userId).length;
    //console.log('task message in enqueue',task.message)
    // Check if the user has already 5 tasks in the queue
    if (count >= 3) {
        console.log(`Task not enqueued. User ${task.message.from.first_name} has reached the maximum task limit.`);
        react(message, "😭");
        cap = true; // Exit the function without enqueuing the new task
    }
    return cap;
}

function handleEnqueueRegen(task) {
    // Check if this is a regeneration task by looking for a `isRegen` flag in the promptObj
    if(!lobby.hasOwnProperty(task.promptObj.userId)){
        return
    }
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
    } else {
        task.promptObj.prompt = task.promptObj.finalPrompt
    }
}

async function enqueueTask(task) {
    //console.log('task in enqueueTask',task)
    // Retrieve user ID from the task message
    const userId = task.promptObj.userId;
    
    //make sure we dont let anyone spam too hard
    if(capUserRequests(userId,task.message)) return
    //make sure we are handling user runs key value
    //console.log(task)
    handleEnqueueRegen(task)
    
    // Track queue entry
    await analytics.trackQueueEvent(task, 'enqueued');
    
    // Update doints for the user
    // Giving these placeholder doints makes it so that you can't spam requests without instant cost
    if (lobby[userId]) {
        const dointsToAdd = task.promptObj.type === 'MS3.3' ? 1000 : 100;
        lobby[userId].doints = (lobby[userId].doints || 0) + dointsToAdd;
        // adding this to promptObj makes sure we take them off when it is deliver
        task.promptObj.dointsAdded = dointsToAdd;
    }

    // Add the task to the queue, which is waiting to be request
    taskQueue.push(task);
    task.timestamp = Date.now();
    task.status = 'thinking';

    // If queue was empty, start processing tasks
    if (taskQueue.length === 1) {
        processQueue();
    }

    if(workspace[userId]){
        delete workspace[userId]
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
}

//makes request for the task and updates waiting array
async function waitlist(task){
    const { message, promptObj } = task;

    let run_id;
    if (promptObj.type === 'TRIPO') {
        run_id = await generateTripo(promptObj,processWaitlist);
    } else {
        run_id = await generate(promptObj);
    }

    if(run_id != -1 && run_id != undefined){
        task = {
            ...task,
            run_id: run_id,
            timestamp: Date.now(),
        };
        waiting.push(task);
        console.log(`⭐️${message.from.first_name} asked for ${run_id}`);
    } else {
        console.log('no run id',promptObj);
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
    for (let i = successors.length - 1; i>=0; i--) {
        if ((now - successors[i].timestamp) > TEN_MINUTES) {
            successors.splice(i, 1); // Remove stale tasks
        }
    }
}

function statusRouter(task, taskIndex, status) {
    switch(status) {
        case 'success':
            task.runningStop = Date.now()
            successors.push(task)
            waiting.splice(taskIndex, 1)
            break;
        case 'running':
        case 'in_progress':  // Common websocket status
        case 'processing':   // Common websocket status
            task.status = 'running';  // Normalize status
            if (!task.runningStart) {
                task.runningStart = Date.now()
            }
            break;
        case 'failed':
        case 'error':        // Common websocket error status
            task.status = 'failed';
            waiting.splice(taskIndex, 1)
            removeDoints(task);
            break;
        case 'timeout':
        case 'cancelled':
            if(task.retrying && task.retrying > 2){
                console.log('thats it for you dude. its over. dont try again');
                return
            } else if (task.retrying) {
                task.retrying += 1;
            } else {
                task.retrying = 1;
            }
            enqueueTask(task)
            waiting.splice(taskIndex, 1);
            break;
        case undefined:
        case null:
        case 'undefined':
            task.status = 'thinking..'
            break;
        default:
            // Handle intermediate websocket statuses (like "25% complete")
            if (typeof status === 'string' && status.includes('%')) {
                task.status = 'running';
                task.progress = status;
            } else {
                task.status = status;
            }
            break;
    }
}
async function deliver() {
    if (successors.length === 0) return;
    //console.log('❤️')
        const task = successors[0];
        successors.shift()

        const run_id = task.run_id;
        
        try {
                    // Check if task has already been processed
            if (task.processed) {
                console.log(`Task ${run_id} has already been processed, skipping`);
                return;
            }
            
            let result;
            
            if(!task.backOff ||(task.backOff && task.backOff > Date.now())){
                result = await handleTaskCompletion(task);
                task.processed = true;
            } else {
                successors.push(task)
                return
            }
            
            if (result === 'success') {
                console.log(`👍 ${task.promptObj.username} ${run_id}`);
            } else if (result === 'not sent') {
                handleDeliveryFailure(task, run_id);
            }
        } catch (err) {
            console.error('Exception in deliver:', err);
            handleDeliveryFailure(task, run_id);
        } 
}


function handleDeliveryFailure(task, run_id) {
    console.error(`Failed to send task with run_id ${run_id}`);
    task.deliveryFail = (task.deliveryFail || 0) + 1;
    
    if (task.deliveryFail > 2) {
        console.log(`Exceeded retry attempts for task: ${run_id}. Moving to failures.`);
        failures.push(task);
        sendMessage(task.message, 'i... i failed you.');
        return;
    }
    
    const now = Date.now();
    task.backOff = now + task.deliveryFail * task.deliveryFail * 2000;
    console.log(`Retrying task ${run_id} after backoff: ${task.backOff - now}ms`);
    successors.push(task);
}

async function processWaitlist(status, run_id, outputs) {
    removeStaleTasks();

    try {
        console.log(`Processing waitlist update - Status: ${status}, Run ID: ${run_id}`);
        
        const taskIndex = waiting.findIndex(task => task.run_id === run_id);
        if (taskIndex === -1) {
            console.log(`Task not found for run_id: ${run_id}`);
            return;
        }

        const task = waiting[taskIndex];
        
        // Merge new outputs with existing ones
        if (!task.allOutputs) task.allOutputs = [];
        if (outputs && outputs.length > 0) {
            task.allOutputs = [...task.allOutputs, ...outputs];
        }

        // Skip if we've already processed this exact status
        if (task.lastProcessedStatus === status) {
            console.log(`Status ${status} already processed for run_id ${run_id}, skipping`);
            return;
        }
        
        task.lastProcessedStatus = status;
        task.status = status;

        await analytics.trackGeneration(task, { run_id }, status);

        // Create run object with accumulated outputs
        const run = { 
            status, 
            run_id, 
            outputs: task.allOutputs 
        };
        
        console.log('Accumulated outputs:', JSON.stringify(task.allOutputs, null, 2));
        task.final = run;

        // Handle webhook notifications if needed
        if (task.isApiRequest && task.webhook_url) {
            try {
                let webhookPayload = {
                    run_id,
                    status: status,
                    timestamp: Date.now()
                };
    
                // Add status-specific information
                switch(status) {
                    case 'success':
                        webhookPayload.outputs = run.outputs;
                        webhookPayload.completion_time = Date.now() - task.runningStart;
                        break;
                    
                    case 'running':
                    case 'in_progress':
                    case 'processing':
                        webhookPayload.status = 'running';  // Normalize status
                        if (!task.runningStart) {
                            webhookPayload.started_at = Date.now();
                        }
                        break;
                    
                    case 'failed':
                    case 'error':
                        webhookPayload.status = 'failed';
                        webhookPayload.error = 'Generation failed';
                        break;
                    
                    case 'timeout':
                    case 'cancelled':
                        webhookPayload.status = status;
                        webhookPayload.retry_count = task.retrying || 0;
                        break;
                    
                    default:
                        // Handle progress updates
                        if (typeof status === 'string' && status.includes('%')) {
                            webhookPayload.status = 'running';
                            webhookPayload.progress = status;
                        }
                }
    
                await fetch(task.webhook_url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(webhookPayload)
                });
    
            } catch (webhookError) {
                console.error(`Failed to send webhook update to ${task.webhook_url}:`, webhookError);
            }
        }

        statusRouter(task, taskIndex, status);
        console.log('Status routing complete');

    } catch (err) {
        await analytics.trackError(err, { 
            function: 'processWaitlist',
            run_id,
            status 
        });
        console.error('Exception in processWaitlist:', err);
    } 
    processQueue();
}
function shouldApplyWatermark(message, promptObj, type) {
    // Safely get group
    const group = getGroup(message);
    // Log each watermark condition check
    // console.log('Watermark conditions:');
    // console.log('- Force logo:', promptObj.forceLogo);
    // console.log('- User balance:', promptObj.balance, 'needs 200000');
    // console.log('- Group exists:', !!group);
    // console.log('- Group qoints:', group?.qoints);
    // console.log('- Points accounting:', group?.gateKeeping?.pointAccounting);
    // console.log('- Content type:', type);

    // 1. Force logo check is always first
    if (promptObj.forceLogo) return true;

    // 2. Always false if not an image
    if (type !== 'image') return false;

    // 3. Check both conditions - only apply watermark if BOTH fail
    const userBalanceFails = !promptObj.balance || promptObj.balance < 200000;
    const groupFails = !group || !group.qoints || group.gateKeeping?.pointAccounting === 'ghost';

    return userBalanceFails && groupFails;
}

async function handleTaskCompletion(task) {
    const { message, promptObj } = task;
    const run = task.final;
    let sent = true;

    console.log('Starting handleTaskCompletion for run_id:', task.run_id);
    console.log('Full run object:', JSON.stringify(run, null, 2));

    // New helper function to handle cook mode completions
    async function handleCookModeCompletion(urls, task) {
        console.log('handleCookModeCompletion received:', {
            urlsType: typeof urls,
            urlsIsArray: Array.isArray(urls),
            urlsLength: urls?.length,
            urlsSample: urls?.[0],
            taskPromptObj: task?.promptObj,
            taskCollectionId: task?.promptObj?.collectionId
        });
        stu = new studioDB();
        try {
                    // Ensure urls is in the correct format
        const formattedUrls = Array.isArray(urls) ? urls : [{ url: urls, type: 'png' }];
        
        console.log('Formatted URLs:', formattedUrls);

            // 1. Save to studio
            const { success, studioDoc, error } = await stu.saveGenerationResult(urls, task);
            
            if (!success) {
                throw error || new Error('Failed to save generation result');
            }

            return true;
        } catch (error) {
            console.error('Error handling cook mode completion:', error);
            return false;
        }
    }

    

    const operation = async () => {
        // If this is a cook mode task, handle differently
        if (promptObj.isCookMode) {
            let urls = [];
            
            // Extract URLs from run outputs (similar to existing logic)
            if (run?.outputs && run.outputs.length > 0) {
                run.outputs.forEach(outputItem => {
                    ["images", "gifs", "videos"].forEach(type => {
                        if (outputItem.data?.[type]?.length > 0) {
                            outputItem.data[type].forEach(dataItem => {
                                const url = dataItem.url;
                                const fileType = extractType(url);
                                urls.push({ type: fileType, url });
                            });
                        }
                    });
                });
            }

            sent = await handleCookModeCompletion(urls, task);
            return;
        }
        // Special handling for Tripo tasks
        if (promptObj.type === 'TRIPO' && run?.outputs) {
            try {
                const tmpDir = path.join(__dirname, '../../tmp');
                
                for (const output of run.outputs) {
                    if (!output.url) continue;

                    const fileExtension = output.type === 'model' ? '.glb' : '.webp';
                    const localPath = path.join(tmpDir, `${task.promptObj.username}_${Date.now()}${fileExtension}`);
                    
                    console.log(`Downloading ${output.type} to ${localPath}`);
                    
                    try {
                        const response = await fetch(output.url);
                        if (!response.ok) throw new Error(`Failed to fetch ${output.type}`);
                        
                        const buffer = await response.buffer();
                        await fs.promises.writeFile(localPath, buffer);
                        
                        // Send the file based on its type
                        if (output.type === 'model') {
                            console.log('Sending model file:', localPath);
                            const modelResponse = await sendDocument(message, localPath);
                            if (!modelResponse) sent = false;
                        } else if (output.type === 'preview') {
                            console.log('Sending preview image:', localPath);
                            const previewResponse = await sendPhoto(message, localPath);
                            if (!previewResponse) sent = false;
                        }
                        
                        // Clean up the temporary file
                        await fs.promises.unlink(localPath);
                    } catch (err) {
                        console.error(`Error processing ${output.type}:`, err);
                        sent = false;
                    }
                }
            } catch (err) {
                console.error('Error sending Tripo media:', err.message || err);
                console.error('Full error object:', err);
                sent = false;
            }
        } else {
            // Existing handling for other types of tasks
            const possibleTypes = ["images", "gifs", "videos", "text", "tags"];
            let urls = [];
            let texts = [];
            let tags = [];

            // If outputs are present, process them
            if (run?.outputs && run.outputs.length > 0) {
                console.log(`Processing ${run.outputs.length} outputs for run_id:`, task.run_id);
                
                // Process all outputs, not just SaveImage
                run.outputs.forEach(output => {
                    if (output.data?.images?.length > 0) {
                        console.log(`Found images in output:`, JSON.stringify(output.data.images, null, 2));
                        output.data.images.forEach(image => {
                            if (image.url) {
                                urls.push({ 
                                    type: extractType(image.url), 
                                    url: image.url 
                                });
                            }
                        });
                    }
                });

                console.log('Processed URLs:', urls);
                
                if (urls.length === 0) {
                    console.log('No valid URLs found to process');
                    return 'not sent';
                }

                for (const { url, type } of urls) {
                    try {
                        console.log(`Attempting to send ${type} from URL:`, url);
                        let fileToSend = url;
                        
                        if (shouldApplyWatermark(message, promptObj, type)) {
                            console.log('Applying watermark...');
                            fileToSend = await addWaterMark(url, promptObj.waterMark);
                        }
                        
                        console.log('Calling sendMedia...');
                        const mediaResponse = await sendMedia(message, fileToSend, type, promptObj);
                        console.log('sendMedia returned:', mediaResponse);
                        
                        if (!mediaResponse) {
                            console.error('Media send failed');
                            sent = false;
                            break; // Exit the loop on first failure
                        }
                    } catch (err) {
                        console.error('Error in media send loop:', err);
                        sent = false;
                        break;
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
                console.log(`No outputs to process for run_id: ${task.run_id}, status: ${run.status}`);
            }
        }
    };

    if (run.status === 'success') {
        if (task.isAPI) {
            const apiResult = await handleApiCompletion(task);
            
            // If this is an awaited request, store the formatted result
            if (task.awaitedRequest) {
                task.final = apiResult;
            } else {
                // Otherwise, send webhook if URL is provided
                if (task.webhook_url) {
                    try {
                        await fetch(task.webhook_url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(apiResult)
                        });
                    } catch (webhookError) {
                        console.error(`Failed to send webhook update to ${task.webhook_url}:`, webhookError);
                    }
                }
            }
            return 'success';
        }
        await operation();
        console.log(`Task completion result - sent: ${sent}`);
        if (sent) {
            await addPoints(task);
            const out = {
                urls: run.outputs || [],
                tags: [],
                texts: []
            };
            if (lobby[task.promptObj.userId]?.progress?.currentStep) {  // This checks if user is in tutorial
                const { TutorialManager, CHECKPOINTS } = require('./handlers/iStart')
                await TutorialManager.checkpointReached(task.promptObj.userId, CHECKPOINTS.BOT_RESULT_SENT, { message });
            }
            await userStats.saveGen({task, run, out});
            return 'success';
        } else {
            console.error(`Failed to send media for run_id: ${task.run_id}`);
            return 'not sent';
        }
    } else {
        if (run.status === undefined || run.status === 'undefined') {
            task.status = 'thinking';
        }
        return 'incomplete';
    }
}

async function handleApiCompletion(task) {
    const run = task.final;
    let results = {
        created: Math.floor(Date.now() / 1000), // Convert to seconds
        data: []
    };

    // If outputs are present, process them
    if (run?.outputs && run.outputs.length > 0) {
        run.outputs.forEach(output => {
            if (output.data?.images) {
                output.data.images.forEach(image => {
                    results.data.push({
                        url: image.url
                    });
                });
            }
        });

        // Still track stats and add points
        await addPoints(task);
        const out = {
            urls: run.outputs || [],
            tags: [],
            texts: []
        };
        await userStats.saveGen({task, run, out});
    }

    return results;
}

function removeDoints(task) {
    const userId = task.promptObj.userId;
    if (lobby[userId]) {
        lobby[userId].doints -= (task.promptObj.dointsAdded || 0);
        console.log(`Removed doints for incomplete task for user: ${userId}`);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Track both recent sends and processed URLs
const recentSends = new Map();
const processedUrls = new Map();

async function sendMedia(message, fileToSend, type, promptObj) {
    // Check if we've already processed this URL recently
    if (processedUrls.has(fileToSend)) {
        console.log(`Already processed URL: ${fileToSend}`);
        return true;
    }

    // Add a unique key for this specific media send
    const sendKey = `${message.chat.id}_${fileToSend}_${Date.now()}`;
    
    if (recentSends.has(sendKey)) {
        console.log(`Preventing duplicate send for ${sendKey}`);
        return true;
    }

    // Track this send with an expiration timestamp
    recentSends.set(sendKey, Date.now() + 5000);
    processedUrls.set(fileToSend, Date.now() + 5000);
    
    // Clean up old entries
    for (const [key, timestamp] of recentSends.entries()) {
        if (timestamp < Date.now()) {
            recentSends.delete(key);
        }
    }
    for (const [url, timestamp] of processedUrls.entries()) {
        if (timestamp < Date.now()) {
            processedUrls.delete(url);
        }
    }

    let options = {};
    let sendResult = false;

    try {
        if (type === 'image') {
            if(promptObj.type == 'RMBG' || promptObj.type == 'UPSCALE'){
                console.log('Sending as document:', fileToSend);
                sendResult = await sendDocument(message, fileToSend, options);
            } else {
                console.log('Sending as photo:', fileToSend);
                if(promptObj.advancedUser && message.chat.id > 0) {
                    options = {caption: promptObj.lastSeed};
                }
                sendResult = await sendPhoto(message, fileToSend, options);
            }
            console.log('Send result:', sendResult ? 'success' : 'failed');
            
            if (sendResult && shouldApplyWatermark(message, promptObj, type)) {
                fs.unlinkSync(fileToSend); // Remove the temporary watermarked file
            }
        } else if (type === 'gif') {
            console.log('Sending animation:', fileToSend);
            sendResult = await sendAnimation(message, fileToSend);
            console.log('Animation send result:', sendResult ? 'success' : 'failed');
        } else if (type === 'video') {
            console.log('Sending video:', fileToSend);
            sendResult = await sendVideo(message, fileToSend);
            console.log('Video send result:', sendResult ? 'success' : 'failed');
        } else {
            console.error(`Unknown URL type for URL: ${fileToSend}`);
            return false;
        }

        return sendResult;
    } catch (error) {
        console.error('Error in sendMedia:', error);
        return false;
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
    handleApiCompletion,
    //deliver
    // Add other exports here if needed
};