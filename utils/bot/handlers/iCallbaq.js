const { lobby, getBotInstance, STATES, burns, workspace, makeSeed } = require('../bot');
const { getVoiceModelByName } = require('../../models/voiceModelMenu')
const { getBasePromptByName } = require('../../models/basepromptmenu')
const {
    sendMessage,
    editMessage,
    safeExecute, safeExecuteCallback,
    setUserState,
    react
} = require('../../utils');
const { displayAccountSettingsMenu } = require('./iAccount')
const { handleStatus } = require('./iWork');
const { startSet } = require('./iSettings');
const { handleRegen, handleHipFire } = require('./iMake')
const { returnToAccountMenu } = require('./iAccount')
const iMenu = require('./iMenu');
const iGroup = require('./iGroup')
const iResponse = require('./iResponse');
const iBrand = require('./iBrand')
const iTrain = require('./iTrain')
const iWork = require('./iWork')
const bot = getBotInstance();
const { getGroup } = require('./iGroup')
const { enqueueTask } = require('../queue')
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
    //console.log('message in handlesetaction',message)
    workspace[user] = { chat_id: message.chat.id, message_id: message.message_id }
    console.log('workspace in handleset after add',workspace)
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
        const reply_markup = iMenu.buildSetMenu(settings,group,settings.balance)
        editMessage({
            ...reply_markup,
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
        settings.input_checkpoint = selectedName;
        const messageTitle = `Checkpoint set to: ${selectedName} ✅`;
        const reply_markup = iMenu.buildSetMenu(settings,group,settings.balance)
        editMessage({
            ...reply_markup,
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
    'flassist': iResponse.flassistStarter.start.bind(iResponse.flassistStarter),
    'ms3': iResponse.ms3Starter.start.bind(iResponse.ms3Starter),
    'ms3.2': iResponse.ms3V2Starter.start.bind(iResponse.ms3V2Starter),
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
    'backToSet':  iMenu.backToSet,
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
        if(!lobby[user].advancedUser){
            lobby[user].advancedUser = true;
        } else {
            lobby[user].advancedUser = false;
        }
        message.from.id = user;
        displayAccountSettingsMenu(message.reply_to_message);
    },
    //for accountsettings
    'toggleStyleTransfer': async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        displayAccountSettingsMenu(message.reply_to_message);
    },
    'toggleControlNet' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        displayAccountSettingsMenu(message.reply_to_message);
    },
    'toggleOpenPose' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        displayAccountSettingsMenu(message.reply_to_message);
    },
    //for create and effect menu
    'toggleStyleCreate': async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        iMenu.handleCreate(message.reply_to_message);
    },
    'toggleStyleEffect': async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        iMenu.handleEffect(message.reply_to_message);
    },
    'toggleControlCreate' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        iMenu.handleCreate(message.reply_to_message);
    },
    'toggleControlEffect' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        iMenu.handleEffect(message.reply_to_message);
    },
    'togglePoseCreate' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        iMenu.handleCreate(message.reply_to_message);
    },
    'togglePoseEffect' : async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        iMenu.handleEffect(message.reply_to_message);
    },
    'refresh' : async (message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        handleStatus(message.reply_to_message);
    },
    'cancel' : (message, user) => {
        bot.deleteMessage(message.chat.id, message.message_id);
        message.from.id = user;
        setUserState(message,STATES.IDLE)
    },
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
    'fluxi2i': iResponse.fluxi2iStarter.start.bind(iResponse.fluxi2iStarter),
    'interMenu': iMenu.handleInterrogateMenu,
    'assistMenu': iMenu.handleAssistMenu,
    'regenRun': async(message, runIndex, user) => {
        // Check if the user exists in the lobby
        //console.log('message in regenrun callback',message)
        if (!lobby[user]) {
            await sendMessage(message, 'Could not find your previous generations.');
            return;
        }

        // Fetch the user's runs
        //console.log('regenrun user',user)
        const userRuns = lobby[user].runs;
        if (!userRuns || userRuns.length <= runIndex) {
            await sendMessage(message, 'Invalid selection, please try again.');
            return;
        }
        const thisSeed = makeSeed(user);
        lobby[user].lastSeed = thisSeed;
        // Retrieve the run corresponding to the index
        const selectedRun = { ...userRuns[runIndex], seed: thisSeed, isRegen: true };
        console.log('regen run',selectedRun)
        // Create the task object using the original message and the selected run's promptObj
        const msg = message.reply_to_message
        //console.log('regenrun message',message)
        //console.log('regenrun reply to message',msg)
        const task = {
            message: msg,
            promptObj: selectedRun
        };

        // Enqueue the task
        enqueueTask(task);

        // Acknowledge the callback query with a success message
        const chatId = message.chat.id
        const messageId = message.message_id
        let messageThreadId = null;
        if(message.message_thread_id) {
            messageThreadId = message.message_thread_id
            bot.deleteMessage(chatId, messageId, {message_thread_id: messageThreadId})
        } else {
            bot.deleteMessage(chatId, messageId)
        }
        await react(message.reply_to_message,'👍')
    },
    'trainingMenu': iTrain.handleTrainingMenu,
    'accountSettingsMenu': returnToAccountMenu,
    'newLora': iTrain.newLora,
    'trainMenu': iTrain.trainMenu,
    'trainSlot': iTrain.trainSlot,
    'viewSlotImage': iTrain.viewSlotImage,
    'viewSlotCaption': iTrain.viewSlotCaption,
    'deleteSlotImage': iTrain.deleteLoraSlot,
    'submitTraining': iTrain.submitTraining,
    'regen_current_settings': handleHipFire,
    'initializeGroup': iGroup.initializeGroup,
    'backToGroupMenu': iGroup.backToGroupSettingsMenu,
    'gateKeepMenu': iGroup.groupGatekeepMenu, 
        'gateKeepTypeMenu' : iGroup.groupGatekeepTypeMenu, 'gateKeepTypeSelect': iGroup.groupGatekeepTypeSelect, 'gateKeepSetCA': iGroup.groupGatekeepSetCA,
    'commandsMenu': iGroup.groupCommandMenu,
    'promptsMenu': iGroup.groupPromptMenu,
    'unlockMenu': iGroup.groupUnlockMenu,
};


