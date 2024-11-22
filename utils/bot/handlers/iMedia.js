const { sendMessage, editMessage, setUserState, react, gated } = require('../../utils')
const { getPhotoUrl, lobby, STATES, flows, makeSeed } = require('../bot')
const { enqueueTask } = require('../queue')
const { getGroup } = require('./iGroup')
const { buildPromptObjFromWorkflow } = require('./iMake')
const Jimp = require('jimp');

const iMake = require('./iMake')

async function handleMs2ImgFile(message, imageUrl = null, prompt = null) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    // Scenario 1: /ms2 command by itself, ask for an image
    if (!message.photo && !message.document && !message.text && !message.reply_to_message) {
        setUserState(message, STATES.IMG2IMG);
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
                // Scenario 3: /ms2 command with an image and a caption (prompt), send for generation
                message.text = targetMessage.caption;
                await iMake.handleMs2Prompt(message);
                return;
            } else {
                // Scenario 2 and 4: Ask for a prompt after processing the image
                await editMessage({
                    text: `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`,
                    chat_id: sent.chat.id,
                    message_id: sent.message_id
                });
                setUserState(message, STATES.MS2PROMPT);
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

async function handleFluxImgFile(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    // Scenario 1: /ms2 command by itself, ask for an image
    if (!message.photo && !message.document && !message.text && !message.reply_to_message) {
        setUserState(message, STATES.FLUX2IMG);
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
                // Scenario 3: /ms2 command with an image and a caption (prompt), send for generation
                message.text = targetMessage.caption;
                await iMake.handleFluxPrompt(message);
                return;
            } else {
                // Scenario 2 and 4: Ask for a prompt after processing the image
                await editMessage({
                    text: `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`,
                    chat_id: sent.chat.id,
                    message_id: sent.message_id
                });
                setUserState(message, STATES.FLUXPROMPT);
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