const { getBotInstance, lobby, startup, STATES, commandStateMessages, SET_COMMANDS } = require('../bot.js'); 
const { initialize } = require('../intitialize')
const bot = getBotInstance();
const { cleanLobby, checkLobby } = require('../gatekeep')
const {
    safeExecute,
    sendMessage,
    setUserState,
    DEV_DMS
} = require('../../utils')
const { readStats } = require('../../../db/mongodb.js')
// const handlers = require('./handle');
const defaultUserData = require('../../users/defaultUserData');

const iMenu = require('./iMenu')
const iAccount = require('./iAccount')
const iMake = require('./iMake')
const iWork = require('./iWork')
const iMedia = require('./iMedia')
const iBrand = require('./iBrand')
const iSettings = require('./iSettings')
const iGroup = require('./iGroup')

/*
Recognizes Groupchat Context
Classes for start, ask photo etc
*/

const commandPatterns = {
    '/signin': iAccount.handleSignIn,
    '/make(?:@stationthisbot)?\\s+(.+)': iMake.handleMake,
    '/make3(?:@stationthisbot)?\\s+(.+)': iMake.handleMake3,
    '/dexmake(?:@stationthisbot)?\\s+(\\d+)': iMake.handleDexMake, 
    '/regen(?:@stationthisbot)?\\s*(.*)': iMake.handleRegen,
    '/getseed(.*)': iWork.saySeed,
    '/promptcatch\\s+(\\d+)': iMake.handlePromptCatch,
    '/savesettings(.*)': iAccount.handleSaveSettings,
    '/seesettings(.*)': iAccount.handleSeeSettings,
    '/accountsettings(?:@stationthisbot)?': iAccount.handleAccountSettings,
    '/loralist(?:@stationthisbot)?': iWork.sendLoRaModelFilenames,
    //'/groupsettings': iGroup.groupSettings,
    //'/disc(.*)': handleDisc,
    //'/watermark(.*)': handleWatermark,
    '/signout': iAccount.handleSignOut,
    '/resetaccount': iAccount.handleAccountReset,
    '/set(?:@stationthisbot)?': iMenu.setMenu,
    '/create(?:@stationthisbot)?': iMenu.handleCreate,
    '/effect(?:@stationthisbot)?': iMenu.handleEffect,
    '/animate(?:@stationthisbot)?': iMenu.handleAnimate,
    '/utils(?:@stationthisbot)?': iMenu.handleUtils,
    //'/inpaint': startInpaint,
    '/help(?:@stationthisbot)?': iWork.handleHelp,
    '/status(?:@stationthisbot)?': iWork.handleStatus,
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
    // '/brendonis': (message) => {
    //     sendMessage(message,'Brendon is hacking into the satellite....')
    //     sendMessage(message,'hacking...')
    //     sendMessage(message,'CONNECTED');
    // }
    '/see': async(message) => {
        if(message.from.id != DEV_DMS){
            return;
        } else {
            const msg = await readStats()
            sendMessage(message,msg);
            //sendMessage(message,'I reset burns and loralist');
        }
    },
    
};


const stateHandlers = {
    [STATES.SIGN_IN]: (message) => safeExecute(message, iAccount.shakeSignIn),
    [STATES.VERIFY]: (message) => safeExecute(message, iAccount.shakeVerify),
    [STATES.MAKE]: (message) => safeExecute(message, iMake.handleMake),
    [STATES.MAKE3]: (message) => safeExecute(message, iMake.handleMake3),
    [STATES.MS2PROMPT]: (message) => safeExecute(message, iMake.handleMs2Prompt),
    [STATES.REQUEST]: (message) => safeExecute(message, iWork.handleRequest),
    [STATES.ASSIST]: (message) => safeExecute(message, iWork.shakeAssist),
    [STATES.SPEAK]: (message) => safeExecute(message, iWork.shakeSpeak),
    [STATES.IMG2IMG]: (message) => safeExecute(message, iMedia.handleMs2ImgFile),
    [STATES.MS3]: (message) => safeExecute(message,iMedia.handleMs3ImgFile),
    [STATES.PFP]: (message) => safeExecute(message, iMedia.handlePfpImgFile),
    [STATES.INTERROGATION]: (message) => safeExecute(message, iMedia.handleInterrogation),
    [STATES.DISC]: (message) => safeExecute(message, iBrand.handleDiscWrite),
    [STATES.WATERMARK]: (message) => safeExecute(message, iBrand.handleWatermark),
    [STATES.SETPHOTO]: (message) => safeExecute(message, iSettings.handleSet),
    [STATES.SETSTYLE]: (message) => safeExecute(message,iSettings.handleSet),
    [STATES.SETCONTROL]: (message) => safeExecute(message,iSettings.handleSet),
    [STATES.INPAINT]: (message) => safeExecute(message, iMedia.handleInpaint),
    [STATES.INPAINTTARGET]: (message) => safeExecute(message, iMake.handleInpaintTarget),
    [STATES.INPAINTPROMPT]: (message) => safeExecute(message, iMake.handleInpaintPrompt),
    [STATES.UPSCALE] : (message) => safeExecute(message, iMedia.handleUpscale),
    [STATES.RMBG] : (message) => safeExecute(message, iMedia.handleRmbg),
    [STATES.GROUPAPPLY] : (message) => safeExecute(message, iGroup.handleApplyBalance)
};


const setStates = [
    STATES.SETBATCH, STATES.SETSTEPS, STATES.SETCFG, 
    STATES.SETSTRENGTH, STATES.SETPROMPT, STATES.SETUSERPROMPT, 
    STATES.SETNEGATIVEPROMPT, STATES.SETSEED, STATES.SETSIZE, 
    STATES.SETSTYLE, STATES.SETCONTROL
];
setStates.forEach(state => {
    stateHandlers[state] = (message) => safeExecute(message,iSettings.handleSet);
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
        safeExecute(message, iSettings.startSet);
    });
});

const commandsRequiringGatekeeping = ['/utils','/set','/accountsettings','/create', '/inpaint','/effect','/animate','/make', '/make3','/dexmake', '/test', '/regen', '/speak','/assist','/interrogate'];

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
                        const allowed = await checkLobby(message);
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

