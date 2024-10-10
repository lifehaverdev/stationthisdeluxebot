const { sendMessage, editMessage, setUserState, react, gated } = require('../../utils')
const { getPhotoUrl, lobby, STATES, flows, makeSeed } = require('../bot')
const { enqueueTask } = require('../queue')
const { getGroup } = require('./iGroup')
const Jimp = require('jimp');

// async function handleUpscale(message) {
//     if(!message.photo || message.document) {
//         return;
//     }
//     const sent = await sendMessage(message,'okay lemme see...');
//     chatId = message.chat.id;
//     const userId = message.from.id;

//     const fileUrl = await getPhotoUrl(message)
    
//     try {
//         lobby[userId] = {
//             ...lobby[userId],
//             type: 'UPSCALE',
//             fileUrl: fileUrl
//         }

//         await react(message);
//         const promptObj = {
//             ...lobby[userId]
//         }
//         enqueueTask({message,promptObj})
//         setUserState(message,STATES.IDLE);
//         return true;
//     } catch (error) {
//         console.error("Error processing photo:", error);
//         await editMessage(
//             {
//                 text: "An error occurred while processing the photo. Please send it again, or another photo.",
//                 chat_id: sent.chat.id,
//                 message_id: sent.message_id
//             }
//         );      
//         return false
//     }
// }

// async function handleRmbg(message) {
//     if(!message.photo || message.document) {
//         return;
//     }
//     const sent = await sendMessage(message,'okay lemme see...');
//     chatId = message.chat.id;
//     const userId = message.from.id;

//     const fileUrl = await getPhotoUrl(message)
    
//     try {
//         lobby[userId] = {
//             ...lobby[userId],
//             type: 'RMBG',
//             fileUrl: fileUrl
//         }

//         await react(message);
//         const promptObj = {
//             ...lobby[userId]
//         }
//         enqueueTask({message,promptObj})
//         setUserState(message,STATES.IDLE);
//         return true;
//     } catch (error) {
//         console.error("Error processing photo:", error);
//         await editMessage(
//             {
//                 text: "An error occurred while processing the photo. Please send it again, or another photo.",
//                 chat_id: sent.chat.id,
//                 message_id: sent.message_id
//             }
//         );      
//         return false
//     }
// }

