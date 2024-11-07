const { 
    sendMessage, setUserState, makeBaseData, 
    sendPrivateMessage,
    editMessage,
} = require('../../utils');
const { rooms, getBurned, lobby, STATES, getBotInstance } = require('../bot')
//const { features } = require('../../models/tokengatefeatures.js')
const { createRoom, writeData, writeBurnData } = require('../../../db/mongodb.js')
const { initialize } = require('../intitialize.js');
const iMenu = require('./iMenu');
const defaultUserData = require('../../users/defaultUserData.js');

function getGroup(message) {
    const group = rooms.find(group => group.chat.id == message.chat.id)
    return group;
}

function getGroupById(groupChatId) {
    const group = rooms.find(group => group.chat.id == groupChatId)
    return group;
}

// function groupSettings(message) {
//     baseData = makeBaseData(message,message.from.id);
//     const group = getGroup(message);
//     if(!group){
//         console.log('handling groupname','message',message.text)
//         handleGroupName(message);
//         console.log('exiting groupSettings')
//         return
//     }
//     let groupSettingsKeyboard = [
//         // [
//         //     {text: 'Edit Group', callback_data: 'editgroup'},
//         // ],
//         // [
//         //     {text: 'Apply Balance', callback_data: 'applygroupbalance'},
//         // ],
//         [],
//         [
//             {
//                 text: 'Chart', 
//                 url: 'https://www.dextools.io/app/en/solana/pair-explorer/3gwq3YqeBqgtSu1b3pAwdEsWc4jiLT8VpMEbBNY5cqkp?t=1719513335558'
//             },
//             {
//                 text: 'Buy',
//                 url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg'
//             },
//             {
//                 text: 'Charge',
//                 url: 'https://miladystation2.net/charge'
//             }
//         ]
//     ];

    
//     let groupSettingsInfo = '\n';
//     groupSettingsInfo += `<b>${group.name}</b> \n`;
//     //groupSettingsInfo += `<b>MS2 Burn Balance:</b> ${group.qoints}🎮\n`;
//     groupSettingsInfo += `<b>Points Remaining</b> ${group.qoints}\n`

//     // List locked features based on the user's balance
//     // const lockedFeatures = features.filter(feature => group.wallet < feature.gate);
//     // if (lockedFeatures.length > 0) {
//     //     groupSettingsInfo += `<b>Limited Access</b>\n`;
//     //     // lockedFeatures.forEach(feature => {
//     //     //     groupSettingsInfo += `<b>-</b> ${feature.gate} $MS2: ${feature.name}\n`;
//     //     // });
//     // } else {
//     //     groupSettingsInfo += `Full Access VIP GROUP\n`;
//     // }

//     // Send account settings menu with account information
//     sendMessage(message, groupSettingsInfo, {
//         parse_mode: 'HTML',
//         reply_markup: {
//             inline_keyboard: groupSettingsKeyboard
//         }
//     });
    
// }

// function handleGroupName(message) {
//     console.log('handling group name')
//     console.log(message)
//     const userId = message.from.id
//     lobby[userId].group = message.chat.title;
//     const burned = getBurned(userId)/2
//     const msg = `You have burned a total of ${burned} MS2, tell me how much you would like to apply to this group`
//     console.log('i would be saying this now'+msg)
//     sendMessage(message,msg)
//     setUserState(message, STATES.GROUPAPPLY)
//     console.log('now the user',userId,' state is ',lobby[userId].state)
// }

/*
Needs to be updated so anyone can request to 
*/

// async function handleApplyBalance(message) {
//     console.log('handling apply balance')
//     const burned = getBurned(message.from.id)/2;
//     const value = message.text;
//     const group = getGroup(message);
//     if (isNaN(value)) {
//         sendMessage(message, 'Please enter a valid integer');
//         return
//     }
//     console.log('value',value,'burned',burned)
//     if(parseInt(value) > burned || burned == undefined){
//         sendMessage(message,'Hey you never burned that much MS2 in ur life, try again')
//         return
//     }
//     if(parseInt(value) < 100000){
//         sendMessage(message,'yea thats not really worth it btw, try again')
//         return
//     }
//     if(group == undefined){
//         createGroup(message)
//         await writeBurnData(message.from.id,parseInt(value))
//         setUserState(message,STATES.IDLE)
//     } else {
//         if(group.owner == message.from.id || (group.admin.length > 0 && group.admin.includes(message.from.id))){
//             group.applied += parseInt(value)
//             await writeData('floorplan',{id: message.chat.id},{applied: group.applied})
//             await writeBurnData(message.from.id,parseInt(value))
//             sendMessage(message,'nice you just added some more burn to the pile')
//             setUserState(message,STATES.IDLE)
//         }
//     }
// }

