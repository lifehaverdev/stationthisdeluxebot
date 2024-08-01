const { lobby, getBotInstance, STATES } = require('./bot');
//const { checkpointmenu } = require('../models/checkpointmenu')
const { getVoiceModelByName } = require('../models/voiceModelMenu')
const { getBasePromptByName } = require('../models/basepromptmenu')
const { getPromptMenu, getCheckpointMenu, getVoiceMenu } = require('../models/userKeyboards')
const {
    sendMessage,
    editMessage,
    safeExecute,
    setUserState,
} = require('../utils');
const { displayAccountSettingsMenu } = require('./handlers/accountSettings')
const { startMake, startMake3, handleRegen, startSet, setMenu, handleStatus, startInpaint, startRmbg, startUpscale } = require('./handlers/handle');
const { startMs2, startPfp } = require('./handlers/imageToImage')
const { startMs3 } = require('./handlers/handleMs3ImgFile')
const { startDisc, startWatermark } = require('./handlers/branding')
const { handleCheckpointMenu, handleBasePromptMenu, handleVoiceMenu, handleWatermarkMenu } = require('./handlers/keyboards');
const bot = getBotInstance();

// function parseCallbackData(data) {
//     if (data.includes('|')) {
//         // Assume it's the compact serialized form
//         const parts = data.split('|');
//         message = {
//             message_id: parts[5], // You might not have a real message ID to use
//             from: {
//                 id: parseInt(parts[1]),
//                 is_bot: false,
//                 //first_name: parts[4],
//                 // Add other necessary user fields if required
//             },
//             chat: {
//                 id: parseInt(parts[3]),
//                 //type: 'private', // Adjust based on actual usage or data available
//                 // Add other necessary chat fields if required
//             },
//             date: Math.floor(Date.now() / 1000), // Use the current timestamp
//             text: 'k', // Since you don't have the original text, leave this empty or use placeholder
//             message_thread_id: parts[4] === '0' ? null : parseInt(parts[4], 10) // Handling for no thread ID
//         };
//         return {
//             action: parts[0],
//             user: parts[6],
//             message: message
//         };
//     } else {
//         // Simple command
//         return { action: data };
//     }
// }

function parseCallbackData(callbackQuery) {
    const data = callbackQuery.data;
    const parts = data.split('|');

    // Use information from the callbackQuery itself
    const message = callbackQuery.message;
    const user = callbackQuery.from.id;

    // Reconstruct additional information if necessary
    return {
        action: parts[0],
        user,
        message
    };
}


const setActions = [
    'setstrength', 'setsize', 'setcfg', 'setprompt', 'setbatch',
    'setsteps', 'setuserprompt', 'setseed', 'setnegprompt', 'setphoto', 
    'setcheckpoint', 'setbaseprompt', 'setstyle', 'setcontrol'
];

const handleSetAction = (action, message, user) => {
    message.from.id = user;
    message.text = `/${action}`;
    safeExecute(message, () => {startSet(message,user)});
};

const handleSetBasePrompt = (message, selectedName, userId) => {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const basePrompt = getBasePromptByName(selectedName);
    if (basePrompt !== undefined) {
        lobby[userId].basePrompt = selectedName;
        const messageTitle = `Base prompt set to: ${selectedName} ✅`;
        editMessage({
            text: messageTitle,
            chat_id: chatId,
            message_id: messageId,
        })
    } else {
        console.log('no base prompt')
    }
};

const handleSetCheckpoint = (message, selectedName, userId) => {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    if (selectedName !== undefined) {
        lobby[userId].checkpoint = selectedName;
        const messageTitle = `Checkpoint set to: ${selectedName} ✅`;
        editMessage({
            text: messageTitle,
            chat_id: chatId,
            message_id: messageId,
        })
    } else {
        console.log('no base prompt')
    }
};

const handleSetVoice = (message, selectedName, userId) => {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const voiceModel = getVoiceModelByName(selectedName);
    if (voiceModel !== undefined) {
        lobby[userId].voiceModel = voiceModel;
        const messageTitle = `Voice set to: ${selectedName}`;
        const opts = {
            chat_id: chatId,
            message_id: messageId,
        };
        bot.editMessageText(messageTitle, {
            chat_id: chatId,
            message_id: messageId,
        }).then(() => {
            bot.editMessageReplyMarkup(getVoiceMenu(userId,message),opts);
        }).catch((error) => {
            console.error("Error editing message text or reply markup:", error);
        });
    } else {
        console.log('no Voice')
    }
};

const handleSetWatermark = (message, selectedName, userId) => {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    if (selectedName !== undefined) {
        if(selectedName == 'empty'){
            lobby[userId].waterMark = false;
        } else {
            lobby[userId].waterMark = selectedName;
        }
        const messageTitle = `Watermark set to: ${selectedName} ✅`;
        editMessage({
            text: messageTitle,
            chat_id: chatId,
            message_id: messageId,
        })
    } else {
        console.log('no base prompt')
    }
};

