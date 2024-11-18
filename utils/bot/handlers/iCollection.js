const { lobby, workspace, STATES, getPhotoUrl, getBotInstance,
    stateHandlers,
    actionMap,
    prefixHandlers,
 } = require('../bot')
const { 
    sendMessage, 
    editMessage, 
    setUserState, 
    sendPhoto,
    react 
} = require('../../utils')
const { 
    //createTraining, 
    createCollection,
    //loadcollection, 
    loadCollection,
    writeUserData,
    deleteWorkspace,
    saveWorkspace,
    saveImageToGridFS, bucketPull,
    deleteImageFromWorkspace
 } = require('../../../db/mongodb')
 const fs = require('fs')
 const { checkIn } = require('../gatekeep')

/*


*/
async function getMyCollections(userId) {
    //console.log('getting collections')
    let collectionKeyboardOptions = [];
    //console.log(lobby[userId])
    if (lobby[userId]?.collections?.length > 0) {
        //console.log('made it in')
        for (const collectionIdHash of lobby[userId].collections) {
            try {
                const collectionInfo = await loadCollection(collectionIdHash);
                collectionKeyboardOptions.push([{ text: `${collectionInfo.name}`, callback_data: `el_${collectionIdHash}` }]);
            } catch (error) {
                console.error(`Failed to load collection with ID ${collectionIdHash}:`, error);
            }
        }
    }
    if (lobby[userId]?.collections?.length < 3) {
        collectionKeyboardOptions.push([{ text: '➕', callback_data: 'newcollection' }]);
    }
    return collectionKeyboardOptions;
}

async function handleCollectionModeMenu(message, user) {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    try {
        const mycollections = await getMyCollections(user) || [];
        const replyMarkup = {
            inline_keyboard: [
                [{ text: '↖︎', callback_data: 'accountSettingsMenu' }],
                ...mycollections,
                [{ text: 'nvm', callback_data: 'cancel' }]
            ]
        };
        const txt = '🌟Stationthisbot Collection Creation 👩‍🎨🖼️';
    await editMessage({
        reply_markup: replyMarkup,
        chat_id: chatId,
        message_id: messageId,
        text: txt,
    });
    } catch (error) {
        console.log('failed to handle collection mode menu', error);
        sendMessage(DEV_DMS, `collection mode menu handle fail ${error}`)
    }
    
}

actionMap['collectionModeMenu'] = handleCollectionModeMenu
actionMap['newcollection'] = newCollection

async function newCollection(message) {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    //if(message.reply_to_message)
    setUserState(message.reply_to_message, STATES.COLLECTIONNAME)
    editMessage({
        text: 'What is the name of the collection?',
        message_id: messageId,
        chat_id: chatId
    })
}

stateHandlers[STATES.COLLECTIONNAME] = (message) => safeExecute(message,createCollection)

async function createCollection(message) {
    const name = message.text;
    const userId = message.from.id
    const hashId = Math.floor(10000000000000 * Math.random())
    if(!lobby.hasOwnProperty(userId)){
        console.log('SUS someone is trying to make a collectiom but we are in create collection rn and they arent in the lobby')
        return
    }
    const userContext = lobby[userId]
    const thisCollection = {
        collectionId: hashId,
        name,
        userId,
        iter: '1.0',
        version: '',
        config: {
            masterPrompt: '',
            traitTypes: []
        },
        initiated: Date.now(),
        status: 'incomplete'
    }
    userContext.collections.push(thisCollection.collectionId)
    workspace[user][thisCollection.collectionId] = thisCollection
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

