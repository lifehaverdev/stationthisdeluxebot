const { 
    actionMap, prefixHandlers,
    lobby, getBotInstance, STATES, burns, workspace, makeSeed 
} = require('../bot');
const { getVoiceModelByName } = require('../../models/voiceModelMenu')
const { getBasePromptByName } = require('../../models/basepromptmenu')
const {
    sendMessage,
    editMessage,
    safeExecute, safeExecuteCallback,
    setUserState,
    react
} = require('../../utils');
const { handleStatus } = require('./iWork');
const { startSet } = require('./iSettings');
const { handleRegen, handleHipFire } = require('./iMake')
const { returnToAccountMenu, displayAccountSettingsMenu, handleRefreshQoints } = require('./iAccount')
const iMenu = require('./iMenu');
const iGroup = require('./iGroup')
const iResponse = require('./iResponse');
const iBrand = require('./iBrand')
const iTrain = require('./iTrain')
const iWork = require('./iWork')
const bot = getBotInstance();
const { getGroup } = require('./iGroup')
const { enqueueTask } = require('../queue')
const { AnalyticsEvents } = require('../../../db/models/analyticsEvents');
const analytics = new AnalyticsEvents();
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
        let messageTitle = `Voice set to: ${selectedName}\n\nWhat should I say?`;
        const customFileNameText = lobby[userId].customFileNames ? 
            "\n\nSeparate what I should say and the output filename with a | symbol\ne.g. Hello world!|greeting will make greeting.mp3\n if you don't include a | I will just use the name you gave me in preferences menu" : "";
        messageTitle += customFileNameText;
        editMessage({
            text: messageTitle,
            chat_id: chatId,
            message_id: messageId,
        })
    } else {
        console.log('no Voice')
    }
};

const handleSetWatermark = async (message, selectedName, userId) => {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const image = workspace[userId]?.imageUrl; // Check workspace for an image
    if(!lobby.hasOwnProperty(userId)){
        console.log('no user in lobby in handlesetwatermark')
        return
    }
    if (selectedName !== undefined) {
        if (selectedName === 'empty') {
            lobby[userId].waterMark = false;
        } else {
            lobby[userId].waterMark = selectedName;
        }

        // Update the workspace with the new watermark status
        const messageTitle = `Watermark set to: ${selectedName} ✅\n\nSend in the photo you want to brand.`;
        await editMessage({
            text: messageTitle,
            chat_id: chatId,
            message_id: messageId,
        });
        setUserState({...message,from: {id: userId},chat: {id: chatId}},STATES.WATERMARK)

        // If an image is already in the workspace, route directly to handleWatermark
        if (image) {
            console.log('Image already in workspace, routing to handleWatermark');
            await iBrand.handleWatermark(message, image, userId);
            delete workspace[userId]
            
        }
    } else {
        console.log('No base prompt provided for watermark');
    }
};


