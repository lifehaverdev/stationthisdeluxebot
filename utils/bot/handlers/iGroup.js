const { 
    sendMessage, setUserState, 
    sendPrivateMessage,
    editMessage,
    safeExecute,
    updateMessage,
} = require('../../utils');
const { 
    stateHandlers,
    prefixHandlers, actionMap,
    rooms, lobby, STATES, getBotInstance ,
    getGroup, getGroupById,
} = require('../bot')
//const { features } = require('../../models/tokengatefeatures.js')
const { createRoom, writeData } = require('../../../db/mongodb.js')
//const { initialize } = require('../intitialize.js');
//const iMenu = require('./iMenu');
const defaultUserData = require('../../users/defaultUserData.js');

// Function to build a header for group settings messages
function buildGroupSettingsHeader(groupChatId, title) {
    const group = getGroupById(groupChatId);
    if (!group) {
        console.error(`Group with ID ${groupChatId} not found.`);
        return `Group not found\n${title}`;
    }
    if(group){
        return group.gateKeeping.ticker
        ? `${group.title}\nstationthisbot X $${group.gateKeeping.ticker}\n${title}`
        : `${group.title}\n$MS2 stationthisbot\n${title}`;
    } else {
        return ''
    }
    
}

const defaultGroupSchema = {
    chat: { id: null },
    title: "",
    admins: [],
    initialized: false,
    qoints: 0,
    burnedQoints: 0,
    allowCustomCommands: false,
    commandList: [],
    customCommandMap: {},
    restrictedCommandList: [],
    basePrompt: "",
    requiredWords: [],
    selectedLoras: [],
    gateKeeping: {
        style: 'none', //'select','nft','token','adminOnly'
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
    try {
        // Step 1: Create an admin groupchat
        // Extract chat ID from the callback query
        const groupTitle = message.chat.title;
        // Fetch administrators from the original group chat
        const bot = getBotInstance()
        const chatAdmins = await bot.getChatAdministrators(groupChatId);
        //console.log(chatAdmins)
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
        const instructions = `Hello ${'admin'},

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
        rooms.push(defaultGroup);
        const menu = buildGroupSettingsMenu(groupChatId)
        //await sendPrivateMessage(user, message, instructions, buildGroupSettingsMenu(groupChatId));
        await updateMessage(message.chat.id,message.message_id,menu,instructions)

    } catch (error) {
        console.error("Error initializing group: ", error);
        // Send an error message to the user
        
        await sendPrivateMessage(user, message, "An error occurred while initializing the group. Please try again later.");
    }
}

async function groupMenu(message) {
    const group = getGroup(message)
    if(!group){
        console.log('no group')
        await sendMessage(message,'oops sometinng wong')
        return 
    }
    const menu = buildGroupSettingsMenu(message.chat.id)
    //console.log(group)
    await sendMessage(message,`${group.gateKeeping.ticker ? `$MS2 X $${group.gateKeeping.ticker}` : '$MS2'}`,menu)
}

async function privateGroupMenu(message, user, groupChatId) {
    const group = getGroupById(groupChatId)
    if(!group) {
        sendMessage(message,'oh noooooo. sorry i ... well. sorry.')
    }
    const bot = getBotInstance()
    await bot.deleteMessage(message.chat.id, message.message_id)
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
            ////console.log('menu',menu)
    const group = getGroupById(groupChatId)
    if(!group){
        //console.log('not gorup')
        return {reply_markup: {inlineKeyboard: []}}
    }
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
    let text = '↖︎💾'
    if(target){
        console.log('we have target',target)
        callback = target
        text = '↖︎'
    }
    const subMenuScaffold = generateInlineKeyboard([[{text, callback_data: `${callback}${groupChatId}`}]])
    return subMenuScaffold
}

async function handleGroupMenu(message, user, groupChatId, menuType) {
    const group = getGroupById(groupChatId);
    if(!group){
        return
    }
    let menu = buildEditGroupSubMenu(groupChatId);
    switch (menuType) {
        case 'gatekeep':
            menu.reply_markup.inline_keyboard.push([{ text: `🚪 set gatekeep type: ${group.gateKeeping.style} 🪟`, callback_data: `gks_${groupChatId}` }]);
            if (group.gateKeeping.style === 'token' || group.gateKeeping.style === 'nft') {
                menu.reply_markup.inline_keyboard.push([{ text: `set ca 🪙`, callback_data: `gkca_${group.gateKeeping.style}_${groupChatId}` }]);
                menu.reply_markup.inline_keyboard.push([{ text: `set gate 🧮`, callback_data: `gkmin_${groupChatId}` }]);
            }
            if (group.gateKeeping.style == 'adminOnly') {
                menu.reply_markup.inline_keyboard.push([{ text: 'refresh 🔄 admin', callback_data: `refreshAdmin_${groupChatId}`}])
            }
            menu.reply_markup.inline_keyboard.push([{ text: `set gate message 🛃`, callback_data: `gkmsg_${groupChatId}` }]);
            menu.reply_markup.inline_keyboard.push([{ text: `set point accounting 🧾`, callback_data: `gkpa_${groupChatId}` }]);
            menu.reply_markup.inline_keyboard.push([{ text: `set ticker 📈`, callback_data: `gktick_${groupChatId}`}])
            break;

        case 'command':
            menu.reply_markup.inline_keyboard.push([{ text: `☑️ command list 🗯️`, callback_data: `gcommandlist_1_${groupChatId}` }]);
            menu.reply_markup.inline_keyboard.push([{ text: `🆒 custom commands 🆗`, callback_data: `egcc_${groupChatId}` }]);
            
            break;

        case 'prompt':
            menu.reply_markup.inline_keyboard.push([{ text: `🌡️ group param type: ${group.settingsType} 🧪`, callback_data: `egpt_${groupChatId}`}])
            if (group.settingsType === 'some') {
                menu.reply_markup.inline_keyboard.push([{ text: ` set overwrites `, callback_data: `egso_${groupChatId}` }]);
            }
            //menu.reply_markup.inline_keyboard.push([{ text: `📧 required words 🔫`, callback_data: `egrw_${groupChatId}` }]);
            //menu.reply_markup.inline_keyboard.push([{ text: `🧠 assist instruction 👩🏼‍🏫`, callback_data: `egai_${groupChatId}` }]);
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
    if(!group){
        return
    }
    await saveGroupRQ(group)
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
    if(!group){
        return
    }
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
    if(!group){
        return 
    }
    group.gateKeeping.style = type;
    //await groupGatekeepTypeMenu(message,user,groupChatId)
    await handleGroupMenu(message, message.from.id, group.chat.id, 'gatekeep')
}

/*
changing point accounting style
*/
async function groupPointAccountingTypeMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    if(!group){
        return
    }
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId,'gatekeep_')
    //for this menu, we check the group gatekeeping type
    const style = group.gateKeeping.pointAccounting
    menu.reply_markup.inline_keyboard.push([{text: style == 'ghost' ? `none ✅`:`none`, callback_data: `sgkpa_ghost_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'house' ? `on the house ✅`:`on the house`, callback_data: `sgkpa_house_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'user' ? `user first ✅`:`user first`, callback_data: `sgkpa_user_${groupChatId}'}`}])
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


async function groupGatekeepPointAccountingSelect(message,user,groupChatId,type) {
    const group = getGroupById(groupChatId)
    if(!group){
        return 
    }
    group.gateKeeping.pointAccounting = type;
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
        const group = getGroupById(this.groupChatId)
        if(!group){
            return 
        }
        const menu = buildEditGroupSubMenu(this.groupChatId, this.callbackPrefix);
        message.from.id = user;

        setUserState(message, this.state);
        group.flag = {
            what: this.flagWhat,
            user,
            targetMessageId: message.message_id, // Store the original message ID to return to later
        };
        console.log('group after adding a flag',group)

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
        //console.log(rooms)
        const group = rooms.find(group => group.flag && typeof group.flag.user !== 'undefined' && group.flag.user.toString() === message.from.id.toString());
        if (group && group.flag.what === this.flagWhat) {
            // Call the specific handler for processing input
            await this.processHandler(group, message);

            saveGroupRQ(group)
            setUserState(message, STATES.IDLE);
            
            console.log('processsettinginput innit',this.flagWhat, group)
            // Activate the callback to return to the original menu
            if (this.onCompleteCallback) {
                await this.onCompleteCallback(message, group, group.flag.targetMessageId);
            }
            delete group.flag;
        }
    }
}

async function saveGroupRQ(group) {
    console.log('...saving group')
    const { _id, flag, ...dataToSave } = group; // Isolate out _id
    try {
        await writeData('floorplan', { id: group.chat.id }, dataToSave);
        return true
    } catch(err) {
        return false
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
    const menu = buildEditGroupSubMenu(groupChatId,'prompts_')
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
    if(!group){
        return
    }
    group.settingsType = type;
    //await groupGatekeepTypeMenu(message,user,groupChatId)
    await handleGroupMenu(message, message.from.id, group.chat.id,'prompt')
}

async function mustHavesMenu(message,user,groupChatId) {
    const header = buildGroupSettingsHeader(groupChatId, 'Group Param Overwrites')
    const info = 'toggle which group settings overwrite user settings when generations take place in the groupchat. The user settings are modified by admins in the groupchat using the /set command.'
    const mustHaveKeyboard = buildMustHaveKeyboard(groupChatId)
    updateMessage(message.chat.id,message.message_id,mustHaveKeyboard,
        `${header}\n\n${lobby[user] && lobby[user].advancedUser ? '': info}\n`
    )
}

function buildMustHaveKeyboard(groupChatId) {
    const group = getGroupById(groupChatId)
    if(!group){
        return
    }
    const mustHaves = group.settingsMusts
    const isMust = (key) => {
        if(mustHaves.includes(key)){
            return '✅'
        } else {
            return '⭕️'
        }
    }
    const menu = buildEditGroupSubMenu(groupChatId, 'prompts_')
    menu.reply_markup.inline_keyboard.push(
        [
            { text: `batch ${isMust('input_batch')}`, callback_data: `egmh_input_batch_${groupChatId}` },
            { text: `size ${isMust('size')}`, callback_data: `egmh_size_${groupChatId}` },
            { text: `steps ${isMust('input_steps')}`, callback_data: `egmh_input_steps_${groupChatId}` }
        ]
    )
    menu.reply_markup.inline_keyboard.push(
        [
            { text: `control ${isMust('controlNet')}`, callback_data: `egmh_controlNet_${groupChatId}` },
            { text: `style ${isMust('styleTransfer')}`, callback_data: `egmh_styleTransfer_${groupChatId}` },
            { text: `pose ${isMust('openPose')}`, callback_data: `egmh_openPose_${groupChatId}` }
        ]
    )
    menu.reply_markup.inline_keyboard.push(
        [
            { text: `cfg ${isMust('input_cfg')}`, callback_data: `egmh_input_cfg_${groupChatId}` },
            { text: `strength ${isMust('input_strength')}`, callback_data: `egmh_input_strength_${groupChatId}` },
            { text: `seed ${isMust('input_seed')}`, callback_data: `egmh_input_seed_${groupChatId}`}
        ]
    )
    menu.reply_markup.inline_keyboard.push(
        [
            { text: `base prompt ${isMust('basePrompt')}`, callback_data: `egmh_basePrompt_${groupChatId}` },
            { text: `checkpoint ${isMust('input_checkpoint')}`, callback_data: `egmh_input_checkpoint_${groupChatId}` }
        ]
    )
    menu.reply_markup.inline_keyboard.push(
        [
            { text: 'cancel', callback_data: 'cancel' }
        ]
    )
    menu.reply_markup.resize_keyboard = true

    return menu;
}

async function mustHaveSelect(message,user,groupChatId,mustHave) {
    const group = getGroupById(groupChatId)
    if(!group){
        return
    }
    //console.log('we are pushing', mustHave)
    group.settingsMusts.push(mustHave)
    //await groupGatekeepTypeMenu(message,user,groupChatId)
    await mustHavesMenu(message,user,groupChatId)
}

/*
setting custom command mapping
setting restricted commands
*/

// &&&&&&&&&&&&&&& //
//GROUP COMMAND LIST
/////////////////////

prefixHandlers['gcommandlist_'] = (action,message,user) => {
    const page = parseInt(action.split('_')[1]);
    const groupChatId = parseInt(action.split('_')[2])
    actionMap['gCommandMenu'](message, page, user, groupChatId);
}
actionMap['gCommandMenu'] = groupCommandListMenu

async function groupCommandListMenu(message, page, user, groupChatId) {
    const group = getGroupById(groupChatId)
    if(!group){
        console.log('we didnt see a group in groupCommandListMenu',rooms)
        return
    }
    const commandKeyboard = buildGCommandListMenu(message, page, group);
    //const groupInfo = buildUserProfile(message, message.chat.id > 0);
    const messageId = message.message_id;
    const chatId = message.chat.id;
    await editMessage({
        reply_markup: { 
            inline_keyboard: commandKeyboard,
        },
        chat_id: chatId,
        message_id: messageId,
        text: 'set group command list',
        options: { parse_mode: 'HTML' }
    })
}

// Function 1: buildCommandListMenu
// This function will iterate over the user's command list and generate the menu UI
function buildGCommandListMenu(message, page = 1, group, pageSize = 5) {
    // Combine user command list with commands not used from the fullCommandList
    const groupCommands = group.commandList;
    const unusedCommands = fullCommandList.filter(cmd => !groupCommands.some(groupCmd => groupCmd.command === cmd.command));
    const combinedCommandList = [...groupCommands, ...unusedCommands];

    const totalPages = Math.ceil(combinedCommandList.length / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, combinedCommandList.length);
    
    // Create buttons for commands in the current page
    let menuButtons = [];
    for (let i = startIndex; i < endIndex; i++) {
        const command = combinedCommandList[i];
        const commandButtons = buildGCommandButtons(group, command, i);
        menuButtons.push(...commandButtons);
    }
    
    // Add navigation buttons for pagination if needed
    if (page > 1 && page < totalPages) {
        menuButtons.push([
            { text: '←', callback_data: `gcommandlist_${page - 1}_${group.chat.id}` },
            { text: '→', callback_data: `gcommandlist_${page + 1}_${group.chat.id}` }
        ]);
    } else if (page == 1) {
        menuButtons.push([{ text: '→', callback_data: `gcommandlist_${page + 1}_${group.chat.id}` }]);
    } else if (page == totalPages) {
        menuButtons.push([{ text: '←', callback_data: `gcommandlist_${page - 1}_${group.chat.id}` }])
    }

    menuButtons.push([{text: 'nvm', callback_data: 'cancel'},{text: '💾', callback_data: `saveGCommandList_${group.chat.id}`}])
    return menuButtons;
}
prefixHandlers['saveGCommandList_'] = (action, message, user) => {
    const groupChatId = parseInt(action.split('_')[1]);
    actionMap['saveGroupCommandList'](message,user,groupChatId)
}

actionMap['saveGroupCommandList'] = async (message, user, groupChatId) => {
    const group = getGroupById(groupChatId)
    if(!group){
        return
    }
    await saveGroupRQ(group)
    await handleGroupMenu(message, message.from.id, group.chat.id,'command')
}

// Function 2: buildCommandButtons
// This function generates buttons for each command, allowing users to enable/disable, move, or delete them
function buildGCommandButtons(group, command, index) {
    let buttons = [];
    const groupChatId = group.chat.id
    // Add the command label
    buttons.push([{ text: command.command, callback_data: `noop` }]);
    
    // Add enable/disable and movement buttons in a separate row
    const isEnabled = group.commandList.some(cmd => cmd.command.trim().toLowerCase() === command.command.trim().toLowerCase());
    const isRestricted = group.restrictedCommandList.some(cmd => cmd.command.trim().toLowerCase() === command.command.trim().toLowerCase())
    let actionButtons = [];
    if (isEnabled) {
        buttons[0].push({ text: '🗑️', callback_data: `gremove_command_${index}_${groupChatId}` });
    } else {
        buttons[0].push({ text: '➕', callback_data: `gadd_command_${index}_${groupChatId}` });
    }
    if (!isRestricted) {
        buttons[0].push({ text: '🆗', callback_data: `grestrict_command_${index}_${groupChatId}` });
    } else {
        buttons[0].push({ text: '🚷', callback_data: `gauthorize_command_${index}_${groupChatId}` });
    }
    if (index > 0 && isEnabled) {
        actionButtons.push({ text: '⬆️', callback_data: `gmove_up_${index}_${groupChatId}` });
    }
    if (index <= group.commandList.length - 1 && isEnabled) {
        actionButtons.push({ text: '⬇️', callback_data: `gmove_down_${index}_${groupChatId}` });
        actionButtons.push({ text: '⏫', callback_data: `gmove_top_${index}_${groupChatId}` });
    }
    buttons.push(actionButtons);
    return buttons;
}

const handleGroupCommandPrefix = (action, message, user) => {
    const index = parseInt(action.split('_')[2]);
    const command = action.split('_').slice(0,2).join('_');
    const groupChatId = parseInt(action.split('_')[3])
    console.log('handle prefix command index',command,index)
    actionMap['editGCommandList'](message, user, index, command, groupChatId);
} 

prefixHandlers['gmove_up_'] = (action,message,user) => handleGroupCommandPrefix(action,message,user)
prefixHandlers['gadd_command_']= (action,message,user) => handleGroupCommandPrefix(action,message,user)
prefixHandlers['gremove_command_']= (action,message,user) => handleGroupCommandPrefix(action,message,user)
prefixHandlers['grestrict_command_']= (action,message,user) => handleGroupCommandPrefix(action,message,user)
prefixHandlers['gauthorize_command_']= (action,message,user) => handleGroupCommandPrefix(action,message,user)
prefixHandlers['gmove_top_']= (action,message,user) => handleGroupCommandPrefix(action,message,user)
prefixHandlers['gmode_down_']= (action,message,user) => handleGroupCommandPrefix(action,message,user)

actionMap['editGCommandList'] = handleCommandListEdit
// Function 3: handleCommandListEdit
// This function handles editing the user's command list based on the given command
function handleCommandListEdit(message, user, index, command, groupChatId) {
    // Combine user command list with commands not used from the fullCommandList
    const group = getGroupById(groupChatId)
    if(!group){
        return
    }
    const userCommands = group.commandList;
    const unusedCommands = fullCommandList.filter(cmd => !userCommands.some(groupCmd => groupCmd.command === cmd.command));
    const combinedCommandList = [...userCommands, ...unusedCommands];

    switch (command) {
        case 'gmove_down':
            if (index < userCommands.length - 1) {
                [userCommands[index], userCommands[index + 1]] = [userCommands[index + 1], userCommands[index]];
            }
            break;
        case 'gmove_up':
            if (index > 0) {
                [userCommands[index], userCommands[index - 1]] = [userCommands[index - 1], userCommands[index]];
            }
            break;
        case 'gmove_top':
            if (index > 0) {
                const [movedCommand] = userCommands.splice(index, 1);
                userCommands.unshift(movedCommand);
            }
            break;
        case 'gremove_command':
            if (index < userCommands.length) {
                const [removedCommand] = userCommands.splice(index, 1);
                unusedCommands.push(removedCommand);
            }
            break;
        case 'gadd_command':
            if (index >= userCommands.length) {
                const addedCommand = combinedCommandList[index];
                userCommands.push(addedCommand);
            }
            break;
        case 'grestrict_command':
            console.log('we restrict here')
            if (index < userCommands.length) {
                const [removedCommand] = userCommands.splice(index, 1);
                unusedCommands.push(removedCommand);
            }
            // Add to restrictedCommandList if it's not already present
            const removedCommand = combinedCommandList[index];
            if (!group.restrictedCommandList.some(cmd => cmd.command === removedCommand.command) && removedCommand.command != 'stationthis') {
                group.restrictedCommandList.push(removedCommand);
                console.log(`Command restricted: ${JSON.stringify(removedCommand)}. Restricted commands: ${JSON.stringify(group.restrictedCommandList)}`);
            }
            break;
        case 'gauthorize_command':
            if (index >= userCommands.length) {
                const addedCommand = combinedCommandList[index];
                userCommands.push(addedCommand);
                // Remove from restrictedCommandList
                group.restrictedCommandList = group.restrictedCommandList.filter(t => t.command !== addedCommand.command);
                console.log(`Command authorized: ${JSON.stringify(addedCommand)}. Restricted commands after authorization: ${JSON.stringify(group.restrictedCommandList)}`);
            }
            break;
        default:
            console.error('Unknown command:', command);
    }

    // Update the lobby with the modified command list
    group.commandList = userCommands;

    // Refresh the command list menu
    groupCommandListMenu(message, 1, user, groupChatId);
}

/*
setting custom commands
*/


prefixHandlers['egcc_'] = (action,message,user) => {
    const groupChatId = parseInt(action.split('_')[1])
    actionMap['gcustomComMenu'](message, user, groupChatId);
}
actionMap['gcustomComMenu'] = groupCustomCommandMenu

async function groupCustomCommandMenu(message, user, groupChatId) {
    const group = getGroupById(groupChatId);
    if (!group) {
        console.log('we didnt see a group in groupCommandListMenu', rooms);
        return;
    }
    const customCommandMap = group.customCommandMap;

    const commandKeyboard = await buildCustomComMenu(message, group);
    const messageId = message.message_id;
    const chatId = message.chat.id;
    await editMessage({
        reply_markup: { 
            inline_keyboard: commandKeyboard,
        },
        chat_id: chatId,
        message_id: messageId,
        text: 'set group custom command list',
        options: { parse_mode: 'HTML' }
    });
}

async function buildCustomComMenu(message, group) {
    const customCommandMap = group.customCommandMap;
    const commandKeyboard = [];

    // Iterate over customCommandMap to create buttons for each entry
    for (const [commandName, commandDetails] of Object.entries(customCommandMap)) {
        commandKeyboard.push([
            {
                text: commandName,
                callback_data: `gcustomcom_${commandName}_${group.id}`
            },
            {
                text: '🗑️',
                callback_data: `gcustomcom_remove_${commandName}_${group.id}`
            }
    ]);
    }

    // Add + button and nvm button
    commandKeyboard.push([
        {
            text: 'nvm',
            callback_data: 'cancel'
        },
        {
            text: '+',
            callback_data: `gcustomcom_add_${group.id}`
        }
    ]);
    //console.log(JSON.stringify(commandKeyboard))
    return commandKeyboard;
}

prefixHandlers['gcustomcom_'] = (action,message,user) => {
    console.log('here we are')
    const task = action.split('_')[1];
    let which = 2;
    if(task == 'remove'){
        which = 3
    }
    const groupChatId = parseInt(action.split('_')[which])
    console.log('doing this',task, groupChatId, which)
    if(which == 2){
        actionMap['gcustomComTaskMenu'](message, user, task, groupChatId);
    } else if (which == 3){
        const command = action.split('_')[2]
        console.log('command',command)
        actionMap['gcustomComTaskMenu'](message, user, task, groupChatId, command);
    }
    
}

actionMap['gcustomComTaskMenu'] = groupCustomCommandTaskMenu


async function groupCustomCommandTaskMenu(message, user, task, groupChatId, command = null) {
    const group = getGroupById(groupChatId);
    if (!group) {
        console.log('Group not found in groupCustomCommandTaskMenu', rooms);
        return;
    }

    if (task === 'add') {
        await showAddCommandMenu(message, group);
    } else if (task === 'remove') {
        await removeCustomCommand(message, group, command);
    }
    //  else {
    //     const customCommandMap = group.customCommandMap;
    //     if (customCommandMap[task]) {
    //         await showCustomCommandInstanceMenu(message, group, task);
    //     } else {
    //         console.log('Custom command not found:', task);
    //     }
    // }
}
async function showAddCommandMenu(message, group) {
    // Commands to exclude from the menu
    const excludedCommands = ['signin', 'signout', 'resetaccount', 'seesettings'];

    // Filter the fullCommandList to remove excluded commands
    const filteredCommandList = fullCommandList.filter(command => !excludedCommands.includes(command.command));

    // Map the filtered list to create the keyboard buttons
    const commandKeyboard = filteredCommandList.map(command => [{
        text: command.command,
        callback_data: `gcctarget_${command.command}_${group.id}`
    }]);

    commandKeyboard.push([
        {
            text: 'nvm',
            callback_data: 'cancel'
        }
    ]);

    const messageId = message.message_id;
    const chatId = message.chat.id;
    await editMessage({
        reply_markup: {
            inline_keyboard: commandKeyboard,
        },
        chat_id: chatId,
        message_id: messageId,
        text: 'Choose which command you want to rename for your group. For example, if you choose make and set it to bake. You will say /bake + prompt. And so on.',
        options: { parse_mode: 'HTML' }
    });
}


prefixHandlers['gcctarget_'] = (action,message,user) => {
    const command = action.split('_')[1]
    const groupChatId = parseInt(action.split('_')[2])
    console.log(command, groupChatId)
    actionMap['gcustomComSet'](message, user, command, groupChatId);
}

actionMap['gcustomComSet'] = groupCustomCommandSet

async function groupCustomCommandSet(message,user,command,groupChatId){
// Show the setting prompt to the user
console.log('oh yea')
    const group = getGroupById(groupChatId)
    if(!group){
        return 
    }
    const menu = buildEditGroupSubMenu(groupChatId, 'commands_');

    setUserState({...message,from: {id: user}}, STATES.SETGROUPCUSTCOM);
    group.flag = {
        what: 'setCustCom',
        who: command,
        user,
        targetMessageId: message.message_id, // Store the original message ID to return to later
    };
    console.log('group after adding a flag',group)
    const promptText = 'tell me what you want this new command to be instead of the old one you just chose'
    const description = 'For example if you are overwriting /make with /bake you tell me bake, then from now on you can use /bake + prompt in this groupchat and make will not work'
    // Determine whether to include the description based on user type
    const userId = message.from.id;
    const userIsAdvanced = lobby[userId]?.advancedUser;
    const descriptionText = userIsAdvanced && description ? `\n\n${description}` : '';

    // Update the message to prompt user for the setting
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: `${lobby[userId] && lobby[userId].advancedUser ? `${group.title}\nstationthisbot X $${group.gateKeeping.ticker}` : `${group.title}\n$MS2 stationthisbot`}\n${descriptionText}\n\n${promptText}`
    });
}

stateHandlers[STATES.SETGROUPCUSTCOM] = handleSetCustCom

async function handleSetCustCom(message) {
    //console.log(rooms)
    const group = rooms.find(
        group => group.flag && 
        typeof group.flag.user !== 'undefined' && 
        group.flag.user.toString() === message.from.id.toString()
    );
    if (group && group.flag.what === 'setCustCom') {
        // Call the specific handler for processing input
        console.log(group.flag)
        const commandEntry = fullCommandList.find(cmd => cmd.command === group.flag.who);
        if (commandEntry) {
            group.commandList.push({ command: message.text, description: commandEntry.description });
        } else {
            return
        }
        group.customCommandMap[message.text] = group.flag.who
        
        saveGroupRQ(group)
        setUserState(message, STATES.IDLE);
        
        console.log('processsettinginput innit','setCustCom', group)
        // Activate the callback to return to the original menu
        
        message.message_id = group.flag.targetMessageId
        await groupCustomCommandMenu(message,message.from.id,group.id)
        
        delete group.flag;
    }
}

async function removeCustomCommand(message, group, commandName) {
    console.log(`Removing custom command: ${commandName} from group: ${group.id}`);

    // Remove the custom command from commandList
    group.commandList = group.commandList.filter(cmd => cmd.command !== commandName);

    // Remove the custom command from customCommandMap
    delete group.customCommandMap[commandName];

    // Save the group state after removing the command
    saveGroupRQ(group);

    // Set user state to idle after removal
    setUserState(message, STATES.IDLE);

    // Optionally, navigate back to the command menu
    message.message_id = group.flag?.targetMessageId || message.message_id; // Use the existing message ID if available
    await groupCustomCommandMenu(message, message.from.id, group.id);
}

/*
setting required words in prompts
*/
/*
setting custom assist gpt instruction
unlocking stuff by "burning" qoints
*/

function handlePrefix(action, message, user, actionKey) {
    const groupChatId = parseInt(action.split('_')[1]);
    actionMap[actionKey](message, user, groupChatId);
}

prefixHandlers['ig_'] = (action, message, user) => handlePrefix(action, message, user, 'initializeGroup');
prefixHandlers['eg_'] = (action, message, user) => handlePrefix(action, message, user, 'backToGroupMenu');
prefixHandlers['peg_'] = (action, message, user) => handlePrefix(action, message, user, 'privateGroupMenu');
prefixHandlers['gatekeep_'] = (action, message, user) => handlePrefix(action, message, user, 'gateKeepMenu');
    
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
    prefixHandlers['gkpa_']= (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        actionMap['groupPointAccountingTypeMenu'](message,user,groupChatId)
    }
        prefixHandlers['sgkpa_']= (action, message, user) => {
            const type = action.split('_')[1];
            const groupChatId = parseInt(action.split('_')[2]);
            actionMap['gateKeepPointAccountingSelect'](message,user,groupChatId,type)
        }
    prefixHandlers['refreshAdmin_'] = async (action, message, user) => {
        const groupChatId = parseInt(action.split('_')[1]);
        const group = getGroupById(groupChatId)
        if(!group){
            return
        }
        const bot = getBotInstance()
        const admins = await bot.getChatAdministrators(groupChatId)
        const adminUserIds = admins.filter(admin => admin.user.is_bot == false).map(admin => admin.user.id);
        group.admins = adminUserIds;
        console.log(group)
        handlePrefix(action, message, user, 'gateKeepMenu')
    }
prefixHandlers['commands_'] = (action, message, user) => handlePrefix(action, message, user, 'commandsMenu');
prefixHandlers['prompts_'] = (action, message, user) => handlePrefix(action, message, user, 'promptsMenu');
    prefixHandlers['egpt_'] = (action, message, user) => handlePrefix(action, message, user, 'settingsTypeMenu');
    prefixHandlers['sst_']= (action, message, user) => {
        const type = action.split('_')[1];
        const groupChatId = parseInt(action.split('_')[2]);
        actionMap['groupSettingsTypeSelect'](message,user,groupChatId,type)
    }
    prefixHandlers['egso_'] =  (action, message, user) => handlePrefix(action, message, user, 'mustHavesMenu');
    prefixHandlers['egmh_'] = (action, message, user) => {
        const read = action.split('_');
        const groupChatId = parseInt(read[read.length - 1]);
        const thing = read.slice(1, read.length - 1).join('_'); // Extract the dynamic part between prefix and groupChatId
        actionMap['mustHaveSelect'](message, user, groupChatId, thing);
    };
actionMap['initializeGroup']= initializeGroup
    actionMap['privateGroupMenu']= privateGroupMenu
    actionMap['backToGroupMenu']= backToGroupSettingsMenu
    actionMap['gateKeepMenu']= groupGatekeepMenu 
        actionMap[ 'gateKeepTypeMenu'] = groupGatekeepTypeMenu 
            actionMap['gateKeepTypeSelect'] = groupGatekeepTypeSelect
        actionMap['groupPointAccountingTypeMenu'] = groupPointAccountingTypeMenu
            actionMap['gateKeepPointAccountingSelect'] = groupGatekeepPointAccountingSelect
            
    actionMap['commandsMenu']= groupCommandMenu
    actionMap['promptsMenu']= groupPromptMenu
        actionMap['settingsTypeMenu'] = groupSettingsTypeMenu
        actionMap['groupSettingsTypeSelect'] = groupSettingsTypeSelect
        actionMap['mustHavesMenu'] = mustHavesMenu
        actionMap['mustHaveSelect'] = mustHaveSelect
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