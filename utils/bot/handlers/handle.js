const { getBotInstance, lobby, startup, STATES, SETTER_TO_STATE, STATE_TO_LOBBYPARAM } = require('../bot'); 
const {
    sendMessage,
    safeExecute,
    setUserState
} = require('../../utils')
const bot = getBotInstance()
const { checkLobby } = require('../gatekeep')
const { loraTriggers } = require("../../models/loraTriggerTranslate");
const { enqueueTask, waiting, taskQueue } = require("../queue.js")
const defaultUserData = require('../../users/defaultUserData');
const {getUserDataByUserId, writeUserData} = require('../../../db/mongodb');
const { interrogateImage } = require('../../../commands/interrogate.js')
const { verifyHash } = require('../../users/verify.js')
const fs = require('fs');
const Jimp = require('jimp');
const { txt2Speech } = require('../../../commands/speak.js');
const { promptAssist } = require('../../../commands/assist.js')


const SIZELIMIT = 2048;
const BATCHLIMIT = 4;

const STEPSLIMIT = 48;

function makeSeed(userId) {
    if(lobby[userId].seed == -1){
        return Math.floor(Math.random() * 1000000);
    } else {
        return lobby[userId].seed;
    }
};

function calcBatch(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    let possibleBatch;
    if(lobby[userId]){
        possibleBatch = Math.floor(lobby[userId].balance / 1000000) + 1;
        if(possibleBatch > BATCHLIMIT){
            possibleBatch = BATCHLIMIT;
        }
        return possibleBatch
    } else {
        sendMessage(message,'hey, please make something first so i can see ur account')
    }
}
function calcSteps(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let possibleSteps;
    if(lobby[userId]){
        possibleSteps = Math.floor(lobby[userId].balance / 1000000) + 30;
        if(possibleSteps > STEPSLIMIT){
            possibleSteps = STEPSLIMIT;
        }
        return possibleSteps
    } else {
        sendMessage(message,'hey, please make something first so i can see ur account')
    }
}
function calcSize(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    let possibleSize;
    if(lobby[userId]){
        possibleSize = Math.floor(lobby[userId].balance / 1000) + 1024; //has 1000000 is 1000 1000, can go 2024
        if(possibleSize > SIZELIMIT){
            possibleSize = SIZELIMIT;
        }
        return possibleSize
    } else {
        sendMessage(message,'hey, please make something first so i can see ur account')
    }
}
function compactSerialize(data) {
    return `${data.action}|${data.fromId}|${data.text}|${data.chatId}|${data.firstName}|${data.threadId}|${data.id}`;
}
function displayAccountSettingsMenu(message) {
    // Create account settings menu keyboard
    const userId = message.from.id;
    const chatId = message.chat.id;
    let accountSettingsKeyboard = [
        [
            {
                text: `Advanced User: ${lobby[userId].advancedUser ? 'Enabled' : 'Disabled'}`,
                callback_data: 'toggleAdvancedUser',
            },
            // {
            //     text: `Whale Mode: ${lobby[userId].whaleMode ? 'Enabled' : 'Disabled'}`,
            //     callback_data: 'toggleWhaleMode'
            // },
            
        ]
    ];

    if (lobby[userId].balance >= 0){//1000000) {
        accountSettingsKeyboard[0].push(
            {
                text: `Watermark: ${lobby[userId].waterMark ? 'ON' : 'OFF'}`,
                callback_data: 'toggleWaterMark',
            },
            {
                text: `Base Prompt Menu`,
                callback_data: 'toggleBasePrompt',
            },
            {
                text: `Voice Menu`,
                callback_data: 'toggleVoice'
            },
            {
                text: `ControlNet`,
                callback_data: 'toggleControlNet',
            },
            {
                text: 'Style Transfer',
                callback_data: 'toggleStyleTransfer'
            }
        );
    }
    if (lobby[userId].balance >= 0){//} 5000000) {
        accountSettingsKeyboard[0].push(
            {
                text: `Checkpoint Menu`,
                callback_data: 'toggleCheckpoint',
            },
        );
    }

    // Send account settings menu
    bot.sendMessage(chatId, 'Account Settings:', {
        reply_markup: {
            inline_keyboard: accountSettingsKeyboard
        }
    });
}
async function handleAdvancedUserOptions(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    //console.log('message in handle advanced',message);
    if (lobby[userId].advancedUser && chatId > 0) {
        // Prepare data for callback serialization
        const baseData = {
            text: 'k',
            id: message.message_id,
            fromId: message.from.id,
            chatId: message.chat.id,
            firstName: message.from.first_name.slice(0, 10), // Limit length of the name to avoid exceeding limit
            threadId: message.message_thread_id || 0 // Use 0 if thread ID is not available
        };
        console.log(baseData);
        console.log(compactSerialize({ ...baseData, action: 'regen' }))
        // Create inline keyboard with compact serialized callback data
        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Regenerate', callback_data: compactSerialize({ ...baseData, action: 'regen' }) },
                    { text: 'Set CFG', callback_data: compactSerialize({ ...baseData, action: 'setcfg' }) },
                    { text: 'Set Prompt', callback_data: compactSerialize({ ...baseData, action: 'setprompt' }) }
                ]
            ]
        };

        // Send the message with inline keyboard
        sendMessage(message, `Used seed: ${lobby[userId].lastSeed}`, replyMarkup);
    }
}


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



