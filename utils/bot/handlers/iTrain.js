const { lobby, workspace, STATES, getPhotoUrl, getBotInstance } = require('../bot')
const { 
    sendMessage, 
    editMessage, 
    setUserState, 
    sendPhoto,
    react, 
    DEV_DMS
} = require('../../utils')
const { 
    createTraining, 
    loadLora, 
    writeUserDataPoint,
    deleteWorkspace,
    saveWorkspace,
    saveImageToGridFS, bucketPull,
    deleteImageFromWorkspace,
    writeQoints
 } = require('../../../db/mongodb')
 const fs = require('fs')
 const { checkIn } = require('../gatekeep')
/*
LORA DATASET CREATION / CURATION

0. handleTrain
callback handler, the menu for displaying user created loras
in accountsettings, user hits TRAIN button
if they have any loras (found in their user object under the loras array, consisting of hash strings that can be referred to in db)
display each lora in paginated menu along with the newSet button that creates dataset entry in database
*/
async function getMyLoras(userId) {
    //console.log('getting loras')
    let loraKeyboardOptions = [];
    //console.log(lobby[userId])
    if (lobby[userId]?.loras?.length > 0) {
        //console.log('made it in')
        for (const loraIdHash of lobby[userId].loras) {
            try {
                const loraInfo = await loadLora(loraIdHash);
                loraKeyboardOptions.push([{ text: `${loraInfo.name}`, callback_data: `el_${loraIdHash}` }]);
            } catch (error) {
                console.error(`Failed to load LoRa with ID ${loraIdHash}:`, error);
            }
        }
    }
    if (lobby[userId]?.loras?.length < 3) {
        loraKeyboardOptions.push([{ text: '➕', callback_data: 'newLora' }]);
    }
    return loraKeyboardOptions;
}

async function handleTrainingMenu(message, user) {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    try {
        const myLoras = await getMyLoras(user) || [];
        const replyMarkup = {
            inline_keyboard: [
                [{ text: '↖︎', callback_data: 'accountSettingsMenu' }],
                ...myLoras,
                [{ text: 'cancel', callback_data: 'cancel' }]
            ]
        };
        const txt = '🌟Stationthisbot LoRa Training 🚂🦾';
    await editMessage({
        reply_markup: replyMarkup,
        chat_id: chatId,
        message_id: messageId,
        text: txt,
    });
    } catch (error) {
        console.log('failed to handle training menu', error);
        sendMessage(DEV_DMS, `lora training menu handle fail ${error}`)
    }
    
}

/*
1. newLora viewLora
the handling for the callback in account menu , newSet
first need a name for the dataset, ask for that, 
callback -> setUserState(LORANAME) , sendMessage(hey what do you wanna call it)

handling for loraname state message recieved, 
create new lora db entry with a random hash id and the message.text name
add lora db hash to lobby[user].loras.push(hash) 
open dataset menu
*/

async function newLora(message) {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    //if(message.reply_to_message)
    setUserState(message.reply_to_message, STATES.LORANAME)
    editMessage({
        text: 'What is the name of the LoRa?',
        message_id: messageId,
        chat_id: chatId
    })
}

async function createLora(message) {
    const name = message.text;
    const userId = message.from.id
    const hashId = Math.floor(10000000000000 * Math.random())
    if(!lobby.hasOwnProperty(userId)){
        console.log('SUS someone is trying to make a lora but we are in create lora rn and they arent in the lobby')
        return
    }
    const userContext = lobby[userId]
    const thisLora = {
        loraId: hashId,
        name,
        userId,
        iter: '1.0',
        version: '',
        images: new Array(20).fill(''),
        captions: new Array(20).fill(''),
        initiated: Date.now(),
        status: 'incomplete'
    }
    userContext.loras.push(thisLora.loraId)
    if (!workspace.hasOwnProperty(userId)) {
        workspace[userId] = {};
    }
    workspace[userId][thisLora.loraId] = thisLora
    try {
        const success = await createTraining(thisLora)
        if(!success){
            await sendMessage(message, 'LoRa creation failed');
            return
        }
    } catch (err) {
        console.error('Error during LoRa creation:', error);
        await sendMessage(message, 'LoRa creation encountered an error.');
        return;
    }
    try {
        const userWriteSuccess = await writeUserDataPoint(parseInt(userId), 'loras',userContext.loras);
        if (!userWriteSuccess) {
            await sendMessage(message, 'Save settings failed, use /savesettings');
        }
    } catch (error) {
        console.error('Error writing user data:', error);
    }
   
    const { text, reply_markup } = await buildTrainingMenu(userId,hashId)
    sendMessage(message, text, { reply_markup })
    setUserState(message,STATES.IDLE)
}

