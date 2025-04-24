const { lobby, workspace, STATES, getPhotoUrl, getBotInstance, prefixHandlers, actionMap } = require('../bot')
const { 
    sendMessage, 
    editMessage, 
    setUserState, 
    sendPhoto,
    react, 
    calculateDiscount,
    DEV_DMS
} = require('../../utils')
const { checkIn } = require('../gatekeep')
const { Workspace, UserEconomy } = require('../../../db/index');
const userEconomy = new UserEconomy();
const loraDB = new Workspace();
const fs = require('fs');

/*
LORA DATASET CREATION / CURATION

0. handleTrain
callback handler, the menu for displaying user created loras
in accountsettings, user hits TRAIN button
if they have any loras (found in their user object under the loras array, consisting of hash strings that can be referred to in db)
display each lora in paginated menu along with the newSet button that creates dataset entry in database
*/
async function getMyLoras(userId) {
    let loraKeyboardOptions = [];
    
    try {
        const trainings = await loraDB.getTrainingsByUserId(userId);
        if (trainings.length > 0) {
            for (const training of trainings) {
                loraKeyboardOptions.push([{ 
                    text: `${training.name}`, 
                    callback_data: `el_${training.loraId}` 
                }]);
            }
        }

        loraKeyboardOptions.push([{ text: '➕', callback_data: 'newLora' }]);
        
    } catch (error) {
        console.error('Failed to get trainings:', error);
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
    
    if (!workspace.hasOwnProperty(userId)) {
        workspace[userId] = {};
    }
    workspace[userId][thisLora.loraId] = thisLora
    try {
        const success = await loraDB.createTraining(thisLora)
        if(!success){
            await sendMessage(message, 'LoRa creation failed');
            return
        }
    } catch (err) {
        console.error('Error during LoRa creation:', error);
        await sendMessage(message, 'LoRa creation encountered an error.');
        return;
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

    // Remove the LoRa from the workspace
    if (workspace.hasOwnProperty(user) && workspace[user][loraId]) {
        delete workspace[user][loraId];
        console.log(`Workspace entry for LoRA ${loraId} removed.`);
    }

    // Delete the LoRa data from the database and associated files
    await loraDB.deleteWorkspace(loraId);
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
        inlineKeyboard.push([{ text: '🗑️', callback_data: `rml_${loraId}` }]);
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

    //remove lora training set
    prefixHandlers['rml_']= async (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        await removeTraining(user, loraId);
        actionMap['trainingMenu'](message, user);
    }

    prefixHandlers['est_']= async (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        await editSlot(user, loraId, slotId);
    }

async function editSlot(user, loraId, slotId) {
    const userId = user;
    const messageId = message.message_id;
    const chatId = message.chat.id;
    setUserState({...message, 'from': {'id': userId}}, STATES.SETLORACAPTION)
}

actionMap['setLoraCaption'] = async (action, message, user) => {
    const loraId = parseInt(action.split('_')[1]);
    const slotId = parseInt(action.split('_')[2]);
    workspace[user][loraId].tool = slotId
    await addLoraSlotCaption(message);
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

        const tempFilePath = await loraDB.bucketPull(fileId, loraId, slotId);
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
        await loraDB.deleteImageFromWorkspace(loraId, slotId);

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
    const isSaved = await loraDB.saveWorkspace(workspace[userId][loraId]);
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
async function assignToSlot(userId, loraId, fileData, tool) {
    if (tool === undefined || tool < 0 || tool >= 20) {
        tool = workspace[userId][loraId].images.findIndex(image => image === '');
        if (tool === -1) {
            console.error(`No available slot found for LoRA ${loraId}`);
            return false;
        }
    }

    try {
        // Get telegram URL using the file object from processFiles
        const telegramFileUrl = await getPhotoUrl(fileData.file);
        if (!telegramFileUrl) {
            console.error(`Failed to get URL for file in slot ${tool}`);
            return false;
        }

        console.log('[assignToSlot] Got telegram URL:', telegramFileUrl);
        const mongoObjectId = await loraDB.saveImageToGridFS(telegramFileUrl, loraId, tool);
        console.log('[assignToSlot] Saved to GridFS, got ObjectId:', mongoObjectId);
        
        workspace[userId][loraId].images[tool] = mongoObjectId;
        return tool;
    } catch (error) {
        console.error(`Failed to save file for slot ${tool}:`, error);
        return false;
    }
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
    await processMediaGroup([message], userId);
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
        const isSaved = await loraDB.saveWorkspace(workspace[userId][loraId]);

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


async function submitTraining(message, user, loraId) {
    const loraPrice = 86400
    await getOrLoadLora(user, loraId)
    if(!lobby.hasOwnProperty(user)){
        return
    }
    const userDat = lobby[user]
    console.log('user data:', userDat)
    console.log('base price:', loraPrice)
    console.log('calculating discount for user:', user)
    const discount = await calculateDiscount(user) // Wait for Promise to resolve
    console.log('discount amount:', discount)
    const multiplier = (100 - discount) / 100
    console.log('multiplier:', multiplier)
    const discountedPrice = Math.floor(loraPrice * multiplier) // Floor to get integer price
    console.log('discounted price:', discountedPrice)
    console.log('checking if user has enough qoints:', userDat, userDat.qoints, 'vs needed:', discountedPrice);
    // Validate discountedPrice is a valid number
    if (isNaN(discountedPrice) || discountedPrice <= 0) {
        console.error('Invalid discounted price:', discountedPrice);
        await sendMessage(message, 'Sorry, there was an error calculating the price. Please try again later.');
        return;
    }

    workspace[user][loraId].status = 'SUBMITTED';
    workspace[user][loraId].submitted = Date.now();
    await loraDB.saveWorkspace(workspace[user][loraId]);

    // Update user's training menu
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const { text, reply_markup } = await buildTrainingMenu(user, loraId);
    await editMessage({
        reply_markup,
        text,
        chat_id: chatId,
        message_id: messageId
    });
    setUserState({...message, from: {id: user}}, STATES.IDLE);

    // Send notification to dev with sample images
    try {
        // Get first, middle and last filled slots
        const filledSlots = workspace[user][loraId].images
            .map((img, index) => ({ img, index }))
            .filter(({ img }) => img !== '');
        
        const sampleSlots = [];
        if (filledSlots.length > 0) {
            // Always include first
            sampleSlots.push(filledSlots[0]);
            
            // Include middle if we have at least 3 images
            if (filledSlots.length >= 3) {
                const midIndex = Math.floor(filledSlots.length / 2);
                sampleSlots.push(filledSlots[midIndex]);
            }
            
            // Include last if it's different from middle and first
            if (filledSlots.length >= 2) {
                sampleSlots.push(filledSlots[filledSlots.length - 1]);
            }
        }

        // Send initial message with details
        const devMessage = await sendMessage(
            {from: {id:DEV_DMS}, chat: {id:DEV_DMS}},
            `🆕 New LoRA Submission\n\n` +
            `👤 User: ${user} @${message.from.username}\n` +
            `📝 Name: ${workspace[user][loraId].name}\n` +
            `💰 Price: ${discountedPrice} qoints\n` +
            `🖼️ Total Images: ${workspace[user][loraId].images.filter(img => img !== '').length}`
        );

        // Send sample images using bucket pull
        for (const { img: fileId, index: slotId } of sampleSlots) {
            try {
                const tempFilePath = await loraDB.bucketPull(fileId, loraId, slotId);
                if (tempFilePath) {
                    await sendPhoto(
                        {chat: {id: DEV_DMS}}, 
                        tempFilePath,
                        {caption: `Sample from slot ${slotId}`}
                    );
                    await fs.promises.unlink(tempFilePath);
                }
            } catch (err) {
                console.error(`Failed to send sample image from slot ${slotId}:`, err);
            }
        }

        // Send admin control panel
        await sendMessage(
            {chat: {id: DEV_DMS}},
            "Admin Controls:",
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Style', callback_data: `trainDiscern_approveStyle_${loraId}_${user}` },
                            { text: '✅ Subject', callback_data: `trainDiscern_approveSubject_${loraId}_${user}` }
                        ],
                        [
                            
                            { text: '❌ Reject', callback_data: `trainDiscern_reject_${loraId}_${user}` }
                        ],
                        [
                            { text: '💰 Demand Payment', callback_data: `trainDiscern_demand_${loraId}_${user}` }
                        ]
                    ]
                }
            }
        );
    } catch (error) {
        console.error('Error sending dev notification:', error);
        await sendMessage({chat: {id: DEV_DMS}}, 
            `Error processing submission notification for LoRA ${loraId} from user ${user}: ${error.message}`
        );
    }
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
    const loraData = await loraDB.loadLora(loraId);

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

prefixHandlers['trainDiscern_'] = async (action, message, user) => {
    const [_, decision, loraId, userId] = action.split('_');
    await handleDevDiscernment(decision, loraId, userId, message);
}

async function handleDevDiscernment(decision, loraId, userId, message) {
    try {
        // Load LoRA data and ensure workspace is initialized
        const loraData = await getOrLoadLora(userId, loraId);
        if (!workspace[userId]) {
            workspace[userId] = {};
        }
        if (!workspace[userId][loraId]) {
            workspace[userId][loraId] = loraData;
        }
        
        const loraName = loraData.name;

        switch (decision) {
            case 'tags':
                // Show tag management menu
                const currentTags = workspace[userId][loraId].tags || [];
                const tagKeyboard = Object.entries(LORA_TAGS).map(([tag, emoji]) => [{
                    text: `${currentTags.includes(tag) ? '✅' : '⬜'} ${emoji} ${tag}`,
                    callback_data: `loraTag_${loraId}_${userId}_${tag}`
                }]);
                
                // Add control buttons
                tagKeyboard.push([
                    { text: '↩️ Back', callback_data: `trainDiscern_back_${loraId}_${userId}` }
                ]);
                
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: `🏷️ Tag Management for "${loraName}"\n\nCurrent tags: ${
                        currentTags.length > 0 
                            ? currentTags.map(tag => `${LORA_TAGS[tag]}${tag}`).join(', ')
                            : 'None'
                    }`,
                    reply_markup: {
                        inline_keyboard: tagKeyboard
                    }
                });
                break;
            case 'back':
                // Return to main review menu
                await showReviewMenu(message, userId, loraId);
                break;
            case 'approve':
            case 'approveStyle':
            case 'approveSubject':
                // Set training type and status
                workspace[userId][loraId].status = 'APPROVED';
                workspace[userId][loraId].trainingType = decision === 'approveStyle' ? 'style' : 
                    decision === 'approveSubject' ? 'subject' : 
                    decision === 'approve' ? 'style' : 'subject';
                workspace[userId][loraId].name = workspace[userId][loraId].name.replace(/\s+/g, '');
                await loraDB.saveWorkspace(workspace[userId][loraId]);

                // Notify user
                await sendMessage(
                    { chat: { id: userId } },
                    `✨ Good news! Your ${decision === 'approveStyle' ? 'style' : 'subject'} LoRA training request "${loraName}" has been approved! We'll begin processing it shortly.`
                );

                // Include tags in notifications
                const tagInfo = workspace[userId][loraId].tags?.length > 0
                ? `\nTags: ${workspace[userId][loraId].tags.map(tag => `${LORA_TAGS[tag]}${tag}`).join(', ')}`
                : '';
                
                // Update dev message
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: `✅ Approved ${decision === 'approveStyle' ? 'Style' : 'Subject'} LoRA "${loraName}" for training\nUser: ${userId}${tagInfo}`
                });
                break;

            case 'reject':
                // Change status to REJECTED
                workspace[userId][loraId].status = 'REJECTED';
                await loraDB.saveWorkspace(workspace[userId][loraId]);
                
                // Notify user
                await sendMessage(
                    { chat: { id: userId } },
                    `❌ Your LoRA training request "${loraName}" was not approved. This could be due to image quality issues or content guidelines. Feel free to try again with different images!`
                );
                
                // Clean up workspace and files
                await removeTraining(userId, loraId);
                
                // Update dev message
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: `❌ Rejected LoRA "${loraName}"\nUser: ${userId}`
                });
                break;

            case 'demand':
                // Change status to PAYMENT_REQUIRED
                workspace[userId][loraId].status = 'PAYMENT_REQUIRED';
                await loraDB.saveWorkspace(workspace[userId][loraId]);
                
                // Calculate price
                const loraPrice = 86400;
                const discount = await calculateDiscount(userId);
                const multiplier = (100 - discount) / 100;
                const discountedPrice = Math.floor(loraPrice * multiplier);
                
                // Check user's qoints - Fix the Economy initialization
                const userEconomy = await userEconomy.findOne({ userId: userId }); // Use userId consistently
                const hasQoints = userEconomy && userEconomy.qoints >= 0; // Changed to check if qoints exists
                
                // Build keyboard based on qoint status
                const keyboard = [
                    [
                        { text: '💰 Pay Premium', callback_data: `premiumTrain_pay_${loraId}_${discountedPrice}` },
                        { text: '❌ Not Today', callback_data: `premiumTrain_cancel_${loraId}` }
                    ]
                ];
                
                if (!hasQoints) {
                    keyboard.unshift([{ text: '🏦 Get Charged', url: `https://www.miladystation2.net/charge` }]);
                }
                
                // Notify user with detailed payment requirement message
                await sendMessage(
                    { chat: { id: userId } },
                    `💫 About your LoRA training request "${loraName}":\n\n` +
                    `While we love creativity, this particular training set falls into our premium category ` +
                    `due to its meme/entertainment nature.\n\n` +
                    `Premium Training Cost: ${discountedPrice} qoints` +
                    `${discount > 0 ? ` (includes your ${discount}% discount)` : ''}\n\n` +
                    `Your current balance: ${userEconomy ? userEconomy.qoints : 0} qoints\n\n` +
                    `Note: Qoints are our premium currency, different from regular points. ` +
                    `${!hasQoints ? 'You currently have no qoints - click "Get Qoints" to purchase some!' : ''}\n\n` +
                    `Would you like to proceed with the premium training?`,
                    {
                        reply_markup: {
                            inline_keyboard: keyboard
                        }
                    }
                );
                
                // Update dev message
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: `💰 Requested premium payment (${discountedPrice} qoints) for LoRA "${loraName}"\nUser: ${userId}`
                });
                break;

            default:
                console.error(`Unknown decision type: ${decision}`);
                return;
        }
    } catch (error) {
        console.error('Error in handleDevDiscernment:', error);
        await sendMessage(
            { chat: { id: DEV_DMS } },
            `Error processing discernment for LoRA ${loraId} (${decision}): ${error.message}`
        );
    }
}