function saySeed(message){
    if(lobby[message.from.id]){
        sendMessage(message,`the last seed you used was ${lobby[message.from.id].lastSeed}`);
    } else {
        sendMessage(message, 'gen something and Ill tell you what seed you used');
    }
}

async function startSet(message) {
    const command = message.text.replace('/set','');
    const userId = message.from.id;
    const setter = `set${command}`;
    const state = SETTER_TO_STATE[setter]
    const lobbyParam = STATE_TO_LOBBYPARAM[state]
    const currentValue = lobby[userId] ? (lobby[userId][lobbyParam] || "not set") : "not set";
    if(currentValue == 'notset'){
        console.log('not set');
        setUserState(STATES.IDLE)
        
    } else {
        switch (command) {
            case 'batch':
                const maxBatch = calcBatch(message); // Assume calcBatch is defined elsewhere
                await sendMessage(message, `What batch do you want to set to? Rn it is set to ${currentValue}. You can go up to ${maxBatch}`);
                break;
            case 'steps':
                const maxSteps = calcSteps(message); // Assume calcSteps is defined elsewhere
                await sendMessage(message, `What steps do you want to set to? Rn it is set to ${currentValue}. You can go up to ${maxSteps}`);
                break;
            case 'size':
                const maxSize = calcSize(message); // Assume calcSize is defined elsewhere
                await sendMessage(message, `What size do you want to set to? Rn it is set to ${currentValue.width},${currentValue.height}. Your maximum size is ${maxSize},${maxSize}`);
                break;
            case 'cfg':
                await sendMessage(message, `What CFG do you want to set to? Rn it is set to ${currentValue}. Please enter a value between 0 and 30`);
                break;
            case 'strength':
                await sendMessage(message, `What strength do you want to set to? Rn it is set to ${currentValue}. Please enter a decimal value (i.e. '.4' or '0.5') between 0 and 1`);
                break;
            case 'prompt':
            case 'userprompt':
            case 'negprompt': 
                await sendMessage(message, `What ${command} do you want to set it to? Rn it is set to:`);
                await sendMessage(message, ` ${currentValue}`);
                break;
            case 'photo':
                await sendMessage(message, 'What photo do you want to set')
                break;
            default:
                await sendMessage(message, `Rn it is set to ${currentValue}. What ${command} do you want to set it to?`);
                break;
        }
        setUserState(message,state);
    }
}

