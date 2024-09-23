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
    const group = getGroup(message);
    if (!await checkLobby(message)) {
        return;
    }
    const slot = parseInt(match[1], 10);
    if (isNaN(slot) || slot < 1 || slot > 6) {
        sendMessage(message, "Invalid slot number. Please choose a slot between 1 and 6.");
        return;
    }
    let settings;
    if(group) {
        settings = group.settings
    } else {
        settings = lobby[userId]
    }
    const userSettings = lobby[userId];
    if (!settings) {
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

    settings.prompt = prompt; // Update prompt with selected slot
    userSettings.type = 'MAKE';
    userSettings.lastSeed = thisSeed;

    const promptObj = {
        ...settings,
        strength: 1,
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

function checkAndSetType(type, settings, message, group, userId) {
    // Early return for token gate if needed
    if (tokenGate(group, userId, message)) return;

    // Define required files based on settings
    const requiredFiles = [];
    
    if (settings.styleTransfer) requiredFiles.push({ name: 'styleFileUrl', message: 'You need to set a style image.' });
    if (settings.controlNet) requiredFiles.push({ name: 'controlFileUrl', message: 'You need to set a control image.' });
    if (settings.openPose) requiredFiles.push({ name: 'poseFileUrl', message: 'You need to set a pose image.' });

    // Check if any required files are missing
    for (let file of requiredFiles) {
        if (!settings[file.name]) {
            //sendMessage(message, `${file.message} use /set menu or turn off the fanciness in /accountsettings}`);
            return;
        }
    }

    // Dynamically build the type
    if (settings.controlNet && settings.controlFileUrl) type += '_CANNY';
    if (settings.styleTransfer && settings.styleFileUrl) type += '_STYLE';
    if (settings.openPose && settings.poseFileUrl) type += '_POSE';

    settings.type = type;
    console.log(`Selected type: ${settings.type}`);
}

function tokenGate(group, userId, message) {
    if(!group && lobby[userId] && lobby[userId].balance < 400000) {
        gated(message)
        return true
    }
    if(group && group.applied < 400000){
        gated(message)
        return true
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

async function startMog(message,user) {
        if(user){
            message.from.id = user;
            await editMessage({
                text: 'What prompt for your txt2img mogflux',
                chat_id: message.chat.id,
                message_id: message.message_id
            })
        } else {
            // if(lobby[message.from.id] && lobby[message.from.id].balance <= 100000){
            //     gated(message)
            //     return
            // }
            sendMessage(message, 'What prompt for your txt2img mogflux')
        }
        //await sendMessage(message,'What prompt for your txt2img sd3');
        setUserState(message,STATES.MOG)
    }

async function handleMake(message) {
    console.log('MAKING SOMETHING')
    const userId = message.from.id;
    message.text = message.text.replace('/make','').replace(`@${process.env.BOT_NAME}`,'')

    if(message.text == ''){
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
        ...lobby[userId],
        prompt: message.text,
        type: 'MAKE',
        lastSeed: thisSeed
    }

    checkAndSetType(lobby[userId].type, lobby[userId], message, group, userId);

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
        strength: 1,
        prompt: message.text,
        seed: thisSeed,
        batchMax: batch
    }
        
    try {
        await react(message);
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
        ...lobby[userId],
        prompt: message.text,
        type: 'MAKE3',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...settings,
        strength: 1,
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

async function handleMog(message) {
    console.log('MOGING SOMETHING')
    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);

    // if((lobby[userId] && lobby[userId].balance < 100000)
    // || (group && group.applied < 100000)
    // ) {
    //     gated(message)
    //     return true
    // }

    if(!group && lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MOG){
        return;
    }
    message.text = message.text.replace('/joycat','').replace(`@${process.env.BOT_NAME}`,'');
    if(message.text == ''){
        startMog();
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
        ...lobby[userId],
        prompt: message.text,
        type: 'MOG',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...settings,
        prompt: message.text,
        strength: 1,
        seed: thisSeed,
        batchMax: batch,
        type: 'MOG'
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

async function handleDegod(message) {
    console.log('DEGODDING SOMETHING')
    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);

    if(!group && lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MOG){
        return;
    }
    message.text = message.text.replace('/degod','').replace(`@${process.env.BOT_NAME}`,'');
    if(message.text == ''){
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
        ...lobby[userId],
        prompt: message.text,
        type: 'DEGOD',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...settings,
        prompt: message.text,
        strength: 1,
        seed: thisSeed,
        batchMax: batch,
        type: 'DEGOD'
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

async function handleMilady(message) {
    console.log('milady')
    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);

    if(!group && lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MOG){
        return;
    }
    message.text = message.text.replace('/milady','').replace(`@${process.env.BOT_NAME}`,'');
    if(message.text == ''){
        startMog();
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
        ...lobby[userId],
        prompt: message.text,
        type: 'MILADY',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...settings,
        prompt: message.text,
        strength: 1,
        seed: thisSeed,
        batchMax: batch,
        type: 'MILADY'
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

async function handleFlux(message) {
    console.log('flux')
    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);

    if(!group && lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.FLUX){
        return;
    }
    message.text = message.text.replace('/flux','').replace(`@${process.env.BOT_NAME}`,'');
    if(message.text == ''){
        console.log('no msg text')
        // startMog();
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
        ...lobby[userId],
        prompt: message.text,
        type: 'FLUX',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...settings,
        prompt: message.text,
        strength: 1,
        checkpoint: 'flux-schnell',
        seed: thisSeed,
        batchMax: batch,
        type: 'FLUX'
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
    const group = getGroup(message);
    let settings;
    if(group){
        settings = group.settings
    } else {
        settings = lobby[userId]
    }
    lobby[userId].lastSeed = thisSeed;
    let batch;
    if(message.chat.id < 0){
        batch = 1;
        //batch = lobby[userId].batchMax
    } else {
        //lobby[userId] ? batch = lobby[userId.batchMax] : batch = 1
        batch = lobby[userId].batchMax;
    }
    let strength;
    // if(settings.type.startsWith('MAKE')){
    //     strength = 1;
    // } else {
    //     strength = settings.strength
    // }
    const promptObj = {
        ...settings,
        strength: strength,
        prompt: lobby[userId].prompt,
        seed: thisSeed,
        batchMax: batch
    }
    react(message, '👍');
    enqueueTask({message, promptObj})
    setUserState(message, STATES.IDLE);
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
        type: 'I2I'
    }

    checkAndSetType(lobby[userId].type, settings, message, group, userId);
    
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
    //const group = getGroup(message);
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
    handleInpaintTarget,
    handleMog, startMog, handleDegod, handleMilady,
    handleFlux
}