/*
2. removeLora
handles callback from datasetmenu
delete database entry, remove from userLoras list
*/
async function removeTraining(user, loraId) {
    if (!lobby[user]) {
        console.log(`User ${user} not found in lobby, checking in.`);
        await checkIn({ from: { id: user }, chat: { id: user } });
    }

    // Safely update the user's loras array
    if (lobby[user]?.loras) {
        lobby[user].loras = lobby[user].loras.filter(lora => lora !== loraId);
    } else {
        console.log(`User ${user} has no loras to remove.`);
    }

    // Remove the LoRa from the workspace
    if (workspace[user][loraId]) {
        delete workspace[user][loraId];
        console.log(`Workspace entry for LoRA ${loraId} removed.`);
    }

    // Delete the LoRa data from the database and associated files
    await deleteWorkspace(loraId);
}


/*

3. datasetmenu
displays a paginated menu with a button representing each image&accompanying textfile in the set
if there is an image in the slot, use portrait emoji
if no image is in teh slot, use 📥
if theres a user written txtfile (prompt) add a 🔖

text on top of the menu message displays: loraStatus, completion percentage / strnegth , name , triggerWord(s)

*/
async function trainMenu(message, user, loraId) {
    const messageId = message.message_id;
    const chatId = message.chat.id;

    try {
        const { text, reply_markup } = await buildTrainingMenu(user,loraId);
        if (!text || !reply_markup) {
            console.error(`Failed to build training menu for LoRa ${loraId}`);
            return;
        }

        await editMessage({
            reply_markup,
            text,
            chat_id: chatId,
            message_id: messageId
        });

        // Set user state explicitly
        setUserState({ ...message, from: { id: user } }, STATES.IDLE);
    } catch (error) {
        console.error(`Error in trainMenu for user ${user} and LoRa ${loraId}:`, error);
    }
}
function unlockWorkspace(userId, loraId) {
    if (workspace[userId] && workspace[userId][loraId] && workspace[userId][loraId].locked) {
        console.log(`[unlockWorkspace] Unlocking workspace for LoRA ${loraId} for user ${userId}`);
        workspace[userId][loraId].locked = false;
    } else {
        console.warn(`[unlockWorkspace] Workspace for LoRA ${loraId} is not locked or does not exist.`);
    }
}
async function buildTrainingMenu(userId,loraId) {
    try {
        const COMPLETION_THRESHOLD = 50; // Threshold for enabling submission
        const ROWS = 5; // Number of rows in the slot grid
        const COLS = 4; // Number of columns in the slot grid

        let loraData = await getOrLoadLora(userId,loraId)

        const { name, status, images = [], captions = [], submitted } = loraData;

        let menuText = `${name}\nSTATUS: ${status}`;
        if (submitted) {
            const timeSinceSubmitted = Math.floor((Date.now() - submitted) / 1000);
            menuText += `\nSubmitted: ${timeSinceSubmitted} seconds ago`;
        }

        const inlineKeyboard = [];
        inlineKeyboard.push([{ text: '↖︎', callback_data: 'trainingMenu' }]);

        if (!submitted) {
            let completedCount = 0;

            for (let row = 0; row < ROWS; row++) {
                const rowButtons = [];
                for (let col = 0; col < COLS; col++) {
                    const slotId = row * COLS + col;
                    let buttonText = '📥';
                    if (images[slotId]) {
                        buttonText = captions[slotId] ? '✅' : '🖼️';
                        completedCount++;
                    }
                    rowButtons.push({ text: buttonText, callback_data: `et_${loraId}_${slotId}` });
                }
                inlineKeyboard.push(rowButtons);
            }

            const completionPercentage = (completedCount / images.length) * 100;
            inlineKeyboard.push([{ text: '🗑️', callback_data: `rml_${loraId}` }]);

            if (completionPercentage >= COMPLETION_THRESHOLD) {
                inlineKeyboard.push([{ text: 'Submit', callback_data: `st_${loraId}` }]);
            }
        }
        unlockWorkspace(userId, loraId)
        return {
            text: menuText,
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        };
    } catch (error) {
        console.error("Error building training menu:", error);
        return null;
    }
}

