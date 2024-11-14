const { 
    sendMessage, setUserState, makeBaseData, 
    sendPrivateMessage,
    editMessage,
    safeExecute,
} = require('../../utils');
const { 
    stateHandlers,
    prefixHandlers, actionMap,
    rooms, getBurned, lobby, STATES, getBotInstance 
} = require('../bot')
//const { features } = require('../../models/tokengatefeatures.js')
const { createRoom, writeData, writeBurnData } = require('../../../db/mongodb.js')
//const { initialize } = require('../intitialize.js');
//const iMenu = require('./iMenu');
const defaultUserData = require('../../users/defaultUserData.js');

function getGroup(message) {
    const group = rooms.find(group => group.chat.id == message.chat.id)
    return group;
}

function getGroupById(groupChatId) {
    const group = rooms.find(group => group.chat.id == groupChatId)
    return group;
}

const defaultGroupSchema = {
    chat: { id: null },
    title: "",
    admins: [],
    initialized: false,
    qoints: 0,
    burnedQoints: 0,
    allowCustomCommands: false,
    customCommandMap: {},
    restrictedCommands: [],
    basePrompt: "",
    requiredWords: [],
    selectedLoras: [],
    gateKeeping: {
        style: 'none',
        chain: 'sol',
        token: '',
        nft: '',
        minBalance: 0,
        msg: '',
        chosen: [],
    },
    settingsType: 'total', //'some', 'pass'
    settingsMusts: [],
    settings: { ...defaultUserData }
};

async function updateMessage(chatId, messageId, menu, text) {
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: text
    });
}

function generateInlineKeyboard(buttons) {
    return {
        reply_markup: {
            inline_keyboard: buttons
        }
    };
}

function setGroupFlag(group, flagType, user, message_id) {
    group.flag = { what: flagType, user, targetMessageId: message_id };
}

function clearGroupFlag(group) {
    const { _id, flag, ...dataToSave } = group; // isolate out _id
    delete group.flag;
    return dataToSave;
}


/*
NEW GROUPCHAT SYSTEM

1. stationthis in teh groupchat
if you are an admin and the group isnt initialized, we give a button to initialize the group. that inititates

initializeGroup
if the user is the only admin or its not a super group, bot dms them directly. Gives them the group menu for the first time.
*/

// Function to handle the group initialization process
async function initializeGroup(message,user,groupChatId) {
    
    await updateMessage(message.chat.id,message.message_id,null,'$MS2')
    
    try {
        // Step 1: Create an admin groupchat
        // Extract chat ID from the callback query
        
        const groupTitle = message.chat.title;
        
        // Fetch administrators from the original group chat
        const bot = getBotInstance()
        const chatAdmins = await bot.getChatAdministrators(groupChatId);
        console.log(chatAdmins)
        const adminUserIds = chatAdmins.filter(admin => admin.user.is_bot == false).map(admin => admin.user.id);
        //console.log('only users',adminUserIds)
        // Instructions common to both scenarios
        const commonInstructions = `It's up to you and other admins to decide a couple of things:
        
1. gatekeeping style
2. custom commands
3. generation settings

`;

        // DM the initializing admin instead of creating a new group chat
        //const adminUserId = adminUserIds[0];
        //const user_name = chatAdmins.filter(admin => admin.user.id)
        const instructions = `Hello ${chatAdmins[0].user.first_name},

To access the menu again, use the /stationthis command again.

${commonInstructions}`;

        // Step 2: Create a default group configuration for the original group chat
        const defaultGroup = {
            ...defaultGroupSchema,
            chat: { id: groupChatId },
            title: groupTitle,
            admins: adminUserIds,
            initialized: true,
        };
        defaultGroup.settings.username = groupTitle
        defaultGroup.settings.userId = user
        
        // Save the default group to the databasex
        await createRoom(groupChatId,defaultGroup);
        rooms[groupChatId] = defaultGroup;
        await sendPrivateMessage(user, message, instructions, buildGroupSettingsMenu(groupChatId));

    } catch (error) {
        console.error("Error initializing group: ", error);
        // Send an error message to the user
        await sendPrivateMessage(user, "An error occurred while initializing the group. Please try again later.");
    }
}

