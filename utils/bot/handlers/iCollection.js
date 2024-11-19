const { 
    lobby, 
    studio, 
    STATES, getBotInstance,
    stateHandlers,
    actionMap,
    prefixHandlers,
 } = require('../bot')
const { 
    sendMessage, 
    editMessage, 
    setUserState, 
    safeExecute,
    updateMessage,
    react 
} = require('../../utils')
const { 
    createCollection,
    loadCollection,
    writeUserDataPoint,
    deleteStudio,
    saveStudio,
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
        
        for (const collectionIdHash of lobby[userId].collections) {
            console.log('made it in',collectionIdHash)    
            try {
                const collectionInfo = await getOrLoadCollection(userId,collectionIdHash);
                collectionKeyboardOptions.push([{ text: `${collectionInfo.name}`, callback_data: `ec_${collectionIdHash}` }]);
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

prefixHandlers['ec_'] = (action, message, user) => handlePrefix(action, message, user, 'editCollection')
actionMap['editCollection'] = handleCollectionMenu

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

stateHandlers[STATES.COLLECTIONNAME] = (message) => safeExecute(message,createConfig)

async function createConfig(message) {
    const name = message.text;
    const userId = message.from.id
    const hashId = Math.floor(10000000000000 * Math.random())
    console.log('this is the hash',hashId)
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
        size: 10,
        config: {
            masterPrompt: '',
            traitTypes: []
        },
        initiated: Date.now(),
        status: 'incomplete'
    }
    userContext.collections.push(thisCollection.collectionId)
    // Ensure studio[userId] is an object
    if (!studio.hasOwnProperty(userId)) {
        studio[userId] = {};
    }
    studio[userId][thisCollection.collectionId] = thisCollection;
    try {
        const success = await createCollection(thisCollection)
        if(!success){
            await sendMessage(message, 'Collection creation failed');
            return
        }
    } catch (err) {
        console.error('Error during Collection creation:', err);
        await sendMessage(message, 'Collection creation encountered an error.');
        return;
    }
    try {
        const userWriteSuccess = await writeUserDataPoint(parseInt(userId), 'collections',userContext.collections);
        if (!userWriteSuccess) {
            await sendMessage(message, 'Save settings failed, use /savesettings');
        }
    } catch (error) {
        console.error('Error writing user data:', error);
    }
   
    const { text, reply_markup } = await buildCollectionMenu(userId,hashId)
    sendMessage(message, text, { reply_markup })
    setUserState(message,STATES.IDLE)
}

async function handleCollectionMenu(message,user,collectionId) {
    const { text, reply_markup } = await buildCollectionMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id,{reply_markup},text)
    setUserState(message,STATES.IDLE)
}

function calculateCompletionPercentage(collectionData) {
    const { config } = collectionData;
    const traitTypes = config.traitTypes;

    // Handle the case where there are no trait types yet
    if (traitTypes.length === 0) {
        return 0; // 0% completion if no trait types are defined
    }

    // Calculate completion as a percentage based on the number of trait types
    const maxTraitTypes = 10; // 10 trait types means 100% completion
    const currentTraitTypes = traitTypes.length;

    // Calculate the percentage
    const completionPercentage = Math.min((currentTraitTypes / maxTraitTypes) * 100, 100);

    return completionPercentage;
}

async function buildCollectionMenu(userId,collectionId) {
    try {
        const COMPLETION_THRESHOLD = 100
        let collectionData = await getOrLoadCollection(userId,collectionId)
        const { name, status, submitted } = collectionData;

        let menuText = `${name}\nSTATUS: ${status}`;
        if (submitted) {
            const timeSinceSubmitted = Math.floor((Date.now() - submitted) / 1000);
            menuText += `\nSubmitted: ${timeSinceSubmitted} seconds ago`;
        }

        const inlineKeyboard = [];

        inlineKeyboard.push([{ text: '↖︎', callback_data: 'collectionModeMenu' }]);
        inlineKeyboard.push([{ text: 'metadata', callback_data: 'collectionMetaData' }])
        inlineKeyboard.push([{ text: 'config', callback_data: 'collectionConfigMenu' }])
        inlineKeyboard.push([{ text: 'consult', callback_data: 'collectionConsult' }])

        if (!submitted) {
            let completedCount = calculateCompletionPercentage(collectionData);
            
            inlineKeyboard.push([{ text: '🗑️', callback_data: `rmc_${collectionId}` }]);

            if (completedCount >= COMPLETION_THRESHOLD) {
                inlineKeyboard.push([{ text: 'Submit', callback_data: `sc_${collectionId}` }]);
            }
        }
        
        return {
            text: menuText,
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        };
    } catch (error) {
        console.error("Error building collection menu:", error);
        return null;
    }
}

//prefixHandlers['rmc_'] = 
// prefixHandlers['rmc_'] = (action, message, user) => handlePrefix(action, message, user, 'removeCollection');
actionMap['removeCollection'] = removeCollection
prefixHandlers['rmc_']= (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    actionMap['removeCollection'](message,user,collectionId)
}

async function removeCollection(message,user, collectionId) {
    console.log('remove collection',user,collectionId)
    if (!lobby[user]) {
        console.log(`User ${user} not found in lobby, checking in.`);
        await checkIn({ from: { id: user }, chat: { id: user } });
    }

    // Safely update the user's collections array
    if (lobby[user]?.collections) {
        lobby[user].collections = lobby[user].collections.filter(collection => collection !== collectionId);
    } else {
        console.log(`User ${user} has no collections to remove.`);
    }

    // Remove the collection from the studio
    if (studio.hasOwnProperty(user) && studio[user].hasOwnProperty(collectionId)) {
        delete studio[user][collectionId];
        console.log(`studio entry for collection ${collectionId} removed.`);
    }

    // Delete the collection data from the database and associated files
    await deleteStudio(collectionId);
    await writeUserDataPoint(user,'collections',lobby[user].collections)
    await handleCollectionModeMenu(message,user)
}


async function getOrLoadCollection(userId, collectionId) {
    console.log('userId',userId,'collectionId',collectionId)
    if (studio[userId]?.[collectionId]) {
        console.log(`Using cached collection data for user ${userId}, collection ${collectionId}`);
        return studio[userId][collectionId];
    }

    console.log(`Loading collection data for user ${userId}, collection ${collectionId} from database...`);
    const collectionData = await loadCollection(collectionId);

    if (!collectionData) {
        throw new Error(`collection data not found for ID ${collectionId}`);
    }

    // Initialize studio for the user if necessary
    if (!studio[userId]) {
        studio[userId] = {};
    }

    // Cache the loaded data in the namespaced studio
    studio[userId][collectionId] = collectionData;
    return collectionData;
}


function handlePrefix(action, message, user, actionKey) {
    const collectionId = parseInt(action.split('_')[1]);
    actionMap[actionKey](message, user, collectionId);
}

