const { DEV_DMS, SETTER_TO_STATE, STATE_TO_LOBBYPARAM, STATES, lobby, rooms, getPhotoUrl } = require('../bot')
const { setUserState, sendMessage, editMessage } = require('../../utils')
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
    if(group){
        if(user == group.owner || (group.admin.length > 0 && group.admin.some((appointed) => {return user == appointed ? true : false}))){
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
        force_reply: true
    };

    const sendOrEditMessage = async (text, reply_markup = null) => {
        let keyboard;
        reply_markup ? keyboard = reply_markup : keyboard = iMenu.justSet
        console.log(keyboard)
        if (user) {
            editMessage({
                text,
                keyboard,
                ...editPayload
            });
        } else {
            await sendMessage(message, text, { keyboard, force_reply: true });
        }
    };

    if(currentValue == 'notset'){
        console.log('not set');
        setUserState(STATES.IDLE)
    } else {
        switch (command) {
            case 'batch':
                const maxBatch = calcBatch(message); // Assume calcBatch is defined elsewhere
                await sendOrEditMessage( `What batch do you want to set to? Rn it is set to ${currentValue}. You can go up to ${maxBatch}`);
                break;
            case 'steps':
                const maxSteps = calcSteps(message); // Assume calcSteps is defined elsewhere
                await sendOrEditMessage( `What steps do you want to set to? Rn it is set to ${currentValue}. You can go up to ${maxSteps}`);
                break;
            case 'size':
                const maxSize = calcSize(message); // Assume calcSize is defined elsewhere
                await sendOrEditMessage(`What size do you want to set to? Rn it is set to ${currentValue.width},${currentValue.height}. Your maximum size is ${maxSize},${maxSize}`);
                break;
            case 'cfg':
                await sendOrEditMessage( `What CFG do you want to set to? Rn it is set to ${currentValue}. Please enter a value between 0 and 30`);
                break;
            case 'strength':
                await sendOrEditMessage( `What strength do you want to set to? Rn it is set to ${currentValue}. Please enter a decimal value (i.e. '.4' or '0.5') between 0 and 1`);
                break;
            case 'prompt':
            case 'userprompt':
            case 'negprompt': 
                await sendOrEditMessage( `What ${command} do you want to set it to? Rn it is set to:`);
                message.message_id = null;
                await sendMessage(message, `\`${currentValue}\``,{parse_mode: 'MarkdownV2'});
                break;
            case 'photo':
                await sendOrEditMessage( 'What photo do you want to set')
                break;
            case 'style':
                await sendOrEditMessage( 'Send in a photo to apply style transfer on')
                break;
            case 'control':
                await sendOrEditMessage( 'Send in a photo to apply controlnet from')
                break;
            case 'pose':
                await sendOrEditMessage( 'Send in a photo to apply openPose on')
                break;
            case 'checkpoint':
                botMessage = await sendOrEditMessage( 'Checkpoint Menu:');
                chat_id = botMessage.chat.id;
                message_id = botMessage.message_id;
                reply_markup = getCheckpointMenu(message.from.id, botMessage);
                editReply(reply_markup, chat_id, message_id,);
            case 'baseprompt':
                botMessage = await sendOrEditMessage( 'Base Prompt Menu:');
                chat_id = botMessage.chat.id;
                message_id = botMessage.message_id;
                reply_markup = getPromptMenu(message.from.id, botMessage);
                editReply(reply_markup, chat_id, message_id,);
            default:
                await sendOrEditMessage( `Rn it is set to ${currentValue}. What ${command} do you want to set it to?`);
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
    //console.log('group in handleset',group.id);
    if(group){
        if(userId == group.owner || (group.admin.length > 0 && group.admin.some((appointed) => {return message.from.id == appointed ? true : false}))){
            settings = group.settings;
        } else {
            sendMessage(message,'only admin can change settings for a group')
            return 
        }
    } else {
        settings = lobby[userId]
    }

    //console.log('settings in handleset',settings);
    
    const newValue = message.text;
    const currentState = lobby[userId].state.state;
    const lobbyParam = STATE_TO_LOBBYPARAM[currentState];
    
    // console.log('setting',lobbyParam)
    // console.log('currently',lobby[userId][lobbyParam])
    // console.log('current user state',currentState)
    if (!lobby[userId] && !group) {
        sendMessage(message, "You need to make something first");
        return;
    }

    switch (currentState) {
        case STATES.SETPROMPT:
        case STATES.SETTYPE:
            settings[lobbyParam] = newValue;
            sendMessage(message, `ok its set`, iMenu.justSet);
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETNEGATIVEPROMPT:
        case STATES.SETUSERPROMPT:
            if(newValue == '-1'){
                settings[lobbyParam] = '';
                sendMessage(message,'alright its off', iMenu.justSet);
            } else {
                settings[lobbyParam] = newValue;
                sendMessage(message, `ok its set`, iMenu.justSet);
            }
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETPHOTO:
        case STATES.SETSTYLE:
        case STATES.SETCONTROL:
        case STATES.SETPOSE:
            const fileUrl = await getPhotoUrl(message);

            try {
                const photo = await Jimp.read(fileUrl);
                const { width, height } = photo.bitmap;

                if(currentState == STATES.SETPHOTO) {
                    const photoStats = {
                        width: width,
                        height: height
                    };
                    
                    settings.fileUrl = fileUrl
                    settings.photoStats = photoStats
                    await sendMessage(message, `k got it. The dimensions of the photo are ${width}x${height}`, iMenu.justSet);
                } else if(currentState == STATES.SETCONTROL) {
                    
                    settings.controlFileUrl = fileUrl
                    
                    await sendMessage(message, `very nice. if controlnet is enabled, this image will be applied.`, iMenu.justSet);
                } else if(currentState == STATES.SETPOSE) {
                    settings.poseFileUrl = fileUrl
                    await sendMessage(message, `very nice. if pose is enabled, this image will be applied.`, iMenu.justSet)
                
                } else if(currentState == STATES.SETSTYLE) {
                    settings.styleFileUrl = fileUrl
                    // console.log('settings in setstyle',settings);
                    // console.log('lobby in setstyle',lobby[userId])
                    await sendMessage(message, `looks dope. if style transfer is enabled, this image will be applied`, iMenu.justSet);
                }
        
                setUserState(message,STATES.IDLE);
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
            sendMessage(message, `Your ${lobbyParam} is now ${intValue}`, iMenu.justSet);
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
            settings[lobbyParam] = { width: sizeValues[0], height: sizeValues[1] };
            sendMessage(message, `You set size to ${sizeValues[0]},${sizeValues[1]}`, iMenu.justSet);
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
            sendMessage(message, `Your ${lobbyParam} is now ${floatValue}`, iMenu.justSet);
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
            sendMessage(message, `Your ${lobbyParam} is now ${floatValue}`, iMenu.justSet);
            setUserState(message,STATES.IDLE);
            break;
        default:
            sendMessage(message, 'Unknown setter command');
            setUserState(message,STATES.IDLE);
            break;
    }
}

module.exports = { startSet, handleSet }