const { sendMessage, editMessage, setUserState, react, gated,chargeGated,cleanPrompt } = require('../../utils')
const { getPhotoUrl, lobby, workspace, STATES, flows, makeSeed } = require('../bot')
const { enqueueTask } = require('../queue')
const { getGroup } = require('./iGroup')
const { buildPromptObjFromWorkflow } = require('./iMake')
const Jimp = require('jimp');
const fs = require('fs')
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const iMake = require('./iMake')

async function handleTRIPO(message) {
    console.log('Starting handleTRIPO function');
    const userId = message.from.id;
    console.log('User ID:', userId);
    
    // Check if user has enough qoints
    console.log('Checking qoints balance:', lobby[userId]?.qoints);
    if (!lobby[userId]?.qoints || lobby[userId].qoints < 50) {
        console.log('Insufficient qoints, gating user');
        await chargeGated(message);
        return;
    }

    let imageFile = null;

    // Get image URL from reply or direct message
    console.log('Attempting to get photo URL');
    imageFile = await getPhotoUrl(message.reply_to_message || message);
    console.log('Image file URL:', imageFile);

    // If no image is found, prompt user and set state
    if (!imageFile) {
        console.log('No image found, prompting user');
        await sendMessage(message, "Please send me an image to convert to 3D model.");
        setUserState(message, STATES.TRIPO);
        return;
    }

    try {
        // Download the image
        console.log('Starting image download process');
        const tmpDir = path.join(__dirname, '../../../tmp');
        
        // Ensure tmp directory exists
        await fs.promises.mkdir(tmpDir, { recursive: true });
        
        const localPath = path.join(tmpDir, `${userId}_${Date.now()}.jpg`);
        console.log('Local path for image:', localPath);
        
        console.log('Fetching image');
        const response = await fetch(imageFile);
        console.log('Converting to buffer');
        const buffer = await response.buffer();
        console.log('Writing file to disk');
        await fs.promises.writeFile(localPath, buffer);
        
        // Create task object
        const promptObj = {
            userId,
            balance: lobby[userId].balance,
            username: message.from.first_name,
            type: 'TRIPO',
            imageFile: localPath,
            status: 'uploading',
            timeRequested: Date.now()
        };
        

        // Create task
        console.log('Creating task object');
        const task = {
            message,
            promptObj,
            timestamp: Date.now(),
            status: 'thinking'
        };
        console.log('Task created:', task);

        // Enqueue the task
        console.log('Enqueueing task');
        await react(message, "🏆");
        enqueueTask(task);

        // Set user state back to IDLE
        console.log('Setting user state back to IDLE');
        setUserState(message, STATES.IDLE);

    } catch (error) {
        console.error('Error in handleTRIPO:', error);
        await sendMessage(message, "Sorry, there was an error processing your image. Please try again.");
        setUserState(message, STATES.IDLE);
    }
}

async function handleMs2ImgFile(message, imageUrl = null, prompt = null) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    // Get workspace entry
    const workspaceEntry = workspace[userId] || {};

    // Determine the target message (current or reply)
    const targetMessage = message.reply_to_message || message;

    // Get image URL (if not provided)
    imageUrl = imageUrl || await getPhotoUrl(targetMessage) || workspaceEntry.imageUrl;

    // If no image is found, prompt the user
    if (!imageUrl) {
        console.log('handle ms2img no image')
        setUserState(message, STATES.IMG2IMG);
        const sent = await sendMessage(message, 'Please provide a photo to proceed.');
        workspace[userId].message = sent;
        return;
    }

    // Extract prompt (from message text, workspace, or caption)
    prompt = prompt || cleanPrompt(message.text || message.caption || workspaceEntry.prompt || '');

    // Process the image
    try {
        const photo = await Jimp.read(imageUrl);
        const { width, height } = photo.bitmap;

        const photoStats = { width, height };
        const thisSeed = makeSeed(userId);

        // Update user settings and workspace
        Object.assign(lobby[userId], {
            lastSeed: thisSeed,
            tempSize: photoStats,
            input_image: imageUrl,
        });
        Object.assign(workspace[userId], {
            imageUrl,
            prompt,
        });

        if (prompt.trim()) {
            console.log('handle ms2img wit da prompt')
            // If both prompt and image are available, proceed to handleTask
            return await iMake.handleTask(message, 'I2I', STATES.IMG2IMG, true, null);
        } else {
            console.log('handle ms2img wit no prompt')
            // If prompt is missing, set state and ask for it
            const sent = await sendMessage(message, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);
            setUserState(message, STATES.MS2PROMPT);
            workspace[userId].message = sent;
        }
    } catch (error) {
        console.error("Error processing photo:", error);
        await sendMessage(message, "An error occurred while processing the photo. Please try again.");
    }
}


