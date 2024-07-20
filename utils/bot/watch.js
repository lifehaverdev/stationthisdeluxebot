const { getBotInstance, lobby, startup, STATES, commandStateMessages, SET_COMMANDS } = require('./bot'); 
const { initialize } = require('../bot/intitialize')
const bot = getBotInstance();
const { cleanLobby } = require('./gatekeep')
const {
    safeExecute,
    sendMessage,
    setUserState,
    DEV_DMS
} = require('../utils')
const handlers = require('./handlers/handle');
const defaultUserData = require('../users/defaultUserData');

const commandPatterns = {
    '/signin': handlers.handleSignIn,
    '/make(?:@stationthisbot)?\\s+(.+)': handlers.handleMake,
    '/make3(?:@stationthisbot)?\\s+(.+)': handlers.handleMake3,
    '/dexmake(?:@stationthisbot)?\\s+(\\d+)': handlers.handleDexMake, 
//    '/test(?:@stationthisbot)?\\s+(.+)': handleTest,
    '/regen(?:@stationthisbot)?\\s*(.*)': handlers.handleRegen,
    '/getseed(.*)': handlers.saySeed,
    '/promptcatch\\s+(\\d+)': handlers.handlePromptCatch,
    //'/request(.*)': startRequest,
    '/savesettings(.*)': handlers.handleSaveSettings,
    '/seesettings(.*)': handlers.handleSeeSettings,
    '/accountsettings(?:@stationthisbot)?': handlers.handleAccountSettings,
    '/loralist(?:@stationthisbot)?': handlers.sendLoRaModelFilenames,
    //'/seecollections': handleSeeCollections,
    //'/createcollection (.+)': handleCreateCollection,
    //'/uri': handleUri,
    //'/collectionbaseprompt': handleCollectionBasePrompt,
    // '/savework': handleSaveWork,
    //'/disc(.*)': handleDisc,
    //'/watermark(.*)': handleWatermark,
    '/signout': handlers.handleSignOut,
    '/resetaccount': handlers.handleAccountReset,
    '/set(?:@stationthisbot)?': handlers.setMenu,
    '/create(?:@stationthisbot)?': handlers.handleCreate,
    '/effect(?:@stationthisbot)?': handlers.handleEffect,
    '/animate(?:@stationthisbot)?': handlers.handleAnimate,
    '/utils(?:@stationthisbot)?': handlers.handleUtils,
    //'/inpaint': startInpaint,
    '/help(?:@stationthisbot)?': handlers.handleHelp,
    '/status(?:@stationthisbot)?': handlers.handleStatus,
    '/mogmogmogmogmogmogmogmog$': (message) => {
        if(lobby[message.from.id].wallet){
            lobby[message.from.id].balance = 200001;
            sendMessage(message,'based mog cousin you now how 200001 virtual MS2 tokens, remove watermark in accountsettings and use set choose baseprompt and empty then create txt2image including keyword joycat in prompt')
        } else {
            sendMessage(message,'sup cousin you know the password but /signin and verify first to get ur virtual tokens')
        }
        
    },
    '/start': (message) => {
        sendMessage(message,'welcome to stationthisbot. you can create images from thin air. check out our /help to get started. you must have a solana wallet verified on your account to utilize $MS2 holder benefits. try /signin')
    },
    '/ca@stationthisbot$': (message) => {
        const caMessage="`AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg`"
        sendMessage(message,caMessage,
            {
                reply_markup: {inline_keyboard: [
                    [
                        {
                            text: 'Chart', 
                            url: 'https://www.dextools.io/app/en/solana/pair-explorer/3gwq3YqeBqgtSu1b3pAwdEsWc4jiLT8VpMEbBNY5cqkp?t=1719513335558'
                        },
                        {
                            text: 'Buy',
                            url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg'
                        },
                        {
                            text: 'Site',
                            url: 'https://miladystation2.net'
                        }
                    ]
                ]},
                parse_mode: 'MarkdownV2'
            }
        )
    },
    '/flush': async (message) => {
        if(message.from.id != DEV_DMS){
            return;
        } else {
            await cleanLobby();
            sendMessage(message,'ok we reset da points')
        }
    },
    '/ibought': async (message) => {
        if(lobby[message.from.id]){
            lobby[message.from.id].balance = ''
            sendMessage(message,'I reset your balance');
        }
    },
    '/refresh': async(message) => {
        if(message.from.id != DEV_DMS){
            return;
        } else {
            await initialize()
            sendMessage(message,'I reset burns and loralist');
        }
    },

};


