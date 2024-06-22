const { getBotInstance, lobby, STATES } = require('../bot'); 
const {
    sendMessage,
    setUserState
} = require('../../utils')
const bot = getBotInstance()
const { checkLobby } = require('../gatekeep')
const fs = require('fs');
const { txt2Speech } = require('../../../commands/speak.js');
const { promptAssist } = require('../../../commands/assist.js')

const { 
    handleSaveSettings,
    handleSeeSettings,
    handleSignIn,
    handleSignOut,
    handleAccountReset,
    handleAccountSettings,
    shakeVerify,
    shakeSignIn } = require('./accountSettings.js')
const { handleAdvancedUserOptions } = require('./advancedUserSettings.js')
const { handleMs3ImgFile } = require('./handleMs3ImgFile.js')
const { saySeed } = require('./saySeed.js')
const { startSet, handleSet } = require('./set.js')
const { handleHelp, handleStatus } = require('./helpStatus.js')
const { handleDexMake, handlePromptCatch } = require('./promptDex.js')
const { startMake, startMake3, handleMake, handleRegen, handleMake3 } = require('./generate.js')
const { handleInterrogation } = require('./interrogate.js')
const { handleMask, handleInpaint, handleInpaintPrompt } = require('./inpaint.js')
const { handleRequest, sendLoRaModelFilenames } = require('./loraRequestList.js')
const { handleWatermark, handleDiscWrite } = require('./branding.js')
const { handleMs2ImgFile, handleMs2Prompt, handlePfpImgFile } = require('./imageToImage.js')
const { setMenu, handleCreate, handleEffect, handleAnimate } = require('./keyboards.js')


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
    //handleVerify,
    handleWatermark,
    // handleLoraTrigger,
    sendLoRaModelFilenames,
    shakeAssist,
    shakeSpeak,
    shakeSignIn,
    shakeVerify,
    startMake,
    startMake3,
    startSet,
    saySeed,
    setUserState,
    checkLobby,
    setMenu,
    handleCreate,
    handleEffect,
    handleAnimate
}