async function handleMs2ImgFile(message) {
    if(!message.photo || message.document) {
        return;
    }
    const sent = await sendMessage(message,'okay lemme see...');
    chatId = message.chat.id;
    const userId = message.from.id;

    const fileUrl = await getPhotoUrl(message)
    
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
            fileUrl: fileUrl
        }
        //console.log(lobby[userId])

        await editMessage(
            {
                text: `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`,
                chat_id: sent.chat.id,
                message_id: sent.message_id
            }
        );        
        setUserState(message,STATES.MS2PROMPT);
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        await editMessage(
            {
                text: "An error occurred while processing the photo. Please send it again, or another photo.",
                chat_id: sent.chat.id,
                message_id: sent.message_id
            }
        );      
        return false
    }
}
// Helper function to build the prompt object dynamically based on the workflow
function buildPromptObjFromWorkflow(workflow, userContext, message) {
    const promptObj = {};
    
    // Always include type from userContext and add username from the message
    promptObj.type = userContext.type || workflow.name;
    promptObj.username = message.from.username || 'unknown_user';
    promptObj.balance = userContext.balance;
    promptObj.userId = userContext.userId;
    promptObj.photoStats = { height: 1024, width: 1024 };

    // Set required inputs based on the workflow type
    if (workflow.name.startsWith('I2I_AUTO')) {
        // Handle PFP workflows and their variations
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
        promptObj.photoStats.height = userContext.photoStats.height || 1024;
        promptObj.photoStats.width = userContext.photoStats.width || 1024;
        promptObj.fileUrl = userContext.fileUrl;

        // Handle optional suffixes (e.g., STYLE, CANNY, POSE)
        if (workflow.name.includes('STYLE')) {
            promptObj.styleFileUrl = userContext.styleFileUrl || userContext.fileUrl;
        }
        if (workflow.name.includes('CANNY')) {
            promptObj.cannyImageUrl = userContext.cannyImageUrl || userContext.fileUrl;
        }
        if (workflow.name.includes('POSE')) {
            promptObj.poseFileUrl = userContext.poseFileUrl || userContext.fileUrl;
        }

        promptObj.cfg = userContext.cfg || 7;
        promptObj.steps = userContext.steps || 50;
        promptObj.prompt = userContext.prompt || 'default PFP prompt';
        promptObj.negativePrompt = userContext.negativePrompt || '';
        promptObj.checkpoint = userContext.checkpoint;
        promptObj.strength = 1.0;
    } 
    else if (workflow.name.startsWith('I2I')) {
        // Handle I2I workflows and their variations
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
        promptObj.photoStats.height = userContext.photoStats.height || 1024;
        promptObj.photoStats.width = userContext.photoStats.width || 1024;
        promptObj.fileUrl = userContext.fileUrl;

        // Handle optional suffixes (e.g., STYLE, CANNY, POSE)
        if (workflow.name.includes('STYLE')) {
            promptObj.styleFileUrl = userContext.styleFileUrl || userContext.fileUrl;
        }
        if (workflow.name.includes('CANNY')) {
            promptObj.cannyImageUrl = userContext.cannyImageUrl || userContext.fileUrl;
        }
        if (workflow.name.includes('POSE')) {
            promptObj.poseFileUrl = userContext.poseFileUrl || userContext.fileUrl;
        }

        promptObj.cfg = userContext.cfg || 7;
        promptObj.steps = userContext.steps || 50;
        promptObj.prompt = userContext.prompt || 'default I2I prompt';
        promptObj.negativePrompt = userContext.negativePrompt || '';
        promptObj.checkpoint = userContext.checkpoint;
        promptObj.strength = 1.0;
    } 
    else if (workflow.name === 'RMBG') {
        // Handle RMBG workflow
        promptObj.fileUrl = userContext.fileUrl;
    }
    else if (workflow.name === 'UPSCALE') {
        // Handle UPSCALE workflow
        promptObj.fileUrl = userContext.fileUrl;
        promptObj.photoStats.width = userContext.photoStats.width || 1024;
        promptObj.photoStats.height = userContext.photoStats.height || 1024;
    }
    else if (workflow.name === 'MS3' || workflow.name === 'MS3.2') {
        // Handle MS3 and MS3.2 workflows
        promptObj.seed = userContext.lastSeed || makeSeed(message.from.id);
        promptObj.fileUrl = userContext.fileUrl;
        promptObj.photoStats = userContext.photoStats || { height: 1024, width: 1024 };
    }

    // Add additional common properties such as prompt, seed, and batchMax
    promptObj.prompt = userContext.prompt;
    promptObj.seed = userContext.lastSeed;
    promptObj.userBasePrompt = userContext.userBasePrompt;
    promptObj.userId = message.from.id;
    promptObj.timeRequested = Date.now();

    return promptObj;
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


// async function handlePfpImgFile(message) {
//     //sendMessage(message,'sorry this is broken rn');
//     if(!message.photo || message.document) {
//         return;
//     }
//     react(message,'🥰')
//     chatId = message.chat.id;
//     const userId = message.from.id;
//     const fileUrl = await getPhotoUrl(message);
//     const group = getGroup(message);
//     //const{time,result} = await interrogateImage(message, fileUrl);
//     let settings;
//     if(group) {
//         settings = group.settings
//     } else {
//         settings = lobby[userId]
//     }
//     settings.type = 'I2I_AUTO'
//     try {
//         const photo = await Jimp.read(fileUrl);
//         const { width, height } = photo.bitmap;

//         const photoStats = {
//             width: width,
//             height: height
//         };

//         const thisSeed = makeSeed(userId);
//         settings.type = checkAndSetType(settings,message, group, userId)

//         lobby[userId] = {
//             ...lobby[userId],
//             lastSeed: thisSeed,
//             tempSize: photoStats,
//             fileUrl: fileUrl
//         }
        
//         const promptObj = {
//             ...settings,
//             seed: thisSeed,
//             photoStats: photoStats,
//             fileUrl: fileUrl
//         }
//         //return await shakeMs2(message,promptObj);
//         enqueueTask({message,promptObj})
//         setUserState(message,STATES.IDLE);
//         return true
//     } catch (error) {
//         console.error("Error processing photo:", error);
//         sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
//         return false
//     }
// }

// async function handleMs3ImgFile(message) {
//     if(!message.photo || message.document) {
//         return;
//     }
//     chatId = message.chat.id;
//     userId = message.from.id;
//     const fileUrl = await getPhotoUrl(message);

//     const thisSeed = makeSeed(userId);
//     lobby[userId].lastSeed = thisSeed;

//     const promptObj = {
//         ...lobby[userId],
//         fileUrl: fileUrl,
//         seed: thisSeed,
//         type: 'MS3',
//     }
//     try {
//         //enqueueTask({message, promptObj})
//         enqueueTask({message,promptObj})
//         setUserState(message,STATES.IDLE);
//         sendMessage(message, `Okay dont hold your breath`);        
//         return true;
//     } catch (error) {
//         console.error("Error processing photo:", error);
//         sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
//         return false
//     }
// }

// async function handleMs3V2ImgFile(message) {
//     if(!message.photo || message.document) {
//         return;
//     }
//     chatId = message.chat.id;
//     userId = message.from.id;
//     const fileUrl = await getPhotoUrl(message);

//     const thisSeed = makeSeed(userId);
//     lobby[userId].lastSeed = thisSeed;
    
//     const promptObj = {
//         ...lobby[userId],
//         fileUrl: fileUrl,
//         seed: thisSeed,
//         type: 'MS3.2',
//     }
//     try {
//         //enqueueTask({message, promptObj})
//         enqueueTask({message,promptObj})
//         setUserState(message,STATES.IDLE);
//         sendMessage(message, `Okay dont hold your breath`);        
//         return true;
//     } catch (error) {
//         console.error("Error processing photo:", error);
//         sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
//         return false
//     }
// }

async function handleInpaint(message) {
    chatId = message.chat.id;
    const userId = message.from.id;
    const fileUrl = await getPhotoUrl(message)
    
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
            fileUrl: fileUrl
        }
        //console.log(lobby[userId])
        await sendMessage(message, `The dimensions of the photo are ${width}x${height}. Describe what part of the photo you want to replace.`);       
        //sendMessage(message,'Ok now go here: https://imagemasker.github.io/ put that same photo in there and draw white over the part you want to inpaint and black over everything else then post it back here') 
        setUserState(message,STATES.INPAINTTARGET);
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}

