const { getBotInstance, lobby, startup, STATES, commandStateMessages, workspace, SET_COMMANDS, getPhotoUrl } = require('../bot.js'); 
const { initialize } = require('../intitialize')
const bot = getBotInstance();
const { lobbyManager, checkLobby, checkIn, POINTMULTI, NOCOINERSTARTER } = require('../gatekeep')
const {
    safeExecute,
    sendMessage,
    setUserState,
    react,
    gated,
    DEV_DMS
} = require('../../utils')
const { readStats, rareCandy } = require('../../../db/mongodb.js')
const { cheese } = require('../../../commands/fry')
// const handlers = require('./handle');
//const defaultUserData = require('../../users/defaultUserData');

const iMenu = require('./iMenu')
const iAccount = require('./iAccount')
const iMake = require('./iMake')
const iWork = require('./iWork')
const iMedia = require('./iMedia')
const iBrand = require('./iBrand')
const iSettings = require('./iSettings')
const iGroup = require('./iGroup')
const iResponse = require('./iResponse')
const iTrain = require('./iTrain')

const botName = 'stationthisdeluxebot'//process.env.BOT_NAME
/*
Recognizes Groupchat Context
Classes for start, ask photo etc
*/
const commandRegistry = {
    '/signin': {
        handler: iAccount.handleSignIn,
    },
    '/make': {
        handler: iMake.handleMake,
    },
    '/make3': {
        handler: iMake.handleMake3,
    },
    '/flux': {
        handler: iMake.handleFlux,
    },
    '/ms2': {
        handler: iMedia.handleMs2ImgFile
    },
    '/joycat': {
        handler: iMake.handleMog,
    },
    '/degod': {
        handler: iMake.handleDegod,
    },
    '/milady': {
        handler: iMake.handleMilady,
    },
    '/loser': {
        handler: iMake.handleLoser,
    },
    '/chud': {
        handler: iMake.handleChud,
    },
    '/radbro': {
        handler: iMake.handleRadbro,
    },
    '/regen': {
        handler: iMake.handleRegen,
    },
    '/getseed': {
        handler: iWork.saySeed,
    },
    '/promptcatch': {
        handler: iMake.handlePromptCatch,
    },
    '/savesettings': {
        handler: iAccount.handleSaveSettings,
    },
    '/seesettings': {
        handler: iAccount.handleSeeSettings,
    },
    '/account': {
        handler: iAccount.handleAccountSettings,
    },
    '/loralist': {
        handler: iWork.loraList, // iWork.sendLoRaModelFilenames
    },
    '/groupsettings': {
        handler: iGroup.groupSettings,
    },
    // '/disc(.*)': handleDisc,
    // '/watermark(.*)': handleWatermark,
    '/signout': {
        handler: iAccount.handleSignOut,
    },
    '/resetaccount': {
        handler: iAccount.handleAccountReset,
    },
    '/set': {
        handler: iMenu.setMenu,
    },
    '/create': {
        handler: iMenu.handleCreate,
    },
    '/effect': {
        handler: iMenu.handleEffect,
    },
    '/animate': {
        handler: iMenu.handleAnimate,
    },
    '/utils': {
        handler: iMenu.handleUtils,
    },
    '/quit': {
        handler: (message) => {
            setUserState(message, STATES.IDLE);
            react(message,'👍')
        }
    },
    '/inpaint': {
        handler: iMedia.handleInpaint,
    },
    '/help': {
        handler: iWork.handleHelp,
    },
    '/status': {
        handler: iWork.handleStatus,
    },
    // '/speak(?:@stationthisbot)?': iWork.startSpeak,
    '/mogmogmogmogmogmogmogmog$': {
        handler: (message) => {
            if(lobby[message.from.id].wallet){
                lobby[message.from.id].balance = 200001;
                sendMessage(message,'based mog cousin you now how 200001 virtual MS2 tokens')
            } else {
                sendMessage(message,'sup cousin you know the password but /signin and verify first to get ur virtual tokens')
            }
        }
    },
    '/cheeseworldcultinc$': {
        handler: (message) => {
            if(lobby[message.from.id].wallet){
                lobby[message.from.id].balance = 600001;
                sendMessage(message,'you now have 600001 virtual MS2 tokens')
            } else {
                sendMessage(message,'sup cousin you know the password but /signin and verify first to get ur virtual tokens')
            }
        }
    },
    '/start': {
        handler: (message) => {
            sendMessage(message,'welcome to stationthisbot. you can create images from thin air. check out our /help to get started. you must have a solana wallet verified on your account to utilize $MS2 holder benefits. try /signin')
        }
    },
    '/ca': {
        handler: (message) => {
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
        condition: (message) => {
            return message.chat.type !== 'private' && message.text.includes('@stationthisbot');
        }
    },
    '/flush': {
        handler: async (message) => {
            if(message.from.id != DEV_DMS){
                return;
            } else {
                await lobbyManager.cleanLobby();
                sendMessage(message,'ok we reset da points')
            }
        }
    },
    '/ibought': {
        handler: async (message) => {
            if(lobby[message.from.id]){
                lobby[message.from.id].balance = ''
                sendMessage(message,'I reset your balance');
            }
        }
    },
    '/refresh': {
        handler: async (message) => {
            if(message.from.id != DEV_DMS){
                return;
            } else {
                await initialize()
                sendMessage(message,'I reset burns, loralist and groups');
            }
        }
    },
    '/check': {
        handler: (message) => {
            if(message.from.id != DEV_DMS){
                return;
            } else {
                const lob = lobby;
                sendMessage(message,JSON.stringify(lob));
            }
        }
    },
    '/see': {
        handler: async (message) => {
            if(message.from.id != DEV_DMS){
                return;
            } else {
                const msg = await readStats()
                sendMessage(message,msg);
                // sendMessage(message,'I reset burns and loralist');
            }
        }
    },
    '/glorp': {
        handler: async (message) => {
            if(message.from.id != DEV_DMS){
                // console.log(message.from.id)
                return;
            } else {
                message.from.id = ''
                const key = message.text 
                const spliced = key.slice(6);
                // console.log(spliced);
                const glorpBalance = await iWork.seeGlorp(spliced) // iAccount.displayAccountSettingsMenu(message,true) // eadStats()
                sendMessage(message,glorpBalance);
                // sendMessage(message,'I reset burns and loralist');
            }
        }
    },
    // '/snipe': {
    //     handler: async(message) => {
    //         if(message)
    //     }
    // }
    '/slamtest': {
        handler: async (message) => {
            sendMessage(message,`${lobby[message.from.id].state.state}`)
        }
    },
    '/admin': {
        handler: iGroup.toggleAdmin,
    },
    '/forcelogo': {
        handler: (message) => {
            if(lobby[message.from.id] && !lobby[message.from.id].forceLogo) {
                lobby[message.from.id].forceLogo = true;
            } else if (lobby[message.from.id] && lobby[message.from.id].forceLogo) {
                lobby[message.from.id].forceLogo = false;
            }
            react(message, '👍');
        }
    },
    '/dointify': {
        handler: (message) => {
            if(message.from.id != DEV_DMS){
                // console.log(message.from.id)
                return;
            } else if(lobby[message.from.id]) {
                lobby[message.from.id].doints = Math.floor((lobby[message.from.id].balance + NOCOINERSTARTER) / POINTMULTI)
            }
        }
    },
    '/showmemyboints': {
        handler: (message) => {
            if(message.from.id != DEV_DMS){
                // console.log(message.from.id)
                return;
            } else if(lobby[message.from.id]) {
                const userId = message.from.id;
                sendMessage(message,`${lobby[userId].points},${lobby[userId].doints},${lobby[userId].qoints},${lobby[userId].boints}`)
            }
        }
    },
    '/here': {
        handler: async (message) => {
            if(message.from.id != DEV_DMS){
                return;
            } else {
                const whom = message.reply_to_message.from.id
                message.from.id = whom
                if(!lobby[whom]){
                    await checkLobby(message)
                }
                if(lobby[whom]){
                    lobby[whom].doints = 0;
                    sendMessage(message,'it is done');
                } else {
                    sendMessage(message,'sorry...')
                }
            }
        }
    },
    '/rarecandy': {
        handler: async (message) => {
            if(message.from.id != DEV_DMS){
                // console.log(message.from.id)
                return;
            } else {
                const whom = message.reply_to_message.from.id
                message.from.id = whom
                if(!lobby[whom]){
                    await checkIn(message)
                }
                if(lobby[whom]){
                    const level = parseInt(message.text.replace('/rarecandy ',''));
                    if(isNaN(level)){
                        return
                    }
                    const exp = level*level*level; 
                    
                    console.log(whom,exp)
                    await rareCandy(whom,exp)
                    lobby[whom].exp = exp;
                    sendMessage(message,'it is done');
                } else {
                    sendMessage(message,'sorry...')
                }
            }
        }
    },
    '/vidthat': {
        handler: async (message) => {
            console.log('made it into the function')
            if(!await checkLobby(message)) return
            if(lobby[message.from.id].balance < 600000){
                gated(message)
                return
            } 
            const target = message.reply_to_message;
            if(target.photo) {
                target.from.id = message.from.id;
                target.message_id = message.message_id
                iMedia.handleMs3V2ImgFile(target)
            } else {
                react(message,"🤔")
            }
        }
    },
    '/cheesethat': {
        handler: cheese,
    },
    '/letspretendiamfrosty': {
        handler: async (message) => {
            if(message.from.id != DEV_DMS){
                return;
            } else {
                if(!lobby[message.from.id]) if(!await checkLobby(message)) return
                lobby[DEV_DMS].balance = 200000
            }
        }
    },
    '/showmetheseproperties': {
        handler: (message) => {
            console.log(message)
        }
    },
    // Modified '/stationthis' command to include group check and onboarding
    '/stationthis': {
        handler: async (message) => {
            const getAdmin = async (message) => {
                const chatAdmins = await bot.getChatAdministrators(message.chat.id);
                const isAdmin = chatAdmins.some(admin => !admin.user.is_bot && admin.user.id === message.from.id);
                return isAdmin
            }
            // Step 1: Check if the message is coming from a group chat
            if (message.chat.id < 0) {
                // Step 2: Use getGroup function to see if the group is initialized
                const group = await iGroup.getGroup(message);
                
                // Step 3: If no group is returned, check if the user is an admin
                if (!group) {
                    const isAdmin = await getAdmin(message)
                    if (isAdmin) {
                        // Step 4: If user is an admin and group is unclaimed, add an inline keyboard to initialize
                        const initializeKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{
                                        text: 'Initialize',
                                        callback_data: `ig_${message.chat.id}`
                                    }]
                                ]
                            }
                        };
                        sendMessage(message, "This group is unclaimed. Would you like to initialize it?", initializeKeyboard);
                        return;
                    } else {
                        sendMessage(message, '$ms2', iMenu.home);
                        return;
                    }
                } else {
                    const isAdmin = await getAdmin(message)
                    if(isAdmin){
                        iGroup.groupMenu(message)
                        return
                    } else {
                        sendMessage(message, '$ms2', iMenu.home);
                        return;
                    }

                }
            }

            // If the group is already initialized or it's not a group chat, send the home menu
            sendMessage(message, '$ms2', iMenu.home);
        }
    }
};