async function trainSlot(message, user, loraId, slotId) {
    const userId = user;
    const messageId = message.message_id;
    const chatId = message.chat.id;

    try {
        let loraData = await getOrLoadLora(user,loraId);

        // Check if the slot contains an image
        if (!Array.isArray(loraData.images) || !loraData.images[slotId]) {
            // Prompt the user to upload photos
            await editMessage({
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '↖︎', callback_data: `el_${loraId}` }]
                    ]
                },
                chat_id: chatId,
                message_id: messageId,
                text: `Send in photo(s) here for training your ${loraData.name} LoRa. We can accept up to 5 files or photos at once.`
            });

            // Clean up the workspace
            try {
                focusWorkspace(loraId, userId);
                console.log(`Focused workspace for user ${userId} and LoRA ${loraId}`);
            } catch (error) {
                console.error(`Error in focusWorkspace:`, error);
            }

            // Initialize the `tool` property in the workspace
            workspace[user][loraId] = workspace[user][loraId] || {};
            workspace[user][loraId].workingMessage = messageId
            workspace[user][loraId].tool = slotId;

            // Update user state
            setUserState({...message, 'from': {'id': userId}}, STATES.ADDLORAIMAGE);
            console.log(`User ${userId} state updated to ADDLORAIMAGE for slot ${slotId}`);
        } else {
            // Build and display the slot menu
            const { text, reply_markup } = await buildSlotMenu(userId, loraId, slotId);
            await editMessage({
                text,
                reply_markup,
                chat_id: chatId,
                message_id: messageId,
            });
        }
    } catch (error) {
        console.error(`Error in trainSlot for user ${userId}, LoRA ${loraId}, slot ${slotId}:`, error);
    }
}

/*

4. slotEdit
callback for having clicked a slot in the datasetmenu,
if its an empty slot, user is just prompted for an image , setUserState(LORASLOTIMG)
if its a full slot, 
    create submenu with back button that goes back to datasetmenu
    button that allows you to see the image, where it references what is stored in the dataset, a telegram url for the file, send to the user
    if the image link is broken, it will redisplay the button to broken emoji 
    button that allows you to add your own caption, sendMessage(caption this image for your dataset, make sure to include the triggerword(s)), setUserState(LORASLOTTXT)
    button that erases the entry, it kicks you back out to the datsetmenu

*/