prefixHandlers['premiumTrain_'] = async (action, message, user) => {
    const [_, choice, loraId, price] = action.split('_');
    await handlePremiumTrainChoice(choice, loraId, parseInt(price), message, user);
}



async function handlePremiumTrainChoice(choice, loraId, price, message, user) {
    try {
        // Load LoRA data and ensure workspace is initialized
        const loraData = await getOrLoadLora(user, loraId);
        if (!workspace[user]) {
            workspace[user] = {};
        }
        if (!workspace[user][loraId]) {
            workspace[user][loraId] = loraData;
        }

        switch (choice) {
            case 'pay':
                // Check if user has enough qoints - Fixed userEconomy usage
                const userEco = await userEconomy.findOne({ userId: user });
                if (!userEco || !userEco.qoints || userEco.qoints < price) {
                    await editMessage({
                        chat_id: message.chat.id,
                        message_id: message.message_id,
                        text: "❌ Insufficient charge balance. Please get more charge and try again.",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🏦 Get Charged', url: 'https://www.miladystation2.net/charge' }],
                                [{ text: 'Cancel', callback_data: `premiumTrain_cancel_${loraId}` }]
                            ]
                        }
                    });
                    return;
                }

                // Deduct qoints - Fixed to use qoints directly
                const newBalance = userEco.qoints - price;
                const success = await userEconomy.writeQoints(user, newBalance);
                if (!success) {
                    await sendMessage(message, "Failed to process payment. Please try again later.");
                    return;
                }

                // Update LoRA status to SUBMITTED (approved)
                workspace[user][loraId].status = 'SUBMITTED';
                workspace[user][loraId].paidAmount = price;
                workspace[user][loraId].paidDate = Date.now();
                await loraDB.saveWorkspace(workspace[user][loraId]);

                // Notify user
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: `✨ Payment successful! Your LoRA "${loraData.name}" has been approved for training.\n\n` +
                          `Paid: ${price} qoints\n` +
                          `Remaining balance: ${newBalance} qoints`
                });

                // Notify dev
                await sendMessage(
                    { chat: { id: DEV_DMS } },
                    `💰 Premium payment received!\n` +
                    `User: ${user}\n` +
                    `LoRA: ${loraData.name}\n` +
                    `Amount: ${price} qoints`
                );
                break;

            case 'cancel':
                // Update message to show cancelled state
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: `❌ Premium training cancelled for "${loraData.name}".\n\n` +
                          `You can always try again later or submit a different training set!`
                });

                // Clean up workspace and files
                await removeTraining(user, loraId);
                break;

            default:
                console.error(`Unknown premium train choice: ${choice}`);
                break;
        }
    } catch (error) {
        console.error('Error in handlePremiumTrainChoice:', error);
        await sendMessage(message, 'An error occurred while processing your request. Please try again later.');
    }
}