function handleHelp(message) {
    const chatId = message.chat.id;

    const helpMessage = `
    HOW TO MAKE SILLY PICTURES AND BEAUTIFUL GENERATIONS WITH OUR PRECIOUS STATIONTHIS BOT ON TELEGRAM

    TYPE IN /make + a prompt (dont just use the command)
    and you will receive an image
    use the /assist command + a smol prompt and gpt will expound on it for you if you're not feeling creative
    use the /pfp command and send in a photo after the response to automatically receive an img2img that was prompted for you
    use the /ms2 command to initiate an img2img, send a photo, provide a prompt and sit back
    use /interrogate to create a prompt based on a photo you provide
    use /regen to try another version of your last one

    use /disc to put your image on a ms2 disc
    use /watermark to brand your image with the ms2 logo
    
    ADVANCED USE
    heres where we are currently developing a lot and you may find some new features. 
    Use the /accountsettings command to bring up a menu. If you have >1M tokens or have been blessed by the dev youll be able to remove the watermark from your renders as well as change base prompts
    
    SETTERS
    for /regen purposes, we have provided setter commands to tweak what your workspace sends to stable diffusion
    /setprompt
    /setcfg
    /setstrength (only applies to img2img)
    /setseed
    /setnegativeprompt
    /setsize (sdxl really loves 1024x1024 so dont go too crazy)
    /setbatch 
    /setsteps
    /setphoto

    /setuserprompt sets an additional baseprompt to be added to all generations while it is activated, you can input loras here as well
    to toggle its activation use /toggleuserprompt
    
    if you are really onto something please be sure to use /savesettings in case the bot crashes you will be able to pick up where you left off
    you can also use /getseed to see what seed was used for the last image so you can farm good generation seeds
    using these features, you will be cooking fr
    you can also utilize /promptcatch <SLOT> to save a prompt to 1 of 6 slots on your account
    then just use /dexmake <SLOT> to create an image with that prompt and your current settings
    If you make a mess of your account and want to start fresh use /resetaccount
    
    TROUBLESHOOTING
    
    First of all if you find a bug go to the techsupport channel and tell the dev, hes trying to make the bot perfect so pls help
    
    If you are stuck in some sort of UI call and rsponse loop or if you change your mind in the middle of one, use the /quit command
    If you are unsure whether the bot is alive use the /status command
    If your settings are all wonky, try /resetaccount or /signout and /signin again. you won't have to reverify
    
    EXTRA
    
    If you have a model you want me to check out use the /request command and shoot it in here ill take a look
    
    Try the /loralist command to see what LORAs we offer along with their key words, just use the trigger word somewhere in your prompt to activate it`

    sendMessage(message, helpMessage);
}
function handleStatus(message) {
    sendMessage(message, 
`
I have been running for ${(Date.now() - startup) / 1000} seconds. 

Waiting: 
${taskQueue.map(task => {
    const username = task.message.from.username || 'Unknown'; // Get the username or use 'Unknown' if not available
    return `${username}: ${task.promptObj.type}`; // Include remaining time in the status
}).join('\n')}

Working on: 
${waiting.map(task => {
    const username = task.message.from.username || 'Unknown'; // Get the username or use 'Unknown' if not available
    const remainingTime = task.status; // Calculate remaining time until checkback
    return `${username}: ${task.promptObj.type} ${remainingTime}`; // Include the username in the status
}).join('\n')}
`
    );
}
async function startMake(message) {
    await sendMessage(message,'What prompt for your txt2img?')
    setUserState(message,STATES.MAKE)
}
async function handleMake(message) {
    console.log('MAKING SOMETHING')
    const chatId = message.chat.id;
    const userId = message.from.id;
    if(!await checkLobby(message)){
        return;
    }

    if(lobby[userId].state.state != STATES.IDLE && lobby[userId].state.state != STATES.MAKE){
        return;
    }

    if(message.text.replace('/make','').replace(`@${process.env.BOT_NAME}`,'') == ''){
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
        type: 'MAKE',
        lastSeed: thisSeed
    }

    if(lobby[userId].styleTransfer && !lobby[userId].controlNet) {
        if (!lobby[userId].stylefileUrl){
            sendMessage(message, 'hey use the setstyle command to pick a style photo');
            return;
        }
        lobby[userId].type = 'MAKE_STYLE'
    } else if (lobby[userId].styleTransfer && lobby[userId].controlNet){
        if (!lobby[userId].stylefileUrl && !lobby[userId].controlfileUrl){
            sendMessage(message, 'hey use the setstyle setcontrol command to pick a style/ control photo');
            return;
        }
        lobby[userId].type = 'MAKE_CONTROL_STYLE'
    } else if (lobby[userId].controlNet && !lobby[userId].styleTransfer){
        if(!lobby[userId].controlfileUrl) {
            sendMessage(message, 'hey use setcontrol command to pick a control image');
            return;
        }
        lobby[userId].type = 'MAKE_CONTROL'
    }

    const promptObj = {
        ...lobby[userId],
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
    if(!await checkLobby(message)){
        return;
    }

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
        sendMessage(message, 'k');
        enqueueTask({ message, promptObj });
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}


async function handleRegen(message) {
    const userId = message.from.id;
    // if(!await checkLobby(message)){
    //     return;
    // }
    // we do this in watch

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
async function handleInterrogation(message) {
    sendMessage(message,'hmm what should i call this..');
    let fileId;
    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const photoInfo = await bot.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${photoInfo.file_path}`;
    // const promptObj = {
    //     type: 'INTER',
    //     photoUrl: photoUrl
    // }
    try {
        //enqueueTask({message,promptObj})
        const{time,result} = await interrogateImage(message, photoUrl);
        sendMessage(message, result)
        setUserState(message,STATES.IDLE);
        return true
    } catch(err){
        console.log(err);
        return false
    }
}
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
async function handleInpaint(message) {
    chatId = message.chat.id;
    const userId = message.from.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
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
            fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
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
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
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


        lobby[userId].mask = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
        
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
//
// setter
//
async function handleSet(message) {
    
    const userId = message.from.id;
    const newValue = message.text;
    const currentState = lobby[userId].state.state;
    const lobbyParam = STATE_TO_LOBBYPARAM[currentState];
    console.log('current user state',currentState)
    if (!lobby[userId]) {
        sendMessage(message, "You need to make something first");
        return;
    }

    switch (currentState) {
        case STATES.SETPROMPT:
        case STATES.SETTYPE:
            lobby[userId][lobbyParam] = newValue;
            sendMessage(message, `ok its set`);
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETNEGATIVEPROMPT:
        case STATES.SETUSERPROMPT:
            lobby[userId][lobbyParam] = newValue;
            if(newValue == '-1'){
                sendMessage(message,'alright its off');
            } else {
                sendMessage(message, `ok its set`);
            }
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETPHOTO:
        case STATES.SETSTYLE:
        case STATES.SETCONTROL:
            let fileId, fileUrl;
            if (message.photo) {
                fileId = message.photo[message.photo.length - 1].file_id;
            } else if (message.document) {
                fileId = message.document.file_id;
            }
            const fileInfo = await bot.getFile(fileId);
            fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
            try {
                const photo = await Jimp.read(fileUrl);
                const { width, height } = photo.bitmap;

                if(currentState == STATES.SETPHOTO) {
                    const photoStats = {
                        width: width,
                        height: height
                    };
                    
                    lobby[userId] = {
                        ...lobby[userId],
                        photoStats: photoStats,
                        fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
                    }
                    await sendMessage(message, `k got it. The dimensions of the photo are ${width}x${height}`);
                } else if(currentState == STATES.SETCONTROL) {
                    
                    lobby[userId] = {
                        ...lobby[userId],
                        controlfileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
                    }
                    await sendMessage(message, `k got it. The dimensions of the photo are ${width}x${height}`);
                } else {
                    lobby[userId] = {
                        ...lobby[userId],
                        styleFileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`,
                    }
                    await sendMessage(message, `looks dope. if style transfer is enabled in account settings, this image will be applied for make`);
                }
        
                setUserState(message,STATES.IDLE);
            } catch(err) {
                bot.sendMessage(DEV_DMS,err);
            }
            break;
        case STATES.SETSTEPS:
        case STATES.SETBATCH:
        case STATES.SETSEED:
            const intValue = parseInt(newValue, 10);
            if (isNaN(intValue)) {
                sendMessage(message, 'Please enter a valid integer');
                return false;
            }
            if (currentState === STATES.SETSTEPS) {
                const maxSteps = calcSteps(message);
                if (intValue > maxSteps) {
                    sendMessage(message, `Please enter a value up to ${maxSteps}`);
                    return false;
                }
            } else if (currentState === STATES.SETBATCH) {
                const maxBatch = calcBatch(message);
                if (intValue > maxBatch) {
                    sendMessage(message, `Please enter a value up to ${maxBatch}`);
                    return false;
                }
            }
            lobby[userId][lobbyParam] = intValue;
            sendMessage(message, `Your ${lobbyParam} is now ${intValue}`);
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETSIZE:
            const sizeValues = newValue.split(',').map(Number);
            if (sizeValues.some(isNaN)) {
                sendMessage(message, 'Please enter valid size values in the format <number,number>');
                return false;
            }
            sizeValues[0] > SIZELIMIT ? sizeValues[0] = SIZELIMIT : null;
            sizeValues[1] > SIZELIMIT ? sizeValues[1] = SIZELIMIT : null;
            lobby[userId][lobbyParam] = { width: sizeValues[0], height: sizeValues[1] };
            sendMessage(message, `You set size to ${sizeValues[0]},${sizeValues[1]}`);
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETSTRENGTH:
        case STATES.SETCFG:
            const floatValue = parseFloat(newValue);
            if (isNaN(floatValue)) {
                sendMessage(message, 'Please enter a valid float value');
                return false;
            }
            if (currentState === STATES.SETSTRENGTH && (floatValue < 0 || floatValue > 1)) {
                sendMessage(message, 'Please enter a value between 0 and 1');
                return false;
            }
            if (currentState === STATES.SETCFG && (floatValue < 0 || floatValue > 30)) {
                sendMessage(message, 'Please enter a value between 0 and 30');
                return false;
            }
            lobby[userId][lobbyParam] = floatValue;
            sendMessage(message, `Your ${lobbyParam} is now ${floatValue}`);
            setUserState(message,STATES.IDLE);
            break;
        default:
            sendMessage(message, 'Unknown setter command');
            setUserState(message,STATES.IDLE);
            break;
    }
}
//
// setter calc
//

