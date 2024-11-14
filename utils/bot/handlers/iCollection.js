const { lobby, workspace, STATES, getPhotoUrl, getBotInstance } = require('../bot')
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
    //loadLora, 
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
    //console.log('getting loras')
    let collectionKeyboardOptions = [];
    //console.log(lobby[userId])
    if (lobby[userId] && lobby[userId].collections && lobby[userId].collections.length > 0) {
        //console.log('made it in')
        for (const collectionIdHash of lobby[userId].collections) {
            try {
                const collectionInfo = await loadCollection(collectionIdHash);
                collectionKeyboardOptions.push([{ text: `${collectionInfo.name}`, callback_data: `ec_${collectionIdHash}` }]);
            } catch (error) {
                console.error(`Failed to load Collection with ID ${collectionIdHash}:`, error);
            }
        }
    }
    if (!(lobby[userId] && lobby[userId].collections && lobby[userId].collections.length >= 3)) {
        collectionKeyboardOptions.push([{ text: '➕', callback_data: 'newCollection' }]);
    }
    return loraKeyboardOptions;
}

async function handleTrainingMenu(message, user) {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const myCollections = await getMyCollections(user);
    const replyMarkup = {
        inline_keyboard: [
            [{ text: '↖︎', callback_data: 'accountSettingsMenu' }],
            ...myCollections,
            [{ text: 'cancel', callback_data: 'cancel' }]
        ]
    };
    const txt = '🌟 Stationthisbot Collection Creation 🖼️👩‍🎨';
    await editMessage({
        reply_markup: replyMarkup,
        chat_id: chatId,
        message_id: messageId,
        text: txt,
    });
}