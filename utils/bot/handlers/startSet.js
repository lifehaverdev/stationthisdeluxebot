const { SETTER_TO_STATE, STATE_TO_LOBBYPARAM, STATES, lobby, rooms, getPhotoUrl } = require('../bot')
const { setUserState, sendMessage } = require('../../utils')

const SIZELIMIT = 2048;
const BATCHLIMIT = 4;

const STEPSLIMIT = 48;

async function startSet(message) {
    let settings;
    if(message.chat.id < 0){
        const index = rooms.findIndex((group) => group.chat.id === message.chat.id);
        if(index != -1){
            if(rooms[index].admin.some((appointed) => {return message.from.id == appointed ? true : false})){
                settings = rooms[index].settings;
            } else {
                sendMessage(message,'only admin can change settings for a group')
                return 
            }
        } else {
            settings = lobby[userId]
        }
    }
    

    const command = message.text.replace('/set','');
    const userId = message.from.id;
    const setter = `set${command}`;
    const state = SETTER_TO_STATE[setter]
    const lobbyParam = STATE_TO_LOBBYPARAM[state]
    const currentValue = settings ? (settings[lobbyParam] || "not set") : "not set";
    if(currentValue == 'notset'){
        console.log('not set');
        setUserState(STATES.IDLE)
    } else {
        switch (command) {
            case 'batch':
                const maxBatch = calcBatch(message); // Assume calcBatch is defined elsewhere
                await sendMessage(message, `What batch do you want to set to? Rn it is set to ${currentValue}. You can go up to ${maxBatch}`);
                break;
            case 'steps':
                const maxSteps = calcSteps(message); // Assume calcSteps is defined elsewhere
                await sendMessage(message, `What steps do you want to set to? Rn it is set to ${currentValue}. You can go up to ${maxSteps}`);
                break;
            case 'size':
                const maxSize = calcSize(message); // Assume calcSize is defined elsewhere
                await sendMessage(message, `What size do you want to set to? Rn it is set to ${currentValue.width},${currentValue.height}. Your maximum size is ${maxSize},${maxSize}`);
                break;
            case 'cfg':
                await sendMessage(message, `What CFG do you want to set to? Rn it is set to ${currentValue}. Please enter a value between 0 and 30`);
                break;
            case 'strength':
                await sendMessage(message, `What strength do you want to set to? Rn it is set to ${currentValue}. Please enter a decimal value (i.e. '.4' or '0.5') between 0 and 1`);
                break;
            case 'prompt':
            case 'userprompt':
            case 'negprompt': 
                await sendMessage(message, `What ${command} do you want to set it to? Rn it is set to:`);
                await sendMessage(message, ` ${currentValue}`);
                break;
            case 'photo':
                await sendMessage(message, 'What photo do you want to set')
                break;
            default:
                await sendMessage(message, `Rn it is set to ${currentValue}. What ${command} do you want to set it to?`);
                break;
        }
        setUserState(message,state);
    }
}

function calcSize(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    let possibleSize;
    if(lobby[userId]){
        possibleSize = Math.floor(lobby[userId].balance / 1000) + 1024; //has 1000000 is 1000 1000, can go 2024
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
    const chatId = message.chat.id;
    let possibleBatch;
    if(lobby[userId]){
        possibleBatch = Math.floor(lobby[userId].balance / 1000000) + 1;
        if(possibleBatch > BATCHLIMIT){
            possibleBatch = BATCHLIMIT;
        }
        return possibleBatch
    } else {
        sendMessage(message,'hey, please make something first so i can see ur account')
    }
}
function calcSteps(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let possibleSteps;
    if(lobby[userId]){
        possibleSteps = Math.floor(lobby[userId].balance / 1000000) + 30;
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
    if(message.chat.id < 0){
        const index = rooms.findIndex((group) => group.chat.id === message.chat.id);
        if(index != -1){
            if(rooms[index].admin.some((appointed) => {return message.from.id == appointed ? true : false})){
                settings = rooms[index].settings;
            } else {
                sendMessage(message,'only admin can change settings for a group')
                return 
            }
        } else {
            settings = lobby[userId]
        }
    }
    
    const userId = message.from.id;
    const newValue = message.text;
    const currentState = lobby[userId].state.state;
    const lobbyParam = STATE_TO_LOBBYPARAM[currentState];
    console.log('current user state',currentState)
    if (!lobby[userId]) {
        sendMessage(message, "You need to make something first");
        return;
    }

    switch (currentState) {
        case STATES.SETPROMPT:
        case STATES.SETTYPE:
            settings[lobbyParam] = newValue;
            sendMessage(message, `ok its set`);
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETNEGATIVEPROMPT:
        case STATES.SETUSERPROMPT:
            settings[lobbyParam] = newValue;
            if(newValue == '-1'){
                sendMessage(message,'alright its off');
            } else {
                sendMessage(message, `ok its set`);
            }
            setUserState(message,STATES.IDLE);
            break;
        case STATES.SETPHOTO:
        case STATES.SETSTYLE:
        case STATES.SETCONTROL:
            getPhotoUrl(message);
            try {
                const photo = await Jimp.read(fileUrl);
                const { width, height } = photo.bitmap;

                if(currentState == STATES.SETPHOTO) {
                    const photoStats = {
                        width: width,
                        height: height
                    };
                    
                    settings = {
                        ...settings,
                        photoStats: photoStats,
                        fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
                    }
                    await sendMessage(message, `k got it. The dimensions of the photo are ${width}x${height}`);
                } else if(currentState == STATES.SETCONTROL) {
                    
                    settings = {
                        ...settings,
                        controlfileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
                    }
                    await sendMessage(message, `k got it. The dimensions of the photo are ${width}x${height}`);
                } else {
                    settings = {
                        ...settings,
                        styleFileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`,
                    }
                    await sendMessage(message, `looks dope. if style transfer is enabled in account settings, this image will be applied for make`);
                }
        
                setUserState(message,STATES.IDLE);
            } catch(err) {
                bot.sendMessage(DEV_DMS,err);
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
            sendMessage(message, `Your ${lobbyParam} is now ${intValue}`);
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
            sendMessage(message, `You set size to ${sizeValues[0]},${sizeValues[1]}`);
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
            sendMessage(message, `Your ${lobbyParam} is now ${floatValue}`);
            setUserState(message,STATES.IDLE);
            break;
        default:
            sendMessage(message, 'Unknown setter command');
            setUserState(message,STATES.IDLE);
            break;
    }
}

module.exports = { startSet, handleSet }