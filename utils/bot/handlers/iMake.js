const { STATES, lobby, rooms, makeSeed } = require('../bot')
const { sendMessage, react, setUserState, editMessage, gated } = require('../../utils')
const { enqueueTask } = require('../queue')
const { writeUserData } = require('../../../db/mongodb')
const { checkLobby } = require('../gatekeep')
const { getGroup } = require('./iGroup')

async function handlePromptCatch(message, match) {
    const slot = parseInt(match[1]); // Ensure it's an integer
    const userId = message.from.id
    if (slot < 1 || slot > 6) {
        sendMessage(message, "Invalid slot number. Please choose a slot between 1 and 6.");
        return;
    }

    const userSettings = lobby[userId];
    if (!userSettings) {
        sendMessage(message, "User settings not found.");
        return;
    }

    const prompt = userSettings.prompt;

    userSettings.promptdex[slot - 1] = prompt;
    writeUserData(userId,userSettings);
    sendMessage(message, `Prompt saved to slot ${slot} and settings saved`);
}

async function handleDexMake(message, match) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    if (!await checkLobby(message)) {
        return;
    }

    const slot = parseInt(match[1], 10);
    if (isNaN(slot) || slot < 1 || slot > 6) {
        sendMessage(message, "Invalid slot number. Please choose a slot between 1 and 6.");
        return;
    }

    const userSettings = lobby[userId];
    if (!userSettings) {
        sendMessage(message, "User settings not found.");
        return;
    }
    
    const prompt = userSettings.promptdex[slot - 1];
    if (!prompt) {
        sendMessage(message, `No prompt saved in slot ${slot}.`);
        return;
    }

    const thisSeed = makeSeed(userId);
    lobby[userId].lastSeed = thisSeed;

    let batch;
    if (chatId < 0) {
        batch = 1;
    } else {
        batch = userSettings.batchMax;
    }

    userSettings.prompt = prompt; // Update prompt with selected slot
    userSettings.type = 'MAKE';
    userSettings.lastSeed = thisSeed;


    const promptObj = {
        ...userSettings,
        seed: thisSeed,
        batchMax: batch,
        prompt: prompt
    };
    
    try {
        await react(message);
        enqueueTask({ message, promptObj });
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}



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

    const group = getGroup(message);

    let settings;
    if(group){
        settings = group.settings;
    } else {
        settings = lobby[userId]
    }
    
    if(settings && !group && settings.state.state != STATES.IDLE && settings.state.state != STATES.MAKE){
        console.log('we not in the right state')
        console.log(settings.state.state)
        return;
    }

    let thisSeed = makeSeed(userId)
    //save these settings into lobby in case cook mode time
    lobby[userId] = {
        ...settings,
        prompt: message.text,
        type: 'MAKE',
        lastSeed: thisSeed
    }

    function tokenGate() {
        if(!group && lobby[userId] && lobby[userId].balance < 400000) {
            gated(message)
            return true
        }
        if(group && group.applied < 400000){
            gated(message)
            return true
        }
    }

    if(settings.styleTransfer && !settings.controlNet) {
        if(tokenGate()){
            return
        }
        if (!settings.styleFileUrl){
            
            sendMessage(message, 'You do not currently have a photo set for your style transfer. Use the set menu and select style to pick a style photo');
            return;
        }
        settings.type = 'MAKE_STYLE'
    } else if (settings.styleTransfer && settings.controlNet){
        if(tokenGate()){
            return
        }
        if (!settings.styleFileUrl && !settings.controlFileUrl){
            sendMessage(message, 'hey use the setstyle setcontrol command to pick a style/ control photo');
            return;
        }
        settings.type = 'MAKE_CONTROL_STYLE'
    } else if (settings.controlNet && !settings.styleTransfer){
        if(tokenGate()){
            return
        }
        if(!settings.controlFileUrl) {
            sendMessage(message, 'hey use setcontrol command to pick a control image');
            return;
        }
        settings.type = 'MAKE_CONTROL'
    }

    let batch;
    let params;
    if(message.chat.id < 0){
        batch = 1;
        //batch = lobby[userId].batchMax
        //console.log('index in handlemake for groupchat',group.id)
        if(group){
            params = group.settings
        } else {
            //react(message)
            params = lobby[userId]
        }
    } else {
        //lobby[userId] ? batch = lobby[userId.batchMax] : batch = 1
        params = lobby[userId]
        batch = lobby[userId].batchMax;
    }
    
    const promptObj = {
        ...params,
        prompt: message.text,
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
    const group = getGroup(message);

    if((lobby[userId] && lobby[userId].balance < 400000)
    || (group && group.applied < 400000)
    ) {
        gated(message)
        return true
    }

    if(!group && lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MAKE3){
        return;
    }

    if(message.text.replace('/make3','').replace(`@${process.env.BOT_NAME}`,'') == ''){
        startMake3();
        return
    }

    let settings;
    if(group){
        settings = group.settings;
    } else {
        settings = lobby[userId]
    }

    const thisSeed = makeSeed(userId);
    let batch;
    if(chatId < 0){
        batch = 1;
    } else {
        batch = settings.batchMax;
    }

    //save these settings into lobby in case cook mode time
    lobby[userId] = {
        ...settings,
        prompt: message.text,
        type: 'MAKE3',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...settings,
        seed: thisSeed,
        batchMax: batch
    }
        
    try {
        await react(message);
        //console.log('check out the prompt object')
        //console.log(promptObj);
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
        //batch = 1;
        batch = lobby[userId].batchMax
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


async function handleMs2Prompt(message) {
    const userId = message.from.id;
    const group = getGroup(message)
    let userInput = message.text;
    //wtf does this do >
    //userInput == '' ? userInput = '' : null;

    let settings;
    if(group){
        settings = group.settings;
    } else {
        settings = lobby[userId]
    }

    lobby[userId] = {
        ...lobby[userId],
        prompt: userInput,
        type: 'MS2'
    }

    function tokenGate() {
        if((lobby[userId] && lobby[userId].balance < 400000)
            || (group && group.applied < 400000)
        ) {
            gated(message)
            return true
        }
    }
    if(settings.styleTransfer && !settings.controlNet) {
        if(tokenGate()){
            return;
        }
        if (!settings.styleFileUrl){
            sendMessage(message, 'You do not currently have a photo set for your style transfer. Use the set menu and select style to pick a style photo');
            return;
        }
        lobby[userId].type = 'MS2_STYLE'
    } else if (lobby[userId].styleTransfer && lobby[userId].controlNet){
        if(tokenGate()){
            return;
        }
        if (!lobby[userId].styleFileUrl && !lobby[userId].controlFileUrl){
            sendMessage(message, 'You do not currently have a photo set for your style transfer. Use the set menu and select style to pick a style photo');
            return;
        }
        lobby[userId].type = 'MS2_CONTROL_STYLE'
    } else if (lobby[userId].controlNet && !lobby[userId].styleTransfer){
        if(tokenGate()){
            return;
        }
        lobby[userId].type = 'MS2_CONTROL'
    }

    
    await react(message);
    const promptObj = {
        ...settings,
        seed: lobby[userId].lastSeed,
        photoStats: settings.tempSize
    }
    //return await shakeMs2(message,promptObj);
    enqueueTask({message,promptObj})
    setUserState(message,STATES.IDLE);
    return true
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

module.exports = { 
    startMake, 
    startMake3, 
    handleMake, 
    handleRegen, 
    handleMake3, 
    handleDexMake, 
    handlePromptCatch,
    handleMs2Prompt,
    handleInpaintPrompt,
    handleInpaintTarget
}