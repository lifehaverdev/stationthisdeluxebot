const { 
    getBotInstance, lobby, startup, STATES, 
    stateHandlers,
    SET_COMMANDS,
    commandRegistry,
    getGroup, 
} = require('../bot.js'); 
const { initialize } = require('../intitialize')
const { tutorialSteps, TutorialManager, CHECKPOINTS } = require('./iStart')
const bot = getBotInstance();
const { lobbyManager, checkLobby, checkIn, POINTMULTI, NOCOINERSTARTER, calculateMaxPoints } = require('../gatekeep')
const {
    safeExecute,
    sendMessage,
    setUserState,
    react,
    gated,
    DEV_DMS
} = require('../../utils')
require('./iLora.js')
require('./iStats.js')
require('../../../commands/ffmpeg')
const { AnalyticsEvents } = require('../../../db/models/analyticsEvents');
const analytics = new AnalyticsEvents();

// const { 
//     readStats, 
//     //rareCandy, 
//     writeUserData, 
//     writeQoints, 
    
//     writeUserDataPoint } = require('../../../db/mongodb.js')

const { cheese } = require('../../../commands/fry')
const { UserEconomy, FloorplanDB } = require('../../../db/index');

//const statsDB = new UserStats();
const userDB = new UserEconomy();
const floorplanDB = new FloorplanDB();

const iMenu = require('./iMenu')
const iAccount = require('./iAccount')
const iMake = require('./iMake')
const iWork = require('./iWork')
const iMedia = require('./iMedia')
const iBrand = require('./iBrand')
const iSettings = require('./iSettings')
const iGroup = require('./iGroup')
//const statsEmitter = require('../../../db/events.js');
const iCollection = require('./iCollection')
const iResponse = require('./iResponse')
const iTrain = require('./iTrain')
require('./iRiff')
require('./iDirect')
//const iWallet = require('./iWallet')

const botName = 'stationthisdeluxebot'//process.env.BOT_NAME
/*
Recognizes Groupchat Context
Classes for start, ask photo etc
*/

commandRegistry['/signin'] = {
    handler: iAccount.handleSignIn
};

commandRegistry['/quickmake'] = {
    handler: iMake.handleMake
};
commandRegistry['/make'] = {
    handler: iMake.handleFlux,
};

commandRegistry['/make3'] = {
    handler: iMake.handleMake3,
};

commandRegistry['/flux'] = {
    handler: (message) => {
        sendMessage(message, 'hey use /make for this from now on')
        iMake.handleFlux(message)
    }
};

commandRegistry['/ms2'] = {
    handler: iMedia.handleMs2ImgFile
};
commandRegistry['/joycat'] = {
    handler: iMake.handleMog,
};

// commandRegistry['/degod'] = {
//     handler: iMake.handleDegod,
// };

commandRegistry['/milady'] = {
    handler: iMake.handleMilady,
};

commandRegistry['/loser'] = {
    handler: iMake.handleLoser,
};

commandRegistry['/regen'] = {
    handler: iMake.handleRegen,
};

commandRegistry['/again'] = {
    handler: iMake.handleAgain,
};

commandRegistry['/getseed'] = {
    handler: iWork.saySeed,
};

commandRegistry['/savesettings'] = {
    handler: iAccount.handleSaveSettings,
};

commandRegistry['/seesettings'] = {
    handler: iAccount.handleSeeSettings,
};

commandRegistry['/account'] = {
    handler: iAccount.handleAccountSettings,
};

// commandRegistry['/groupsettings'] = {
//     handler: iGroup.groupSettings,
// };

// commandRegistry['/disc(.*)'] = handleDisc,
    // '/watermark(.*)': handleWatermark,
commandRegistry['/signout'] = {
    handler: iAccount.handleSignOut,
};
commandRegistry['/resetaccount'] = {
    handler: iAccount.handleAccountReset,
};

commandRegistry['/set'] = {
    handler: iMenu.setMenu,
};

commandRegistry['/create'] = {
    handler: iMenu.handleCreate,
};

commandRegistry['/effectplus'] = {
    handler: iMenu.handleEffect,
};

commandRegistry['/effect'] = {
    handler: iMenu.handleEffectF,
};

commandRegistry['/quickeffect'] = {
    handler: iMenu.handleEffectXL,
};

commandRegistry['/animate'] = {
    handler: iMenu.handleAnimate,
};