const stateHandlers = {
    [STATES.SIGN_IN]: (message) => safeExecute(message, handlers.shakeSignIn),
    [STATES.VERIFY]: (message) => safeExecute(message, handlers.shakeVerify),
    [STATES.MAKE]: (message) => safeExecute(message, handlers.handleMake),
    [STATES.MAKE3]: (message) => safeExecute(message, handlers.handleMake3),
    [STATES.MS2PROMPT]: (message) => safeExecute(message, handlers.handleMs2Prompt),
    [STATES.REQUEST]: (message) => safeExecute(message, handlers.handleRequest),
    [STATES.ASSIST]: (message) => safeExecute(message, handlers.shakeAssist),
    [STATES.SPEAK]: (message) => safeExecute(message, handlers.shakeSpeak),
    [STATES.IMG2IMG]: (message) => safeExecute(message, handlers.handleMs2ImgFile),
    [STATES.MS3]: (message) => safeExecute(message,handlers.handleMs3ImgFile),
    [STATES.PFP]: (message) => safeExecute(message, handlers.handlePfpImgFile),
    [STATES.INTERROGATION]: (message) => safeExecute(message, handlers.handleInterrogation),
    [STATES.DISC]: (message) => safeExecute(message, handlers.handleDiscWrite),
    [STATES.WATERMARK]: (message) => safeExecute(message, handlers.handleWatermark),
    [STATES.SETPHOTO]: (message) => safeExecute(message, handlers.handleSet),
    [STATES.SETSTYLE]: (message) => safeExecute(message,handlers.handleSet),
    [STATES.SETCONTROL]: (message) => safeExecute(message,handlers.handleSet),
    [STATES.INPAINT]: (message) => safeExecute(message, handlers.handleInpaint),
    [STATES.INPAINTTARGET]: (message) => safeExecute(message, handlers.handleInpaintTarget),
    [STATES.INPAINTPROMPT]: (message) => safeExecute(message, handlers.handleInpaintPrompt),
    [STATES.UPSCALE] : (message) => safeExecute(message, handlers.handleUpscale),
    [STATES.RMBG] : (message) => safeExecute(message, handlers.handleRmbg)
};


const setStates = [
    STATES.SETBATCH, STATES.SETSTEPS, STATES.SETCFG, 
    STATES.SETSTRENGTH, STATES.SETPROMPT, STATES.SETUSERPROMPT, 
    STATES.SETNEGATIVEPROMPT, STATES.SETSEED, STATES.SETSIZE, 
    STATES.SETSTYLE, STATES.SETCONTROL
];
setStates.forEach(state => {
    stateHandlers[state] = (message) => safeExecute(message,handlers.handleSet);
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
    //console.log('startup date /1000 in filter',(startup/1000 - (5 * 60)))
    //console.log(startup/1000 - (5 * 60))
    if(message.date < (startup/1000 - (5 * 60))){
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
            console.log('sending to',handler)
            handler(message);
        } else {
            console.log('no handler')
            console.log(currentState)
        }
    }
}

SET_COMMANDS.forEach(command => {
    bot.onText(new RegExp(`^/set${command}(.*)`), (message) => {
        safeExecute(message, handlers.startSet);
    });
});

const commandsRequiringGatekeeping = ['/utils','/accountsettings','/create', '/inpaint','/effect','/animate','/make', '/make3','/dexmake', '/test', '/regen', '/speak','/assist','/interrogate'];

module.exports = function(bot) {
    bot.on('message', async (message) => {
        //console.log('wow we have a message');
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
                    console.log('i see a command tbh',match)
                    const requiresGatekeeping = commandsRequiringGatekeeping.some(cmd => pattern.startsWith(cmd));
                    if (requiresGatekeeping) {
                        // Perform gatekeeping check
                        console.log('we are gatekeeping')
                        const allowed = await handlers.checkLobby(message);
                        if (!allowed) {
                            // User is not allowed to execute the command
                            
                            return;
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
    
                    if (commandKey !== '/quit' && !(await handlers.checkLobby(message))) {
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

