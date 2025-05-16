const { lobby } = require('../bot/bot')
const { basepromptmenu } = require('./basepromptmenu')
const { checkpointmenu } = require('./checkpointmenu')
const { voiceModels } = require('./voiceModelMenu')
const { watermarkmenu } = require('./watermarks')
const { compactSerialize, makeBaseData } = require('../utils')

const home =  {
    reply_markup: {
        keyboard: [
            [{ text: '/create' },{ text: '/effect' },{ text: '/animate' }],
            [{ text: '/set' },{text: '/utils'},{text: '/regen' },{ text: '/status'}],
            [{ text: '/accountsettings' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

const justSet = {
    reply_markup: {
        keyboard: [
            [{ text: '/regen' },{ text: '/status' },{ text: '/set' }],
            [{ text: '/accountsettings' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

const signedOut = {
    reply_markup: {
        keyboard: [
            [{ text: '/signin' }],
            [{ text: '/help' }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

function isValidCallbackData(callbackData) {
    // Maximum length for callback_data is 64 bytes
    const maxLength = 64;

    // Valid characters include letters, digits, underscores, and dashes
    const validCharacters = /^[a-zA-Z0-9_$|.<-]*$/;

    // Check length
    if (callbackData.length > maxLength) {
        return false;
    }

    // Check valid characters
    if (!validCharacters.test(callbackData)) {
        return false;
    }

    return true;
}

function getPromptMenu(userId, message) {
    const baseData = makeBaseData(message, userId);
    if (!lobby[userId]) {
        console.error('User not found in lobby:', userId);
        return null;
    }
    const promptSettingsKeyboard = basepromptmenu.map(prompt => {
        const callbackData = compactSerialize({ ...baseData, action: `sbp_${prompt.name}` });
        if (isValidCallbackData(callbackData)) {
            return [{
                text: `${lobby[userId].basePrompt === prompt.name ? '✅ ' + prompt.name : prompt.name} - ${prompt.description}`,
                callback_data: callbackData
            }];
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${prompt.name} - ${prompt.description}`,
            //     callback_data: 'invalid_callback_data'
            // }];
        }
    });

    return {
        inline_keyboard: promptSettingsKeyboard
    };
}

function getCheckpointMenu(userId, message) {
    const baseData = makeBaseData(message, userId);
    if (!lobby[userId]) {
        console.error('User not found in lobby:', userId);
        return null;
    }

    const checkpoints = checkpointmenu.map(checkpoint => {
        const callbackData = compactSerialize({ ...baseData, action: `scp_${checkpoint.name}` });
        if (isValidCallbackData(callbackData)) {
            return [{
                text: `${lobby[userId].checkpoint == checkpoint.name ? '✅ '+checkpoint.name : checkpoint.name} - ${checkpoint.description}`,
                callback_data: callbackData,
            }];
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${checkpoint.name} - ${checkpoint.description}`,
            //     callback_data: 'invalid_callback_data'
            // }];
        }
    });

    return {
        inline_keyboard: checkpoints
    };
}

function getVoiceMenu(userId, message) {
    const baseData = makeBaseData(message,userId);
    if(!lobby[userId]) {
        console.log('User not in the lobby', userId);
        return null;
    }

    const voices = voiceModels.map(voice => {
        const callbackData = compactSerialize({ ...baseData, action: `sv_${voice.name}`});
        if(isValidCallbackData(callbackData)) {
            return [{
                    text: `${lobby[userId].voiceModel == voice.modelId ? '✅ '+voice.name : voice.name}`,
                    callback_data: callbackData,
            }]
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${voice.name} - Not Available`,
            //     callback_data: 'invalid_callback_data'
            // }]
        }
    })

    return {
        inline_keyboard: voices
    };
}

function getWatermarkMenu(userId, message) {
    const baseData = makeBaseData(message,userId);
    if(!lobby[userId]) {
        console.log('User not in the lobby', userId);
        return null;
    }

    const watermarkKeyboard = watermarkmenu.map(watermark => {
        const callbackData = compactSerialize({ ...baseData, action: `swm_${watermark.name}`});
        if(isValidCallbackData(callbackData)) {
            return [{
                    text: `${lobby[userId].waterMark == watermark.name ? '✅ '+watermark.name : watermark.name}`,
                    callback_data: callbackData,
            }]
        } else {
            console.error('Invalid callback_data:', callbackData);
            return 
            // [{
            //     text: `${voice.name} - Not Available`,
            //     callback_data: 'invalid_callback_data'
            // }]
        }
    })

    return {
        inline_keyboard: watermarkKeyboard
    };
}



module.exports = {
    home,
    justSet,
    signedOut,
    getPromptMenu,
    getCheckpointMenu,
    getVoiceMenu,
    getWatermarkMenu
}