async function groupMenu(message) {
    const group = getGroup(message)
    const menu = buildGroupSettingsMenu(message.chat.id)
    //console.log(group)
    await sendMessage(message,`${group.gateKeeping.ticker ? `$MS2 X $${group.gateKeeping.ticker}` : '$MS2'}`,menu)
}

async function privateGroupMenu(message, user, groupChatId) {
    const bot = getBotInstance()
    await bot.deleteMessage(message.chat.id, message.message_id)
    const group = getGroupById(groupChatId)
    const menu = buildGroupSettingsMenu(groupChatId,true)
    //console.log(menu.reply_markup.inline_keyboard.shift())
    
    await sendPrivateMessage(user, message,`${group.gateKeeping.ticker ? `$MS2 X $${group.gateKeeping.ticker}` : '$MS2'}`,menu)
}

function buildGroupSettingsMenu(groupChatId, isDms = false) {
    const menu = generateInlineKeyboard([
                //[{ text: '👀 edit in dms ⬆️', callback_data: `peg_${groupChatId}`}],
                [{ text: '⛩️ gatekeep 🛂', callback_data: `gatekeep_${groupChatId}`}],
                [{ text: '🗣️ commands 🪖', callback_data: `commands_${groupChatId}`}],
                [{ text: '📋 params 📑', callback_data: `prompts_${groupChatId}`}],
                [{text: 'cancel', callback_data: 'cancel'}]
            ])
            console.log('menu',menu)
    const group = getGroupById(groupChatId)
    //console.log(group)
    if(group && group.burnedQoints && group.burnedQoints < 600000) {
        console.log('some things to unlock')
        menu.reply_markup.inline_keyboard.unshift([{ text: '🔒 unlock 🔑', callback_data: `unlock_${groupChatId}`}],)
    }
    if(!isDms){
        menu.reply_markup.inline_keyboard.unshift([{ text: '👀 edit in dms ⬆️', callback_data: `peg_${groupChatId}`}])
    }
    return menu;
}

function buildEditGroupSubMenu(groupChatId, target = null) {
    let callback = 'eg_'
    if(target){
        callback = target
    }
    const subMenuScaffold = generateInlineKeyboard([[{text: '↖︎', callback_data: `${callback}${groupChatId}`}]])
    return subMenuScaffold
}

async function handleGroupMenu(message, user, groupChatId, menuType) {
    const group = getGroupById(groupChatId);
    let menu = buildEditGroupSubMenu(groupChatId);
    switch (menuType) {
        case 'gatekeep':
            menu.reply_markup.inline_keyboard.push([{ text: `🚪 set gatekeep type: ${group.gateKeeping.style} 🪟`, callback_data: `gks_${groupChatId}` }]);
            if (group.gateKeeping.style === 'token' || group.gateKeeping.style === 'nft') {
                menu.reply_markup.inline_keyboard.push([{ text: `set ca 🪙`, callback_data: `gkca_${group.gateKeeping.style}_${groupChatId}` }]);
                menu.reply_markup.inline_keyboard.push([{ text: `set gate 🧮`, callback_data: `gkmin_${groupChatId}` }]);
            }
            menu.reply_markup.inline_keyboard.push([{ text: `set gate message 🛃`, callback_data: `gkmsg_${groupChatId}` }]);
            menu.reply_markup.inline_keyboard.push([{ text: `set ticker 📈`, callback_data: `gktick_${groupChatId}`}])
            break;

        case 'command':
            menu.reply_markup.inline_keyboard.push([{ text: `🆒 custom commands 🆗`, callback_data: `egcc_${groupChatId}` }]);
            menu.reply_markup.inline_keyboard.push([{ text: `☑️ allowed commands 🗯️`, callback_data: `egac_${groupChatId}` }]);
            break;

        case 'prompt':
            menu.reply_markup.inline_keyboard.push([{ text: `🌡️ group param type: ${group.settingsType} 🧪`, callback_data: `egpt_${groupChatId}`}])
            menu.reply_markup.inline_keyboard.push([{ text: `📧 required words 🔫`, callback_data: `egrw_${groupChatId}` }]);
            menu.reply_markup.inline_keyboard.push([{ text: `🧠 assist instruction 👩🏼‍🏫`, callback_data: `egai_${groupChatId}` }]);
            break;

        default:
            console.error("Invalid menu type provided");
            return;
    }
    const marquee = `Gatekeep: ${group.gateKeeping.style}${group.gateKeeping.token}\n`
    await updateMessage(message.chat.id,message.message_id,menu,
        `${group.gateKeeping.ticker ? 
            `${group.title}\nstationthisbot X $${group.gateKeeping.ticker}\n${capitalizeFirstLetter(menuType)} Menu${marquee}` : 
            `${group.title}\n$MS2 stationthisbot\n${capitalizeFirstLetter(menuType)} menu\n${marquee}`}`
    )
}