// Add new prefix handler for tag toggling
prefixHandlers['loraTag_'] = async (action, message, user) => {
    const [_, loraId, userId, tag] = action.split('_');
    await toggleLoraTag(loraId, userId, tag, message);
};


async function toggleLoraTag(loraId, userId, tag, message) {
    try {
        if (!workspace[userId][loraId].tags) {
            workspace[userId][loraId].tags = [];
        }
        
        const tagIndex = workspace[userId][loraId].tags.indexOf(tag);
        if (tagIndex === -1) {
            workspace[userId][loraId].tags.push(tag);
        } else {
            workspace[userId][loraId].tags.splice(tagIndex, 1);
        }
        
        await loraDB.saveWorkspace(workspace[userId][loraId]);
        
        // Refresh tag menu
        await handleDevDiscernment('tags', loraId, userId, message);
    } catch (error) {
        console.error('Error toggling tag:', error);
        await sendMessage(message, 'Failed to update tags. Please try again.');
    }
}

// Add this near the top with other constants
const LORA_TAGS = {
    'meme': '😂',
    'illustration': '🎨',
    'retro': '📺',
    'arthurts_picks': '⭐',
    'anime': '🌸',
    'photo': '📸',
    'landscape': '🌄',
    'experimental': '🧪'
};

async function showReviewMenu(message, userId, loraId) {
    const loraData = workspace[userId][loraId];
    const currentTags = loraData.tags || [];
    
    const tagDisplay = currentTags.length > 0 
        ? '\n🏷️ Tags: ' + currentTags.map(tag => `${LORA_TAGS[tag]}${tag}`).join(', ')
        : '';

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: `Review LoRA: "${loraData.name}"${tagDisplay}`,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Style', callback_data: `trainDiscern_approveStyle_${loraId}_${userId}` },
                    { text: '✅ Subject', callback_data: `trainDiscern_approveSubject_${loraId}_${userId}` }
                ],
                [
                    { text: '🏷️ Manage Tags', callback_data: `trainDiscern_tags_${loraId}_${userId}` }
                ],
                [
                    { text: '💰 Premium', callback_data: `trainDiscern_demand_${loraId}_${userId}` },
                    { text: '❌ Reject', callback_data: `trainDiscern_reject_${loraId}_${userId}` }
                ]
            ]
        }
    });
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