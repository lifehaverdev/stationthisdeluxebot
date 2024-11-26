const { workspace, SETTER_TO_STATE, STATE_TO_LOBBYPARAM, STATES, lobby, rooms, getPhotoUrl } = require('../bot')
const { setUserState, sendMessage, editMessage, DEV_DMS } = require('../../utils')
const { getPromptMenu } = require('../../models/userKeyboards')
const Jimp = require('jimp');
const iMenu = require('./iMenu')
const { getGroup } = require('./iGroup')

const SIZELIMIT = 2048;
const BATCHLIMIT = 6;

const STEPSLIMIT = 48;

async function startSet(message,user) {
    //console.log('message in startset',message)
    let settings;
    const group = getGroup(message);
    //console.log('group',group.wallet, group.owner)
    //console.log('user',message.from.id)
    console.log('handling set',user,'is we dev',user == DEV_DMS,user,DEV_DMS)
    if(group){
        if(
            user == DEV_DMS ||
            (group.admins.length > 0 && group.admins.some((appointed) => {return user == appointed ? true : false}))){
            console.log('we got it , you are group owner')
            settings = group.settings;
        } else {
            sendMessage(message,'only admin can change settings for a group')
            return 
        }
    } else {
        settings = lobby[message.from.id]
    }
    

    const command = message.text.replace('/set','');
    //const userId = message.from.id;
    const setter = `set${command}`;
    const state = SETTER_TO_STATE[setter]
    const lobbyParam = STATE_TO_LOBBYPARAM[state]
    //console.log(settings)
    const currentValue = settings ? (settings[lobbyParam] || "not set") : "not set";

    let botMessage;
    let chat_id;
    let message_id;
    let reply_markup;

    const editPayload = {
        chat_id: message.chat.id,
        message_id: message.message_id,
    };

    const buildOptionalInline = (type, justBack = null) => {
        if(justBack){
                return {
                    inline_keyboard: [
                    [{text: '↖︎', callback_data: 'backToSet'}],
                ]
            }
        }
        if(type == 'seed'){
            return {
                inline_keyboard: [
                [{text: '↖︎', callback_data: 'backToSet'}],
                [{text: 'set to random', callback_data: `empty_${type}` }],
            ]
        }
        }
        return {
                inline_keyboard: [
                [{text: '↖︎', callback_data: 'backToSet'}],
                [{text: 'set as empty', callback_data: `empty_${type}` }],
                
            ]
        }
    }

    const sendOrEditMessage = async (text, reply_markup = null) => {
        let keyboard;
        reply_markup ? keyboard = reply_markup : keyboard = null
        console.log(keyboard)
        if (user) {
            editMessage({
                text,
                reply_markup: keyboard,
                ...editPayload,
                options: { parse_mode: 'Markdown'}
            });
        } else {
            await sendMessage(message, text, { reply_markup: keyboard, force_reply: true, parse_mode: 'MarkdownV2' });
        }
    };
    if(currentValue == 'notset'){
        console.log('not set');
        setUserState(STATES.IDLE)
    } else {
        let keys;
        switch (command) {
            case 'batch':
                keys = buildOptionalInline(command,true)
                const maxBatch = calcBatch(message); // Assume calcBatch is defined elsewhere
                await sendOrEditMessage( `What batch do you want to set to? ${currentValue == 1 ? `` : `Rn it is set to ${currentValue}.`} You can go up to ${maxBatch}`,keys);
                break;
            case 'steps':
                keys = buildOptionalInline(command,true)
                const maxSteps = calcSteps(message); // Assume calcSteps is defined elsewhere
                await sendOrEditMessage( `What steps do you want to set to? ${currentValue == 30 ? `` : `Rn it is set to ${currentValue}.`} You can go up to ${maxSteps}`,keys);
                break;
            case 'size':
                keys = buildOptionalInline(command,true)
                const maxSize = calcSize(message); // Assume calcSize is defined elsewhere
                await sendOrEditMessage(`What size do you want to set to? ('W,H' format) ${settings.input_width == 1024 && settings.input_height == 1024 ? `` : `Rn it is set to ${settings.input_width},${settings.input_height}.`} Your maximum size is ${maxSize},${maxSize}`,keys);
                break;
            case 'cfg':
                keys = buildOptionalInline(command,true)
                await sendOrEditMessage( `What CFG do you want to set to? ${currentValue == 6 ? `` : `Rn it is set to ${currentValue}.`} Please enter a value between 0 and 20`,keys);
                break;
            case 'strength':
                keys = buildOptionalInline(command,true)
                await sendOrEditMessage( `What strength do you want to set to? Rn it is set to ${currentValue}. Please enter a decimal value (i.e. '.4' or '0.5') between 0 and 1`,keys);
                break;
            case 'prompt':
            case 'userprompt':
            case 'negprompt': 
                const blank = currentValue == -1
                keys = buildOptionalInline('prompt',true)
                if(command == 'negprompt'){keys = buildOptionalInline('input_negative',blank)} 
                if(command == 'userprompt'){keys = buildOptionalInline('userPrompt',blank)}
                await sendOrEditMessage( `What ${command} do you want to set it to? ${blank ? '' : `Rn it is set to:\n\n\`${currentValue}\`\n`}`,{...keys,parse_mode: 'MarkdownV2' });
                break;
            case 'photo':
                keys = buildOptionalInline('input_image')
                await sendOrEditMessage( 'What photo do you want to set',keys)
                break;
            case 'style':
                keys = buildOptionalInline('input_style_image')
                await sendOrEditMessage( 'Send in a photo to apply style transfer on',keys)
                break;
            case 'control':
                keys = buildOptionalInline('input_control_image')
                await sendOrEditMessage( 'Send in a photo to apply controlnet from',keys)
                break;
            case 'pose':
                keys = buildOptionalInline('input_pose_image')
                await sendOrEditMessage( 'Send in a photo to apply openPose on',keys)
                break;
            case 'checkpoint':
                botMessage = await sendOrEditMessage( 'Checkpoint Menu:');
                chat_id = botMessage.chat.id;
                message_id = botMessage.message_id;
                reply_markup = getCheckpointMenu(message.from.id, botMessage);
                editReply(reply_markup, chat_id, message_id,);
                break
            case 'baseprompt':
                botMessage = await sendOrEditMessage( 'Base Prompt Menu:');
                chat_id = botMessage.chat.id;
                message_id = botMessage.message_id;
                reply_markup = getPromptMenu(message.from.id, botMessage);
                editReply(reply_markup, chat_id, message_id,);
                break
            case 'seed': 
                keys = buildOptionalInline('seed')
                await sendOrEditMessage( `What seed do you want to set to? ${currentValue == -1 ? `Rn it is random` : `Rn it is set to ${currentValue}.`}`,keys);
                break;
            default:
                keys = buildOptionalInline(command,true)
                await sendOrEditMessage( `Rn it is set to ${currentValue}. What ${command} do you want to set it to?`,keys);
                break;
        }
        setUserState(message,state);
    }
}

function calcSize(message) {
    const userId = message.from.id;
    const group = getGroup(message)
    let possibleSize;
    if(lobby[userId] || group){
        if(group){
            possibleSize = Math.floor(group.applied/ 1000) + 1024; //has 1000000 is 1000 1000, can go 2024
        } else {
            possibleSize = Math.floor(lobby[userId].balance / 1000) + 1024; //has 1000000 is 1000 1000, can go 2024
        }
        if(possibleSize > SIZELIMIT){
            possibleSize = SIZELIMIT;
        }
        return possibleSize
    } else {
        sendMessage(message,'hey, please make something first so i can see ur account')
    }
}

function calcBatch(message) {
    const userId = message.from.id;
    const group = getGroup(message)
    let possibleBatch;
    if(lobby[userId] || group){
        if(group){
            possibleBatch = Math.floor(group.applied / 1000000) + 1;
        } else {
            possibleBatch = Math.floor(lobby[userId].balance / 1000000) + 1;
        }
        if(possibleBatch > BATCHLIMIT){
            possibleBatch = BATCHLIMIT;
        }
        return possibleBatch
    } else {
        sendMessage(message,'hey, please make something first so i can see ur account')
    }
}
function calcSteps(message) {
    const userId = message.from.id;
    const group = getGroup(message)
    let possibleSteps;
    if(lobby[userId] || group){
        if(group){
            possibleSteps = Math.floor(group.applied / 1000000) + 30;
        } else {
            possibleSteps = Math.floor(lobby[userId].balance / 1000000) + 30;
        }
        if(possibleSteps > STEPSLIMIT){
            possibleSteps = STEPSLIMIT;
        }
        return possibleSteps
    } else {
        sendMessage(message,'hey, please make something first so i can see ur account')
    }
}

async function handleSet(message) {
    let settings;
    const userId = message.from.id;
    const group = getGroup(message);
    const originalMsg = workspace[JSON.stringify(message.from.id)]
    //console.log('workspace',workspace)
    //console.log('found it!',originalMsg)
    //console.log('group in handleset',group.id);
    console.log('handling set',userId,'is we dev',userId == DEV_DMS)
    if(group){
        if(
            userId == DEV_DMS ||
            (group.admins.length > 0 && group.admins.some((appointed) => {return message.from.id == appointed ? true : false}))
        ){
            settings = group.settings;
        } else {
            sendMessage(message,'Only admin can change group settings')
            return 
        }
    } else {
        settings = lobby[userId]
    }


    const sendOrEdit = async (text) => {
        const chatId = originalMsg ? originalMsg.chat_id : message.chat.id;
        const messageId = originalMsg ? originalMsg.message_id : message.message_id;
    
        const context = workspace[userId]?.context || 'set';
        console.log('sendoredit in handleset workspace user id',workspace[userId])
        if (context === 'create') {
            console.log('create context',originalMsg)
            // Call createMenu directly with originalMsg to handle editing
            await iMenu.handleCreate({chat: {id: originalMsg.chat_id}, from: {id: userId}, message_id: originalMsg.message_id}, '', userId);
            console.log('we just sent to create')
        } else {
            // Build and edit setMenu for 'set' context
            const setMenu = iMenu.buildSetMenu(settings, group, settings.balance);
            setMenu.reply_markup.inline_keyboard.push([{ text: 'regen', callback_data: 'regen' }]);
            setUserState(message,STATES.IDLE);
            if (originalMsg) {
                delete workspace[userId];
                await editMessage({
                    chat_id: chatId,
                    message_id: messageId,
                    text,
                    ...setMenu,
                });
            } else {
                if (workspace[userId]) delete workspace[userId];
                await sendMessage(message, text, setMenu);
            }
        }
    };
    
    

    //console.log('settings in handleset',settings);
    
    const newValue = message.text;
    const currentState = lobby[userId].state.state;
    const lobbyParam = STATE_TO_LOBBYPARAM[currentState];
    
    // console.log('setting',lobbyParam)
    // console.log('currently',lobby[userId][lobbyParam])
    // console.log('current user state',currentState)
    if (!lobby[userId] && !group) {
        sendOrEdit(originalMsg, "You need to make something first");
        return;
    }

    switch (currentState) {
        case STATES.SETPROMPT:
        case STATES.SETTYPE:
            settings[lobbyParam] = newValue;
            sendOrEdit(`ok its set`);
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETNEGATIVEPROMPT:
        case STATES.SETUSERPROMPT:
            if(newValue == '-1'){
                settings[lobbyParam] = '';
                sendOrEdit('alright its off');
            } else {
                settings[lobbyParam] = newValue;
                sendOrEdit(`ok its set`);
            }
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETPHOTO:
        case STATES.SETSTYLE:
        case STATES.SETCONTROL:
        case STATES.SETPOSE:
            const fileUrl = await getPhotoUrl(message);
            console.log('made it here')
            try {
                const photo = await Jimp.read(fileUrl);
                const { width, height } = photo.bitmap;

                if(currentState == STATES.SETPHOTO) {
                    
                    settings.input_image = fileUrl
                    settings.input_width = width
                    settings.input_height = height
                    await sendOrEdit(`k got it. The dimensions of the photo are ${width}x${height}`);
                } else if(currentState == STATES.SETCONTROL) {
                    
                    settings.input_control_image = fileUrl
                    
                    await sendOrEdit(`very nice. if controlnet is enabled, this image will be applied.`);
                } else if(currentState == STATES.SETPOSE) {
                    settings.input_pose_image = fileUrl
                    await sendOrEdit(`very nice. if pose is enabled, this image will be applied.`)
                
                } else if(currentState == STATES.SETSTYLE) {
                    settings.input_style_image = fileUrl
                    // console.log('settings in setstyle',settings);
                    // console.log('lobby in setstyle',lobby[userId])
                    await sendOrEdit(`looks dope. if style transfer is enabled, this image will be applied`);
                }
                
            } catch(err) {
                sendMessage(message,`${err}`);
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
            settings[lobbyParam] = intValue;
            sendOrEdit(`Your ${lobbyParam} is now ${intValue}`);
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
            settings.input_width = sizeValues[0]
            settings.input_height = sizeValues[1]
            sendOrEdit(`You set size to ${sizeValues[0]},${sizeValues[1]}`);
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
            settings[lobbyParam] = floatValue;
            sendOrEdit(`Your ${lobbyParam} is now ${floatValue}`, iMenu.justSet);
            setUserState(message,STATES.IDLE);
            break;
        case STATES.GROUPAPPLY:
            //console.log('we are in handle set group apply');
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
            //settings[lobbyParam] = floatValue;
            iGroup.createGroup(message);
            sendOrEdit(`Your ${lobbyParam} is now ${floatValue}`);
            setUserState(message,STATES.IDLE);
            break;
        default:
            sendMessage(message, 'Unknown setter command');
            setUserState(message,STATES.IDLE);
            break;
    }
}

module.exports = { startSet, handleSet }