// Define prefix handlers map outside of the main exported function
const prefixHandlers = {
    //setbaseprompt
    'sbp_': (action, message, user) => {
        const selectedName = action.split('_')[1];
        actionMap['setBasePrompt'](message, selectedName, user);
    },
    //setvoicemodel
    'sv_': (action, message, user) => {
        const selectedName = action.split('_').slice(1).join('_');
        actionMap['setVoice'](message, selectedName, user);
    },
    //setcheckpoint
    'scp_': (action, message, user) => {
        const selectedName = action.split('_').slice(1).join('_');
        actionMap['setCheckpoint'](message, selectedName, user);
    },
    //setwatermark
    'swm_': (action, message, user) => {
        const selectedName = action.split('_').slice(1).join('_');
        actionMap['setWatermark'](message, selectedName, user);
    },
    'regen_run_': (action, message, user) => {
        const runIndex = parseInt(action.split('_')[2], 10);
        actionMap['regenRun'](message, runIndex, user);
    },
    //edit lora
    'el_': (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        actionMap['trainMenu'](message, user, loraId);
    },
    //edit training slot
    'et_': (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['trainSlot'](message, user, loraId, slotId);
    },
    //remove lora training set
    'rml_': (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        iTrain.removeTraining(user, loraId);
        actionMap['trainingMenu'](message, user);
    },
    //view slot image
    'vsi_': (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['viewSlotImage'](message,user,loraId,slotId);
    },
    //view slot caption
    'vsc_': (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['viewSlotCaption'](message,user,loraId,slotId);
    },
    //remove slot image
    'rms_': (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['deleteSlotImage'](message,user,loraId,slotId);
    },
    //submit training
    'st_': (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        actionMap['submitTraining'](message,user,loraId);
    },
    //initialize gorup
    'ig_': (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['initializeGroup'](message,user,groupChatId)
    },
    //edit group (back to group menu)
    'eg_': (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['backToGroupMenu'](message,user,groupChatId)
    },
    'gatekeep_' : (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['gateKeepMenu'](message,user,groupChatId)
    },
    'commands_': (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['commandsMenu'](message,user,groupChatId)
    },
    'prompts_': (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['promptsMenu'](message,user,groupChatId)
    },
    'unlock_':(action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['unlockMenu'](message,user,groupChatId)
    },
    'empty_': (action, message, user) => {
        const key = action.replace(/^empty_/, '');
        //console.log(key)
        //console.log(lobby[user][key])
        if(action.includes('image')){
            lobby[user][key] = ''
        } else if (key == 'seed') {
            lobby[user].input_seed = -1
        }else {
            lobby[user][key] = '-1'
        }
        actionMap['backToSet'](message,user)
    },
    //gatekeepstyle
    'gks_': (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['gateKeepTypeMenu'](message,user,groupChatId)
    },
    'sgks_': (action, message, user) => {
        const type = action.split('_')[1];
        const groupChatId = parseInt(action.split('_')[2]);
        actionMap['gateKeepTypeSelect'](message,user,groupChatId,type)
    },
    'gkca_': (action, message, user) => {
        const type = action.split('_')[1];
        const groupChatId = parseInt(action.split('_')[2]);
        actionMap['gateKeepSetCA'](message,user,groupChatId,type)
    }
    
};

// Main export function
module.exports = function (bot) {
    bot.on('callback_query', (callbackQuery) => {
        try {
            const { action, message, user } = parseCallbackData(callbackQuery);

            // Check if the callback query is from the correct user
            if (
                (
                    callbackQuery.from.id &&
                    callbackQuery.from.id != message.chat.id &&
                    callbackQuery.message.reply_to_message &&
                    callbackQuery.from.id !== callbackQuery.message.reply_to_message.from.id &&
                    message.from.id !== process.env.BOT_ID
                ) &&
                action !== 'refresh'
            ) {
                console.log('wrong user',callbackQuery.from.id,callbackQuery.message.reply_to_message, message.from.id);
                return;
            }

            // If the action is mapped directly in actionMap, call it
            if (actionMap[action]) {
                safeExecuteCallback(message,user,actionMap[action]);
            } else {
                // Loop through the prefixHandlers to find a match
                let handled = false;
                for (const prefix in prefixHandlers) {
                    if (action.startsWith(prefix)) {
                        safeExecuteCallback(message,user,prefixHandlers[prefix],action);
                        handled = true;
                        break;
                    }
                }

                // If not handled by prefixHandlers and it is a set action
                if (!handled && setActions.includes(action)) {
                    handleSetAction(action, message, user);
                } else if (!handled) {
                    console.log(`Unhandled action: ${action}`);
                }
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