// async function createGroup(message) {
//     console.log('creating group')
//         // Check if any room has an owner that matches the current message's owner
//         if (rooms.some(room => room.owner === message.from.id)) {
//             console.log('Owner already has a group');
//             sendMessage(message,'you are already group owner')
//             return; // Exit the function if the owner already has a group
//         }
//     const owner = message.from.id;
//     const chat = message.chat.id;
//     await createRoom(chat,owner,message.text);
//     await initialize();
//     //const group = rooms.find(group => group.id == message.chat.id)
//     setUserState(message,STATES.IDLE)
//     groupSettings(message);
// }

// async function toggleAdmin(message) {
//     const group = getGroup(message);
//     if(!group) return
//     if(message.from.id != group.owner || !group.admins.includes(message.from.id)) return
//     if(group && group.admins.length > 0
//         && group.admins.includes(message.reply_to_message.from.id)
//     ) {
//         group.admins = group.admins.filter(adminId => adminId !== message.reply_to_message.from.id);
//         react(message,'✍️');
//         //return; // Exit the function after removing the admin
//     } else {
//         group.admins.push(message.reply_to_message.from.id);
//         react(message,"💅");
//         //return
//     }
//     await writeData('floorplan',{id: message.chat.id},{admins: group.admins})
//     console.log('rewrote the room')
// }

/*

NEW GROUPCHAT SYSTEM

1. stationthis in teh groupchat
if you are an admin and the group isnt initialized, we give a button to initialize the group. that inititates

initializeGroup
if the user is the only admin or its not a super group, bot dms them directly. Gives them the group menu for the first time.
*/

