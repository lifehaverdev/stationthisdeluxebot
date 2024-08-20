const { lobby, getBotInstance, STATES, burns } = require('../bot');
const { getVoiceModelByName } = require('../../models/voiceModelMenu')
const { getBasePromptByName } = require('../../models/basepromptmenu')
const {
    sendMessage,
    editMessage,
    safeExecute,
    setUserState,
} = require('../../utils');
const { displayAccountSettingsMenu } = require('./iAccount')
const { handleStatus } = require('./iWork');
const { startSet } = require('./iSettings');
const { handleRegen } = require('./iMake')
const iMenu = require('./iMenu');
const iResponse = require('./iResponse');
const bot = getBotInstance();

/*
Uniformity and confluence with iResponse
private menus, must only be selectable by intended user
*/

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
            bot.editMessageReplyMarkup(iMenu.getVoiceMenu(userId,message),opts);
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
    'regen': async (message,user) => {
        message.from.id = user;
        handleRegen(message)
    },
    'make': iResponse.makeStarter.start.bind(iResponse.makeStarter),
    'make_style': iResponse.makeStyleStarter.start.bind(iResponse.makeStyleStarter),
    'make_control': iResponse.makeControlStarter.start.bind(iResponse.makeControlStarter),
    'make_control_style': iResponse.makeControlStyleStarter.start.bind(iResponse.makeControlStyleStarter),
    'ms2': iResponse.ms2Starter.start.bind(iResponse.ms2Starter),
    'ms2_style': iResponse.ms2StyleStarter.start.bind(iResponse.ms2StyleStarter),
    'ms2_control': iResponse.ms2ControlStarter.start.bind(iResponse.ms2ControlStarter),
    'ms2_control_style': iResponse.ms2ControlStyleStarter.start.bind(iResponse.ms2ControlStyleStarter),
    'make3': iResponse.make3Starter.start.bind(iResponse.make3Starter),
    'pfp': iResponse.pfpStarter.start.bind(iResponse.pfpStarter),
    'pfp_style': iResponse.pfpStyleStarter.start.bind(iResponse.pfpStyleStarter),
    'pfp_control': iResponse.pfpControlStarter.start.bind(iResponse.pfpControlStarter),
    'pfp_control_style': iResponse.pfpControlStyleStarter.start.bind(iResponse.pfpControlStyleStarter),
    'interrogate' : iResponse.interrogateStarter.start.bind(iResponse.interrogateStarter),
    'assist': iResponse.assistStarter.start.bind(iResponse.assistStarter),
    'ms3': iResponse.ms3Starter.start.bind(iResponse.ms3Starter),
    'rmbg': iResponse.rmbgStarter.start.bind(iResponse.rmbgStarter),
    'upscale': iResponse.upscaleStarter.start.bind(iResponse.upscaleStarter),
    'watermark': iResponse.watermarkStarter.start.bind(iResponse.watermarkStarter),
    'disc': iResponse.discStarter.start.bind(iResponse.discStarter),
    'speak': iResponse.speakStarter.start.bind(iResponse.speakStarter),
    'inpaint' : iResponse.inpaintStarter.start.bind(iResponse.inpaintStarter),
    'set': async (message,user) => {
        message.from.id = user;
        iMenu.setMenu(message)
    },
    'voiceMenu': iMenu.handleVoiceMenu,
    'checkpointmenu': iMenu.handleCheckpointMenu,
    'basepromptmenu': iMenu.handleBasePromptMenu,
    'voicemenu': iMenu.handleVoiceMenu,
    'toggleWaterMark' : iMenu.handleWatermarkMenu,
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
    'applygroupbalance': (message) => {
        console.log(message)
        const burnRecord = burns.find(burn => burn.wallet === lobby[message.reply_to_message.from.id].wallet);
        let burned = 0;
        if (burnRecord) {
            console.log(burnRecord.burned)
            burned += parseInt(burnRecord.burned) * 2 / 1000000;
        }
        sendMessage(message.reply_to_message,`You have burned a total of ${burned} MS2, tell me how much you would like to apply to this group`)
        setUserState(message.reply_to_message, STATES.GROUPAPPLY)
    }
};


module.exports = function(bot) {
    bot.on('callback_query', (callbackQuery) => {
        //console.log('callback querey itself',callbackQuery,'/n/n');
        //console.log('message reply to message from',callbackQuery.message.reply_to_message)
        try {
            //const userId = callbackQuery.from.id;
            const {action, message, user} = parseCallbackData(callbackQuery);
            //console.log('in callback query data', action, message, user)
            if(
                (
                    callbackQuery.from.id != callbackQuery.message.reply_to_message.from.id 
                    //|| callbackQuery.from.id != callbackQuery.message.from.id
                ) 
                && action != 'refresh' 
                //&& message.from.id != process.env.BOT_ID
            ){ //6864632060){//6324772900 ){
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