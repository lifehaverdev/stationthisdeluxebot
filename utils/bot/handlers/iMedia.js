const { sendMessage, editMessage, setUserState } = require('../../utils')
const { getPhotoUrl, lobby, STATES, makeSeed } = require('../bot')
const { enqueueTask } = require('../queue')
const Jimp = require('jimp');


async function handleUpscale(message) {
    if(!message.photo || message.document) {
        return;
    }
    const sent = await sendMessage(message,'okay lemme see...');
    chatId = message.chat.id;
    const userId = message.from.id;

    const fileUrl = await getPhotoUrl(message)
    
    try {
        lobby[userId] = {
            ...lobby[userId],
            type: 'UPSCALE',
            fileUrl: fileUrl
        }

        await react(message);
        const promptObj = {
            ...lobby[userId]
        }
        enqueueTask({message,promptObj})
        setUserState(message,STATES.IDLE);
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

async function handleRmbg(message) {
    if(!message.photo || message.document) {
        return;
    }
    const sent = await sendMessage(message,'okay lemme see...');
    chatId = message.chat.id;
    const userId = message.from.id;

    const fileUrl = await getPhotoUrl(message)
    
    try {
        lobby[userId] = {
            ...lobby[userId],
            type: 'RMBG',
            fileUrl: fileUrl
        }

        await react(message);
        const promptObj = {
            ...lobby[userId]
        }
        enqueueTask({message,promptObj})
        setUserState(message,STATES.IDLE);
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

async function handleInterrogation(message) {
    sendMessage(message,'hmm what should i call this..');
    const photoUrl = await getPhotoUrl(message);
    try {
        const promptObj = {
            ...lobby[message.from.id],
            fileUrl: photoUrl,
            type: 'INTERROGATE'
        }
        //enqueueTask({message,promptObj})
        //const{time,result} = await interrogateImage(message, photoUrl);
        enqueueTask({message, promptObj})
        //sendMessage(message, result)
        setUserState(message,STATES.IDLE);
        return true
    } catch(err){
        console.log(err);
        return false
    }
}

module.exports = 
{
    handleMs2ImgFile,
    handlePfpImgFile,
    handleRmbg,
    handleUpscale,
    handleMs3ImgFile,
    handleInpaint,
    handleInterrogation
}