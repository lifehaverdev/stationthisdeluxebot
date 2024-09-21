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
const iBrand = require('./iBrand')
const iWork = require('./iWork')
const bot = getBotInstance();
const { getGroup } = require('./iGroup')

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
    //console.log(user, message, parts[0])
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
    'setcheckpoint', 'setbaseprompt', 'setstyle', 'setcontrol', 'setpose'
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
    const group = getGroup(message)
    let settings;
    if(group) {
        settings = group.settings;
    } else {
        settings = lobby[userId]
    }
    if (basePrompt !== undefined) {
        settings.basePrompt = selectedName;
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
    const group = getGroup(message)
    let settings;
    if(group) {
        settings = group.settings;
    } else {
        settings = lobby[userId]
    }
    if (selectedName !== undefined) {
        settings.checkpoint = selectedName;
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
        const messageTitle = `Voice set to: ${selectedName}\n\nWhat should I say?`;
        // const opts = {
        //     chat_id: chatId,
        //     message_id: messageId,
        // };
        // bot.editMessageText(messageTitle, {
        //     chat_id: chatId,
        //     message_id: messageId,
        // }).then(() => {
        //     bot.editMessageReplyMarkup(iMenu.getVoiceMenu(userId,message),opts);
        // }).catch((error) => {
        //     console.error("Error editing message text or reply markup:", error);
        // });
        editMessage({
            text: messageTitle,
            chat_id: chatId,
            message_id: messageId,
        })
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
        const messageTitle = `Watermark set to: ${selectedName} ✅\n\nSend in the photo you want to brand`;
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
    
    'ms2': iResponse.ms2Starter.start.bind(iResponse.ms2Starter),
    
    'make3': iResponse.make3Starter.start.bind(iResponse.make3Starter),
    'pfp': iResponse.pfpStarter.start.bind(iResponse.pfpStarter),
    
    'interrogate' : iResponse.interrogateStarter.start.bind(iResponse.interrogateStarter),
    'assist': iResponse.assistStarter.start.bind(iResponse.assistStarter),
    'ms3': iResponse.ms3Starter.start.bind(iResponse.ms3Starter),
    'rmbg': iResponse.rmbgStarter.start.bind(iResponse.rmbgStarter),
    'upscale': iResponse.upscaleStarter.start.bind(iResponse.upscaleStarter),
    'watermark': iBrand.startWatermark ,//iResponse.watermarkStarter.start.bind(iResponse.watermarkStarter),
    'disc': iResponse.discStarter.start.bind(iResponse.discStarter),
    'speak': iWork.startSpeak,//iResponse.speakStarter.start.bind(iResponse.speakStarter),
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
    //for accountsettings
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
    'toggleOpenPose' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        displayAccountSettingsMenu(message);
    },
    //for create and effect menu
    'toggleStyleCreate': async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        iMenu.handleCreate(message);
    },
    'toggleStyleEffect': async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        iMenu.handleEffect(message);
    },
    'toggleControlCreate' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        iMenu.handleCreate(message);
    },
    'toggleControlEffect' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        iMenu.handleEffect(message);
    },
    'togglePoseCreate' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        iMenu.handleCreate(message);
    },
    'togglePoseEffect' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        iMenu.handleEffect(message);
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
    },
    // 'createGroup': async (message) => {
    //     console.log('this is createGroup rn');
    //     console.log('message',message);
    //     console.log('reply',message.reply_to_message);
    //     message.from.id = message.reply_to_message.from.id;
    //     //message.message_thread_id = message.message_thread_id;
    //     sendMessage(message.reply_to_message,'What is the name of your group?')
    //     setUserState(message.reply_to_message, STATES.GROUPNAME)
    // }
    'featuredLora': async (message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.featuredLoRaList(message);
    },
    'topTenLora': async (message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.loraList(message);
    },
    // 'favoriteLora': async (message) => {
    //     await bot.deleteMessage(message.chat.id, message.message_id);
    //     iWork.favoriteLoRaList(message);
    // }
    'fullLora': async(message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.sendLoRaModelFilenames(message)
    },
    'fluxLora': async(message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.fluxLoraList(message)
    },
    'finterrogate': iWork.startFluxInterrogate,
    'flux': iResponse.fluxStarter.start.bind(iResponse.fluxStarter),
    'interMenu': iMenu.handleInterrogateMenu
};


module.exports = function(bot) {
    bot.on('callback_query', (callbackQuery) => {
        //console.log('callback querey itself',callbackQuery,'/n/n');
        //console.log('message reply to message from',callbackQuery.message.reply_to_message)
        try {
            //const userId = callbackQuery.from.id;
            const {action, message, user} = parseCallbackData(callbackQuery);
            //console.log('in callback query data', action, message, user)
            //console.log('before the first if')
            if(
                (
                    callbackQuery.from.id && callbackQuery.message.reply_to_message && callbackQuery.from.id != callbackQuery.message.reply_to_message.from.id 
                    && message.from.id != process.env.BOT_ID
                    //|| callbackQuery.from.id != callbackQuery.message.from.id
                )
                && action != 'refresh' 
                //
            ){ //6864632060){//6324772900 ){
                console.log('wrong user');
                return
            }
            //console.log('after first if')
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