const { sendMessage, setUserState } = require('../../utils')
const { getPhotoUrl, lobby, STATES, makeSeed } = require('../bot')
const { enqueueTask } = require('../queue')
const Jimp = require('jimp');


async function handleMs2ImgFile(message) {
    sendMessage(message,'okay lemme see...');
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
        await sendMessage(message, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);        
        setUserState(message,STATES.MS2PROMPT);
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}
async function handleMs2Prompt(message) {
    const userId = message.from.id;
    let userInput = message.text;
    userInput == '' ? userInput = '' : null;

    lobby[userId] = {
        ...lobby[userId],
        prompt: userInput,
        type: 'MS2'
    }
    if(lobby[userId].styleTransfer && !lobby[userId].controlNet) {
        lobby[userId].type = 'MS2_STYLE'
    } else if (lobby[userId].styleTransfer && lobby[userId].controlNet) {
        lobby[userId].type = 'MS2_CONTROL_STYLE'
    } else if (lobby[userId].controlNet && !lobby[userId].styleTransfer){
        lobby[userId].type = 'MS2_CONTROL'
    }
    await sendMessage(message, 'pls wait i will make in 1 second');
    const promptObj = {
        ...lobby[userId],
        seed: lobby[userId].lastSeed,
        photoStats: lobby[userId].tempSize
    }
    //return await shakeMs2(message,promptObj);
    enqueueTask({message,promptObj})
    setUserState(message,STATES.IDLE);
    return true
}
async function handlePfpImgFile(message) {
    sendMessage(message,'looks good. sit tight');
    chatId = message.chat.id;
    const userId = message.from.id;
    const fileUrl = await getPhotoUrl(message);
    const{time,result} = await interrogateImage(message, fileUrl);
    
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
            prompt: result,
            lastSeed: thisSeed,
            type: 'MS2',
            tempSize: photoStats,
            fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
        }
        
        const promptObj = {
            ...lobby[userId],
            seed: thisSeed,
            strength: .6,
            cfg: 8,
            photoStats: photoStats,
        }
        //return await shakeMs2(message,promptObj);
        enqueueTask({message,promptObj})
        setUserState(message,STATES.IDLE);
        return true
    } catch (error) {
        console.error("Error processing photo:", error);
        sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}

module.exports = { 
    handlePfpImgFile,
    handleMs2Prompt,
    handleMs2ImgFile
}