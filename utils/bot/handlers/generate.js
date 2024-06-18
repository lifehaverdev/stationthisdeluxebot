const { STATES, lobby, rooms, makeSeed } = require('../bot')
const { sendMessage } = require('../../utils')
const { enqueueTask } = require('../queue')

async function startMake(message) {
    await sendMessage(message,'What prompt for your txt2img?')
    setUserState(message,STATES.MAKE)
}
async function handleMake(message) {
    console.log('MAKING SOMETHING')
    const chatId = message.chat.id;
    const userId = message.from.id;



    if(message.text.replace('/make','').replace(`@${process.env.BOT_NAME}`,'') == ''){
        startMake();
        return
    }

    
    let batch;
    if(chatId < 0){
        batch = 1;
    } else {
        batch = lobby[userId].batchMax;
    }

    const index = rooms.findIndex((group) => group.chat.id === message.chat.id);

    let settings = { ...lobby[userId] }; // Start with lobby settings
    let thisSeed
    if (index !== -1) {
        const matchedRoom = rooms[index];
        console.log(matchedRoom); // Log the matched room object
        thisSeed = makeSeed(-1);
        // Apply group settings if user balance is 0, otherwise use user settings
        if (lobby[userId].balance === 0) {
            settings = {
                ...matchedRoom.settings, // Group settings
                ...settings // Keep any necessary default settings
            };
        } else {
            // Merge user settings with group settings giving priority to user settings
            settings = {
                ...matchedRoom.settings, // Group settings
                ...lobby[userId] // User-specific settings with balance > 0
            };
            thisSeed = makeSeed(userId);
        }
    } else {
        thisSeed = makeSeed(userId);
    }

    if(settings.state.state != STATES.IDLE && settings.state.state != STATES.MAKE){
        return;
    }

    //save these settings into lobby in case cook mode time
    lobby[userId] = {
        ...lobby[userId],
        prompt: message.text,
        type: 'MAKE',
        lastSeed: thisSeed
    }

    if(settings.styleTransfer && !settings.controlNet) {
        if (!settings.stylefileUrl){
            sendMessage(message, 'hey use the setstyle command to pick a style photo');
            return;
        }
        lobby[userId].type = 'MAKE_STYLE'
    } else if (settings.styleTransfer && settings.controlNet){
        if (!settings.stylefileUrl && !settings.controlfileUrl){
            sendMessage(message, 'hey use the setstyle setcontrol command to pick a style/ control photo');
            return;
        }
        lobby[userId].type = 'MAKE_CONTROL_STYLE'
    } else if (settings.controlNet && !settings.styleTransfer){
        if(!settings.controlfileUrl) {
            sendMessage(message, 'hey use setcontrol command to pick a control image');
            return;
        }
        lobby[userId].type = 'MAKE_CONTROL'
    }

    const promptObj = {
        ...settings,
        seed: thisSeed,
        batchMax: batch
    }
        
    try {
        sendMessage(message,'k');
        console.log('check out the prompt object')
        console.log(promptObj);
        enqueueTask({message,promptObj})
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}
async function handleMake3(message) {
    console.log('MAK3ING SOMETHING')
    const chatId = message.chat.id;
    const userId = message.from.id;
    // if(!await checkLobby(message)){
    //     return;
    // }

    if(lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MAKE){
        return;
    }

    if(message.text.replace('/make3','').replace(`@${process.env.BOT_NAME}`,'') == ''){
        startMake();
        return
    }

    const thisSeed = makeSeed(userId);
    let batch;
    if(chatId < 0){
        batch = 1;
    } else {
        batch = lobby[userId].batchMax;
    }

    //save these settings into lobby in case cook mode time
    lobby[userId] = {
        ...lobby[userId],
        prompt: message.text,
        type: 'MAKE3',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...lobby[userId],
        seed: thisSeed,
        batchMax: batch
    }
        
    try {
        sendMessage(message,'k3');
        console.log('check out the prompt object')
        console.log(promptObj);
        enqueueTask({message,promptObj})
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}


async function handleRegen(message) {
    const userId = message.from.id;
    const thisSeed = makeSeed(userId);
    lobby[userId].lastSeed = thisSeed;

    const promptObj = {
        ...lobby[userId],
        seed: thisSeed,
    }
    if(lobby[userId].type == 'MAKE'){
        try {
            sendMessage(message,'ok')
            enqueueTask({message,promptObj})
    
        } catch (error) {
            console.error("Error generating and sending image:", error);
        }
    } else if (lobby[userId].type == 'MS2' || lobby[userId].type == 'INPAINT'){
        promptObj.photoStats = lobby[userId].tempSize
        await sendMessage(message, 'pls wait i will make in 1 second');
        //await shakeMs2(message,promptObj)
        enqueueTask({message,promptObj})
    } else if (lobby[userId].type == ''){
        lobby[userId].type = 'MAKE';
        sendMessage(message,'k');
        enqueueTask({message,promptObj})
    }
}

module.exports = { startMake, handleMake, handleRegen, handleMake3 }