const { lobby, getBotInstance } = require('../bot');
const bot = getBotInstance;
const { enqueueTask } = require('../queue');
const { sendMessage, setUserState } = require('../../utils')

async function handleMs3ImgFile(message) {
    chatId = message.chat.id;
    let fileId, fileUrl;
    const userData = lobby[message.from.id];

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    const promptObj = {
        ...userData,
        fileUrl: fileUrl,
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