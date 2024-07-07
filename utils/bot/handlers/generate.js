const { STATES, lobby, rooms, makeSeed } = require('../bot')
const { sendMessage, react, setUserState, editMessage, gated } = require('../../utils')
const { enqueueTask } = require('../queue')

async function startMake(message, user = null) {

    if(user){
        message.from.id = user;
        await editMessage({
            text: 'What prompt for your txt2img?',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        sendMessage(message, 'What prompt for your txt2img?')
    }
    //await sendMessage(message,'What prompt for your txt2img?')
    //console.log('user in start make',message.from.id);
    //console.log('message in start make',message);
    setUserState(message,STATES.MAKE)
}


async function startMake3(message,user) {
    if(user){
        message.from.id = user;
        await editMessage({
            text: 'What prompt for your txt2img sd3',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        if(lobby[message.from.id] && lobby[message.from.id].balance <= 500000){
            gated(message)
            return
        }
        sendMessage(message, 'What prompt for your txt2img sd3')
    }
    //await sendMessage(message,'What prompt for your txt2img sd3');
    setUserState(message,STATES.MAKE3)
}
async function handleMake(message) {
    console.log('MAKING SOMETHING')
    const chatId = message.chat.id;
    const userId = message.from.id;

    if(message.text.replace('/make','').replace(`@${process.env.BOT_NAME}`,'') == ''){
        startMake();
        return
    }

    

    //const index = rooms.findIndex((group) => group.chat.id === message.chat.id);

    //let settings = { ...lobby[userId] }; // Start with lobby settings
    
    //if (index !== -1) {
    //    const matchedRoom = rooms[index];
    //    console.log(matchedRoom); // Log the matched room object
    //    thisSeed = makeSeed(-1);
        // Apply group settings if user balance is 0, otherwise use user settings
    //    if (lobby[userId].balance === 0) {
    //        settings = {
    //            ...matchedRoom.settings, // Group settings
    //            ...settings // Keep any necessary default settings
    //        };
    //    } else {
    //        // Merge user settings with group settings giving priority to user settings
    //        settings = {
    //            ...matchedRoom.settings, // Group settings
    //            ...lobby[userId] // User-specific settings with balance > 0
    //        };
    //        thisSeed = makeSeed(userId);
    //    }
    //} else {
    //    thisSeed = makeSeed(userId);
    //}

    

    if(lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MAKE){
        return;
    }

    let thisSeed = makeSeed(userId)
    //save these lobby[userId] into lobby in case cook mode time
    lobby[userId] = {
        ...lobby[userId],
        prompt: message.text,
        type: 'MAKE',
        lastSeed: thisSeed
    }

    function tokenGate() {
        if(lobby[userId] && lobby[userId].balance <= 400000) {
            gated(message)
            return true
        }
    }

    if(lobby[userId].styleTransfer && !lobby[userId].controlNet) {
        if(tokenGate()){
            return
        }
        if (!lobby[userId].styleFileUrl){
            
            sendMessage(message, 'hey use the setstyle command to pick a style photo');
            return;
        }
        lobby[userId].type = 'MAKE_STYLE'
    } else if (lobby[userId].styleTransfer && lobby[userId].controlNet){
        if(tokenGate()){
            return
        }
        if (!lobby[userId].styleFileUrl && !lobby[userId].controlFileUrl){
            sendMessage(message, 'hey use the setstyle setcontrol command to pick a style/ control photo');
            return;
        }
        lobby[userId].type = 'MAKE_CONTROL_STYLE'
    } else if (lobby[userId].controlNet && !lobby[userId].styleTransfer){
        if(tokenGate()){
            return
        }
        if(!lobby[userId].controlFileUrl) {
            sendMessage(message, 'hey use setcontrol command to pick a control image');
            return;
        }
        lobby[userId].type = 'MAKE_CONTROL'
    }

    let batch;
    if(chatId < 0){
        batch = 1;
    } else {
        //lobby[userId] ? batch = lobby[userId.batchMax] : batch = 1
        batch = lobby[userId].batchMax;
    }

    const promptObj = {
        ...lobby[userId],
        seed: thisSeed,
        batchMax: batch
    }
        
    try {
        await react(message);
        console.log('check out the prompt object')
        //console.log(promptObj);
        enqueueTask({message,promptObj})
        setUserState(message, STATES.IDLE);
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}
async function handleMake3(message) {
    console.log('MAK3ING SOMETHING')
    const chatId = message.chat.id;
    const userId = message.from.id;
    if(lobby[userId] && lobby[userId].balance <= 400000000) {
        gated(message)
        return true
    }

    if(lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MAKE3){
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
        await react(message);
        console.log('check out the prompt object')
        console.log(promptObj);
        enqueueTask({message,promptObj})
        setUserState(message, STATES.IDLE);
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}


async function handleRegen(message) {
    const userId = message.from.id;
    const thisSeed = makeSeed(userId);
    lobby[userId].lastSeed = thisSeed;
    let batch;
    if(message.chat.id < 0){
        batch = 1;
    } else {
        //lobby[userId] ? batch = lobby[userId.batchMax] : batch = 1
        batch = lobby[userId].batchMax;
    }
    const promptObj = {
        ...lobby[userId],
        seed: thisSeed,
        batchMax: batch
    }
    if(
        lobby[userId].type == 'MAKE' || 
        lobby[userId].type == 'MAKE_STYLE' || 
        lobby[userId].type == 'MAKE_CONTROL_STYLE' ||
        lobby[userId].type == 'MAKE_CONTROL' ||
        lobby[userId].type == 'MAKE3'
    ){
        try {
            sendMessage(message,'ok')
            enqueueTask({message,promptObj})
    
        } catch (error) {
            console.error("Error generating and sending image:", error);
        }
    } else if (
        lobby[userId].type == 'MS2' || 
        lobby[userId].type == 'MS2_STYLE'|| 
        lobby[userId].type == 'MS2_CONTROL_STYLE' || 
        lobby[userId].type == 'MS2_CONTROL' ||
        lobby[userId].type == 'PFP' ||
        lobby[userId].type == 'PFP_CONTROL' ||
        lobby[userId].type == 'PFP_STYLE' ||
        lobby[userId].type == 'PFP_CONTROL_STYLE' ||
        lobby[userId].type == 'MS3' ||
        lobby[userId].type == 'INPAINT'
    ){
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

module.exports = { startMake, startMake3, handleMake, handleRegen, handleMake3 }