function capitalizeFirstLetter(string) {
    if (!string) return ''; // Handle empty or undefined strings
    return string.charAt(0).toUpperCase() + string.slice(1);
}

async function groupGatekeepMenu(message,user,groupChatId) {
    handleGroupMenu(message, user, groupChatId, 'gatekeep')
}

async function groupCommandMenu(message,user,groupChatId) {
    handleGroupMenu(message, user, groupChatId, 'command')
}

async function groupPromptMenu(message,user,groupChatId) {
    handleGroupMenu(message, user, groupChatId, 'prompt')
}

async function groupUnlockMenu(message,user,groupChatId) {
    handleGroupMenu(message, user, groupChatId, 'unlock')
}

async function backToGroupSettingsMenu(message,user,groupChatId) {
    console.log('backtogroupsettings my g')
    const group = getGroupById(groupChatId)
    let isDm = false
    if(message.chat.id > 0) {isDm = true}
    const options = buildGroupSettingsMenu(groupChatId,isDm)
    message.from.id = user
    setUserState(message,STATES.IDLE)
    await updateMessage(message.chat.id,message.message_id,options,
        `${group.gateKeeping.ticker ? `$MS2 X $${group.gateKeeping.ticker}` : '$MS2'}`
    )
}

/*
layer 2 menus, menus within the submenu, doing things like 
changing the gatekeeping type,
*/
async function groupGatekeepTypeMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId,'gatekeep_')
    //for this menu, we check the group gatekeeping type
    const style = group.gateKeeping.style
    menu.reply_markup.inline_keyboard.push([{text: style == 'none' ? `none ✅`:`none`, callback_data: `sgks_none_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'token' ? `token 🪙 ✅`:`token 🪙`, callback_data: `sgks_token_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'nft' ? `nft 🖼️ ✅`:`nft 🖼️`, callback_data: `sgks_nft_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'adminOnly 👔' ? `adminOnly 👔 ✅`:`adminOnly`, callback_data: `sgks_adminOnly_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'select 📇' ? `select 📇 ✅`:`select`, callback_data: `sgks_select_${groupChatId}'}`}])
    //['none', 'token', 'nft', 'adminOnly', 'selectedOnly']
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: `${group.gateKeeping.ticker ? `${group.title}\nstationthisbot X $${group.gateKeeping.ticker}\nGatekeeping Menu` : `${group.title}\n$MS2 stationthisbot\nGatekeeping menu`}`
    })
    message.from.id = user;
    setUserState(message,STATES.IDLE)
}

async function groupGatekeepTypeSelect(message,user,groupChatId,type) {
    const group = getGroupById(groupChatId)
    group.gateKeeping.style = type;
    //await groupGatekeepTypeMenu(message,user,groupChatId)
    await handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
}
/*
setting token contract address,
*/

// Class definition for handling group settings
class GroupSettingHandler {
    constructor(groupChatId, options) {
        this.groupChatId = groupChatId; // The ID of the group being configured
        this.settingName = options.settingName; // Name of the setting being handled (e.g., 'minBalance', 'gateMessage')
        this.promptText = options.promptText; // Instructional text to guide the user when setting the parameter
        this.description = options.description; // Description to provide more context for advanced users
        this.state = options.state; // State identifier for the bot
        this.flagWhat = options.flagWhat; // Flag identifier for the group
        this.processHandler = options.processHandler; // Function to handle processing the user's input
        this.prefix = options.prefix; // The prefix used for the callback action (e.g., 'gkmsg_')
        this.actionKey = options.actionKey; // The action key for `actionMap`
        this.callbackPrefix = options.callbackPrefix; // Prefix for the callback data
        this.onCompleteCallback = options.onCompleteCallback; // Callback to activate upon completion of the process
        options.alt ? this.alt = options.alt : this.alt = 1
        // Register the handlers
        this.registerHandlers(this.alt);
    }