// Function to handle the group initialization process
async function initializeGroup(message,user,groupChatId) {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    await editMessage({
        //reply_markup: replym,
        chat_id: chatId,
        message_id: messageId,
        text: '$ms2'
    })
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
3. restricted commands
4. base prompt

`;

        // DM the initializing admin instead of creating a new group chat
        //const adminUserId = adminUserIds[0];
        //const user_name = chatAdmins.filter(admin => admin.user.id)
        const instructions = `Hello ${chatAdmins[0].user.first_name},

Since this group requires configuration, we will do this via direct messages.
To access the menu again, use the /stationthis command again.

${commonInstructions}`;

        

        // Step 2: Create a default group configuration for the original group chat
        const defaultGroup = {
            chat: {
                id: groupChatId,
            },
            title: groupTitle,
            admins: adminUserIds,
            initialized: true,
            qoints: 0,
            burnedQoints: 0,
            
            allowCustomCommands: false,
            customCommandMap: {},

            // customKeyboard: [
            //     [{text: '/'}]
            // ]

            restrictedCommands: [],

            basePrompt: "",
            
            requiredWords: [],

            gateKeeping: {
                style: 'none',//['none', 'token', 'nft', 'adminOnly', 'selectedOnly']
                chain: 'sol', //'eth'
                token: '',
                nft: '',
                minBalance: 0,
                chosen: [],
            },

            settings: {
                ...defaultUserData
            }
        };
        
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
    await sendMessage(message,`${group.ticker ? `$MS2 X ${group.ticker}` : '$MS2'}`,iMenu.home)
    await sendPrivateMessage(message.from.id, message,`${group.ticker ? `$MS2 X ${group.ticker}` : '$MS2'}`,menu)
}

function buildGroupSettingsMenu(groupChatId) {
    const menu = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'unlock', callback_data: `unlock_${groupChatId}`}],
                [{ text: 'gatekeep', callback_data: `gatekeep_${groupChatId}`}],
                [{ text: 'commands', callback_data: `commands_${groupChatId}`}],
                [{ text: 'prompts', callback_data: `prompts_${groupChatId}`}]
            ]
        }
    }
    return menu;
}

function buildEditGroupSubMenu(groupChatId) {
    const subMenuScaffold = {
        reply_markup: {
            inline_keyboard: [
                [{text: '↖︎', callback_data: `eg_${groupChatId}`}]
            ]
        }    
    }
    return subMenuScaffold
}

async function groupGatekeepMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId)
    menu.reply_markup.inline_keyboard.push([{text: `gatekeep type ${group.gateKeeping.style}`, callback_data: `gks_${groupChatId}`}])
    if(group.gateKeeping.style == 'token' || group.gateKeeping.style == 'nft') {
        menu.reply_markup.inline_keyboard.push([{text: `set token`, callback_data: `gkca_${groupChatId}`}])
        menu.reply_markup.inline_keyboard.push([{text: `set gate`, callback_data: `gkmin_${groupChatId}`}])
    }
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: `${group.ticker ? `${group.title}\nstationthisbot X ${group.ticker}\nGatekeeping Menu` : `${group.title}\n$MS2 stationthisbot\nGatekeeping menu`}`
    })
}

async function groupCommandMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId)
    menu.reply_markup.inline_keyboard.push([{text: `custom commands`, callback_data: `egcc_${groupChatId}`}])
    menu.reply_markup.inline_keyboard.push([{text: `allowed commands`, callback_data: `egac_${groupChatId}`}])
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: `${group.ticker ? `${group.title}\nstationthisbot X ${group.ticker}\nCommands Menu` : `${group.title}\n$MS2 stationthisbot\nCommands menu`}`
    })
}

async function groupPromptMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId)
    menu.reply_markup.inline_keyboard.push([{text: `required words`, callback_data: `egrw_${groupChatId}`}])
    menu.reply_markup.inline_keyboard.push([{text: `assist instruction`, callback_data: `egai_${groupChatId}`}])
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: `${group.ticker ? `${group.title}\nstationthisbot X ${group.ticker}\nPrompts Menu` : `${group.title}\n$MS2 stationthisbot\nPrompts menu`}`
    })
}

async function groupUnlockMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId)

    //build unlock text
    //based on burnedQoints, show features yet to be unlocked and the price they can pay to unlock them
    //one time unlock for now, in the future, renting?

    // menu.reply_markup.inline_keyboard.push([{text: `required words`, callback_data: `egrw_${groupChatId}`}])
    // menu.reply_markup.inline_keyboard.push([{text: `assist instruction`, callback_data: `egai_${groupChatId}`}])
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        //text: `${group.ticker ? `${group.title}\nstationthisbot X ${group.ticker}\nPrompts Menu` : `${group.title}\n$MS2 stationthisbot\nPrompts menu`}`
    })
}

async function backToGroupSettingsMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const messageId = message.message_id;
    const chatId = message.chat.id;
    const options = buildGroupSettingsMenu(groupChatId)
    await editMessage({
        reply_markup: options.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: `${group.ticker ? `$MS2 X ${group.ticker}` : '$MS2'}`
    })
}


/*
layer 2 menus, menus within the submenu, doing things like 
changing the gatekeeping type,
*/
async function groupGatekeepTypeMenu(message,user,groupChatId) {
    const group = getGroupById(groupChatId)
    const chatId = message.chat.id
    const messageId = message.message_id
    const menu = buildEditGroupSubMenu(groupChatId)
    //for this menu, we check the group gatekeeping type
    const style = group.gateKeeping.style
    menu.reply_markup.inline_keyboard.push([{text: style == 'none' ? `none ✅`:`none`, callback_data: `sgks_none_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'token' ? `token ✅`:`token`, callback_data: `sgks_token_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'none' ? `none ✅`:`none`, callback_data: `sgks_none_${groupChatId}'}`}])
    menu.reply_markup.inline_keyboard.push([{text: style == 'none' ? `none ✅`:`none`, callback_data: `sgks_none_${groupChatId}'}`}])
    //['none', 'token', 'nft', 'adminOnly', 'selectedOnly']
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: `${group.ticker ? `${group.title}\nstationthisbot X ${group.ticker}\nGatekeeping Menu` : `${group.title}\n$MS2 stationthisbot\nGatekeeping menu`}`
    })
}
/*
setting token contract address,
setting gate threshold,
setting custom command mapping
setting restricted commands
setting required words in prompts
setting custom assist gpt instruction
unlocking stuff by "burning" qoints
*/



module.exports = {
    // groupSettings,
    // handleApplyBalance,
    // handleGroupName,
    getGroup,
    // createGroup,
    // toggleAdmin,
    groupMenu,
    backToGroupSettingsMenu,

    groupGatekeepMenu,
    groupCommandMenu,
    groupPromptMenu,
    groupUnlockMenu,

    initializeGroup
}