async function handleFluxImgFile(message, imageUrl = null, prompt = null) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    // Get workspace entry
    const workspaceEntry = workspace[userId] || {};

    // Determine the target message (current or reply)
    const targetMessage = message.reply_to_message || message;

    // Get image URL (if not provided)
    imageUrl = imageUrl || await getPhotoUrl(targetMessage) || workspaceEntry.imageUrl;

    // If no image is found, prompt the user
    if (!imageUrl) {
        console.log('handle flux img no image');
        setUserState(message, STATES.IMG2IMG);
        const sent = await sendMessage(message, 'Please provide a photo to proceed.');
        workspace[userId].message = sent;
        return;
    }

    // Extract prompt (from message text, workspace, or caption)
    prompt = prompt || cleanPrompt(message.text || message.caption || workspaceEntry.prompt || '');

    // Process the image
    try {
        const photo = await Jimp.read(imageUrl);
        const { width, height } = photo.bitmap;

        const photoStats = { width, height };
        const thisSeed = makeSeed(userId);

        // Update user settings and workspace
        Object.assign(lobby[userId], {
            lastSeed: thisSeed,
            tempSize: photoStats,
            input_image: imageUrl,
        });
        Object.assign(workspace[userId], {
            imageUrl,
            prompt,
        });

        if (prompt.trim()) {
            console.log('handle flux img wit da prompt');
            // If both prompt and image are available, proceed to handleTask
            return await iMake.handleTask(message, 'I2I', STATES.IMG2IMG, true, null);
        } else {
            console.log('handle flux img wit no prompt');
            // If prompt is missing, set state and ask for it
            const sent = await sendMessage(message, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);
            setUserState(message, STATES.MAKEPROMPT);
            workspace[userId].message = sent;
        }
    } catch (error) {
        console.error("Error processing photo:", error);
        await sendMessage(message, "An error occurred while processing the photo. Please try again.");
    }
}

async function handleSD3ImgFile(message, imageUrl = null, prompt = null) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    // Get workspace entry
    const workspaceEntry = workspace[userId] || {};

    // Determine the target message (current or reply)
    const targetMessage = message.reply_to_message || message;

    // Get image URL (if not provided)
    imageUrl = imageUrl || await getPhotoUrl(targetMessage) || workspaceEntry.imageUrl;

    // If no image is found, prompt the user
    if (!imageUrl) {
        console.log('handle sd3 img no image');
        setUserState(message, STATES.SD32IMG);
        const sent = await sendMessage(message, 'Please provide a photo to proceed.');
        workspace[userId].message = sent;
        return;
    }

    // Extract prompt (from message text, workspace, or caption)
    prompt = prompt || cleanPrompt(message.text || message.caption || workspaceEntry.prompt || '');

    // Process the image
    try {
        const photo = await Jimp.read(imageUrl);
        const { width, height } = photo.bitmap;

        const photoStats = { width, height };
        const thisSeed = makeSeed(userId);

        // Update user settings and workspace
        Object.assign(lobby[userId], {
            lastSeed: thisSeed,
            tempSize: photoStats,
            input_image: imageUrl,
        });
        Object.assign(workspace[userId], {
            imageUrl,
            prompt,
        });

        if (prompt.trim()) {
            console.log('handle sd3 img wit da prompt');
            // If both prompt and image are available, proceed to handleTask
            setUserState(message, STATES.SD32IMG);
            return await iMake.handleTask(message, 'I2I_3', STATES.SD32IMG, true, null);
        } else {
            console.log('handle sd3 img wit no prompt');
            // If prompt is missing, set state and ask for it
            const sent = await sendMessage(message, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);
            setUserState(message, STATES.SD32IMGPROMPT);
            workspace[userId].message = sent;
        }
    } catch (error) {
        console.error("Error processing photo:", error);
        await sendMessage(message, "An error occurred while processing the photo. Please try again.");
    }
}
function checkAndSetType(type, settings, message, group, userId) {
    console.log('Initial type:', type);

    // Early return if token gate fails
    if ((settings.controlNet || settings.styleTransfer || settings.openPose) &&
        tokenGate(group, userId, message)) {
        console.log('Token gate triggered for additional settings.');
        return null; // Return null to indicate the task cannot proceed
    }

    // Build suffix based on active flags
    const suffixes = [];
    if (settings.controlNet) suffixes.push('CANNY');
    if (settings.styleTransfer) suffixes.push('STYLE');
    if (settings.openPose) suffixes.push('POSE');

    // Append suffixes to type
    const finalType = suffixes.length > 0 ? `${type}_${suffixes.join('_')}` : type;

    console.log('Final type:', finalType);
    return finalType;
}