async function handleInterrogation(message) {
    sendMessage(message,'hmm what should i call this..');
    const photoUrl = await getPhotoUrl(message);
    try {
        const promptObj = {
            ...lobby[message.from.id],
            fileUrl: photoUrl,
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

    // Ensure there's a valid image in the message
    if (!message.photo && !message.document) {
        console.log('No image or document provided for task.');
        await sendMessage(message, "Please provide an image for processing.");
        return;
    }

    // Fetch the file URL from the message
    const fileUrl = await getPhotoUrl(message);
    if (!fileUrl) {
        console.log('Failed to retrieve the file URL.');
        await sendMessage(message, "An error occurred while retrieving the image. Please try again.");
        return;
    }

    const thisSeed = makeSeed(userId);

    // If this is a special case (e.g., MAKE) and needs a type check
    let finalType = taskType;
    console.log('finalyType before checkset',finalType)
    if (needsTypeCheck) {
        finalType = checkAndSetType(taskType, settings, message, group, userId);
        if (!finalType) {
            console.log('Task type could not be set due to missing files or settings.');
            return;
        }
    }

    // Update user settings in the lobby
    Object.assign(lobby[userId], {
        fileUrl: fileUrl,  // Set the image file URL
        type: finalType,   // Use the modified type
        lastSeed: thisSeed
    });

    // Prevent batch requests in group chats
    const batch = chatId < 0 ? 1 : settings.batchMax;

    // Use the workflow reader to dynamically build the promptObj based on the workflow's required inputs
    
    console.log('finaltype before finding workflow',finalType)
    const workflow = flows.find(flow => flow.name === finalType);
    const promptObj = buildPromptObjFromWorkflow(workflow, {
        ...settings,
        fileUrl: fileUrl,  // Set the image URL in the promptObj
        seed: thisSeed,
        batchMax: batch
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
    handlePfpImgFile,
    handleRmbg,
    handleUpscale,
    handleMs3ImgFile,
    handleMs3V2ImgFile,
    handleInpaint,
    handleInterrogation
}