    // Register prefixHandlers, actionMap, and stateHandlers
    registerHandlers(alt = 1) {
        // Prefix handler to trigger the setting prompt
        prefixHandlers[this.prefix] = (action, message, user) => {
            const groupChatId = parseInt(action.split('_')[alt]);
            this.groupChatId = groupChatId; // Set correct groupChatId dynamically
            this.showSettingPrompt(message, user);
        };

        // Action map handler for the given action key
        actionMap[this.actionKey] = (message, user, groupChatId) => {
            this.groupChatId = groupChatId; // Set correct groupChatId dynamically
            this.showSettingPrompt(message, user);
        };

        // State handler to process the user's response
        stateHandlers[this.state] = (message) => {
            safeExecute(message, this.processSettingInput.bind(this));
        };
    }

    // Show the setting prompt to the user
    async showSettingPrompt(message, user) {
        const group = getGroupById(this.groupChatId);
        const menu = buildEditGroupSubMenu(this.groupChatId, this.callbackPrefix);
        message.from.id = user;

        setUserState(message, this.state);
        group.flag = {
            what: this.flagWhat,
            user,
            targetMessageId: message.message_id, // Store the original message ID to return to later
        };

        // Determine whether to include the description based on user type
        const userId = message.from.id;
        const userIsAdvanced = lobby[userId]?.advancedUser;
        const descriptionText = userIsAdvanced && this.description ? `\n\n${this.description}` : '';

        // Update the message to prompt user for the setting
        await editMessage({
            reply_markup: menu.reply_markup,
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: `${lobby[userId] && lobby[userId].advancedUser ? `${group.title}\nstationthisbot X $${group.gateKeeping.ticker}` : `${group.title}\n$MS2 stationthisbot`}\n${descriptionText}\n\n${this.promptText}`
        });
    }

    // Process the user input for the given setting
    async processSettingInput(message) {
        const group = rooms.find(group => group.flag.user === message.from.id);
        if (group && group.flag.what === this.flagWhat) {
            // Call the specific handler for processing input
            await this.processHandler(group, message);

            const { _id, flag, ...dataToSave } = group; // Isolate out _id
            await writeData('floorplan', { id: group.chat.id }, dataToSave);
            setUserState(message, STATES.IDLE);
            delete group.flag;

            // Activate the callback to return to the original menu
            if (this.onCompleteCallback) {
                await this.onCompleteCallback(message, group, flag.targetMessageId);
            }
        }
    }
}

// Gatekeeping message setting handler with inline processHandler
const gateMessageHandler = new GroupSettingHandler('groupChatId', {
    settingName: 'gateMessage',
    promptText: 'What should I say if someone gets gatekept?',
    description: 'This message will be displayed to users who do not meet the gatekeeping requirements. It can be customized to provide additional instructions or a friendly message.',
    state: STATES.SETGROUPGATEMSG,
    flagWhat: 'setGateMsg',
    processHandler: async (group, message) => {
        group.gateKeeping.Msg = message.text;
    },
    prefix: 'gkmsg_',
    actionKey: 'gateKeepSetGateMsg',
    callbackPrefix: 'gatekeep_',
    onCompleteCallback: async (message, group, targetMessageId) => {
        message.message_id = targetMessageId
        handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
    }
});

// Gatekeeping message setting handler with inline processHandler
const tickerHandler = new GroupSettingHandler('groupChatId', {
    settingName: 'ticker',
    promptText: 'What is the ticker?',
    description: 'is a vanity thing. about hype and intrigue. I will display the ticker on our messages so that people know you are cool with me.',
    state: STATES.SETGROUPTICKER,
    flagWhat: 'setTicker',
    processHandler: async (group, message) => {
        group.gateKeeping.ticker = message.text;
    },
    prefix: 'gktick_',
    actionKey: 'gateKeepSetTicker',
    callbackPrefix: 'gatekeep_',
    onCompleteCallback: async (message, group, targetMessageId) => {
        message.message_id = targetMessageId
        handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
    }
});

