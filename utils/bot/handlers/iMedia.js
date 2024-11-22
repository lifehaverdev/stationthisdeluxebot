const { sendMessage, editMessage, setUserState, react, gated, cleanPrompt } = require('../../utils')
const { getPhotoUrl, lobby, workspace, STATES, flows, makeSeed } = require('../bot')
const { enqueueTask } = require('../queue')
const { getGroup } = require('./iGroup')
const { buildPromptObjFromWorkflow } = require('./iMake')
const Jimp = require('jimp');

const iMake = require('./iMake')

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
        setUserState(message, STATES.FLUX2IMG);
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
            return await iMake.handleTask(message, 'FLUXI2I', STATES.FLUX2IMG, true, null);
        } else {
            console.log('handle flux img wit no prompt');
            // If prompt is missing, set state and ask for it
            const sent = await sendMessage(message, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);
            setUserState(message, STATES.FLUXPROMPT);
            workspace[userId].message = sent;
        }
    } catch (error) {
        console.error("Error processing photo:", error);
        await sendMessage(message, "An error occurred while processing the photo. Please try again.");
    }
}


function checkAndSetType(type, settings, message, group, userId) {
    // Early return for token gate if needed
    let typest = type;
    console.log('type',typest)
    // Dynamically build the type
    if (settings.controlNet) typest += '_CANNY';
    if (settings.styleTransfer) typest += '_STYLE';
    if (settings.openPose) typest += '_POSE';
    console.log('post triple condit typest',typest)
    if ((settings.controlNet || settings.styleTransfer || settings.openPose) && 
        tokenGate(group, userId, message)
    ) {console.log('triplecondit')
        return;}
    //settings.type = type;
    console.log(`Selected type: ${typest}`);
    return typest
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

            if (targetMessage.caption) {
                // Scenario 3: /inpaint command with an image and a caption containing delimiter
                const [prompt, target] = targetMessage.caption.split('|');
                if (prompt && target) {
                    message.text = prompt.trim();
                    await iMake.handleInpaintPrompt(message);
                    message.text = target.trim();
                    await iMake.handleInpaintTarget(message);
                    return;
                } else {
                    // If only one part is provided, treat it as the first prompt
                    message.text = targetMessage.caption;
                    await iMake.handleInpaintPrompt(message);
                    return;
                }
            } else {
                // Scenario 2 and 4: Ask for a prompt after processing the image
                await editMessage({
                    text: `The dimensions of the photo are ${width}x${height}. Describe what part of the photo you want to replace.`,
                    chat_id: sent.chat.id,
                    message_id: sent.message_id
                });
                setUserState(message, STATES.INPAINTTARGET);
                return true;
            }
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
    sendMessage(message,'hmm what should i call this..');
    const photoUrl = await getPhotoUrl(message);
    try {
        const promptObj = {
            ...lobby[message.from.id],
            input_image: photoUrl,
            type: 'INTERROGATE'
        }
        //enqueueTask({message,promptObj})
        //const{time,result} = await interrogateImage(message, photoUrl);
        enqueueTask({message, promptObj})
        //sendMessage(message, result)
        setUserState(message,STATES.IDLE);
        return true
    } catch(err){
        console.log(err);
        return false
    }
}

async function handleImageTask(message, taskType, defaultState, needsTypeCheck = false, minTokenAmount = null) {
    console.log(`HANDLING IMAGE TASK: ${taskType}`);

    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);

    // Unified settings: get group settings or user settings from lobby
    const settings = group ? group.settings : lobby[userId];

    // Token gate check if minTokenAmount is provided
    if (minTokenAmount && tokenGate(group, userId, message, minTokenAmount)) {
        console.log(`Token gate failed for task ${taskType}, user lacks sufficient tokens.`);
        react(message, '👎');
        return;
    }

    // Optional: State check to ensure the user is in the correct state
    if (!group && settings.state.state !== STATES.IDLE && settings.state.state !== defaultState) {
        return;
    }

    // Ensure there's a valid image in the message or in the replied message
    let imageMessage = message;
    if (!message.photo && !message.document) {
        // Check if the message is a reply and contains an image or document
        if (message.reply_to_message) {
            if (message.reply_to_message.photo) {
                imageMessage = message.reply_to_message;
            } else if (message.reply_to_message.document) {
                imageMessage = message.reply_to_message;
            }
        }

        // If neither the original message nor the replied message contains an image
        if (!imageMessage.photo && !imageMessage.document) {
            console.log('No image or document provided for task.');
            await sendMessage(message, "Please provide an image for processing.");
            return;
        }
    }

    // Fetch the file URL from the determined image message
    const fileUrl = await getPhotoUrl(imageMessage);
    if (!fileUrl) {
        console.log('Failed to retrieve the file URL.');
        await sendMessage(message, "An error occurred while retrieving the image. Please try again.");
        return;
    }

    const thisSeed = makeSeed(userId);

    // If this is a special case (e.g., MAKE) and needs a type check
    let finalType = taskType;
    console.log('finalyType before checkset', finalType);
    if (needsTypeCheck) {
        finalType = checkAndSetType(taskType, settings, message, group, userId);
        if (!finalType) {
            console.log('Task type could not be set due to missing files or settings.');
            return;
        }
    }

    // Update user settings in the lobby
    Object.assign(lobby[userId], {
        input_image: fileUrl,  // Set the image file URL
        type: finalType,   // Use the modified type
        lastSeed: thisSeed
    });

    // Prevent batch requests in group chats
    const batch = chatId < 0 ? 1 : settings.batchMax;

    // Use the workflow reader to dynamically build the promptObj based on the workflow's required inputs
    console.log('finaltype before finding workflow', finalType);
    const workflow = flows.find(flow => flow.name === finalType);
    const promptObj = buildPromptObjFromWorkflow(workflow, {
        ...settings,
        input_image: fileUrl,  // Set the image URL in the promptObj
        input_seed: thisSeed,
        input_batch: batch
    }, message);

    try {
        await react(message);  // Acknowledge the command
        enqueueTask({ message, promptObj });
        setUserState(message, STATES.IDLE);
    } catch (error) {
        console.error(`Error generating and sending task for ${taskType}:`, error);
    }
}

async function handleUpscale(message) {
    await handleImageTask(message, 'UPSCALE', STATES.UPSCALE, false, null);
}

async function handleRmbg(message) {
    await handleImageTask(message, 'RMBG', STATES.RMBG, false, null);
}

async function handlePfpImgFile(message) {
    await handleImageTask(message, 'I2I_AUTO', STATES.PFP, true, 400000)
}

async function handleMs3ImgFile(message) {
    await handleImageTask(message, 'MS3', STATES.MS3, false, 600000);
}

async function handleMs3V2ImgFile(message) {
    await handleImageTask(message, 'MS3.2', STATES.MS3V2, false, 600000);
}

module.exports = 
{
    handleImageTask,
    handleMs2ImgFile,
    handleFluxImgFile,
    handlePfpImgFile,
    handleRmbg,
    handleUpscale,
    handleMs3ImgFile,
    handleMs3V2ImgFile,
    handleInpaint,
    handleInterrogation
}