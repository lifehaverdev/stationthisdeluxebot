const { getBotInstance, makeSeed, getPhotoUrl, lobby, startup, STATES, SETTER_TO_STATE, STATE_TO_LOBBYPARAM } = require('../bot'); 
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

const { displayAccountSettingsMenu } = require('./accountSettings.js')
const { handleAdvancedUserOptions } = require('./advancedUserSettings.js')
const { handleMs3ImgFile } = require('./handleMs3ImgFile.js')
const { saySeed } = require('./saySeed.js')
const { startSet, handleSet } = require('./startSet.js')
const { handleHelp, handleStatus } = require('./helpStatus.js')
const { handleDexMake, handlePromptCatch } = require('./promptDex.js')


const SIZELIMIT = 2048;
const BATCHLIMIT = 4;

const STEPSLIMIT = 48;

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
async function handleInterrogation(message) {
    sendMessage(message,'hmm what should i call this..');
    const photoUrl = await getPhotoUrl(message);
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

async function handleInpaint(message) {
    chatId = message.chat.id;
    const userId = message.from.id;
    const fileUrl = getPhotoUrl(message)
    
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
    const fileUrl = getPhotoUrl(message);
    
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