commandRegistry['/utils'] = {
    handler: iMenu.handleUtils,
};

commandRegistry['/quit'] = {
    handler: (message) => {
        setUserState(message, STATES.IDLE);
        react(message,'👍')
    }
};

commandRegistry['/inpaint'] = {
    handler: iMedia.handleInpaint,
};

commandRegistry['/help'] = {
    handler: iWork.handleHelp,
};

commandRegistry['/status'] = {
    handler: iWork.handleStatus,
};
    // '/speak(?:@stationthisbot)?': iWork.startSpeak,
    // '/mogmogmogmogmogmogmogmog$': {
    //     handler: (message) => {
    //         if(lobby[message.from.id].wallet){
    //             lobby[message.from.id].balance = 200001;
    //             sendMessage(message,'based mog cousin you now how 200001 virtual MS2 tokens')
    //         } else {
    //             sendMessage(message,'sup cousin you know the password but /signin and verify first to get ur virtual tokens')
    //         }
    //     }
    // },
commandRegistry['/remiliaworldorder'] = {
    handler: (message) => {
        console.log('cheeseworld!!!')
                lobby[message.from.id].balance = 600001;
                sendMessage(message,'you now have 600001 virtual MS2 tokens')
        sendMessage({...message, 'chat': {'id': DEV_DMS}, reply_to_message: null}, `@${message.from.username} missing the rage rn`)
    }
};