function tokenGate(group, userId, message) {
    if(!group && lobby[userId] && lobby[userId].balance < 400000) {
        gated(message)
        return true
    }
    if(group && group.applied < 400000){
        gated(message)
        return true
    }
}

async function handleInpaint(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    // Scenario 1: /inpaint command by itself, ask for an image
    if (!message.photo && !message.document && !message.text && !message.reply_to_message) {
        setUserState(message, STATES.INPAINT);
        await sendMessage(message, 'Please provide a photo to proceed.');
        return;
    }

    // Scenarios where an image or document is present
    const targetMessage = message.reply_to_message || message;
    if (targetMessage.photo || targetMessage.document) {
        const sent = await sendMessage(message, 'okay lemme see...');
        const fileUrl = await getPhotoUrl(targetMessage);

        try {
            const photo = await Jimp.read(fileUrl);
            const { width, height } = photo.bitmap;

            const photoStats = {
                width: width,
                height: height
            };

            const thisSeed = makeSeed(userId);

            lobby[userId] = {
                ...lobby[userId],
                lastSeed: thisSeed,
                tempSize: photoStats,
                input_image: fileUrl
            };

            // Always ask for prompt after processing image
            await editMessage({
                text: `The dimensions of the photo are ${width}x${height}. Describe what part of the photo you want to replace.`,
                chat_id: sent.chat.id,
                message_id: sent.message_id
            });
            setUserState(message, STATES.INPAINTTARGET);
            
            // Scenario 2 and 4: Ask for a prompt after processing the image
            await editMessage({
                text: `The dimensions of the photo are ${width}x${height}. Describe what part of the photo you want to replace.`,
                chat_id: sent.chat.id,
                message_id: sent.message_id
            });
            setUserState(message, STATES.INPAINTTARGET);
            return true;
            
        } catch (error) {
            console.error("Error processing photo:", error);
            await editMessage({
                text: "An error occurred while processing the photo. Please send it again, or another photo.",
                chat_id: sent.chat.id,
                message_id: sent.message_id
            });
            return false;
        }
    }
}


