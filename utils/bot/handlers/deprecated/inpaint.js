const { getPhotoUrl, makeSeed, lobby, STATES } = require('../bot')
const { sendMessage, setUserState, editMessage, gated } = require('../../utils')
const { enqueueTask } = require('../queue');
const Jimp = require('jimp');

// async function startInpaint(message, user = null) {

// }

// async function startInpaint(message, user) {
//     if(user){
//         message.from.id = user;
//         await editMessage({
//             text: 'Send in the photo you want to inpaint.',
//             chat_id: message.chat.id,
//             message_id: message.message_id
//         })
//     } else {
//         if(lobby[message.from.id] && lobby[message.from.id].balance < 400000){
//             gated(message)
//             return
//         }
//         sendMessage(message, 'Send in the photo you want to inpaint.',{reply_to_message_id: message.message_id})
//     }
//     setUserState(message,STATES.INPAINT)
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
        await sendMessage(message, `The dimensions of the photo are ${width}x${height}. Describe what part of the photo you want to replace.`);       
        //sendMessage(message,'Ok now go here: https://imagemasker.github.io/ put that same photo in there and draw white over the part you want to inpaint and black over everything else then post it back here') 
        setUserState(message,STATES.INPAINTTARGET);
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

async function handleInpaintTarget(message) {
    const userId = message.from.id;
    let userInput = message.text;
    userInput == '' ? userInput = '' : null;

    lobby[userId] = {
        ...lobby[userId],
        inpaintTarget: userInput,
        type: 'INPAINT'
    }
    await sendMessage(message, 'What do you want instead of what you described.');
    // const promptObj = {
    //     ...lobby[userId],
    //     seed: lobby[userId].lastSeed,
    //     photoStats: lobby[userId].tempSize
    // }
    //return await shakeMs2(message,promptObj);
    //enqueueTask({message,promptObj})
    setUserState(message,STATES.INPAINTPROMPT);
}

module.exports = { handleInpaint, handleInpaintPrompt, handleInpaintTarget }