const { getBotInstance, lobby, startup, STATES, commandStateMessages, SET_COMMANDS } = require('../bot'); 
const bot = getBotInstance();
//const { checkLobby } = require('../gatekeep')
const {
    safeExecute,
    sendMessage,
    setUserState
} = require('../../utils')
const {
    handleAccountReset,
    handleAccountSettings,
    handleAdvancedUserOptions,
    handleDexMake,
    handleDiscWrite,
    handleHelp,
    handleInpaint,
    handleMask,
    handleInpaintPrompt,
    handleInterrogation,
    handleMake,
    handkeMake3,
    handleMs2ImgFile,
    handleMs2Prompt,
    handleMs3ImgFile,
    handlePfpImgFile,
    handlePromptCatch,
    handleRegen,
    handleRequest,
    handleSaveSettings,
    handleSeeSettings,
    handleSet,
    handleSignIn,
    handleSignOut,
    handleStatus,
    // handleSpeak,
    //handleTest,
    handleVerify,
    shakeVerify,
    handleWatermark,
    //handleLoraTrigger,
    sendLoRaModelFilenames,
    startMake,
    shakeAssist,
    shakeSpeak,
    shakeSignIn,
    startSet,
    saySeed,
    checkLobby,
} = require('./handle');
const defaultUserData = require('../../users/defaultUserData');

const commandPatterns = {
    '/signin': handleSignIn,
    '/make(?:@stationthisdeluxebot)?\\s+(.+)': handleMake,
    '/make3(?:@stationthisdeluxebot)?\\s+(.+)': handleMake3,
    '/dexmake(?:@stationthisdeluxebot)?\\s+(\\d+)': handleDexMake, 
//    '/test(?:@stationthisdeluxebot)?\\s+(.+)': handleTest,
    '/regen(?:@stationthisdeluxebot)?\\s*(.*)': handleRegen,
    '/getseed(.*)': saySeed,
    '/promptcatch\\s+(\\d+)': handlePromptCatch,
    //'/request(.*)': startRequest,
    '/savesettings(.*)': handleSaveSettings,
    '/seesettings(.*)': handleSeeSettings,
    '/accountsettings(?:@stationthisdeluxebot)?': handleAccountSettings,
    '/loralist(?:@stationthisdeluxebot)?': sendLoRaModelFilenames,
    //'/seecollections': handleSeeCollections,
    //'/createcollection (.+)': handleCreateCollection,
    //'/uri': handleUri,
    //'/collectionbaseprompt': handleCollectionBasePrompt,
    // '/savework': handleSaveWork,
    //'/disc(.*)': handleDisc,
    //'/watermark(.*)': handleWatermark,
    '/signout': handleSignOut,
    '/resetaccount': handleAccountReset,
    
    '/help(?:@stationthisbot)?': handleHelp,
    '/status(?:@stationthisbot)?': handleStatus
};


const stateHandlers = {
    [STATES.SIGN_IN]: (message) => safeExecute(message, shakeSignIn),
    [STATES.VERIFY]: (message) => safeExecute(message, shakeVerify),
    [STATES.MAKE]: (message) => safeExecute(message, handleMake),
    [STATES.MS2PROMPT]: (message) => safeExecute(message, handleMs2Prompt),
    [STATES.MASKPROMPT]: (message) => safeExecute(message, handleInpaintPrompt),
    [STATES.REQUEST]: (message) => safeExecute(message, handleRequest),
    [STATES.ASSIST]: (message) => safeExecute(message, shakeAssist),
    [STATES.SPEAK]: (message) => safeExecute(message, shakeSpeak),
    [STATES.IMG2IMG]: (message) => safeExecute(message, handleMs2ImgFile),
    [STATES.MS3]: (message) => safeExecute(message,handleMs3ImgFile),
    [STATES.PFP]: (message) => safeExecute(message, handlePfpImgFile),
    [STATES.INTERROGATION]: (message) => safeExecute(message, handleInterrogation),
    [STATES.DISC]: (message) => safeExecute(message, handleDiscWrite),
    [STATES.WATERMARK]: (message) => safeExecute(message, handleWatermark),
    [STATES.SETPHOTO]: (message) => safeExecute(message, handleSet),
    [STATES.SETSTYLE]: (message) => safeExecute(message,handleSet),
    [STATES.SETCONTROL]: (message) => safeExecute(message,handleSet),
    [STATES.INPAINT]: (message) => safeExecute(message, handleInpaint),
    [STATES.MASK]: (message) => safeExecute(message, handleMask),
};


