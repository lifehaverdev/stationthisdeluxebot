const { lobby, getBotInstance, STATES } = require('./bot');
//const { checkpointmenu } = require('../models/checkpointmenu')
const { getVoiceModelByName } = require('../models/voiceModelMenu')
const { getBasePromptByName } = require('../models/basepromptmenu')
const { getPromptMenu, getCheckpointMenu, getVoiceMenu } = require('../models/userKeyboards')
const {
    sendMessage,
    safeExecute,
    setUserState,
    makeBaseData,
} = require('../utils');
const { startMake, startMake3, handleRegen, startSet, setMenu } = require('./handlers/handle');
const { handleCheckpointMenu, handleBasePromptMenu, handleVoiceMenu } = require('./handlers/keyboards');
const bot = getBotInstance();

function parseCallbackData(data) {
    if (data.includes('|')) {
        // Assume it's the compact serialized form
        const parts = data.split('|');
        message = {
            message_id: parts[5], // You might not have a real message ID to use
            from: {
                id: parseInt(parts[1]),
                is_bot: false,
                //first_name: parts[4],
                // Add other necessary user fields if required
            },
            chat: {
                id: parseInt(parts[3]),
                //type: 'private', // Adjust based on actual usage or data available
                // Add other necessary chat fields if required
            },
            date: Math.floor(Date.now() / 1000), // Use the current timestamp
            text: 'k', // Since you don't have the original text, leave this empty or use placeholder
            message_thread_id: parts[4] === '0' ? null : parseInt(parts[4], 10) // Handling for no thread ID
        };
        return {
            action: parts[0],
            user: parts[6],
            message: message
        };
    } else {
        // Simple command
        return { action: data };
    }
}

const setActions = [
    'setstrength', 'setsize', 'setcfg', 'setprompt', 'setbatch',
    'setsteps', 'setuserprompt', 'setseed', 'setnegprompt', 'setphoto', 
    'setcheckpoint', 'setbaseprompt', 'setstyle', 'setcontrol'
];

const handleSetAction = (action, message) => {
    message.text = `/${action}`;
    safeExecute(message, startSet);
};

const handleSetBasePrompt = (message, selectedName, userId) => {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const basePrompt = getBasePromptByName(selectedName);
    if (basePrompt !== undefined) {
        lobby[userId].basePrompt = selectedName;
        const messageTitle = `Base prompt set to: ${selectedName}`;
        const opts = {
            chat_id: chatId,
            message_id: messageId,
        };
        bot.editMessageText(messageTitle, {
            chat_id: chatId,
            message_id: messageId,
        }).then(() => {
            bot.editMessageReplyMarkup(getPromptMenu(userId,message),opts);
        }).catch((error) => {
            console.error("Error editing message text or reply markup:", error);
        });
    } else {
        console.log('no base prompt')
    }
};

const handleSetCheckpoint = (message, selectedName, userId) => {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    if (selectedName !== undefined) {
        lobby[userId].checkpoint = selectedName;
        const messageTitle = `Checkpoint set to: ${selectedName}`;
        const opts = {
            chat_id: chatId,
            message_id: messageId,
        };
        bot.editMessageText(messageTitle, {
            chat_id: chatId,
            message_id: messageId,
        }).then(() => {
            bot.editMessageReplyMarkup(getCheckpointMenu(userId,message),opts);
        }).catch((error) => {
            console.error("Error editing message text or reply markup:", error);
        });
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

const actionMap = {
    'regen': handleRegen,
    'make': startMake,
    'make_style': (message) => {
        lobby[message.from.id].styleTransfer = true;
        startMake(message);
    },
    'make3': startMake3,
    'ms2': (message) => {
        setUserState(message, STATES.IMG2IMG);
        sendMessage(message, 'Send in the photo you want to img to img.', {reply_to_message_id: message.message_id});
    },
    'pfp': (message) => {
        sendMessage(message,'not available now');
    },
    'assist': (message) => {
        setUserState(message, STATES.ASSIST);
        sendMessage(message, 'What prompt do you need help with',{reply_to_message_id: message.message_id});
    },
    'ms3': (message) => {
        setUserState(message, STATES.MS3);
        sendMessage(message, 'What image will you animate (pls a square)',{reply_to_message_id: message.message_id});
    },
    'set': setMenu,
    'speak': (message) => {
        setUserState(message, STATES.SPEAK);
        sendMessage(message, 'what should I say?');
    },
    'voiceMenu': handleVoiceMenu,
    'checkpointmenu': handleCheckpointMenu,
    'basepromptmenu': handleBasePromptMenu,
    'voicemenu':handleVoiceMenu,
    'setVoice': handleSetVoice,
    'setBasePrompt': handleSetBasePrompt,
    'setCheckpoint': handleSetCheckpoint
    
};


module.exports = function(bot) {
    bot.on('callback_query', (callbackQuery) => {
        //console.log(callbackQuery.data);
        try {
            //const userId = callbackQuery.from.id;
            const {action, message, user} = parseCallbackData(callbackQuery.data);
            console.log('in callback query', action, message, user)

            if (actionMap[action]) {
                actionMap[action](message);
            } else if (callbackQuery.data.startsWith('sbp_')) {
                const selectedName = action.split('_')[1];
                actionMap['setBasePrompt'](message, selectedName, user);
            } else if (callbackQuery.data.startsWith('sv_')) {
                const selectedName = action.split('_').slice(1).join('_');
                actionMap['setVoice'](message, selectedName, user);
            } else if (callbackQuery.data.startsWith('scp_')) {
                const selectedName = action.split('_').slice(1).join('_');
                actionMap['setCheckpoint'](message, selectedName, user);
            } else if (setActions.includes(action)) {
                handleSetAction(action, message);
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