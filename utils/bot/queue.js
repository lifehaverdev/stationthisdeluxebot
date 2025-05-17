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
const { startViduGeneration, pollViduUntilSuccess } = require('../../commands/vidu');
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
    } else if (promptObj.type === 'VIDU_I2V') {
        run_id = await startViduGeneration(promptObj);   // just get the task_id
        if (run_id) pollViduUntilSuccess(run_id, processWaitlist); // run in background
    } else if (promptObj.type === 'VIDU_UPSCALE') {
        run_id = await startViduUpscale(promptObj);
        if (run_id) pollViduUntilSuccess(run_id, processWaitlist);
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
        console.log(`⭐️${message.from.first_name} asked for ${JSON.stringify(run_id)}`);
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
            if (task.processed && !task.deliveryFail) {
                console.log(`Task ${run_id} has already been processed successfully, skipping`);
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
                const username = task.promptObj?.username || 'UnknownUser'; // Safe access
                console.log(`👍 ${username} ${run_id}`);
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
        
        //console.log('Accumulated outputs:', JSON.stringify(task.allOutputs, null, 2));
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

    // tags and texts will be populated by the result of 'operation'
    // let tags = []; // No longer needed here
    // let texts = []; // No longer needed here

    console.log('Starting handleTaskCompletion for run_id:', task.run_id);

    const operation = async () => {
        // Initialize urls, tags, texts within operation's scope
        let urls = [];
        let tags = [];
        let texts = [];
        let operationSent = true; // Track 'sent' status within the operation

        if (promptObj.isCookMode) {
            // ... (existing cook mode logic)
            // Ensure cook mode logic also sets operationSent appropriately
            // and potentially returns urls/tags/texts if relevant for saving
            if (run?.outputs && run.outputs.length > 0) {
                run.outputs.forEach(output => {
                    ["images", "gifs", "videos"].forEach(type => {
                        if (output.data?.[type]?.length > 0) {
                            output.data[type].forEach(dataItem => {
                                const url = dataItem.url;
                                const fileType = extractType(url);
                                urls.push({ type: fileType, url });
                            });
                        }
                    });
                });
            }
            operationSent = await handleCookModeCompletion(urls, task);
            // For cook mode, tags/texts might not be standard, adjust if needed
            return { urls, tags, texts, operationSent };
        }

        if (promptObj.type === 'TRIPO' && run?.outputs) {
            // ... (existing TRIPO logic)
            // Ensure TRIPO logic sets operationSent
            // and populates urls, tags, texts as appropriate
            // operationSent = ...
            return { urls, tags, texts, operationSent };
        } else if (promptObj.type === 'VIDU_I2V' && run?.outputs?.[0]?.url) {
            const videoUrl = run.outputs[0].url;
            const type = 'video'; // Vidu outputs are videos
            console.log(`Processing VIDU_I2V - URL: ${videoUrl}`);
            urls.push({ type, url: videoUrl }); // Populate urls for saving

            try {
                // We don't apply watermark to Vidu videos by default, modify if needed
                const mediaResponse = await sendMedia(message, videoUrl, type, promptObj);
                if (!mediaResponse) {
                    console.error('VIDU media send failed');
                    operationSent = false;
                }
            } catch (err) {
                console.error('Error in VIDU media send:', err);
                operationSent = false;
            }
            // tags and texts are not typically generated by Vidu, keep them empty or handle if necessary
            return { urls, tags, texts, operationSent };
        } else {
            if (run?.outputs && run.outputs.length > 0) {
                console.log(`Processing ${run.outputs.length} outputs for run_id:`, task.run_id);
                // Verbose log, can be commented out for normal operation
                // console.log('Full outputs:', JSON.stringify(run.outputs, null, 2));

                run.outputs.forEach(output => {
                    // Verbose log, can be commented out for normal operation
                    // console.log('Processing output:', JSON.stringify(output, null, 2));

                    if (output.data?.images?.length > 0) {
                        output.data.images.forEach(image => {
                            if (image.url) {
                                urls.push({ 
                                    type: extractType(image.url), 
                                    url: image.url 
                                });
                            }
                        });
                    }
                    
                    if (output.data?.files?.length > 0) {
                        output.data.files.forEach(file => {
                            if (file.url && file.format?.includes('video')) {
                                urls.push({
                                    type: 'video',
                                    url: file.url
                                });
                            }
                        });
                    }

                    if (output.data?.tags?.length > 0) {
                        console.log('Found tags in output:', JSON.stringify(output.data.tags, null, 2));
                        tags.push(...output.data.tags);
                    }
                    // Assuming 'texts' would be populated similarly if present in output.data
                    // if (output.data?.texts?.length > 0) {
                    //     texts.push(...output.data.texts);
                    // }
                });
                
                if (urls.length === 0 && tags.length === 0 && texts.length === 0) { // If nothing to send or record
                    console.log('No valid URLs, tags, or texts found to process');
                    // If there are no URLs, but there ARE tags/texts, we still want to proceed to save them.
                    // Only return 'not sent' if there's truly nothing.
                    // However, the 'sent' status refers to media.
                    // The saveGen should happen regardless if there are tags/text.
                    // Let's reconsider the meaning of 'sent'.
                    // For now, if no URLs, media sending part is skipped.
                }


                for (const { url, type } of urls) {
                    try {
                        let fileToSend = url;
                        if (shouldApplyWatermark(message, promptObj, type)) {
                            console.log('Applying watermark...');
                            fileToSend = await addWaterMark(url, promptObj.waterMark);
                        }
                        const mediaResponse = await sendMedia(message, fileToSend, type, promptObj);
                        if (!mediaResponse) {
                            console.error('Media send failed');
                            operationSent = false;
                            break; 
                        }
                    } catch (err) {
                        console.error('Error in media send loop:', err);
                        operationSent = false;
                        break;
                    }
                }

                // Send collected tags as messages
                if (operationSent) { // Only proceed if previous steps were successful
                    for (const tagString of tags) {
                        if (tagString && typeof tagString === 'string' && tagString.trim() !== "") {
                            try {
                                console.log(`Attempting to send tag string: "${tagString.trim()}"`);
                                const tagMessageResponse = await sendMessage(message, tagString.trim());
                                if (!tagMessageResponse) {
                                    console.error('Tag message send failed (sendMessage returned falsy)');
                                    operationSent = false;
                                    break; 
                                }
                            } catch (err) {
                                console.error('Error sending tag string via sendMessage:', err);
                                operationSent = false;
                                break;
                            }
                        }
                    }
                }
                
                // Texts sending loop (if needed) would go here, similar to tags
                // if (operationSent) {
                //    for (const textMsg of texts) { /* ... send ... */ }
                // }

            } else {
                console.log(`No outputs to process for run_id: ${task.run_id}, status: ${run.status}`);
                // operationSent might be considered false or true depending on expectation
            }
        }
        return { urls, tags, texts, operationSent }; // Return all collected data + status
    };

    if (run.status === 'success') {
        if (task.isAPI) {
            // ... (existing API logic)
            // Ensure API logic also considers tags/texts if they become relevant for API response
        }

        const operationResult = await operation();
        sent = operationResult.operationSent; // Update outer 'sent' based on operation's outcome

        console.log(`Task completion result - media sent: ${sent}`);
        
        // We save to DB regardless of 'sent' status for media if there are tags/texts or for record keeping.
        // The 'sent' status in DB might reflect 'mediaSent'.
        // The 'return "success"' or 'return "not sent"' from handleTaskCompletion
        // might depend on whether *any* part of the delivery (media or DB log) succeeded.

        await addPoints(task); // addPoints should be based on successful generation, not delivery

        const out = {
            urls: operationResult.urls.map(u => u.url), // Save an array of URL strings, or keep objects if type is needed
            tags: operationResult.tags,
            texts: operationResult.texts
        };
        
        if (lobby[task.promptObj.userId]?.progress?.currentStep) {
            const { TutorialManager, CHECKPOINTS } = require('./handlers/iStart');
            await TutorialManager.checkpointReached(task.promptObj.userId, CHECKPOINTS.BOT_RESULT_SENT, { message });
        }

        // Create minimal objects for saving
        const minimalTaskForSave = {
            message: { chat: { id: task.message?.chat?.id } },
            promptObj: { 
                userId: task.promptObj?.userId, username: task.promptObj?.username, type: task.promptObj?.type,
                prompt: task.promptObj?.prompt, finalPrompt: task.promptObj?.finalPrompt, negative_prompt: task.promptObj?.negative_prompt,
                model: task.promptObj?.model, seed: task.promptObj?.seed, width: task.promptObj?.width, height: task.promptObj?.height,
                steps: task.promptObj?.steps, cfg_scale: task.promptObj?.cfg_scale, sampler: task.promptObj?.sampler,
                scheduler: task.promptObj?.scheduler, denoise: task.promptObj?.denoise, tiling: task.promptObj?.tiling,
                restore_faces: task.promptObj?.restore_faces, isRegen: task.promptObj?.isRegen, isApiRequest: task.promptObj?.isApiRequest,
                isCookMode: task.promptObj?.isCookMode, forceLogo: task.promptObj?.forceLogo, advancedUser: task.promptObj?.advancedUser,
                dointsAdded: task.promptObj?.dointsAdded, waterMark: task.promptObj?.waterMark, lastSeed: task.promptObj?.lastSeed,
                collectionId: task.promptObj?.collectionId, enable_hr: task.promptObj?.enable_hr, hr_scale: task.promptObj?.hr_scale,
                hr_upscaler: task.promptObj?.hr_upscaler, hr_second_pass_steps: task.promptObj?.hr_second_pass_steps,
                hr_resize_x: task.promptObj?.hr_resize_x, hr_resize_y: task.promptObj?.hr_resize_y, hr_denoise: task.promptObj?.hr_denoise,
                styles: task.promptObj?.styles, override_settings_restore_afterwards: task.promptObj?.override_settings_restore_afterwards,
                controlnet_units: task.promptObj?.controlnet_units, loras: task.promptObj?.loras 
            },
            runningStop: task.runningStop, runningStart: task.runningStart
        };
        const minimalRunForSave = {
            run_id: run?.run_id,
            outputs: operationResult.urls, // Pass the urls from operationResult (which are {type, url} objects)
                                          // or run?.outputs if that's preferred and sanitized in saveGen
            status: run?.status
        };
            
        await userStats.saveGen({ task: minimalTaskForSave, run: minimalRunForSave, out });
        
        // The final return status of handleTaskCompletion might need adjustment.
        // If media sending failed but DB save was ok (e.g. tags were processed), is it "not sent" or "success"?
        // For now, keeping it based on the 'sent' variable which tracks media.
        if (sent) {
            return 'success';
        } else {
            // If no URLs were present to begin with, but tags/text were processed,
            // this could still be considered a form of success.
            // Current logic: if 'sent' is false (due to media send failure or no URLs to send), it's "not sent".
             if (operationResult.urls.length === 0 && (operationResult.tags.length > 0 || operationResult.texts.length > 0)) {
                // No media to send, but tags/text were processed and will be saved. Consider this success for DB.
                console.log("No media sent, but tags/texts processed. Considering successful for DB save.");
                return 'success'; // Or a new status like 'processed_metadata'
            }
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