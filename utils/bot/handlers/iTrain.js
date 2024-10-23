const { lobby, workspace, STATES, getPhotoUrl, getBotInstance } = require('../bot')
const { 
    sendMessage, 
    editMessage, 
    setUserState, 
    sendPhoto,
    react 
} = require('../../utils')
const { 
    createTraining, 
    loadLora, 
    writeUserData,
    deleteWorkspace,
    saveWorkspace,
    saveImageToGridFS, bucketPull,
    deleteImageFromWorkspace
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
    if (lobby[userId] && lobby[userId].loras && lobby[userId].loras.length > 0) {
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
    if (!(lobby[userId] && lobby[userId].loras && lobby[userId].loras.length >= 3)) {
        loraKeyboardOptions.push([{ text: '➕', callback_data: 'newLora' }]);
    }
    return loraKeyboardOptions;
}

async function handleTrainingMenu(message, user) {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const myLoras = await getMyLoras(user);
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
    setUserState(message.reply_to_message, STATES.LORANAME)
    editMessage({
        text: 'What is the name of the LoRa?',
        message_id: messageId,
        chat_id: chatId
    })
}

async function createLora(message) {
    if(false){
        sendMessage(message,'🚂')
        setUserState(message,STATES.IDLE)
        return
    }
    const name = message.text;
    const userId = message.from.id
    const hashId = Math.floor(10000000000000 * Math.random())
    const userContext = lobby[userId]
    const thisLora = {
        loraId: hashId,
        name,
        userId,
        iter: '1.0',
        version: '',
        images: new Array(20).fill(''),
        captions: new Array(20).fill(''),
        status: 'incomplete'
    }
    userContext.loras ? userContext.loras.push(thisLora.loraId) : userContext.loras = [thisLora.loraId]
    workspace[thisLora.loraId] = thisLora
    const success = await createTraining(thisLora)
    const userWriteSuccess = await writeUserData(parseInt(userId), userContext)
    console.log(userWriteSuccess)
    if(!success){
        sendMessage(message,'lora creation failed ):')
    }
    if(!userWriteSuccess){
        sendMessage(message,'save settings failed, use /savesettings')
    }
    const { text, reply_markup } = await buildTrainingMenu(hashId)
    sendMessage(message, text, {reply_markup})
    setUserState(message,STATES.IDLE)
}

/*
2. removeLora
handles callback from datasetmenu
delete database entry, remove from userLoras list
*/
async function removeTraining(user, loraId) {
    if(!lobby[user]){
        await checkIn({ from: { id: user}, chat: { id: user }})
    }
    lobby[user].loras = lobby[user].loras.filter(lora => lora !== loraId);
    await deleteWorkspace(loraId)
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
    const { text, reply_markup } = await buildTrainingMenu(loraId)
    await editMessage({
        reply_markup,
        text,
        chat_id: chatId,
        message_id: messageId
    })
}

async function buildTrainingMenu(loraId) {
    try {
        let loraData;
        if (workspace[loraId]) {
            loraData = workspace[loraId];
        } else {
            loraData = await loadLora(loraId);
            if (!loraData) {
                throw new Error('LoRA data not found');
            }
            workspace[loraId] = loraData;
        }
        const { name, status, images, captions, submitted } = loraData;

        // Create the text for the menu
        let menuText = `${name}\nSTATUS: ${status}`;

        // If submitted, add submission time to the menu text
        if (submitted) {
            const timeSinceSubmitted = Math.floor((Date.now() - submitted) / 1000); // Time in seconds
            menuText += `\nSubmitted: ${timeSinceSubmitted} seconds ago`;
        }

        // Create inline keyboard with buttons
        const inlineKeyboard = [];

        // Add the back button
        inlineKeyboard.push([{ text: '↖︎', callback_data: `trainingMenu` }]);

        // If not submitted, add the slot buttons
        if (!submitted) {
            let completedCount = 0;
            for (let row = 0; row < 5; row++) {
                const rowButtons = [];
                for (let col = 0; col < 4; col++) {
                    const slotId = row * 4 + col;
                    let buttonText = '📥';
                    if (images && images[slotId]) {
                        if (captions && captions[slotId]) {
                            buttonText = '✅';
                            
                        } else {
                            buttonText = '🖼️';
                        }
                        completedCount++;
                    }
                    rowButtons.push({ text: buttonText, callback_data: `et_${loraId}_${slotId}` });
                }
                inlineKeyboard.push(rowButtons);
            }

            // Calculate completion percentage
            const completionPercentage = (completedCount / images.length) * 100;
            inlineKeyboard.push([{ text: '🗑️', callback_data: `rml_${loraId}` }]);
            
            // Add the submit button if completion is >= 50%
            if (completionPercentage >= 50) {
                inlineKeyboard.push([{ text: 'Submit', callback_data: `st_${loraId}` }]);
            }
        }

        // Return the menu text and inline keyboard
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
    let loraData;

    // Check workspace for the loraData
    if (!workspace[loraId]) {
        loraData = await loadLora(loraId);
        if (loraData) {
            workspace[loraId] = loraData;
        } else {
            console.error(`LoRA data for ID ${loraId} not found.`);
            return;
        }
    } else {
        loraData = workspace[loraId];
    }

    // Check loraData slotId for an image URL
    if (!loraData.images[slotId]) {
        // If there isn't a URL there, simply prompt the user for a photo
        await editMessage({
            reply_markup: {
                inline_keyboard: [
                    [{ text: '↖︎', callback_data: `el_${loraId}` }]
                ]
            },
            chat_id: chatId,
            message_id: messageId,
            text: `Send in a photo here for training your ${loraData.name} LoRa`
        });
        //console.log('workspace before focus',workspace)
        // Loop through workspace to remove other LoRAs that are from the user and are not this loraId
        focusWorkspace(loraId, userId);
        //console.log('workspace after focus',workspace)

        // Initialize `tool` property for this LoRA data in the workspace
        if (!workspace[loraId]) {
            workspace[loraId] = {};
        }
        workspace[loraId].tool = slotId;

        // Update the user's state
        message.from.id = user;
        setUserState(message, STATES.ADDLORAIMAGE);
    } else {
        // Build and display the slot menu
        const { text, reply_markup } = await buildSlotMenu(loraId, slotId);
        await editMessage({
            text,
            reply_markup,
            chat_id: chatId,
            message_id: messageId,
        });
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

async function buildSlotMenu(loraId, slotId) {
    try {
        let loraData;
        if (workspace[loraId]) {
            loraData = workspace[loraId];
        } else {
            loraData = await loadLora(loraId);
            if (!loraData) {
                throw new Error('LoRA data not found');
            }
            workspace[loraId] = loraData;
        }

        const { images, captions } = loraData;
        const hasImage = images && images[slotId];
        const hasCaption = captions && captions[slotId];

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
        return null;
    }
}

async function viewSlotImage(message, user, loraId, slotId) {
    let loraData;
    if (workspace[loraId]) {
        loraData = workspace[loraId];
    } else {
        loraData = await loadLora(loraId);
        if (!loraData) {
            throw new Error('LoRA data not found');
        }
        workspace[loraId] = loraData;
    }

    const fileId = loraData.images[slotId];

    if (!fileId) {
        sendMessage(message.reply_to_message, 'No image found in this slot.');
        return;
    }

    try {
        // Retrieve the image from MongoDB GridFS
        const tempFilePath = await bucketPull(loraId, slotId)
        if (!tempFilePath) {
            sendMessage(message.reply_to_message, 'Failed to retrieve the image. Please try again later.');
            return;
        }
        console.log('message',message)
        delete message.message_id
        // Send the photo using Telegram bot
        await sendPhoto(message, tempFilePath, {
            caption: slotId,
            reply_markup: {inline_keyboard: [
                [{text: 'k', callback_data: 'cancel'}]
            ]}
        });

        // Delete the local file after sending
        fs.unlinkSync(tempFilePath);

    } catch (error) {
        console.error('Error while sending image:', error);
        sendMessage(message, 'Failed to retrieve the image. Please try again later.');
    }
}

async function viewSlotCaption(message, user, loraId, slotId) {
    let loraData;
    if (workspace[loraId]) {
        loraData = workspace[loraId];
    } else {
        loraData = await loadLora(loraId);
        if (!loraData) {
            throw new Error('LoRA data not found');
        }
        workspace[loraId] = loraData;
    }

    const caption = loraData.captions[slotId];

    if (!caption) {
        sendMessage(message.reply_to_message, 'No caption found in this slot.');
        return;
    }

    try {
        
        console.log('message',message)
        delete message.message_id
        // Send the photo using Telegram bot
        await sendPhoto(message, caption, {
            reply_markup: {inline_keyboard: [
                [{text: 'k', callback_data: 'cancel'}]
            ]}
        });


    } catch (error) {
        console.error('Error while sending caption:', error);
        sendMessage(message, 'Failed to retrieve the caption. Please try again later.');
    }
}

async function deleteLoraSlot(message, user, loraId, slotId) {
    await deleteImageFromWorkspace(loraId,slotId)
    let loraData;
    if (workspace[loraId]) {
        loraData = workspace[loraId];
    } else {
        loraData = await loadLora(loraId);
        if (!loraData) {
            throw new Error('LoRA data not found');
        }
        workspace[loraId] = loraData;
    }
    
    workspace[loraId].images[slotId] = '';
    workspace[loraId].captions[slotId] = '';
    var bot = getBotInstance()
    bot.deleteMessage(message.chat.id, message.message_id);
    const { text, reply_markup } = await buildTrainingMenu(loraId);
    sendMessage(message, text, { reply_markup });
}


/*

5. handleSlotEdit
handler for LORASLOTIMG and LORASLOTTXT, saves whatever to the lora db entry for the slot

*/

async function addLoraSlotImage(message) {
    const userId = message.from.id;

    // Find the workspace lora corresponding with the userId
    const loraId = findUserBench(userId);
    if (!loraId) {
        console.error(`No LoRA found for user ${userId}`);
        sendMessage(message, "Something went wrong. No LoRA data found. Please try again.");
        return;
    }

    // Loop through workspace to find the lora with the tool value
    const tool = findTool(loraId);
    if (tool === undefined) {
        console.error(`No tool found for LoRA ${loraId}`);
        sendMessage(message, "Something went wrong. No tool found. Please try again.");
        return;
    }

    // Make sure workspace[loraId] is properly initialized
    if (!workspace[loraId]) {
        console.error(`LoRA ${loraId} not found in workspace.`);
        sendMessage(message, "Something went wrong. No LoRA found in workspace. Please try again.");
        return;
    }

    // Ensure `images` array is initialized
    if (!workspace[loraId].images) {
        workspace[loraId].images = new Array(20).fill('');
    }

    let telegramFileUrl;
    if (message.photo || message.document) {
        telegramFileUrl = await getPhotoUrl(message);
        const fileUrl = await saveImageToGridFS(telegramFileUrl, loraId, tool);
        
        // Set the image URL in the appropriate slot
        workspace[loraId].images[tool] = fileUrl;

        // Save workspace
        const isSaved = await saveWorkspace(workspace[loraId]);

        if (isSaved) {
            setUserState(message, STATES.IDLE);
            react(message, '👍');
            const { text, reply_markup } = await buildTrainingMenu(loraId);
            sendMessage(message, text, { reply_markup });
        } else {
            sendMessage(message, 'Ah... wait. Something messed up. Try again.');
        }
    } else {
        sendMessage(message, 'Actually... I was expecting a photo, preferably a file.');
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
    const tool = findTool(loraId);
    if (tool === undefined) {
        console.error(`No tool found for LoRA ${loraId}`);
        sendMessage(message, "Something went wrong. No tool found. Please try again.");
        return;
    }

    // Make sure workspace[loraId] is properly initialized
    if (!workspace[loraId]) {
        console.error(`LoRA ${loraId} not found in workspace.`);
        sendMessage(message, "Something went wrong. No LoRA found in workspace. Please try again.");
        return;
    }

    // Ensure `images` array is initialized
    if (!workspace[loraId].captions) {
        workspace[loraId].captions = new Array(20).fill('');
    }

    if (message.text) {
        
        // Set the image URL in the appropriate slot
        workspace[loraId].captions[tool] = message.text;

        // Save workspace
        const isSaved = await saveWorkspace(workspace[loraId]);

        if (isSaved) {
            setUserState(message, STATES.IDLE);
            react(message, '👍');
            const { text, reply_markup } = await buildTrainingMenu(loraId);
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
    let loraData;
    if (workspace[loraId]) {
        loraData = workspace[loraId];
    } else {
        loraData = await loadLora(loraId);
        if (!loraData) {
            throw new Error('LoRA data not found');
        }
        workspace[loraId] = loraData;
    }
    workspace[loraId].status = 'SUBMITTED'
    workspace[loraId].submitted = Date.now();
    await saveWorkspace(workspace[loraId])
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const { text, reply_markup } = await buildTrainingMenu(loraId)
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

function focusWorkspace(loraId, userId) {
    // Convert `loraId` to string for consistent comparison
    const loraIdStr = String(loraId);
    const keysToDelete = [];

    for (const key in workspace) {
        if (workspace.hasOwnProperty(key)) {
            const trainingObject = workspace[key];
            // Convert key and loraId to strings for proper comparison
            if (trainingObject.userId === userId && key !== loraIdStr) {
                keysToDelete.push(key);
            }
        }
    }

    // Delete all keys collected for deletion
    keysToDelete.forEach(key => {
        delete workspace[key];
    });
}

function findUserBench(userId) {
    console.log(userId)
    for (const key in workspace) {
        if (workspace.hasOwnProperty(key)) {
            const trainingObject = workspace[key];
            console.log(trainingObject)
            if (trainingObject.userId === userId) {
                return key; // Return the loraId key value
            }
        }
    }
    return null; // If no matching object is found
}

function findTool(loraId) {
    const trainingObject = workspace[loraId];
    if (trainingObject) {
        return trainingObject.tool; // Return the value from the 'tool' key
    }
    return null; // If no matching object is found
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