const stateHandlers = {
    [STATES.SIGN_IN]: (message) => safeExecute(message, iAccount.shakeSignIn),
    [STATES.VERIFY]: (message) => safeExecute(message, iAccount.shakeVerify),
    [STATES.MAKE]: (message) => safeExecute(message, iMake.handleMake),
    [STATES.MAKE3]: (message) => safeExecute(message, iMake.handleMake3),
    [STATES.MS2PROMPT]: (message) => safeExecute(message, iMake.handleMs2Prompt),
    [STATES.FLUXPROMPT] : (message) => safeExecute(message, iMake.handleFluxPrompt),
    [STATES.ASSIST]: (message) => safeExecute(message, iWork.shakeAssist),
    [STATES.FLASSIST]: (message) => safeExecute(message, iWork.shakeFluxAssist),
    [STATES.SPEAK]: (message) => safeExecute(message, iWork.shakeSpeak),
    [STATES.IMG2IMG]: (message) => safeExecute(message, iMedia.handleMs2ImgFile),
    [STATES.FLUX2IMG]:(message) => safeExecute(message, iMedia.handleFluxImgFile),
    [STATES.MS3]: (message) => safeExecute(message,iMedia.handleMs3ImgFile),
    [STATES.MS3V2] : (message) => safeExecute(message,iMedia.handleMs3V2ImgFile),
    [STATES.PFP]: (message) => safeExecute(message, iMedia.handlePfpImgFile),
    [STATES.INTERROGATION]: (message) => safeExecute(message, iMedia.handleInterrogation),
    [STATES.DISC]: (message) => safeExecute(message, iBrand.handleDiscWrite),
    [STATES.WATERMARK]: (message) => safeExecute(message, iBrand.handleWatermark),
    [STATES.SETPHOTO]: (message) => safeExecute(message, iSettings.handleSet),
    [STATES.SETSTYLE]: (message) => safeExecute(message,iSettings.handleSet),
    [STATES.SETCONTROL]: (message) => safeExecute(message,iSettings.handleSet),
    [STATES.SETPOSE]: (message) => safeExecute(message, iSettings.handleSet),
    [STATES.INPAINT]: (message) => safeExecute(message, iMedia.handleInpaint),
    [STATES.INPAINTTARGET]: (message) => safeExecute(message, iMake.handleInpaintTarget),
    [STATES.INPAINTPROMPT]: (message) => safeExecute(message, iMake.handleInpaintPrompt),
    [STATES.UPSCALE] : (message) => safeExecute(message, iMedia.handleUpscale),
    [STATES.RMBG] : (message) => safeExecute(message, iMedia.handleRmbg),
    [STATES.GROUPAPPLY] : (message) => safeExecute(message, iGroup.handleApplyBalance),
    [STATES.FLUXINTERROGATE] : (message) => safeExecute(message, iWork.shakeFluxInterrogate),
    [STATES.FLUX] : (message) => safeExecute(message,iMake.handleFlux),
    [STATES.LORANAME] : (message) => safeExecute(message,iTrain.createLora),
    [STATES.ADDLORAIMAGE] : (message) => safeExecute(message,iTrain.addLoraSlotImage),
    //[STATES.GROUPNAME] : (message) => safeExecute(message, iGroup.handleGroupName)
    [STATES.SETGROUPNFTCA]: (message) => safeExecute(message,iGroup.handleSetTick),
    [STATES.SETGROUPTOKENCA]: (message) => safeExecute(message,iGroup.handleSetTick),
    [STATES.SETGROUPTICKER]: (message) => safeExecute(message,iGroup.handleSetTick),
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
           console.log("Handling a reply to a message.")
            //console.log(message)
            return false; // Early return to prevent further processing of this as a normal command
        }
    }
    
    //Ignore old messages
    if(message.date < (startup/1000 - (5 * 60))){
        console.log('ignoring because its old')
        return true;
    }

    if( 
        lobby[message.from.id] &&
        //user is amidst call and response anywhere aka their state is set
        lobby[message.from.id].state.state != STATES.IDLE && 
        //commented out to fix groupname
        //AND set state chat id isnt where this message is
        (lobby[message.from.id].state.chatId != message.chat.id || 
            //OR message thread
            (message.message_thread_id && lobby[message.from.id].state.messageThreadId &&
                (message.message_thread_id != lobby[message.from.id].state.messageThreadId )
            )
        )
    ){
        console.log('here is why we are filtered, all of these must match')
        
        console.log('msg thread',message.message_thread_id)
        console.log('msg chat id',message.chat.id)
        console.log('state state',lobby[message.from.id].state);
        console.log('state chatid',lobby[message.from.id].state.chatId)
        console.log('state message thread',lobby[message.from.id].state.messageThreadId )

        //lobby[message.from.id].state.state = STATES.IDLE
        return true;
    }

    
    return false
}
function watch(message) {
    //console.log('watching message')
    const userId = message.from.id;
    if(lobby[userId]){
        const currentState = lobby[userId].state;
        const handler = stateHandlers[currentState.state];
        if (handler) {
            console.log('sending to',handler)
            //console.log('workspace in watch',workspace)
            handler(message);
        } else {
            console.log('no handler',currentState)
            //console.log(currentState)
        }
    }
}