const actionMap = {
    'regen': handleRegen,
    'make': (message, user) => {
        lobby[user].styleTransfer = false;
        lobby[user].controlNet = false;
        startMake(message, user)
    },
    'make_style': (message,user) => {
        lobby[user].styleTransfer = true;
        lobby[user].controlNet = false;
        startMake(message,user);
    },
    'make_control': (message,user) => {
        lobby[user].controlNet = true;
        lobby[user].styleTransfer = false;
        startMake(message,user);
    },
    'make_control_style': (message,user) => {
        lobby[user].controlNet = true;
        lobby[user].styleTransfer = true;
        startMake(message,user);
    },
    'ms2': (message,user) => {
        lobby[user].styleTransfer = false;
        lobby[user].controlNet = false;
        startMs2(message,user);
    },
    'ms2_style': (message,user) => {
        lobby[user].styleTransfer = true;
        lobby[user].controlNet = false;
        startMs2(message,user);
    },
    'ms2_control': (message,user) => {
        lobby[user].styleTransfer = false;
        lobby[user].controlNet = true;
        startMs2(message,user);
    },
    'ms2_control_style': (message,user) => {
        lobby[user].styleTransfer = true;
        lobby[user].controlNet = true;
        startMs2(message,user);
    },
    'make3': startMake3,
    'pfp': (message,user) => {
        lobby[user].styleTransfer = false;
        lobby[user].controlNet = false;
        startPfp(message,user);
    },
    'pfp_style': (message,user) => {
        lobby[user].styleTransfer = true;
        lobby[user].controlNet = false;
        startPfp(message,user);
    },
    'pfp_control': (message,user) => {
        lobby[user].styleTransfer = false;
        lobby[user].controlNet = true;
        startPfp(message,user);
    },
    'pfp_control_style': (message,user) => {
        lobby[user].styleTransfer = true;
        lobby[user].controlNet = true;
        startPfp(message,user);
    },
    'interrogate' : (message, user) => {
        
        editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'Send in the photo you want to extract a prompt from'
        })
        message.from.id = user;
        setUserState(message, STATES.INTERROGATION);
        //sendMessage(message, );
    },
    'assist': (message,user) => {
        editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'What prompt do you need help with'
        })
        message.from.id = user;
        setUserState(message, STATES.ASSIST);
    },
    'ms3': startMs3,
    'rmbg': startRmbg,
    'upscale': startUpscale,
    'watermark': startWatermark,
    'disc': startDisc,
    'set': setMenu,
    'speak': (message,user) => {
        editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'what should I say?'
        })
        message.from.id = user;
        setUserState(message, STATES.SPEAK);
        //sendMessage(message, 'what should I say?');
    },
    'voiceMenu': handleVoiceMenu,
    'checkpointmenu': handleCheckpointMenu,
    'basepromptmenu': handleBasePromptMenu,
    'voicemenu':handleVoiceMenu,
    'toggleWaterMark' : handleWatermarkMenu,
    'setVoice': handleSetVoice,
    'setBasePrompt': handleSetBasePrompt,
    'setCheckpoint': handleSetCheckpoint,
    'setWatermark': handleSetWatermark,
    'toggleAdvancedUser': async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].advancedUser = !lobby[user].advancedUser;
        message.from.id = user;
        displayAccountSettingsMenu(message);
    },
    'toggleStyleTransfer': async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        displayAccountSettingsMenu(message);
    },
    'toggleControlNet' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        displayAccountSettingsMenu(message);
    },
    
    'refresh' : async (message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        handleStatus(message);
    },
    'cancel' : (message) => {
        bot.deleteMessage(message.chat.id, message.message_id);
    },
    'inpaint' : startInpaint

    
};


module.exports = function(bot) {
    bot.on('callback_query', (callbackQuery) => {
        //console.log('callback querey itself',callbackQuery,'/n/n');
        try {
            //const userId = callbackQuery.from.id;
            const {action, message, user} = parseCallbackData(callbackQuery);
            //console.log('in callback query data', action, message, user)
            if(message.from.id != callbackQuery.from.id && action != 'refresh' && message.from.id != process.env.BOT_ID){ //6864632060){//6324772900 ){
                console.log('wrong user');
                return
            }


            if (actionMap[action]) {
                actionMap[action](message, user);
            } else if (callbackQuery.data.startsWith('sbp_')) {
                const selectedName = action.split('_')[1];
                actionMap['setBasePrompt'](message, selectedName, user);
            } else if (callbackQuery.data.startsWith('sv_')) {
                const selectedName = action.split('_').slice(1).join('_');
                actionMap['setVoice'](message, selectedName, user);
            } else if (callbackQuery.data.startsWith('scp_')) {
                const selectedName = action.split('_').slice(1).join('_');
                actionMap['setCheckpoint'](message, selectedName, user);
            } else if (callbackQuery.data.startsWith('swm_')) {
                const selectedName = action.split('_').slice(1).join('_');
                actionMap['setWatermark'](message, selectedName, user);
            } else if (setActions.includes(action)) {
                handleSetAction(action, message, user);
            } else {
                console.log(`Unhandled action: ${action}`);
            }

        } catch (error) {
            console.error("Error during callback query handling:", {
                errorMessage: error.message,
                requestData: {
                    chatId: callbackQuery.message.chat.id,
                    userId: callbackQuery.from.id,
                    data: callbackQuery.data
                }
            });
        }
    });
}