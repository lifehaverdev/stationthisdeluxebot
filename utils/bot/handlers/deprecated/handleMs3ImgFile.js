const { lobby, getPhotoUrl, makeSeed, STATES } = require('../bot');
//const bot = getBotInstance;
const { enqueueTask } = require('../queue');
const { sendMessage, setUserState, editMessage, gated } = require('../../utils')

async function startMs3(message, user) {

    if(user){
        message.from.id = user;
        await editMessage({
            text: 'Send in the photo you want to img to video.',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        if(lobby[message.from.id] && lobby[message.from.id].balance < 600000){
            gated(message)
            return
        }
        sendMessage(message, 'Send in the photo you want to img to video.',{reply_to_message_id: message.message_id})
    }
    setUserState(message,STATES.MS3)
}

async function handleMs3ImgFile(message) {
    if(!message.photo || message.document) {
        return;
    }
    chatId = message.chat.id;
    userId = message.from.id;
    const fileUrl = await getPhotoUrl(message);

    const thisSeed = makeSeed(userId);
    lobby[userId].lastSeed = thisSeed;

    const promptObj = {
        ...lobby[userId],
        fileUrl: fileUrl,
        seed: thisSeed,
        type: 'MS3',
    }
    try {
        //enqueueTask({message, promptObj})
        enqueueTask({message,promptObj})
        setUserState(message,STATES.IDLE);
        sendMessage(message, `Okay dont hold your breath`);        
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}

module.exports = { handleMs3ImgFile, startMs3 }