SET_COMMANDS.forEach(command => {
    bot.onText(new RegExp(`^/set${command}(.*)`), (message) => {
        safeExecute(message, iSettings.startSet);
    });
});

const commandsRequiringGatekeeping = ['/flux','/milady','/degod','/joycat','/utils','/create','/inpaint','/effect','/animate','/make', '/make3','/regen', 
    //'/speak','/assist','/interrogate'
    ];

// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
function parseCommand(message) {
    let commandEntity;

    // Determine whether to use entities from text or caption
    if (message.text && message.entities) {
        commandEntity = message.entities.find(entity => entity.type === 'bot_command');
    } else if (message.caption && message.caption_entities) {
        commandEntity = message.caption_entities.find(entity => entity.type === 'bot_command');
    }

    // If a command entity exists and starts at the beginning of the message, proceed to parse
    if (commandEntity && commandEntity.offset === 0) {
        let command;
        let args;

        // If the message contains text, extract the command and arguments from the text
        if (message.text) {
            // Extract the command from the message text based on the entity length
            command = message.text.slice(commandEntity.offset, commandEntity.offset + commandEntity.length);
            // Extract the arguments, which come after the command
            args = message.text.slice(commandEntity.offset + commandEntity.length).trim();
        } 
        // If the message contains a caption, extract the command and arguments from the caption
        else if (message.caption) {
            // Extract the command from the message caption based on the entity length
            command = message.caption.slice(commandEntity.offset, commandEntity.offset + commandEntity.length);
            // Extract the arguments, which come after the command
            args = message.caption.slice(commandEntity.offset + commandEntity.length).trim();
        }

        // Normalize the command by removing the bot mention if present (e.g., /make@stationthisbot => /make)
        const botMentionIndex = command.indexOf('@');
        if (botMentionIndex !== -1) {
            command = command.slice(0, botMentionIndex);
        }

        // Return the parsed command and arguments
        return { command, args };
    }

    // If no command entity is found, return null values for command and arguments
    return { command: null, args: null };
}