//const actionMap = {
    actionMap['regen']= async (message,user) => {
        message.from.id = user;
        handleRegen(message)
    },
    actionMap['make']= iResponse.makeStarter.start.bind(iResponse.makeStarter)
    actionMap['ms2']= iResponse.ms2Starter.start.bind(iResponse.ms2Starter)
    actionMap['make3']= iResponse.make3Starter.start.bind(iResponse.make3Starter)
    actionMap['pfp']= iResponse.pfpStarter.start.bind(iResponse.pfpStarter)
    actionMap['interrogate'] = iResponse.interrogateStarter.start.bind(iResponse.interrogateStarter)
    actionMap['assist']= iResponse.assistStarter.start.bind(iResponse.assistStarter)
    actionMap['flassist']= iResponse.flassistStarter.start.bind(iResponse.flassistStarter)
    actionMap['ms3']= iResponse.ms3Starter.start.bind(iResponse.ms3Starter)
    actionMap['ms3.2']= iResponse.ms3V2Starter.start.bind(iResponse.ms3V2Starter)
    actionMap['rmbg']= iResponse.rmbgStarter.start.bind(iResponse.rmbgStarter)
    actionMap['upscale']= iResponse.upscaleStarter.start.bind(iResponse.upscaleStarter)
    actionMap['watermark']= iBrand.startWatermark ,//iResponse.watermarkStarter.start.bind(iResponse.watermarkStarter)
    actionMap['disc']= iResponse.discStarter.start.bind(iResponse.discStarter)
    actionMap['speak']= iWork.startSpeak,//iResponse.speakStarter.start.bind(iResponse.speakStarter)
    actionMap['inpaint'] = iResponse.inpaintStarter.start.bind(iResponse.inpaintStarter)
    actionMap['set']= async (message,user) => {
        message.from.id = user;
        iMenu.setMenu(message)
    }
    actionMap['backToSet']=  iMenu.backToSet
    actionMap['voiceMenu']= iMenu.handleVoiceMenu
    actionMap['checkpointmenu']= iMenu.handleCheckpointMenu
    actionMap['basepromptmenu']= iMenu.handleBasePromptMenu
    actionMap['voicemenu']= iMenu.handleVoiceMenu
    actionMap['toggleWaterMark'] = iMenu.handleWatermarkMenu
    actionMap['setVoice']= handleSetVoice
    actionMap['setBasePrompt']= handleSetBasePrompt
    actionMap['setCheckpoint']= handleSetCheckpoint
    actionMap['setWatermark']= handleSetWatermark
    
    //for accountsettings
    actionMap['toggleStyleTransfer']= async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        displayAccountSettingsMenu(message.reply_to_message);
    }
    actionMap['toggleControlNet'] = async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        displayAccountSettingsMenu(message.reply_to_message);
    }
    actionMap['toggleOpenPose'] = async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        displayAccountSettingsMenu(message.reply_to_message);
    }
    //for create and effect menu
    actionMap['toggleStyleCreate']= async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        iMenu.handleCreate(message.reply_to_message);
    }
    actionMap['toggleStyleEffect']= async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].styleTransfer = !lobby[user].styleTransfer;
        message.from.id = user;
        iMenu.handleEffect(message.reply_to_message);
    }
    actionMap['toggleControlCreate'] = async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        iMenu.handleCreate(message.reply_to_message);
    }
    actionMap['toggleControlEffect'] = async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].controlNet = !lobby[user].controlNet;
        message.from.id = user;
        iMenu.handleEffect(message.reply_to_message);
    }
    actionMap['togglePoseCreate'] = async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        iMenu.handleCreate(message.reply_to_message);
    }
    actionMap['togglePoseEffect'] = async (message, user) => {
        await bot.deleteMessage(message.chat.id, message.message_id)
        lobby[user].openPose = !lobby[user].openPose;
        message.from.id = user;
        iMenu.handleEffect(message.reply_to_message);
    }
    actionMap['refresh'] = async (message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        handleStatus(message.reply_to_message);
    }
    actionMap['cancel'] = (message, user) => {
        bot.deleteMessage(message.chat.id, message.message_id);
        message.from.id = user;
        workspace.hasOwnProperty(user) ? delete workspace[user] : null
        setUserState(message,STATES.IDLE)
    }
    actionMap['featuredLora']= async (message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.featuredLoRaList(message);
    }
    actionMap['topTenLora']= async (message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.loraList(message);
    }
    // 'favoriteLora'= async (message) => {
    //     await bot.deleteMessage(message.chat.id, message.message_id);
    //     iWork.favoriteLoRaList(message);
    // }
    actionMap['fullLora']= async(message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.sendLoRaModelFilenames(message)
    }
    actionMap['fluxLora']= async(message) => {
        await bot.deleteMessage(message.chat.id, message.message_id);
        iWork.fluxLoraList(message)
    }
    actionMap['finterrogate']= iWork.startFluxInterrogate,
    actionMap['flux']= iResponse.fluxStarter.start.bind(iResponse.fluxStarter),
    actionMap['fluxi2i']= iResponse.fluxi2iStarter.start.bind(iResponse.fluxi2iStarter),
    actionMap['interMenu']= iMenu.handleInterrogateMenu,
    actionMap['assistMenu']= iMenu.handleAssistMenu,
    actionMap['regenRun']= async(message, runIndex, user) => {
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
    }
    actionMap['trainingMenu']= iTrain.handleTrainingMenu
    actionMap['accountSettingsMenu']= returnToAccountMenu
    actionMap['newLora']= iTrain.newLora
    actionMap['trainMenu']= iTrain.trainMenu
    actionMap['trainSlot']= iTrain.trainSlot
    actionMap['viewSlotImage']= iTrain.viewSlotImage
    actionMap['viewSlotCaption']= iTrain.viewSlotCaption
    actionMap['deleteSlotImage']= iTrain.deleteLoraSlot
    actionMap['submitTraining']= iTrain.submitTraining
    actionMap['regen_current_settings']= handleHipFire

    actionMap['refreshQoints'] = handleRefreshQoints
    
    
//};


// Define prefix handlers map outside of the main exported function
//const prefixHandlers = {
    //setbaseprompt
    prefixHandlers['sbp_'] = (action, message, user) => {
        const selectedName = action.split('_')[1];
        actionMap['setBasePrompt'](message, selectedName, user);
    }
    //setvoicemodel
    prefixHandlers['sv_']= (action, message, user) => {
        const selectedName = action.split('_').slice(1).join('_');
        actionMap['setVoice'](message, selectedName, user);
    }
    //setcheckpoint
    prefixHandlers['scp_']= (action, message, user) => {
        const selectedName = action.split('_').slice(1).join('_');
        actionMap['setCheckpoint'](message, selectedName, user);
    }
    //setwatermark
    prefixHandlers['swm_']= (action, message, user) => {
        const selectedName = action.split('_').slice(1).join('_');
        actionMap['setWatermark'](message, selectedName, user);
    }
    prefixHandlers['regen_run_']= (action, message, user) => {
        const runIndex = parseInt(action.split('_')[2], 10);
        actionMap['regenRun'](message, runIndex, user);
    }
    //edit lora
    prefixHandlers['el_']= (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        actionMap['trainMenu'](message, user, loraId);
    }
    //edit training slot
    prefixHandlers['et_']= (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['trainSlot'](message, user, loraId, slotId);
    }

    //view slot image
    prefixHandlers['vsi_']= (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['viewSlotImage'](message,user,loraId,slotId);
    }
    //view slot caption
    prefixHandlers['vsc_']= (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['viewSlotCaption'](message,user,loraId,slotId);
    }
    //remove slot image
    prefixHandlers['rms_']= (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        const slotId = parseInt(action.split('_')[2]);
        actionMap['deleteSlotImage'](message,user,loraId,slotId);
    }
    //submit training
    prefixHandlers['st_']= (action, message, user) => {
        const loraId = parseInt(action.split('_')[1]);
        actionMap['submitTraining'](message,user,loraId);
    }
    
    prefixHandlers['empty_']= (action, message, user) => {
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
    }
    
//};

// Main export function
module.exports = function (bot) {
    bot.on('callback_query', async(callbackQuery) => {
        //console.log(callbackQuery)
        try {
            const { action, message, user } = parseCallbackData(callbackQuery);

            // Track the menu interaction
            await analytics.trackMenuInteraction(
                callbackQuery, 
                action, 
                !actionMap[action] && !setActions.includes(action)
            );
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