const setStates = [
    STATES.SETBATCH, STATES.SETSTEPS, STATES.SETCFG, 
    STATES.SETSTRENGTH, STATES.SETPROMPT, STATES.SETUSERPROMPT, 
    STATES.SETNEGATIVEPROMPT, STATES.SETSEED, STATES.SETSIZE, 
    STATES.SETSTYLE, STATES.SETCONTROL
];
setStates.forEach(state => {
    stateHandlers[state] = (message) => safeExecute(message,handleSet);
});

function messageFilter(message) {
    if (!message || !message.chat || !message.chat.id || !message.from || !message.from.id) {
        console.error('Invalid message format:', message);
        return true;
    }
    // Check if the message is a reply
    if (message.reply_to_message) {
        if(message.reply_to_message.message_id != message.message_thread_id){
           // console.log("Handling a reply to a message.")
            //console.log(message)
        return; // Early return to prevent further processing of this as a normal command
        }
    }
    //console.log('message date in filter',message.date)
    //console.log('startup date /1000 in filter',startup/1000 - 60 * 5)
    if(message.date < startup/1000 - 60 * 5){
        console.log('ignoring because its old')
        return true;
    }
    //maybe this is not chill for webhooks

    //why did we do this
    // if(message.text && message.text[0] == '/' && message.text != '/signin'){
    //     return true
    // }
    
    // // Initialize state for new users
    if (!lobby[message.from.id]) {
       //console.log('no state')
       lobby[message.from.userId] = defaultUserData;
       return false
    }
    if( 
        //user is amidst call and response anywhere aka their state is set
        lobby[message.from.id].state.state != STATES.IDLE && 
        //AND set state chat id isnt where this message is
        (lobby[message.from.id].state.chatId != message.chat.id || 
            //OR message thread
            (message.message_thread_id && 
                (message.message_thread_id != lobby[message.from.id].state.messageThreadId )
            )
        )
    ){
        console.log('here is why we are filtered')
        console.log(lobby[message.from.id].state);
        console.log('thread',message.message_thread_id)
        console.log('chat id',message.chat.id)

        lobby[message.from.id].state.state = STATES.IDLE
        return true;
    }

    
    return false
}
function watch(message) {
    const userId = message.from.id;
    if(lobby[userId]){
        const currentState = lobby[userId].state;
        const handler = stateHandlers[currentState.state];
        if (handler) {
            //console.log('sending to',handler)
            handler(message);
        }
    }
}

SET_COMMANDS.forEach(command => {
    bot.onText(new RegExp(`^/set${command}(.*)`), (message) => {
        safeExecute(message, startSet);
    });
});

const commandsRequiringGatekeeping = ['/make', '/dexmake', '/test', '/regen', '/speak'];

module.exports = function(bot) {
    bot.on('message', async (message) => {
        console.log('wow we have a message');
        if (messageFilter(message)) {
            //console.log('message filtered');
            return;
        }
    
        if ('text' in message) {
            let handled = false;
            // Process commands with specific regex patterns
            for (const [pattern, handler] of Object.entries(commandPatterns)) {
                const regex = new RegExp(`^${pattern}`);
                const match = regex.exec(message.text);
                if (match) {
                    console.log('i see a command tbh')
                    const requiresGatekeeping = commandsRequiringGatekeeping.some(cmd => pattern.startsWith(cmd));
                    if (requiresGatekeeping) {
                        // Perform gatekeeping check
                        console.log('we are gatekeeping')
                        const allowed = await checkLobby(message);
                        if (!allowed) {
                            // User is not allowed to execute the command
                            await sendMessage(message, 'AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg');
                        } 
                    }
                    await safeExecute(message, () => handler(message, match));
                    handled = true;
                    break; // Stop after the first match to avoid multiple command executions
                }
            }
    
            // Process generic commands if no specific command was handled
            if (!handled) {
                const commandKey = Object.keys(commandStateMessages).find(key => 
                    message.text.startsWith(key));
                if (commandKey) {
                    const commandInfo = commandStateMessages[commandKey];
    
                    if (commandKey !== '/quit' && !(await checkLobby(message))) {
                        console.log("Lobby check failed, not processing command:", commandKey);
                        return; // Exit if lobby check fails
                    }
    
                    setUserState(message, commandInfo.state);
                    await sendMessage(message, commandInfo.message, {reply_to_message_id: message.message_id});
                    handled = true;
                }
            }
    
            // If no command has handled the message, use watch for further processing
            if (!handled) {
                watch(message);
            }
        } else if ('photo' in message || 'document' in message) {
            // Log and delegate to watch for non-text messages
            //console.log(`Received ${'photo' in message ? 'photo' : 'document'}`);
            watch(message);
        }
    })
}