commandRegistry['/ca'] = {
    handler: (message) => {
        const caMessage="SOLANA:\n`AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg`\n\nETHEREUM:\n`0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820`\n"
        sendMessage(message,caMessage,
                {
                    reply_markup: {inline_keyboard: [
                        [
                            {
                                text: 'Sol Chart', 
                                url: 'https://www.coingecko.com/en/coins/station-this'
                            },
                            {
                                text: 'Buy',
                                url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg'
                            },
                            
                        ],
                        [
                            {
                                text: 'Eth Chart', 
                                url: 'https://www.dextools.io/app/en/ether/pair-explorer/0xdc7e9e9808bb28aa4cbef08fe604c4ab4cfe0402?t=1737136827755'
                            },
                            {
                                text: 'Buy',
                                url: 'https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=0x98ed411b8cf8536657c660db8aa55d9d4baaf820'
                            },
                        ],
                        [
                            {
                                text: 'Bridge MS2',
                                url: 'https://portalbridge.com/'
                            }
                        ],
                        [
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
            return message.chat.id > 0 || (message.chat.id < 0 && message.text.includes('@stationthisbot'));
        }
    },
commandRegistry['/flush'] = {
    handler: async (message) => {
        if(message.from.id != DEV_DMS){
            return;
            } else {
                await lobbyManager.cleanLobby();
                sendMessage(message,'ok we reset da points')
            }
        }
    },
commandRegistry['/ibought'] = {
    handler: async (message) => {
        if(lobby[message.from.id]){
            lobby[message.from.id].balance = ''
                sendMessage(message,'I reset your balance');
            }
        }
    },
commandRegistry['/refresh'] = {
    handler: async (message) => {
        if(message.from.id != DEV_DMS){
            return;
        } else {
                await initialize()
                sendMessage(message,'I reset burns, loralist and groups');
            }
        }
    },
commandRegistry['/check'] = {
    handler: (message) => {
        if(message.from.id != DEV_DMS){
            return;
        } else {
                const lob = lobby;
                sendMessage(message,JSON.stringify(lob));
            }
        }
    },
    // '/see': {
    //     handler: async (message) => {
    //         if (message.from.id != DEV_DMS) {
    //             return;
    //         } else {
    //             // Start the stats calculation
    //             readStats();

    //             // Set up event listeners to receive progress updates and final messages
    //             statsEmitter.on('stats-progress', async (progressMsg) => {
    //                 await sendMessage(message, progressMsg);
    //             });

    //             statsEmitter.once('stats-completed', async (finalMsg) => {
    //                 await sendMessage(message, 'Stats analysis completed successfully:\n' + finalMsg);
    //             });

    //             statsEmitter.once('stats-error', async (errorMsg) => {
    //                 await sendMessage(message, 'Error occurred during stats analysis:\n' + errorMsg);
    //             });

    //             // Send initial confirmation
    //             await sendMessage(message, 'Stats analysis has started, updates will follow.');
    //         }
    //     }
    // },
commandRegistry['/glorp'] = {
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
commandRegistry['/slamtest'] = {
    handler: async (message) => {
        sendMessage(message,`${lobby[message.from.id].state.state}`)
    }
};
    // '/admin': {
    //     handler: iGroup.toggleAdmin,
    // },
commandRegistry['/forcelogo'] = {
    handler: (message) => {
        if(lobby[message.from.id] && !lobby[message.from.id].forceLogo) {
            lobby[message.from.id].forceLogo = true;
            } else if (lobby[message.from.id] && lobby[message.from.id].forceLogo) {
                lobby[message.from.id].forceLogo = false;
            }
            react(message, '👍');
        }
    },
commandRegistry['/dointify'] = {
    handler: (message) => {
        if(message.from.id != DEV_DMS){
            // console.log(message.from.id)
                return;
            } else if(lobby[message.from.id]) {
                lobby[message.from.id].doints = Math.floor((lobby[message.from.id].balance + NOCOINERSTARTER) / POINTMULTI)
            }
        }
    },
commandRegistry['/showmemyboints'] = {
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
commandRegistry['/here'] = {
    handler: async (message) => {
        if(message.from.id != DEV_DMS){
            return;
        } else {
                const whom = message.reply_to_message.from.id
                if(!lobby[whom]){
                    await checkIn({...message, from: {id: whom}})
                }
                if(lobby[whom]){
                    lobby[whom].doints = 0;
                    await react(message,'👍')
                } else {
                    sendMessage(message,'sorry...')
                }
            }
        }
    },
commandRegistry['/rarecandy'] = {
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
                    await userDB.rareCandy(whom,exp)
                    lobby[whom].exp = exp;
                    sendMessage(message,'it is done');
                } else {
                    sendMessage(message,'sorry...')
                }
            }
        }
    },
commandRegistry['/vidthat'] = {
    handler: async (message) => {
        console.log('made it into the function')
        const group = getGroup(message)
        if(!lobby.hasOwnProperty(message.from.id)) await checkIn(message)
            if((lobby[message.from.id].balance < 600000 && !group) || (group && group.qoints < 100)){
                gated(message)
                return
            }
            const target = message.reply_to_message;
            if(target && (target.photo || target.document)) {
                lobby[message.from.id].prompt = message.text.replace('/vidthat', '').trim()
                target.from.id = message.from.id;
                target.message_id = message.message_id
                iMedia.handleMs3V3ImgFile(target)
            } else {
                react(message,"🤔")
            }
        }
    },
commandRegistry['/vidthat2'] = {
    handler: async (message) => {
        console.log('made it into the function')
        const group = getGroup(message)
        if(!lobby.hasOwnProperty(message.from.id)) await checkIn(message)
            if((lobby[message.from.id].balance < 600000 && !group) || (group && group.qoints < 100) || (!group && calculateMaxPoints(lobby[message.from.id]) - (lobby[message.from.id].doints + lobby[message.from.id].points) < 1000)){
                gated(message)
                return
            }
            const target = message.reply_to_message;
            if(target && (target.photo || target.document)) {
                //lobby[message.from.id].prompt = message.text.replace('/vidthat', '').trim()
                iMedia.handleMs3V2ImgFile(
                    {
                        ...target, 
                        from: {id: message.from.id},
                        message_id: message.message_id,
                    }
                )
            } else {
                react(message,"🤔")
            }
        }
    },
commandRegistry['/interrogate'] = {
    handler: async (message) => {
        console.log('made it into interrogate')
        const group = getGroup(message)
        if(!lobby.hasOwnProperty(message.from.id)) await checkIn(message)
            if((lobby[message.from.id].balance < 400000 && !group) || (group && group.qoints < 100)){
                gated(message)
                return
            }
            const target = message.reply_to_message;
            if(message.photo || message.document) {
                // Use the original message if it has a photo
                if(lobby[message.from.id].createSwitch == 'MAKE'){
                    iWork.shakeFluxInterrogate(message)
                } else {
                    iMedia.handleInterrogation(message)
                }
            } else if(target && (target.photo || target.document)) {
                // Otherwise use the replied-to message if it has a photo
                target.from.id = message.from.id;
                target.message_id = message.message_id
                if(lobby[message.from.id].createSwitch == 'MAKE'){
                    iWork.shakeFluxInterrogate(target)
                } else {
                    iMedia.handleInterrogation(target)
                }
            } else {
                react(message,"🤔")
            }
        }
    },
commandRegistry['/assist'] = {
    handler: async (message) => {
        console.log('made it into assist')
        const group = getGroup(message)
        if(!lobby.hasOwnProperty(message.from.id)) await checkIn(message)
        if((lobby[message.from.id].balance < 200000 && !group) || (group && group.qoints < 100)){
                gated(message)
                return
            }
            const cleanedText = message.text.replace('/assist', '').trim();
            if (cleanedText) {
                if(lobby[message.from.id].createSwitch == 'MAKE'){
                    iWork.shakeFluxAssist({...message, text: cleanedText});
                } else {
                    iWork.shakeAssist({...message, text: cleanedText});
                }
            } else {
                react(message, '🤔');
            }
        }
    },
commandRegistry['/watermark'] = {
    handler: async (message) => {
        console.log('made it into interrogate')
        if(!lobby.hasOwnProperty(message.from.id)) await checkIn(message)
        const target = message.reply_to_message;
        if(target.photo || target.document) {
                target.from.id = message.from.id;
                target.message_id = message.message_id
                iBrand.handleWatermark(target)
            } else {
                react(message,"🤔")
            }
            
        }
    },
    
commandRegistry['/cheesethat'] = {
    handler: cheese,
};
commandRegistry['/letspretendiamfrosty'] = {
    handler: async (message) => {
        if(message.from.id != DEV_DMS){
            return;
        } else {
            if(!lobby[message.from.id]) if(!await checkLobby(message)) return
                lobby[DEV_DMS].balance = 200000
            }
        }
    },
commandRegistry['/showmetheseproperties'] = {
    handler: (message) => {
        console.log(message)
    }
};
commandRegistry['/tsa'] = {
    handler: async (message) => {
        if(message.from.id != DEV_DMS){
            return;
            } else {
                if(!lobby[message.reply_to_message.from.id]) if(!await checkIn(message.reply_to_message)) return
                const target = message.reply_to_message.from.id
                await react(message,"💅")
                const settingsMessage = {
                    from: { id: target },
                    chat: { id: DEV_DMS },
                    message_id: message.message_id
                };
                let profile = iAccount.buildUserProfile(settingsMessage, true);
                const keyboard = iAccount.buildAccountSettingsKeyboard(target);
                profile += `userId: ${target}`
                sendMessage({...settingsMessage, from: {id: DEV_DMS}}, profile, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                });
            }
        }
    },
commandRegistry['/showmemyruns'] = {
    handler: (message) => {
        console.log(lobby[message.from.id].runs[0])
    }
};
commandRegistry['/bestow'] = {
    handler: async (message) => {
        console.log('made it into the function')
        const target = message.reply_to_message;
        if(!target){
                return
            }
            const group = getGroup(message)
            if(!group){
                return
            }
            group.gateKeeping.chosen.push(target.from.id)
            console.log('chosen now',group.gateKeeping.chosen)
            await react(message,'😎')
        },
        condition: (message) => {
            const group = getGroup(message)
            return message.chat.type !== 'private' && group && group.gateKeeping.style == 'select' && group.admins.includes(message.from.id);
        }
    },
commandRegistry['/revoke'] = {
    handler: async (message) => {
        console.log('made it into the function')
        const target = message.reply_to_message;
        if(!target){
                return
            }
            const group = getGroup(message)
            if(!group){
                return
            }

            group.gateKeeping.chosen = group.gateKeeping.chosen.filter(val => val !== target.from.id)
            console.log('chosen now',group.gateKeeping.chosen)
            await react(message,"💅")
        },
        condition: (message) => {
            const group = getGroup(message)
            return message.chat.type !== 'private' && group && group.gateKeeping.style == 'select' && group.admins.includes(message.from.id);
        }
    },
    

commandRegistry['/donate'] = {
    handler: async (message) => {
        const userId = message.from.id;
        const group = getGroup(message);

        if (!group) {
            await react(message, "🤨");
            return;
        }

        const current = group.qoints;
        message.text = message.text.replace('/donate', '').replace(`@stationthisdeluxebot`, '');
        const howMuch = parseInt(message.text);
        const balance = lobby[userId]?.qoints || 0;

        console.log('donate before', current, howMuch, balance);

        if (userId === DEV_DMS) {
            // Developer can freely donate qoints
            group.qoints += howMuch;
            await floorplanDB.writeGroupQoints(message.chat.id, group.qoints);
            await react(message, '✍️');
            sendMessage(message, 'thank you for your contribution.');
        } else if (!isNaN(howMuch) && howMuch <= balance && howMuch > 0) {
            // Regular user donation logic
            group.qoints += howMuch;
            lobby[userId].qoints -= howMuch;
            await userDB.writeQoints(userId, 'qoints', lobby[userId].qoints);
            await floorplanDB.writeGroupQoints(message.chat.id, group.qoints);
            await react(message, '✍️');
            sendMessage(message, 'thank you for your contribution.');
        } else {
            // Validation errors for regular users
            if (isNaN(howMuch)) {
                sendMessage(message, 'um pls send a number');
            }
            if (howMuch > balance) {
                sendMessage(message, `actually.. you only have ${balance} so you can't donate ${howMuch} obviously`);
            }
            if (howMuch <= 0) {
                sendMessage(message, 'very funny.');
            }
        }
    },
},
commandRegistry['/gift'] = {
    handler: async (message) => {
        const userId = message.from.id;
        const target = message.reply_to_message;

        if (!target) {
            return;
        }

        console.log('message from', message.from.id, 'target from', target.from.id);

        if (!lobby.hasOwnProperty(target.from.id)) {
            console.log('lets check this sucker in');
            await checkIn(target);
        }

        if (!lobby[target.from.id].qoints) {
            lobby[target.from.id].qoints = 0;
        }

        const current = lobby[target.from.id].qoints;
        message.text = message.text.replace('/gift', '').replace(`@stationthisdeluxebot`, '');
        const howMuch = parseInt(message.text);
        const balance = lobby[userId]?.qoints || 0;

        console.log('gift before', current, howMuch, balance);

        if (userId === DEV_DMS) {
            // Developer can freely gift qoints
            lobby[target.from.id].qoints += howMuch;
            await userDB.writeUserDataPoint(target.from.id, 'qoints', lobby[target.from.id].qoints);
            await react(message, '✍️');
            sendMessage(message, `@${target.from.username} thanks you for your generosity! Use /account and refresh to process your gift.`);
        } else if (!isNaN(howMuch) && howMuch <= balance && howMuch > 0) {
            // Regular user gift logic
            lobby[target.from.id].qoints += howMuch;
            lobby[userId].qoints -= howMuch;
            await userDB
                .startBatch()
                .writeUserDataPoint(userId, 'qoints', lobby[userId].qoints,true)
                .writeUserDataPoint(target.from.id, 'qoints', lobby[target.from.id].qoints,true)
                .executeBatch()
            await react(message, '✍️');
            sendMessage(message, `@${target.from.username} thanks you for your generosity! Use /account and refresh to process your gift.`);
        } else {
            // Validation errors for regular users
            if (isNaN(howMuch)) {
                sendMessage(message, 'um pls send a number');
            }
            if (howMuch > balance) {
                sendMessage(message, `actually.. you only have ${balance} so you can't gift ${howMuch} obviously`);
            }
            if (howMuch <= 0) {
                sendMessage(message, 'very funny');
            }
        }
    },
},
commandRegistry['/tripo'] = {
    handler: async (message) => {
        console.log('made it into the function')
        iMedia.handleTRIPO(message)
    }
},
commandRegistry['/viduthat'] = {
    handler: async (message) => {
        console.log('made it into /viduthat command');
        iMedia.handleVIDU(message);
    },
};
commandRegistry['/makevideo'] = {
    handler: async (message) => {
        console.log('made it into /makevideo command');
        iMake.handleMakeVideo(message);
    }
};
commandRegistry['/vidupscale'] = {
    handler: async (message) => {
        console.log('made it into /vidupscale command');
        iMedia.handleVIDUUpscale(message);
    }
};

    // Modified '/stationthis' command to include group check and onboarding
commandRegistry['/stationthis'] = {
    handler: async (message) => {
        const getAdmin = async (message) => {
            const chatAdmins = await bot.getChatAdministrators(message.chat.id);
                const isAdmin = message.from.id == DEV_DMS || (chatAdmins.some(admin => !admin.user.is_bot && admin.user.id === message.from.id));
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



//const stateHandlers = {
    stateHandlers[STATES.SIGN_IN]= (message) => safeExecute(message, iAccount.shakeSignIn)
    stateHandlers[STATES.VERIFY]= (message) => safeExecute(message, iAccount.shakeVerify)

    stateHandlers[STATES.QUICKMAKE]= (message) => safeExecute(message, iMake.handleMake)
    stateHandlers[STATES.MAKE3]= (message) => safeExecute(message, iMake.handleMake3)

    stateHandlers[STATES.EFFECTHANG] = (message) => safeExecute(message, iMenu.handleEffectHang);
    stateHandlers[STATES.PFP]= (message) => safeExecute(message, iMedia.handlePfpImgFile)
    stateHandlers[STATES.MS2PROMPT]= (message) => safeExecute(message, iMake.handleMs2Prompt)
    stateHandlers[STATES.MAKEPROMPT] = (message) => safeExecute(message, iMake.handleFluxPrompt)
    stateHandlers[STATES.QUICKIMG2IMG]= (message) => safeExecute(message, iMedia.handleMs2ImgFile)
    stateHandlers[STATES.IMG2IMG]=(message) => safeExecute(message, iMedia.handleFluxImgFile)
    stateHandlers[STATES.SD32IMG] = (message) => safeExecute(message, iMedia.handleSD3ImgFile)
    stateHandlers[STATES.SD32IMGPROMPT] = (message) => safeExecute(message, iMake.handleSD3ImgPrompt)
    
    stateHandlers[STATES.MS3]= (message) => safeExecute(message,iMedia.handleMs3ImgFile)
    stateHandlers[STATES.MS3V2] = (message) => safeExecute(message,iMedia.handleMs3V2ImgFile)
    
    stateHandlers[STATES.QUICKINTERROGATION]= (message) => safeExecute(message, iMedia.handleInterrogation)
    stateHandlers[STATES.ASSIST]= (message) => safeExecute(message, iWork.shakeAssist)
    stateHandlers[STATES.FLASSIST]= (message) => safeExecute(message, iWork.shakeFluxAssist)
    stateHandlers[STATES.SPEAK]= (message) => safeExecute(message, iWork.shakeSpeak)
    stateHandlers[STATES.DISC]= (message) => safeExecute(message, iBrand.handleDiscWrite)
    stateHandlers[STATES.WATERMARK]= (message) => safeExecute(message, iBrand.handleWatermark)

    stateHandlers[STATES.SETPHOTO]= (message) => safeExecute(message, iSettings.handleSet)
    stateHandlers[STATES.SETSTYLE]= (message) => safeExecute(message,iSettings.handleSet)
    stateHandlers[STATES.SETCONTROL]= (message) => safeExecute(message,iSettings.handleSet)
    stateHandlers[STATES.SETPOSE]= (message) => safeExecute(message, iSettings.handleSet)

    stateHandlers[STATES.INPAINT]= (message) => safeExecute(message, iMedia.handleInpaint)
    stateHandlers[STATES.INPAINTTARGET]= (message) => safeExecute(message, iMake.handleInpaintTarget)
    stateHandlers[STATES.INPAINTPROMPT]= (message) => safeExecute(message, iMake.handleInpaintPrompt)

    stateHandlers[STATES.UPSCALE] = (message) => safeExecute(message, iMedia.handleUpscale)
    stateHandlers[STATES.RMBG] = (message) => safeExecute(message, iMedia.handleRmbg)
    //[STATES.GROUPAPPLY] = (message) => safeExecute(message, iGroup.handleApplyBalance)
    stateHandlers[STATES.INTERROGATE] = (message) => safeExecute(message, iWork.shakeFluxInterrogate)
    stateHandlers[STATES.MAKE] = (message) => safeExecute(message,iMake.handleFlux)

    stateHandlers[STATES.LORANAME] = (message) => safeExecute(message,iTrain.createLora)
    stateHandlers[STATES.ADDLORAIMAGE] = (message) => safeExecute(message,iTrain.addLoraSlotImage)

    stateHandlers[STATES.TRIPO] = (message) => safeExecute(message, iMedia.handleTRIPO)
    stateHandlers[STATES.CUSTOMFILENAME] = (message) => safeExecute(message, iAccount.customFileName)
    
//};

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
    if (message.text == '/quit'){
        return false
    }
    // Check if the message is a reply
    if (message.reply_to_message) {
        if(message.reply_to_message.message_id != message.message_thread_id){
           console.log("Handling a reply to a message.")
            return false;
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
        //update 11/21 just set them to idle and let them do w/e
        setUserState(message,STATES.IDLE)
        //lobby[message.from.id].state.state = STATES.IDLE
        return false;
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

const commandsRequiringGatekeeping = [
    '/flux','/quickmake','/make', '/make3',
    '/milady','/degod','/joycat',
    '/utils','/create','/effect','/effectf','effectxl','/animate',
    '/inpaint','/regen', 
    '/speak','/assist','/interrogate'
    ];

// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
// Helper function to parse the command and arguments from the message
async function parseCommand(message) {
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
            // Extract the command from the message text based on the entity length and convert to lowercase
            command = message.text.slice(commandEntity.offset, commandEntity.offset + commandEntity.length).toLowerCase();
            // Extract the arguments, which come after the command
            args = message.text.slice(commandEntity.offset + commandEntity.length).trim();
        } 
        // If the message contains a caption, extract the command and arguments from the caption
        else if (message.caption) {
            // Extract the command from the message caption based on the entity length and convert to lowercase
            command = message.caption.slice(commandEntity.offset, commandEntity.offset + commandEntity.length).toLowerCase();
            // Extract the arguments, which come after the command
            args = message.caption.slice(commandEntity.offset + commandEntity.length).trim();
        }

        // Normalize the command by removing the bot mention if present (e.g., /make@stationthisbot => /make)
        const botMentionIndex = command.indexOf('@');
        if (botMentionIndex !== -1) {
            command = command.slice(0, botMentionIndex);
        }

        // Tutorial progression check - only for private chats
        if (message.chat.id > 0 && lobby[message.from.id]?.progress) {
            const currentStep = TutorialManager.getCurrentStep(message.from.id);
            
            // If this command matches the current tutorial step's command
            if (tutorialSteps[currentStep]?.command === command) {
                console.log('[Tutorial] Command matches current step, triggering checkpoint');
                await TutorialManager.checkpointReached(
                    message.from.id, 
                    CHECKPOINTS.COMMAND_USED,
                    { message }
                );
            } else {
                console.log('[Tutorial] Command used:', command);
                console.log('[Tutorial] Expected command:', tutorialSteps[currentStep]?.command);
            }
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
        if (messageFilter(message)) {
            console.log('message filtered');
            return;
        }
    
        if ('text' in message || 'caption' in message) {
            const { command, args } = await parseCommand(message);
            // Get group context if available
            const group = getGroup(message);
            let groupCommandList = group ? group.commandList : null;
            let groupRestrictedCommands = group ? group.restrictedCommandList : null;
            
            // Handle command if it exists
            if (command && commandRegistry.hasOwnProperty(command)) {
                // Check if the command is restricted in the group
                if (group && groupRestrictedCommands && groupRestrictedCommands.some(cmd => cmd.command === command.replace('/',''))) {
                    console.log(`Command ${command} is restricted in group ${group.title}`);
                    await react(message, "😴");
                    return; // Skip restricted commands
                }

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

                // Track the command
                await analytics.trackCommand(message, command);

                // Execute the handler with the message and parsed arguments
                await safeExecute(message, () => commandRegistry[command].handler(message, args));
                return; // Stop after the first match to avoid multiple command executions
            }

            // If group commands are available, handle potential group custom commands
            if (group && group.customCommandMap && command) {
                console.log('here!');
                const customCommandKey = command.replace('/', '');
                const customCommand = group.customCommandMap[customCommandKey];
                console.log(command, group.customCommandMap);
                console.log('customCommand', customCommand);

                if (customCommand) {
                    console.log(`Handling custom group command ${command} for group ${group.title}`);

                    // Fix the gatekeeping check to look at the mapped command instead
                    const requiresGatekeeping = commandsRequiringGatekeeping.some(cmd => 
                        cmd.replace('/', '') === customCommand  // Direct comparison with mapped command
                    );
                    
                    console.log('requiresGatekeeping', requiresGatekeeping);
                    if (requiresGatekeeping) {
                        const allowed = await checkLobby(message);
                        if (!allowed) {
                            return;
                        }
                    } else {
                        await checkIn(message);
                    }

                    // Track the custom command
                    await analytics.trackCommand(message, command, true);

                    // Execute the handler for the custom command
                    await safeExecute(message, () => commandRegistry['/' + customCommand].handler(message, args));
                    return; // Stop after handling custom command
                }
            }

            // If no command was handled, call watch
            watch(message);
        } else if ('photo' in message || 'document' in message) {
            // Log and delegate to watch for non-text messages
            watch(message);
        }
    });
}