module.exports = function(bot) {
    bot.on('message', async (message) => {
        //console.log('wow we have a message',message);
        let handled = false;
        if (messageFilter(message)) {
            console.log('message filtered');
            return;
        }
    
        if ('text' in message || 'caption' in message) {
            const { command, args } = parseCommand(message);
            //console.log('command and args',command,args)
            // Handle command if it exists
            if (command && commandRegistry.hasOwnProperty(command)) {
                // Gatekeeping check if needed
                const requiresGatekeeping = commandsRequiringGatekeeping.some(cmd => command.startsWith(cmd));
                if (requiresGatekeeping) {
                    const allowed = await checkLobby(message);
                    if (!allowed) {
                        return;
                    }
                } else {
                    await checkIn(message);
                }
                    // Execute the handler with the message and parsed arguments
                    //await safeExecute(message, () => commandRegistry[command](message, args));
                    await safeExecute(message, () => commandRegistry[command].handler(message, args));

                    handled = true;
                    return; // Stop after the first match to avoid multiple command executions
            }
            
            // If no command has handled the message, use watch for further processing
            if (!handled) {
                //console.log('imessage text watch')
                watch(message);
            } else {
                //console.log('but its handled?')
            }
            //console.log('message receipt complete')
        } else if ('photo' in message || 'document' in message) {
            // Log and delegate to watch for non-text messages
            //console.log(`Received ${'photo' in message ? 'photo' : 'document'}`);
            watch(message);
        }
    })
}

