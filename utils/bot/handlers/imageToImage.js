const { sendMessage, editMessage, setUserState, react } = require('../../utils')
const { getPhotoUrl, lobby, STATES, makeSeed } = require('../bot')
const { enqueueTask } = require('../queue')
const Jimp = require('jimp');

async function startMs2(message, user = null) {

    if(user){
        message.from.id = user;
        await editMessage({
            text: 'Send in the photo you want to img to img.',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        sendMessage(message, 'Send in the photo you want to img to img.',{reply_to_message_id: message.message_id})
    }
    setUserState(message,STATES.IMG2IMG)
}

async function startPfp(message, user = null) {

    if(user){
        message.from.id = user;
        await editMessage({
            text: 'Send in the photo you want to img to img. I will do the prompt myself.',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        sendMessage(message, 'Send in the photo you want to img to img.  I will do the prompt myself.',{reply_to_message_id: message.message_id})
    }
    setUserState(message,STATES.PFP)
}

async function handleMs2ImgFile(message) {
    if(!message.photo || message.document) {
        return;
    }
    const sent = await sendMessage(message,'okay lemme see...');
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

        await editMessage(
            {
                text: `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`,
                chat_id: sent.chat.id,
                message_id: sent.message_id
            }
        );        
        setUserState(message,STATES.MS2PROMPT);
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        await editMessage(
            {
                text: "An error occurred while processing the photo. Please send it again, or another photo.",
                chat_id: sent.chat.id,
                message_id: sent.message_id
            }
        );      
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
        if (!lobby[userId].styleFileUrl){
            sendMessage(message, 'hey use the setstyle command to pick a style photo');
            return;
        }
        lobby[userId].type = 'MS2_STYLE'
    } else if (lobby[userId].styleTransfer && lobby[userId].controlNet){
        if (!lobby[userId].styleFileUrl && !lobby[userId].controlFileUrl){
            sendMessage(message, 'hey use the setstyle command to pick a style photo');
            return;
        }
        lobby[userId].type = 'MS2_CONTROL_STYLE'
    } else if (lobby[userId].controlNet && !lobby[userId].styleTransfer){
        lobby[userId].type = 'MS2_CONTROL'
    }

    
    await react(message);
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
    //sendMessage(message,'sorry this is broken rn');
    if(!message.photo || message.document) {
        return;
    }
    sendMessage(message,'looks good. sit tight');
    chatId = message.chat.id;
    const userId = message.from.id;
    const fileUrl = await getPhotoUrl(message);
    //const{time,result} = await interrogateImage(message, fileUrl);
    
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
            type: 'PFP',
            tempSize: photoStats,
            fileUrl: fileUrl
        }


        if(lobby[userId].styleTransfer && !lobby[userId].controlNet) {
            if (!lobby[userId].styleFileUrl){
                sendMessage(message, 'hey use the setstyle command to pick a style photo');
                return;
            }
            lobby[userId].type = 'PFP_STYLE'
        } else if (lobby[userId].styleTransfer && lobby[userId].controlNet){
            if (!lobby[userId].styleFileUrl){
                sendMessage(message, 'hey use the setstyle command to pick a style/ control photo');
                return;
            }
            lobby[userId].type = 'PFP_CONTROL_STYLE'
        } else if (lobby[userId].controlNet && !lobby[userId].styleTransfer){
            lobby[userId].type = 'PFP_CONTROL'
        }
        
        const promptObj = {
            ...lobby[userId],
            seed: thisSeed,
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
    handleMs2ImgFile,
    startMs2,
    startPfp
}