async function buildSlotMenu(userId, loraId, slotId) {
    try {
        let loraData = await getOrLoadLora(userId,loraId);
        if (!loraData) {
            console.error(`LoRA data not found for userId ${userId} and LoRA ${loraId}`);
            return {
                text: 'LoRA data is unavailable. Please try again later.',
                reply_markup: { inline_keyboard: [[{ text: '↖︎', callback_data: `el_${loraId}` }]] }
            };
        }
        const { images = [], captions =[] } = loraData;
        const hasImage = !!images[slotId];
        const hasCaption = !!captions[slotId];

        // Create the inline keyboard for the slot menu
        const inlineKeyboard = [];

        // Add the back button
        inlineKeyboard.push([{ text: '↖︎', callback_data: `el_${loraId}` }]);

        // Add the view image button if an image exists
        if (hasImage) {
            inlineKeyboard.push([{ text: '🖼️👀', callback_data: `vsi_${loraId}_${slotId}` }]);
        }

        // Add the caption button
        if (hasImage && hasCaption) {
            inlineKeyboard.push([{ text: '📃👀', callback_data: `vst_${loraId}_${slotId}` }]);
        } else {
            inlineKeyboard.push([{ text: '✍️', callback_data: `est_${loraId}_${slotId}` }]);
        }

        inlineKeyboard.push([{ text: '🗑️', callback_data: `rms_${loraId}_${slotId}` }])

        // Return the slot menu
        return {
            text: `${loraData.name} ${slotId}`,
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        };
    } catch (error) {
        console.error("Error building slot menu:", error);
        return {
            text: 'An error occurred while building the menu. Please try again later.',
            reply_markup: { inline_keyboard: [[{ text: '↖︎', callback_data: `el_${loraId}` }]] }
        };
    }
}
async function viewSlotImage(message, user, loraId, slotId) {
    try {
        const loraData = await getOrLoadLora(user, loraId);
        const fileId = loraData.images[slotId];

        if (!fileId) {
            await sendMessage(message.reply_to_message, 'No image found in this slot.');
            return;
        }

        const tempFilePath = await bucketPull(user, loraId, slotId);
        if (!tempFilePath) {
            await sendMessage(message.reply_to_message, 'Failed to retrieve the image. Please try again later.');
            return;
        }

        delete message.message_id;
        await sendPhoto(message, tempFilePath, {
            caption: `Slot ${slotId}`,
            reply_markup: {
                inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]],
            },
        });

        await fs.promises.unlink(tempFilePath);
    } catch (error) {
        console.error('Error while sending image:', error);
        await sendMessage(message, 'Failed to retrieve the image. Please try again later.');
    }
}

async function viewSlotCaption(message, user, loraId, slotId) {
    try {
        const loraData = await getOrLoadLora(user, loraId);
        const caption = loraData.captions[slotId];

        if (!caption) {
            await sendMessage(message.reply_to_message, 'No caption found in this slot.');
            return;
        }

        await sendMessage(message, caption, {
            reply_markup: {
                inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]],
            },
        });
    } catch (error) {
        console.error('Error while sending caption:', error);
        await sendMessage(message, 'Failed to retrieve the caption. Please try again later.');
    }
}

async function deleteLoraSlot(message, user, loraId, slotId) {
    try {
        // Delete the image from the workspace
        await deleteImageFromWorkspace(loraId, slotId);

        // Reload LoRA data to ensure synchronization
        await getOrLoadLora(user, loraId);

        // Clear the slot data in the workspace
        if (workspace[user]?.[loraId]) {
            workspace[user][loraId].images[slotId] = '';
            workspace[user][loraId].captions[slotId] = '';
            console.log(`Cleared slot ${slotId} for LoRA ${loraId} in user ${user}'s workspace.`);
        }

        // Delete the slot menu message
        const bot = getBotInstance();
        await bot.deleteMessage(message.chat.id, message.message_id);

        // Refresh and display the training menu
        const { text, reply_markup } = await buildTrainingMenu(user, loraId);
        await sendMessage(message, text, { reply_markup });
    } catch (error) {
        console.error('Error while deleting slot:', error);
        await sendMessage(message, 'Failed to delete the slot. Please try again later.');
    }
}


/*

5. handleSlotEdit
handler for LORASLOTIMG and LORASLOTTXT, saves whatever to the lora db entry for the slot

*/