// Gatekeeping limit setting handler with inline processHandler
const gateLimitHandler = new GroupSettingHandler('groupChatId', {
    settingName: 'minBalance',
    promptText: `How much token is necessary to use the bot on the groups' tab?`,
    description: 'This setting defines the minimum balance a user must have to access the bot. It can be used to restrict access based on token holdings.',
    state: STATES.SETGROUPGATE,
    flagWhat: 'setGate',
    processHandler: async (group, message) => {
        const inputValue = parseInt(message.text);
        if (!isNaN(inputValue)) {
            group.gateKeeping.minBalance = inputValue;
        } else {
            console.error("Invalid number input for gate limit.");
        }
    },
    prefix: 'gkmin_',
    actionKey: 'gateKeepSetGate',
    callbackPrefix: 'gatekeep_',
    onCompleteCallback: async (message, group, targetMessageId) => {
        message.message_id = targetMessageId
        handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
    }
});

// Gatekeeping token contract address setting handler
const gateTokenCAHandler = new GroupSettingHandler('groupChatId', {
    settingName: 'tokenContractAddress',
    promptText: 'Tell me the token Contract Address (CA) we are gatekeeping with',
    description: 'This setting allows you to specify the contract address (CA) for tokens used for gatekeeping. It determines the access control based on token ownership.',
    state: STATES.SETGROUPTOKENCA,
    flagWhat: 'setTokenCA',
    alt: 2,
    processHandler: async (group, message) => {
        group.gateKeeping.token = message.text;
    },
    prefix: 'gkca_token_',
    actionKey: 'gateKeepSetTokenCA',
    callbackPrefix: 'gatekeep_',
    onCompleteCallback: async (message, group, targetMessageId) => {
        message.message_id = targetMessageId
        handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
    }
});

// Gatekeeping NFT contract address setting handler
const gateNFTCAHandler = new GroupSettingHandler('groupChatId', {
    settingName: 'nftContractAddress',
    promptText: 'Tell me the NFT Contract Address (CA) we are gatekeeping with',
    description: 'This setting allows you to specify the contract address (CA) for NFTs used for gatekeeping. It determines the access control based on NFT ownership.',
    state: STATES.SETGROUPNFTCA,
    flagWhat: 'setNFTCA',
    alt: 2,
    processHandler: async (group, message) => {
        group.gateKeeping.nft = message.text;
    },
    prefix: 'gkca_nft_',
    actionKey: 'gateKeepSetNFTCA',
    callbackPrefix: 'gatekeep_',
    onCompleteCallback: async (message, group, targetMessageId) => {
        message.message_id = targetMessageId
        handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
    }
});

// Gatekeeping ticker setting handler
const gateTickerHandler = new GroupSettingHandler('groupChatId', {
    settingName: 'gateTicker',
    promptText: 'Tell me the Ticker we are gatekeeping with',
    description: 'This setting allows you to specify the ticker symbol for gatekeeping. It determines the access control based on ticker information.',
    state: STATES.SETGROUPTICKER,
    flagWhat: 'setTicker',
    alt: 2,
    processHandler: async (group, message) => {
        group.gateKeeping.ticker = message.text;
    },
    prefix: 'gkca_ticker_',
    actionKey: 'gateKeepSetTicker',
    callbackPrefix: 'gatekeep_',
    onCompleteCallback: async (message, group, targetMessageId) => {
        message.message_id = targetMessageId
        handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
    }
});

// Adjust prefix handler to handle different scenarios
prefixHandlers['gkca_'] = (action, message, user) => {
    const which = action.split('_')[1];
    const groupChatId = parseInt(action.split('_')[2]);
    gateCAHandler.groupChatId = groupChatId; // Set correct groupChatId dynamically
    gateCAHandler.showSettingPrompt(message, user);
};

// Register appropriate state handlers for each scenario
stateHandlers[STATES.SETGROUPNFTCA] = (message) => safeExecute(message, gateNFTCAHandler.processSettingInput.bind(gateNFTCAHandler));
stateHandlers[STATES.SETGROUPTOKENCA] = (message) => safeExecute(message, gateTokenCAHandler.processSettingInput.bind(gateTokenCAHandler));
stateHandlers[STATES.SETGROUPTICKER] = (message) => safeExecute(message, gateTickerHandler.processSettingInput.bind(gateTickerHandler));


/*
setting gate threshold,
*/
/*
setting the way the group settings interact with user ssettings and generations
*/