async function handleInterrogation(message) {
    await react(message,"👀")
    const photoUrl = await getPhotoUrl(message);
    try {
        const promptObj = {
            ...lobby[message.from.id],
            input_image: photoUrl,
            type: 'INTERROGATE'
        }
        //enqueueTask({message,promptObj})
        //const{time,result} = await interrogateImage(message, photoUrl);
        console.log('ehhhh')
        enqueueTask({message, promptObj})
        //sendMessage(message, result)
        setUserState(message,STATES.IDLE);
        return true
    } catch(err){
        console.log(err);
        return false
    }
}
async function handleImageTask(message, user = null, taskType, defaultState, needsTypeCheck = false, minTokenAmount = null) {
    console.log(`HANDLING IMAGE TASK: ${taskType}`);

    const chatId = message.chat.id;
    const userId = user || message.from.id;
    const group = getGroup(message);

    // Unified settings: get group settings or user settings from lobby
    const settings = group ? group.settings : lobby[userId];
    //console.log('settings', settings, userId, user);

    // Token gate check if minTokenAmount is provided
    if (minTokenAmount && tokenGate(group, userId, message, minTokenAmount)) {
        console.log(`Token gate failed for task ${taskType}, user lacks sufficient tokens.`);
        react(message, '👎');
        return;
    }

    // Optional: State check to ensure the user is in the correct state
    if (!group && settings.state.state !== STATES.IDLE && settings.state.state !== defaultState) {
        console.log('Invalid state for task.');
        return;
    }

    // Attempt to find the image URL
    let fileUrl;
    const workspaceImage = workspace[userId]?.imageUrl;

    if (message.photo || message.document) {
        fileUrl = await getPhotoUrl(message);
    } else if (message.reply_to_message) {
        const replyMessage = message.reply_to_message;
        if (replyMessage.photo || replyMessage.document) {
            fileUrl = await getPhotoUrl(replyMessage);
        }
    }

    if (!fileUrl && workspaceImage) {
        console.log('Using image from workspace.');
        fileUrl = workspaceImage;
    }

    if (!fileUrl) {
        console.log('No image or document provided for task.');
        await sendMessage(message, "Please provide an image for processing.");
        return;
    }

    const thisSeed = makeSeed(userId);

    // Determine type based on SDXL and flags
    let finalType = taskType;
    // if () {
    //     // finalType += '_PLUS';
    // }

    // Append control, style, and pose flags to the type
    if (settings.createSwitch === 'QUICKMAKE' && 
        (taskType == 'I2I' || taskType == 'I2I_AUTO') &&
        (settings.controlNet || settings.styleTransfer || settings.openPose)) {
        finalType += '_PLUS';
    }

    console.log('Derived finalType:', finalType);

    // Update user settings in the lobby
    Object.assign(lobby[userId], {
        input_image: fileUrl,  // Set the image file URL
        type: finalType,       // Use the modified type
        lastSeed: thisSeed,
    });

    // Prevent batch requests in group chats
    const batch = chatId < 0 ? 1 : settings.batchMax;

    // Use the workflow reader to dynamically build the promptObj
    const workflow = flows.find(flow => flow.name === finalType);
    const promptObj = buildPromptObjFromWorkflow(workflow, {
        ...settings,
        input_image: fileUrl,  // Set the image URL in the promptObj
        input_seed: thisSeed,
        input_batch: batch,
    }, message);
    
    try {
        await react(message);  // Acknowledge the command
        if (workspace[userId]?.message && ['create', 'effect', 'utils'].includes(workspace[userId]?.context)) {
            const sent = workspace[userId].message;
            await editMessage({ reply_markup: null, chat_id: sent.chat.id, message_id: sent.message_id, text: '🌟' });
        }
        enqueueTask({ message, promptObj });
        setUserState(message, STATES.IDLE);
    } catch (error) {
        console.error(`Error generating and sending task for ${taskType}:`, error);
    }
}



async function handleUpscale(message, user = null) {
    await handleImageTask(message, user, 'UPSCALE', STATES.UPSCALE, false, null);
}

async function handleRmbg(message, user = null) {
    await handleImageTask(message, user, 'RMBG', STATES.RMBG, false, null);
}

async function handlePfpImgFile(message, user = null) {
    await handleImageTask(message, user, 'I2I_AUTO', STATES.PFP, true, 400000)
}

async function handleMs3ImgFile(message, user = null) {
    await handleImageTask(message, user, 'MS3', STATES.MS3, false, 600000);
}

async function handleMs3V2ImgFile(message, user = null) {
    await handleImageTask(message, user, 'MS3.2', STATES.MS3V2, false, 600000);
}

async function handleMs3V3ImgFile(message, user = null) {
    await handleImageTask(message, user, 'MS3.3', STATES.MS3V3,  false, 600000)
}

module.exports = 
{
    handleImageTask, handleTRIPO,
    handleMs2ImgFile,
    handleSD3ImgFile,
    handleFluxImgFile,
    handlePfpImgFile,
    handleRmbg,
    handleUpscale,
    handleMs3ImgFile,
    handleMs3V2ImgFile, handleMs3V3ImgFile,
    handleInpaint,
    handleInterrogation
}