function releaseWorkspaceLock(userId, loraId, instanceId) {
    if (workspace[userId][loraId].locked === instanceId) {
        workspace[userId][loraId].locked = false;
    } else {
        console.warn(`Instance ${instanceId} attempted to release lock for LoRA ${loraId}, but did not own the lock.`);
    }
}
async function saveAndReact(userId, loraId, messages, instanceId) {
    console.log('[saveAndReact] Messages:', JSON.stringify(messages, null, 2)); // Debugging messages structure
    const isSaved = await saveWorkspace(workspace[userId][loraId]);
    if (isSaved) {
        console.log(`LoRA ${loraId} successfully saved by instance ${instanceId}`);
        for (const message in messages) {
            await react(messages[message], '👍');
        }
    } else {
        sendMessage(messages[0], 'Ah... wait. Something messed up. Try again.');
    }
    // Delete and re-send the prompting message
    console.log('old working message id',workspace[userId][loraId].workingMessage)
    const bot = getBotInstance();
    try{
        await bot.deleteMessage(messages[messages.length-1].chat.id, workspace[userId][loraId].workingMessage);
    } catch (err) {
        console.log('unable to delete the message')
    }
    console.log('we delete old working message no?')
    const { text, reply_markup } = await buildTrainingMenu(userId,loraId);
    const newWorkingMessage = await sendMessage(messages[messages.length-1], text, { reply_markup });
    workspace[userId][loraId].workingMessage = newWorkingMessage.message_id
    console.log('new working message id',workspace[userId][loraId].workingMessage)
    // Keep user in ADDLORAIMAGE state
    setUserState(messages[messages.length-1], STATES.ADDLORAIMAGE);
}
async function assignToSlot(userId, loraId, fileData,tool) {
    if (tool === undefined || tool < 0 || tool >= 20) {
        tool = workspace[userId][loraId].images.findIndex(image => image === '');
        if (tool === -1) {
            console.error(`No available slot found for LoRA ${loraId}`);
            //sendMessage(message, "No available slots to add more images.");
            return false;
        }
    }

    const telegramFileUrl = await getPhotoUrl(fileData.file);
    if (!telegramFileUrl) {
        console.error(`Failed to get URL for file in slot ${tool}`);
        return false;
    }

    const fileUrl = await saveImageToGridFS(telegramFileUrl, loraId, tool);
    workspace[userId][loraId].images[tool] = fileUrl;

    return true;
}
async function processFiles(messages) {
    const files = [];
    for (const message of messages){
        if (message.photo) {
            const largestPhoto = message.photo[message.photo.length - 1];
            files.push({ type: 'photo', file: largestPhoto });
        } else if (message.document) {
            files.push({ type: 'document', file: message.document });
        }
    }
    return files;
}
async function lockWorkspace(userId, loraId, instanceId) {
    const MAX_RETRIES = 5;
    let retries = 0;

    while (workspace[userId][loraId].locked && retries < MAX_RETRIES) {
        const waitTime = Math.pow(2, retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retries++;
    }

    if (workspace[userId][loraId].locked) {
        console.error(`Workspace for LoRA ${loraId} is still locked after ${MAX_RETRIES} retries.`);
        //sendMessage(message, "The server is currently processing other requests. Please try again in a moment.");
        return false;
    }

    workspace[userId][loraId].locked = instanceId;
    return true;
}
function initializeWorkspace(userId, loraId) {
    if (!workspace[userId] || !workspace[userId][loraId]) {
        console.error(`LoRA ${loraId} not found in workspace.`);
        //sendMessage(message, "Something went wrong. No LoRA found in workspace. Please try again.");
        return false;
    }
    if (!workspace[userId][loraId].images) {
        workspace[userId][loraId].images = new Array(20).fill('');
    }
    return true;
}
const mediaGroups = {};
async function addLoraSlotImage(message) {
    const userId = message.from.id;
    console.log(`[addLoraSlotImage] Called for user ${userId}`);
    //console.log('addloraslotimagemessage',message)
    const mediaGroupId = message.media_group_id;
    if(mediaGroupId) {
        console.log(`[addLoraSlotImage] Detected media_group_id: ${mediaGroupId}`);

        // Initialize media group if not present
        if (!mediaGroups[mediaGroupId]) {
            mediaGroups[mediaGroupId] = [];
        }

        // Add message to the media group
        mediaGroups[mediaGroupId].push(message);

        // Wait briefly to ensure all parts of the group are received
        setTimeout(() => {
            const messages = mediaGroups[mediaGroupId];
            if (messages) {
                console.log(`[addLoraSlotImage] Processing media group ${mediaGroupId}`);
                processMediaGroup(messages, userId);
                delete mediaGroups[mediaGroupId]; // Clean up after processing
            }
        }, 1000); // Adjust timeout as needed
        return;
    }

    // Single message (no media_group_id) - Process immediately
    console.log(`[addLoraSlotImage] Single message received. Processing directly.`);
    await processSingleMessage(message, userId);
}

// Function to process a media group
async function processMediaGroup(messages, userId) {
    console.log(`[processMediaGroup] Processing messages for user ${userId}:`, messages);

    
    // Initialize workspace
    console.log(`[addLoraSlotImage] Attempting to find and initialize workspace for user ${userId}`);
    const loraId = findUserBench(userId);
    if (!loraId) {
        console.error(`[addLoraSlotImage] No LoRA found for user ${userId}`);
        //sendMessage(message, "Something went wrong. No LoRA data found. Please try again.");
        return;
    }

    const workspaceInitialized = initializeWorkspace(userId, loraId);
    console.log(`[addLoraSlotImage] Workspace initialized: ${workspaceInitialized}`);
    if (!workspaceInitialized) return;

    // Lock workspace
    const instanceId = Date.now() + Math.random();
    console.log(`[addLoraSlotImage] Attempting to lock workspace for LoRA ${loraId} with instance ID ${instanceId}`);
    const lockAcquired = await lockWorkspace(userId, loraId, instanceId);
    console.log(`[addLoraSlotImage] Lock acquired: ${lockAcquired}`);
    if (!lockAcquired) return;


    try {
        // Process attached files (photos or documents)
        console.log(`[addLoraSlotImage] Processing files for user ${userId} and LoRA ${loraId}`);
        const files = await processFiles(messages);
        console.log(`[addLoraSlotImage] Files processed: ${JSON.stringify(files)}`);

        if (!files.length) {
            console.warn(`[addLoraSlotImage] No valid files found for user ${userId}`);
            sendMessage(messages[0], "No valid files found. Please try again.");
            return;
        }
        let tool = findTool(userId, loraId);
        let it = 0
        // Assign files to slots
        for (const fileData of files) {
            tool += it
            console.log(`[addLoraSlotImage] Attempting to assign file ${fileData.type} to a slot for LoRA ${loraId}`);
            const slotAssigned = await assignToSlot(userId, loraId, fileData);
            console.log(`[addLoraSlotImage] File assigned to slot: ${slotAssigned}`);
            if (!slotAssigned) break;
            it++
        }

        // Save workspace and update the user interface
        console.log(`[addLoraSlotImage] Attempting to save workspace for LoRA ${loraId}`);
        await saveAndReact(userId, loraId, messages, instanceId);
    } catch (error) {
        console.error(`[addLoraSlotImage] Error occurred: ${error}`);
        console.log(messages[messages.length-1])
        sendMessage(messages[messages.length-1], 'Something went wrong while processing your request. Please try again.');
    } finally {
        // Release lock
        console.log(`[addLoraSlotImage] Releasing lock for LoRA ${loraId} with instance ID ${instanceId}`);
        releaseWorkspaceLock(userId, loraId, instanceId);
    }
        
}


async function addLoraSlotCaption(message) {
    const userId = message.from.id;

    // Find the workspace lora corresponding with the userId
    const loraId = findUserBench(userId);
    if (!loraId) {
        console.error(`No LoRA found for user ${userId}`);
        sendMessage(message, "Something went wrong. No LoRA data found. Please try again.");
        return;
    }

    // Loop through workspace to find the lora with the tool value
    const tool = findTool(userId,loraId);
    if (tool === undefined) {
        console.error(`No tool found for LoRA ${loraId}`);
        sendMessage(message, "Something went wrong. No tool found. Please try again.");
        return;
    }

    // Make sure workspace[userId][loraId] is properly initialized
    if (!workspace[userId][loraId]) {
        console.error(`LoRA ${loraId} not found in workspace.`);
        sendMessage(message, "Something went wrong. No LoRA found in workspace. Please try again.");
        return;
    }

    // Ensure `images` array is initialized
    if (!workspace[userId][loraId].captions) {
        workspace[userId][loraId].captions = new Array(20).fill('');
    }

    if (message.text) {
        
        // Set the image URL in the appropriate slot
        workspace[userId][loraId].captions[tool] = message.text;

        // Save workspace
        const isSaved = await saveWorkspace(workspace[userId][loraId]);

        if (isSaved) {
            setUserState(message, STATES.IDLE);
            react(message, '👍');
            const { text, reply_markup } = await buildTrainingMenu(userId,loraId);
            sendMessage(message, text, { reply_markup });
        } else {
            sendMessage(message, 'Ah... wait. Something messed up. Try again.');
        }
    } else {
        sendMessage(message, 'Actually... I was expecting a caption, preferably a description of the image containing the trigger word.');
    }
}

/*
6. SUBMIT 
changes lora status from working to pending review
*/
const loraPrice = 86400

async function submitTraining(message, user, loraId) {
    await getOrLoadLora(user, loraId)
    if(!lobby.hasOwnProperty(user)){
        return
    }
    const userDat = lobby[user]
    if(userDat.qoints < loraPrice){
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Charge ⚡️', url: 'https://miladystation2.net/charge' }
                    ]
                ]
            }
        };
        await sendMessage(message,`Submitting a training to make a lora costs 86,400 🧀1-time-use-points⚡️. You don't have that. You have ${userDat.qoints}. You may purchase more on the website`,options)
        return
    } else {
        userDat.qoints -= loraPrice;
        await writeQoints('users',{'userId': user},userDat.qoints)
    }
    workspace[user][loraId].status = 'SUBMITTED'
    workspace[user][loraId].submitted = Date.now();
    await saveWorkspace(workspace[user][loraId])
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const { text, reply_markup } = await buildTrainingMenu(user,loraId)
    await editMessage({
        reply_markup,
        text,
        chat_id: chatId,
        message_id: messageId
    })
}

