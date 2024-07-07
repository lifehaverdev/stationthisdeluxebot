const { getPhotoUrl, makeSeed, lobby } = require('../bot')
const { sendMessage, setUserState } = require('../../utils')
const { enqueueTask } = require('../queue');

// async function startInpaint(message, user = null) {

// }
async function handleInpaint(message) {
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
        await sendMessage(message, `The dimensions of the photo are ${width}x${height}.`);       
        sendMessage(message,'Ok now go here: https://imagemasker.github.io/ put that same photo in there and draw white over the part you want to inpaint and black over everything else then post it back here') 
        setUserState(message,STATES.MASK);
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}
async function handleMask(message) {
    chatId = message.chat.id;
    const userId = message.from.id;
    const fileUrl = await getPhotoUrl(message);
    
    try {
        const photo = await Jimp.read(fileUrl);
        const { width, height } = photo.bitmap;

        const photoStats = {
            width: width,
            height: height
        };

        if (photoStats.width != lobby[userId].tempSize.width || photoStats.height != lobby[userId].tempSize.height){
            sendMessage(message,'hey those dont match. try again from beginning')
            setUserState(message,STATES.IDLE);
            
        }


        lobby[userId].mask = fileUrl
        
        //console.log(lobby[userId])
        sendMessage(message,'What prompt for the inpainting pls')
        setUserState(message,STATES.MASKPROMPT);
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
    
}
async function handleInpaintPrompt(message) {
    const userId = message.from.id;
    let userInput = message.text;
    userInput == '' ? userInput = '' : null;

    lobby[userId] = {
        ...lobby[userId],
        prompt: userInput,
        type: 'INPAINT'
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
}

module.exports = { handleInpaint, handleInpaintPrompt, handleMask }