function handleRequest(message) {
    const chatId = message.chat.id;
    const userId = message.from.first_name;
    const messageContent = message.text || message.caption || ''; // Get message text or caption

    // Create directory if it doesn't exist
    const directoryPath = path.join(__dirname, 'modelRequests');
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }

    // Generate filename based on chatId and current timestamp
    const timestamp = Date.now();
    const filename = `message_${chatId}_${timestamp}.txt`;
    const filePath = path.join(directoryPath, filename);

    // Write message content to file
    fs.writeFileSync(filePath, userId + '\n' + messageContent, 'utf8');

    console.log(`Message written to file: ${filePath}`);
    sendMessage(message,'okay we will take a look and try to get it on the bot soon');
    setUserState(message,STATES.IDLE);
    return true;
}
async function handleSaveSettings(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    writeUserData(userId,lobby[userId]);
    await sendMessage(message,`I just saved your settings. So when the bot resets, this is what you'll be on`);
}
async function handleSeeSettings(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let settings;

    // Define keys to ignore
    const keysToIgnore = ['_id', 'lastPhoto','userId', 'whaleMode', 'collections', 'loras', 'blessing', 'curse', 'fileUrl', 'collectionConfig', 'tempSize'];

    if (lobby[userId]) {
        settings = lobby[userId];
    } else {
        settings = await getUserDataByUserId(chatId);  // Assuming this fetches user data
    }

    if (settings) {
        let messageText = "Here is what you are working with right now:\n";
        for (const key in settings) {
            if (settings.hasOwnProperty(key) && !keysToIgnore.includes(key)) {
                messageText += `${key}: ${JSON.stringify(settings[key], null, 2)}\n`;
            }
        }
        await sendMessage(message, messageText);
    } else {
        await sendMessage(message, "No settings found.");
    }
}
async function sendLoRaModelFilenames(message) {
    const chatId = message.chat.id;
    let loraMessage = 'Here are the available LoRAs:\n\n';
  
    loraTriggers.forEach(lora => {
      const triggerWords = lora.triggerWords.join(', ');
      loraMessage += `Trigger Words: ${triggerWords}\n`;
      loraMessage += `Description: ${lora.description}\n`;
      loraMessage += `Civitai Link: ${lora.civitaiLink}\n\n`;
    });
  
    loraMessage += 'Use the listed trigger word to activate the LoRA in your prompt!';
  
    const maxMessageLength = 4096; // Telegram's max message length is 4096 characters
  if (loraMessage.length > maxMessageLength) {
    const midpoint = Math.floor(loraMessage.length / 2);
    let splitIndex = midpoint;
    
    // Ensure we split at a sensible point (e.g., end of a line)
    while (splitIndex > 0 && loraMessage[splitIndex] !== '\n') {
      splitIndex--;
    }

    const messagePart1 = loraMessage.substring(0, splitIndex);
    const messagePart2 = loraMessage.substring(splitIndex);

    sendMessage(message, messagePart1)
      .then(() => {
        sendMessage(message, messagePart2)
          .then(() => {
            console.log(`Sent split LoRA list to chatId ${chatId}.`);
          })
          .catch(error => {
            console.error(`Error sending second part of LoRA list to chatId ${chatId}:`, error);
          });
      })
      .catch(error => {
        console.error(`Error sending first part of LoRA list to chatId ${chatId}:`, error);
      });
  } else {
    sendMessage(message, loraMessage)
      .then(() => {
        console.log(`Sent LoRA list to chatId ${chatId}.`);
      })
      .catch(error => {
        console.error(`Error sending LoRA list to chatId ${chatId}:`, error);
      });
  }
}
async function handleDiscWrite(message) {
    sendMessage(message,'one sec..');
    chatId = message.chat.id;
    const userId = message.from.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
    try {
        const filenames = await writeToDisc(fileUrl)
        console.log(filenames)
        await sendPhoto(message, filenames[0]);
        //closeTask(userId,1,filenames,'DISC')
        fs.unlinkSync(filenames[0]);
        setUserState(message,STATES.IDLE);
        return true;
    } catch (err) {
        console.log(err);
        await sendMessage(message,'oh man something went horribly wrong. tell the dev');
        setUserState(message,STATES.IDLE);
        return false;
    }
}
async function handleWatermark(message) {
    sendMessage(message,`yes. this one needs a logo`)
    chatId = message.chat.id;
    const userId = message.from.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
    try {
        const filenames = await addWaterMark(fileUrl)
        console.log('back in handleWatermark',filenames)
        await sendPhoto(message, filenames[0]);
        //closeTask(userId,1,filenames,'WATERMARK')
        fs.unlinkSync(filenames[0]);
        setUserState(message,STATES.IDLE);
        return true;
    } catch (err) {
        console.log(err);
        setUserState(message,STATES.IDLE);
        await sendMessage(message,'oh man something went horribly wrong');
        return false;
    }
}
async function handleMs2ImgFile(message) {
    sendMessage(message,'okay lemme see...');
    chatId = message.chat.id;
    const userId = message.from.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
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
            fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
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
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
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
async function shakeAssist(message) {
    const userId = message.from.id;
    const{time,result} = await promptAssist(message);
    lobby[userId].points += time;
    sendMessage(message,result);
    setUserState(message,STATES.IDLE);
    return true
}
async function shakeSpeak(message) {
    const userId = message.from.id;
    if(!lobby[userId].voiceModel){
        sendMessage(message,'please choose a voice from voice menu in account settings');
        return;
    }
    const result = await txt2Speech(message, lobby[userId].voiceModel);
    //console.log(result);
    if(result == '-1'){
        sendMessage(message,'... i failed... :<')
        console.log(result);
        return 
    }
    lobby[userId].points += 5;
    await bot.sendAudio(message.chat.id,result);
    fs.unlinkSync(result);
    setUserState(message,STATES.IDLE);
    return true
}
async function handleSignIn (message) {
    const userId = message.from.id;
    
    userData = await getUserDataByUserId(userId);
    
    if(userData != false){
        lobby[userId] = userData;
        if(userData.wallet != ''){
            sendMessage(message, `You are signed in to ${userData.wallet}`);
            if(userData.verified == true){
                sendMessage(message,'and you are verified. Have fun');
                setUserState(message,STATES.IDLE)
            } else {
                await handleVerify(message);
            }
        } else {
            sendMessage(message, "What's your Solana address?")
            setUserState(message,STATES.SIGN_IN)
            console.log('state',lobby[userId].state)
        }
    } else {
        sendMessage(message, "What's your Solana address?")
        setUserState(message,STATES.SIGN_IN)
    }
};
async function shakeSignIn (message) {
    console.log('shaking signin')
    const userId = message.from.id;
    if(!lobby[userId]){
        return;
    }
    let chatData = lobby[userId];
    chatData.wallet = message.text;
    //console.log('chatdata wallet in shake',chatData.wallet);
    writeUserData(userId,chatData)
    lobby[userId] = chatData; //redundant i think
    console.log(message.from.first_name,'has entered the chat');
    // Confirm sign-in
    sendMessage(message, `You are now signed in to ${message.text}`);
    safeExecute(message, handleVerify);
}
async function handleVerify(message) {
    const userId = message.from.id;
    if(lobby[userId]){
        lobby[userId].verified ? sendMessage(message,'You are verified, dw') : sendMessage(message,'go to https://miladystation2.net/verify , connect your wallet, sign the nonce, return with the hash you get there')
        lobby[userId].verified ? setUserState(message,STATES.IDLE) : setUserState(message,STATES.VERIFY)
    } else {
        const userData = await getUserDataByUserId(userId);
        userData.verified ? sendMessage(message,'You are verified, dw') : sendMessage(message,'go to https://miladystation2.net/verify , connect your wallet, sign the nonce, return with the hash you get there')
        userData.verified ? setUserState(message,STATES.IDLE) : setUserState(message,STATES.VERIFY)
    }
    console.log('userStates after handlever',lobby[userId].state.state)
}
async function shakeVerify(message) {
    // Example data received from user
    console.log('shaking verify');
    const chatId = message.chat.id;
    const userId = message.from.id;
    setUserState(message,STATES.IDLE);
    const validity = (userData) => {
        let userWalletAddress;
        if(lobby[userId]){
            userWalletAddress = lobby[userId].wallet;
        } else {
            userWalletAddress = userData.wallet
        }
        
        const userTimestamp = Date.now() / 60000;
        const userProvidedHash = message.text;
        const salt = process.env.VERISALT; // Keep this consistent and secure
        let isValid = false;
        for(let i = 0; i < 5; i++){
            const match = verifyHash(userWalletAddress, userTimestamp-i, salt, userProvidedHash);
            console.log(match);
            if(match){
                isValid = true;
            }
        }
        return isValid;
    }
    const handleValidity = (userData,isValid) => {
        if (isValid) {
            console.log('Verification successful: the user controls the wallet.');
            try {
                if(lobby[userId]){
                    lobby[userId].verified = true;
                }
                userData.verified = true;
                writeUserData(userId,userData);
                return true
            } catch(err) {
                console.log('verify shake error: ',err)
                return true
            }
        } else {
            console.log('Verification failed: the data does not match or has been tampered with.');
            return true
        }
    }
    if(lobby[userId]){
        isValid = validity(lobby[userId]);
        sendMessage(message,`${isValid ? 'you are verified now' : 'not verified'}`);
        return handleValidity(lobby[userId],isValid);
    } else {
        const userData = await getUserDataByUserId(userId);
        isValid = validity(userData);
        sendMessage(message,`${isValid ? 'you are verified now' : 'not verified'}`);
        return handleValidity(userData,isValid);
    }
}
async function handleSignOut(message) {
    chatId = message.chat.id;
    const userId = message.from.id;
    let userData = await getUserDataByUserId(userId);
    console.log(userData,'signing out');
        if (userData) {
            // Remove user data for this chatId
            userData.wallet = '';
            userData.verified = false;
            //fs.writeFileSync(chatFilePath, JSON.stringify(userData, null, 2))
            writeUserData(userId,userData);
            if(lobby[userId]){delete lobby[userId]}
        } else {
            // User data not found
            if(lobby[userId]){delete lobby[userId]}
        }
    sendMessage(message,'You are signed out');
    return true;
}
async function handleAccountSettings(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    if(!await checkLobby(message)){
        return;
    }
    if(chatId < 0){
        sendMessage(message,'ew do that in private messages you perv');
    } else {
        displayAccountSettingsMenu(message);
    }
    
}

async function handleAccountReset(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let chatData;
    if(lobby[userId]){
        chatData = lobby[userId]
    } else {
        chatData = await getUserDataByUserId(userId);
    }
    let wallet = chatData.wallet;
    chatData=defaultUserData;
    chatData.wallet = wallet;
    if(lobby[userId]){lobby[userId] = chatData;}
    // Confirm sign-in
    sendMessage(message, `You reset to default settings`);
    setUserState(message,STATES.IDLE);
}

module.exports = {
    handleAccountReset,
    handleAccountSettings,
    handleAdvancedUserOptions,
    handleDexMake,
    handleDiscWrite,
    handleHelp,
    handleInpaint,
    handleMask,
    handleInpaintPrompt,
    handleInterrogation,
    handleMake,
    handleMake3,
    handleMs2ImgFile,
    handleMs2Prompt,
    handleMs3ImgFile,
    handlePfpImgFile,
    handlePromptCatch,
    handleRegen,
    handleRequest,
    handleSaveSettings,
    handleSeeSettings,
    handleSet,
    handleSignIn,
    handleSignOut,
    handleStatus,
    //handleTest,
    handleVerify,
    handleWatermark,
    // handleLoraTrigger,
    sendLoRaModelFilenames,
    shakeAssist,
    shakeSpeak,
    shakeSignIn,
    shakeVerify,
    startMake,
    startSet,
    saySeed,
    setUserState,
    checkLobby
}