async function groupSettingsTypeMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId,'prompt_')
    //for this menu, we check the group gatekeeping type
    const style = group.settingsType
    menu.reply_markup.inline_keyboard.push([{text: style == 'pass' ? `pass ✅`:`pass`, callback_data: `sst_pass_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'some' ? `some ✅`:`some`, callback_data: `sst_some_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'total' ? `total ✅`:`total`, callback_data: `sst_total_${groupChatId}'}`}])
    //['none', 'token', 'nft', 'adminOnly', 'selectedOnly']
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: `${group.gateKeeping.ticker ? `${group.title}\nstationthisbot X $${group.gateKeeping.ticker}\nGatekeeping Menu` : `${group.title}\n$MS2 stationthisbot\nGatekeeping menu`}`
    })
    message.from.id = user;
    setUserState(message,STATES.IDLE)
}

async function groupSettingsTypeSelect(message,user,groupChatId,type) {
    const group = getGroupById(groupChatId)
    group.settingsType = type;
    //await groupGatekeepTypeMenu(message,user,groupChatId)
    await handleGroupMenu(message, message.from.id, group.chat.id,'prompt')
}

/*
setting custom command mapping
setting restricted commands
setting required words in prompts
setting custom assist gpt instruction
unlocking stuff by "burning" qoints
*/

prefixHandlers['ig_'] = (action, message, user) => handlePrefix(action, message, user, 'initializeGroup');
prefixHandlers['eg_'] = (action, message, user) => handlePrefix(action, message, user, 'backToGroupMenu');
prefixHandlers['peg_'] = (action, message, user) => handlePrefix(action, message, user, 'privateGroupMenu');
prefixHandlers['gatekeep_'] = (action, message, user) => handlePrefix(action, message, user, 'gateKeepMenu');
    function handlePrefix(action, message, user, actionKey) {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap[actionKey](message, user, groupChatId);
    }
    prefixHandlers['unlock_']=(action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['unlockMenu'](message,user,groupChatId)
    }
    prefixHandlers['gks_']= (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['gateKeepTypeMenu'](message,user,groupChatId)
    }
    prefixHandlers['sgks_']= (action, message, user) => {
        const type = action.split('_')[1];
        const groupChatId = parseInt(action.split('_')[2]);
        actionMap['gateKeepTypeSelect'](message,user,groupChatId,type)
    }
prefixHandlers['commands_'] = (action, message, user) => handlePrefix(action, message, user, 'commandsMenu');
prefixHandlers['prompts_'] = (action, message, user) => handlePrefix(action, message, user, 'promptsMenu');
    prefixHandlers['egpt_'] = (action, message, user) => handlePrefix(action, message, user, 'settingsTypeMenu');
    prefixHandlers['sst_']= (action, message, user) => {
        const type = action.split('_')[1];
        const groupChatId = parseInt(action.split('_')[2]);
        actionMap['groupSettingsTypeSelect'](message,user,groupChatId,type)
    }
actionMap['initializeGroup']= initializeGroup
    actionMap['privateGroupMenu']= privateGroupMenu
    actionMap['backToGroupMenu']= backToGroupSettingsMenu
    actionMap['gateKeepMenu']= groupGatekeepMenu 
        actionMap[ 'gateKeepTypeMenu'] = groupGatekeepTypeMenu 
            actionMap['gateKeepTypeSelect'] = groupGatekeepTypeSelect
            
            
    actionMap['commandsMenu']= groupCommandMenu
    actionMap['promptsMenu']= groupPromptMenu
        actionMap['settingsTypeMenu'] = groupSettingsTypeMenu
        actionMap['groupSettingsTypeSelect'] = groupSettingsTypeSelect
    actionMap['unlockMenu']= groupUnlockMenu


module.exports = {
    getGroup, getGroupById,
    groupMenu,
    backToGroupSettingsMenu,

    groupGatekeepMenu, 
        groupGatekeepTypeMenu, 
            groupGatekeepTypeSelect, //groupGatekeepSetCA, handleSetTick,
            //groupGatekeepSetGateLimit, handleSetGateLimit,
            //groupGatekeepSetGateMsg, handleSetGateMsg,

    groupCommandMenu,
    groupPromptMenu,
    groupUnlockMenu,

    initializeGroup
}