/*

BACKEND

1. download dataset (safe? make sure only take pngs and txtfiles)
2. change status, change status from pending review to pending training to training 
3. change bot global training status to display to users that you are training a dataset for them rn


*/

async function getOrLoadLora(userId, loraId) {
    if (workspace[userId]?.[loraId]) {
        console.log(`Using cached LoRA data for user ${userId}, LoRA ${loraId}`);
        return workspace[userId][loraId];
    }

    console.log(`Loading LoRA data for user ${userId}, LoRA ${loraId} from database...`);
    const loraData = await loadLora(loraId);

    if (!loraData) {
        throw new Error(`LoRA data not found for ID ${loraId}`);
    }

    // Initialize workspace for the user if necessary
    if (!workspace[userId]) {
        workspace[userId] = {};
    }

    // Cache the loaded data in the namespaced workspace
    workspace[userId][loraId] = loraData;
    return loraData;
}

function focusWorkspace(loraId, userId) {
    const userWorkspace = workspace[userId];
    if (!userWorkspace) {
        console.warn(`No workspace found for user ${userId}`);
        return;
    }

    const keysToDelete = [];
    for (const key in userWorkspace) {
        if (userWorkspace.hasOwnProperty(key) && key !== String(loraId)) {
            keysToDelete.push(key);
        }
    }

    keysToDelete.forEach(key => {
        console.log(`Deleting LoRA ${key} from workspace for user ${userId}`);
        delete userWorkspace[key];
    });

    if (Object.keys(userWorkspace).length === 0) {
        console.log(`No remaining LoRAs for user ${userId}, cleaning up workspace.`);
        delete workspace[userId]; // Clean up empty user workspace
    }
}
function findUserBench(userId) {
    if (workspace[userId]) {
        const keys = Object.keys(workspace[userId]);
        if (keys.length > 0) {
            return keys[0]; // Return the first loraId under the userId
        }
    }
    console.warn(`No LoRAs found for user ${userId}`);
    return null;
}

function findTool(userId, loraId) {
    if (workspace[userId] && workspace[userId][loraId]) {
        const trainingObject = workspace[userId][loraId];
        if (trainingObject.tool !== undefined) {
            return trainingObject.tool;
        }
        console.warn(`No 'tool' key found for LoRA ${loraId} under user ${userId}`);
    } else {
        console.warn(`Training object for LoRA ${loraId} not found under user ${userId}`);
    }
    return null;
}


module.exports = {
    handleTrainingMenu,
    newLora,
    createLora,
    trainMenu, trainSlot,
    addLoraSlotImage, viewSlotImage,
    addLoraSlotCaption, viewSlotCaption,
    removeTraining, deleteLoraSlot,
    submitTraining
}