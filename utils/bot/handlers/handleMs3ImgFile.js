const { lobby, getPhotoUrl, makeSeed, STATES } = require('../bot');
//const bot = getBotInstance;
const { enqueueTask } = require('../queue');
const { sendMessage, setUserState } = require('../../utils')

async function handleMs3ImgFile(message) {
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

module.exports = { handleMs3ImgFile }