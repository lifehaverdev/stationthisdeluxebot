const { getBotInstance, lobby, rooms, STATES, startup, getBurned, getNextPeriodTime ,
    actionMap,
    prefixHandlers
} = require('../bot'); 
const bot = getBotInstance()
const { 
    writeUserData, writeQoints, writeNewUserData,
    getUserDataByUserId, writeData,  getUsersByWallet, 
    writeUserDataPoint
} = require('../../../db/mongodb')
const { 
    sendMessage, editMessage, setUserState, safeExecute, makeBaseData, compactSerialize, DEV_DMS ,
    fullCommandList
} = require('../../utils')
const { checkLobby, lobbyManager, NOCOINERSTARTER, POINTMULTI, LOBBY_CLEAN_MINUTE, LOBBY_CLEAN_INTERVAL, lastCleanTime } = require('../gatekeep')
const { verifyHash } = require('../../users/verify.js')
const { signedOut } = require('../../models/userKeyboards.js')
const { features } = require('../../models/tokengatefeatures.js')
const defaultUserData = require('../../users/defaultUserData.js')
const { getGroup } = require('./iGroup')
const { home } = require("./iMenu")
/*
Let's upgrade protection
Cull mutliple userids on same wallet address
Cull multiple addresses same userId?
Website route?
*/

function displayAccountSettingsMenu(message, dms) {
    const userId = message.from.id;
    const accountSettingsKeyboard = buildAccountSettingsKeyboard(userId);
    const accountInfo = buildUserProfile(message, dms);

    sendMessage(message, accountInfo, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: accountSettingsKeyboard
        }
    });
}

async function returnToAccountMenu(message, user) {
    const userId = user;
    const accountSettingsKeyboard = buildAccountSettingsKeyboard(userId);
    const accountInfo = buildUserProfile(message, message.chat.id > 0);
    const messageId = message.message_id;
    const chatId = message.chat.id;
    //console.log('message: ',message)
    await editMessage({
        reply_markup: { 
            inline_keyboard: accountSettingsKeyboard,
        },
        chat_id: chatId,
        message_id: messageId,
        text: accountInfo,
        options: { parse_mode: 'HTML' }
    })
}

function buildAccountSettingsKeyboard(userId) {
    return [
        [
           { text: '🔄', callback_data: 'refreshQoints' }
        ],
        [
            {text: 'Settings ⚙️', callback_data: 'preferencesMenu'}
        ],
        [
            { text: 'Create 👩‍🎨🖼️🏭', callback_data: 'collectionModeMenu' },
        ],
        [
            { text: 'Train 🚂🦾🧠', callback_data: 'trainingMenu' },
        ],
        [
            { text: 'nvm', callback_data: 'cancel' }
        ],
    ];
}

actionMap['preferencesMenu'] = accountPreferencesMenu

async function accountPreferencesMenu(message, user) {
    const userId = user;
    const preferencesKeyboard = buildPreferencesKeyboard(userId);
    const accountInfo = buildUserProfile(message, message.chat.id > 0);
    const messageId = message.message_id;
    const chatId = message.chat.id;
    //console.log('message: ',message)
    await editMessage({
        reply_markup: { 
            inline_keyboard: preferencesKeyboard,
        },
        chat_id: chatId,
        message_id: messageId,
        text: accountInfo,
        options: { parse_mode: 'HTML' }
    })
}

function buildPreferencesKeyboard(userId) {
    if(!lobby[userId].hasOwnProperty('customFileNames')){
        lobby[userId].customFileNames = false;
    }
    return [
        [
            {
                text: 'Commands', callback_data: 'commandlist_1'
            }
        ],
        [
            {
                text: `Emoji buttons: ${lobby[userId].advancedUser ? '✅' : '❌'}`,
                callback_data: 'toggleAdvancedUser',
            },
            {
                text: `Custom File names: ${lobby[userId].customFileNames ? '✅' : '❌'}`,
                callback_data: 'toggleCustomFileNames',
            }
        ],
    ]
}
actionMap['toggleAdvancedUser']= async (message, user) => {
    if(!lobby[user].advancedUser){
        lobby[user].advancedUser = true;
    } else {
        lobby[user].advancedUser = false;
    }
    accountPreferencesMenu(message, user);
}

actionMap['toggleCustomFileNames'] = async (message, user) => {
    lobby[user].customFileNames = !lobby[user].customFileNames;
    // accountPreferencesMenu(message, user);
    sendMessage(message, `what is a fallback file name you'd like to use if you don't include one inline?`)
    setUserState({...message, chat: {id: message.chat.id}, from: {id: user}}, STATES.CUSTOMFILENAME)
}

async function customFileName(message) {
    const user = message.from.id;
    // Clean the filename - remove special chars except alphanumeric and dashes
    const cleanFileName = message.text.trim().replace(/[^a-zA-Z0-9-]/g, '');
    
    if (!cleanFileName) {
        // If filename is empty after cleaning, send error message
        sendMessage(message, 'Please provide a valid filename using only letters, numbers and dashes.');
        return;
    }

    if (!lobby[user].hasOwnProperty('customFileName')) {
        lobby[user].customFileName = '';
    }
    lobby[user].customFileName = cleanFileName;
    displayAccountSettingsMenu(message, false);
}

// actionMap['customFileName'] = async (message, user) => {
//     customFileName(message, user);
// }

prefixHandlers['commandlist_'] = (action,message,user) => {
    const page = parseInt(action.split('_')[1]);
    actionMap['commandMenu'](message, page, user);
}
actionMap['commandMenu'] = commandListMenu

async function commandListMenu(message, page, user) {
    const commandKeyboard = buildCommandListMenu(message, page, user);
    const accountInfo = buildUserProfile(message, message.chat.id > 0);
    const messageId = message.message_id;
    const chatId = message.chat.id;
    await editMessage({
        reply_markup: { 
            inline_keyboard: commandKeyboard,
        },
        chat_id: chatId,
        message_id: messageId,
        text: accountInfo,
        options: { parse_mode: 'HTML' }
    })
}

// Function 1: buildCommandListMenu
// This function will iterate over the user's command list and generate the menu UI
function buildCommandListMenu(message, page = 1, user, pageSize = 5) {
    // Combine user command list with commands not used from the fullCommandList
    const userCommands = lobby[user].commandList;
    const unusedCommands = fullCommandList.filter(cmd => !userCommands.some(userCmd => userCmd.command === cmd.command));
    const combinedCommandList = [...userCommands, ...unusedCommands];

    const totalPages = Math.ceil(combinedCommandList.length / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, combinedCommandList.length);
    
    // Create buttons for commands in the current page
    let menuButtons = [];
    for (let i = startIndex; i < endIndex; i++) {
        const command = combinedCommandList[i];
        const commandButtons = buildCommandButtons(user, command, i);
        menuButtons.push(...commandButtons);
    }
    
    // Add navigation buttons for pagination if needed
    if (page > 1 && page < totalPages) {
        menuButtons.push([
            { text: '←', callback_data: `commandlist_${page - 1}` },
            { text: '→', callback_data: `commandlist_${page + 1}` }
        ]);
    } else if (page == 1) {
        menuButtons.push([{ text: '→', callback_data: `commandlist_${page + 1}` }]);
    } else if (page == totalPages) {
        menuButtons.push([{ text: '←', callback_data: `commandlist_${page - 1}` }])
    }

    menuButtons.push([{text: 'nvm', callback_data: 'cancel'},{text: '💾', callback_data: 'saveCommandList'}])
    return menuButtons;
}

actionMap['saveCommandList'] = async (message, user) => {
    if(!lobby.hasOwnProperty(user)){
        return
    }
    if (!lobby[user].stationed || typeof lobby[user].stationed == 'boolean') {
        lobby[user].stationed = {};
    }
    if (typeof chatId !== 'undefined') {
        lobby[user].stationed[chatId] = true;
        console.log(`User ${user} is now stationed for chatId: ${chatId}.`);
    }
    lobby[user].stationed[message.chat.id] = false
    await writeUserDataPoint(user, 'commandList', lobby[user].commandList)
    await returnToAccountMenu(message,user)
}

// Function 2: buildCommandButtons
// This function generates buttons for each command, allowing users to enable/disable, move, or delete them
function buildCommandButtons(user, command, index) {
    let buttons = [];
    
    // Add the command label
    buttons.push([{ text: command.command, callback_data: `noop` }]);
    
    // Add enable/disable and movement buttons in a separate row
    const isEnabled = lobby[user].commandList.some(cmd => cmd.command === command.command);
    let actionButtons = [];
    if (isEnabled) {
        buttons[0].push({ text: '🗑️', callback_data: `remove_command_${index}` });
    } else {
        buttons[0].push({ text: '➕', callback_data: `add_command_${index}` });
    }
    if (index > 0 && isEnabled) {
        actionButtons.push({ text: '⬆️', callback_data: `move_up_${index}` });
    }
    if (index <= lobby[user].commandList.length - 1 && isEnabled) {
        actionButtons.push({ text: '⬇️', callback_data: `move_down_${index}` });
        actionButtons.push({ text: '⏫', callback_data: `move_top_${index}` });
    }
    buttons.push(actionButtons);
    return buttons;
}

const handlePrefix = (action, message, user) => {
    const index = parseInt(action.split('_')[2]);
    const command = action.split('_').slice(0,2).join('_');
    console.log('handle prefix command index',command,index)
    actionMap['editCommandList'](message, user, index, command);
} 

prefixHandlers['move_up_'] = (action,message,user) => handlePrefix(action,message,user)
prefixHandlers['add_command_']= (action,message,user) => handlePrefix(action,message,user)
prefixHandlers['remove_command_']= (action,message,user) => handlePrefix(action,message,user)
prefixHandlers['move_top_']= (action,message,user) => handlePrefix(action,message,user)
prefixHandlers['mode_down_']= (action,message,user) => handlePrefix(action,message,user)

actionMap['editCommandList'] = handleCommandListEdit
// Function 3: handleCommandListEdit
// This function handles editing the user's command list based on the given command
function handleCommandListEdit(message, user, index, command) {
    // Combine user command list with commands not used from the fullCommandList
    const userCommands = lobby[user].commandList;
    const unusedCommands = fullCommandList.filter(cmd => !userCommands.some(userCmd => userCmd.command === cmd.command));
    const combinedCommandList = [...userCommands, ...unusedCommands];

    switch (command) {
        case 'move_down':
            if (index < userCommands.length - 1) {
                [userCommands[index], userCommands[index + 1]] = [userCommands[index + 1], userCommands[index]];
            }
            break;
        case 'move_up':
            if (index > 0) {
                [userCommands[index], userCommands[index - 1]] = [userCommands[index - 1], userCommands[index]];
            }
            break;
        case 'move_top':
            if (index > 0) {
                const [movedCommand] = userCommands.splice(index, 1);
                userCommands.unshift(movedCommand);
            }
            break;
        case 'remove_command':
            if (index < userCommands.length) {
                const [removedCommand] = userCommands.splice(index, 1);
                unusedCommands.push(removedCommand);
            }
            break;
        case 'add_command':
            if (index >= userCommands.length) {
                const addedCommand = combinedCommandList[index];
                userCommands.push(addedCommand);
            }
            break;
        default:
            console.error('Unknown command:', command);
    }

    // Update the lobby with the modified command list
    lobby[user].commandList = userCommands;

    // Refresh the command list menu
    commandListMenu(message, 1, user);
}

function buildUserProfile(message, dms) {
    message.from.is_bot ? message = message.reply_to_message : null 
    const userId = message.from.id;
    const totalExp = (lobby[userId].exp + lobby[userId].points);
    const level = Math.floor(Math.cbrt(totalExp));
    
    const nextLevel = (level + 1) ** 3;
    const lastLevel = (level) ** 3;
    const toLevelUpRatio = (totalExp - lastLevel) / (nextLevel - lastLevel);

    let bars = '🟩';
    for (let i = 0; i < 6; i++) {
        bars += i < toLevelUpRatio * 6 ? '🟩' : '⬜️';
    }

    const maxPoints = Math.floor((lobby[userId].balance + NOCOINERSTARTER) / POINTMULTI);
    let qoints = lobby[userId].qoints;
    let doints = lobby[userId].doints || 0;
    const pointBars = createBalancedBar(maxPoints, lobby[userId].points + doints, qoints);

    const currentTime = Date.now();
    const timePassed = currentTime - lastCleanTime;
    const minutesLeft = LOBBY_CLEAN_MINUTE - Math.floor((timePassed % LOBBY_CLEAN_INTERVAL) / (1000 * 60));

    const burned = getBurned(userId);
    let accountInfo = '\n';
    accountInfo += `<b>${message.from.username}</b> \n`;
    if (dms) {
        accountInfo += `<b>${lobby[userId].wallet}</b>\n`
        accountInfo += `<b>MS2 Balance:</b> ${lobby[userId].balance - burned}🎮\n`;
        accountInfo += `<b>MS2 Burned:</b> ${burned / 2}🔥\n`;
    }
    accountInfo += `<b>LEVEL:</b>${level}\n`;
    accountInfo += `<b>EXP:</b>        ${bars}\n`;
    accountInfo += `<b>POINTS:</b> ${pointBars}\n`;
    accountInfo += `${Math.floor(lobby[userId].points + doints) || 0} / ${Math.floor(maxPoints)} ${qoints ? '+ ' + Math.floor(qoints) : ''}\n\n`;
    accountInfo += `<b>Next Points Replenish in ${minutesLeft}m</b>\n\n`;

    const lockedFeatures = features.filter(feature => lobby[userId].balance < feature.gate);
    if (lockedFeatures.length > 0) {
        accountInfo += `<b>🔒Locked Features:</b>\n`;
        lockedFeatures.forEach(feature => {
            accountInfo += `🚪<b>${feature.name}</b>  🔐$MS2: ${feature.gate}\n`;
        });
    } else {
        accountInfo += `<b>🎖️🏅🥇🏵️👑🈺🔑</b>`;
    }

    return accountInfo;
}

function createBalancedBar(totalPossiblePoints, spentPoints, qoints, segments = 7) {
    let bar = [];

    const regeneratingEmojiTiers = [
        { emoji: '💎', value: 10000 },
        { emoji: '💠', value: 1000 },
        { emoji: '🔷', value: 100 },
        { emoji: '🔹', value: 10 }
    ];

    const qointEmojiTiers = [
        { emoji: '☀️', value: 10000 },
        { emoji: '🧀', value: 1000 },
        { emoji: '🔶', value: 100 },
        { emoji: '🔸', value: 10 }
    ];

    function fillSegments(points, tiers, remainingSegments) {
        const emojiBar = [];
        let segmentCount = remainingSegments;

        for (const tier of tiers) {
            while (points >= tier.value && segmentCount > 0) {
                emojiBar.push(tier.emoji);
                points -= tier.value;
                segmentCount--;
            }
        }

        while (segmentCount > 0) {
            if (points > 0) {
                emojiBar.push('🔹');
                points -= 10;
            } else {
                emojiBar.push('▫️');
            }
            segmentCount--;
        }

        return emojiBar;
    }

    if (qoints && qoints > 0 && totalPossiblePoints > 0) {
        bar = bar.concat(fillSegments(qoints, qointEmojiTiers, 1));
        const regenPoints = totalPossiblePoints - spentPoints;
        bar = bar.concat(fillSegments(regenPoints, regeneratingEmojiTiers, segments - 1));
        if (spentPoints > 0) {
            bar[bar.length - 1] = '▫️';
        }
    } else if (!qoints || qoints <= 0) {
        const regenPoints = totalPossiblePoints - spentPoints;
        bar = fillSegments(regenPoints, regeneratingEmojiTiers, segments);
        if (spentPoints > 0) {
            bar[bar.length - 1] = '▫️';
        }
    } else if (totalPossiblePoints <= spentPoints && qoints && qoints > 0) {
        bar = fillSegments(qoints, qointEmojiTiers, segments);
        const lowestQointValue = qointEmojiTiers[qointEmojiTiers.length - 1].value;
        if (qoints < lowestQointValue * segments) {
            bar[bar.length - 1] = '▫️';
        }
    }

    while (bar.length > segments) {
        bar.pop();
    }

    return bar.join('');
}


async function handleSaveSettings(message) {
    const group = getGroup(message);
    if(group){
        writeData('floorplan',{id: group.id},{settings: group.settings})
        await sendMessage(message,`I just saved your group settings. So when the bot resets, this is what you'll be on`, home);
    } else {
        writeUserData(message.from.id,lobby[message.from.id]);
        await sendMessage(message,`I just saved your settings. So when the bot resets, this is what you'll be on`, home);
    }
}
async function handleSeeSettings(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const group = getGroup(message);
    let settings;

    // Define keys to ignore
    const keysToIgnore = ['_id', 'runs','lastPhoto','userId', 'input_image','input_control_image', 'input_style_image','input_pose_image','whaleMode', 'collections', 'loras', 'blessing', 'curse', 'fileUrl', 'collectionConfig', 'tempSize'];

    if (message.chat.id < 0 && group){
        settings = group.settings;
    }
    else if (!group && lobby[userId]) {
        settings = lobby[userId];
    } else {
        settings = await getUserDataByUserId(chatId);  // Assuming this fetches user data
    }

    if (settings) {
        let messageText = "Here is what you are working with right now:\n";
        for (const key in settings) {
            if (settings.hasOwnProperty(key) && !keysToIgnore.includes(key)) {
                messageText += `${key}: ${JSON.stringify(settings[key], null, 2)}\n`;
            }
        }
        await sendMessage(message, messageText);
    } else {
        await sendMessage(message, "No settings found.");
    }
}

async function handleSignIn (message) {
    const userId = message.from.id;
    let userData;
    if(lobby[userId]){
        userData = lobby[userId]
    } else {
        console.log('THIS SHOUDLNT HAPPEN WE ARE GETTING USERDATA CASUE THE USER ISNT IN THE LOBBY IN HANDLESIGNIN')
        //userData = await getUserDataByUserId(userId);
        sendMessage(message,'try again sorry')
        return
    }
    
    if(userData != false){
        //lobby[userId] = userData;
        if(userData.wallet != ''){
            sendMessage(message, `You are signed in to ${userData.wallet}`);
            if(userData.verified == true){
                let options = home;
                sendMessage(message,'and you are verified. Have fun',options);
                setUserState(message,STATES.IDLE)
            } else {
                await handleVerify(message);
            }
        } else {
            sendMessage(message, "What's your Solana address?")
            setUserState(message,STATES.SIGN_IN)
        }
    } else {
        sendMessage(message, "What's your Solana address?")
        setUserState(message,STATES.SIGN_IN)
    }
};
function isBase58(str) {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Regex.test(str);
}

function decodeBase58(base58) {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const base = 58;

    let decoded = BigInt(0);
    for (const char of base58) {
        const index = alphabet.indexOf(char);
        if (index === -1) {
            throw new Error("Invalid base58 character");
        }
        decoded = decoded * BigInt(base) + BigInt(index);
    }

    const bytes = [];
    while (decoded > 0) {
        bytes.push(Number(decoded % BigInt(256)));
        decoded = decoded / BigInt(256);
    }

    // Account for leading zeroes
    for (const char of base58) {
        if (char === '1') {
            bytes.push(0);
        } else {
            break;
        }
    }

    return new Uint8Array(bytes.reverse());
}

function validateSolanaAddress(address) {
    if (!isBase58(address) || address.length < 32 || address.length > 44) {
        return false; // Does not match the base58 format or expected length
    }

    try {
        const decoded = decodeBase58(address);
        return decoded.length === 32; // Valid if decoded length is 32 bytes
    } catch (error) {
        return false; // Invalid base58 decoding
    }
}

function extractSolanaAddresses(text) {
    // Regular expression for base58-compatible strings (32 to 44 characters)
    const pattern = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

    // Find all potential matches
    const candidates = text.match(pattern) || [];

    // Filter only valid addresses
    return candidates.filter(validateSolanaAddress);
}

async function shakeSignIn(message) {
    console.log('shaking signin');
    const userId = message.from.id;

    // Check if the user is in the lobby
    if (!lobby[userId]) {
        return;
    }

    const walletAddress = message.text;

    // Validate the wallet address format
    if (!validateSolanaAddress(walletAddress)) {
        sendMessage(message, "Invalid Solana wallet address.");
        setUserState(message,STATES.IDLE)
        return;
    }

    let chatData = lobby[userId];
    chatData.wallet = walletAddress;

    // Check if the wallet address is already associated with another verified user in the database
    let isDuplicate = false;
    const usersWithSameWallet = await getUsersByWallet(walletAddress);

    for (const user of usersWithSameWallet) {
        if (user.verified && user.userId !== userId) {
            isDuplicate = true;
            break;
        }
    }

    if (isDuplicate) {
        sendMessage(message, "This wallet address is already associated with another verified user.");
        setUserState(message,STATES.IDLE)
        return;
    }

    // Update the user's wallet address
    try {
        await writeUserDataPoint(userId, 'wallet', walletAddress);
        lobbyManager.addUser(userId, chatData);
        console.log(message.from.first_name, 'has entered the chat');
        // Confirm sign-in and proceed to verification
        safeExecute(message, handleVerify);
    } catch (error) {
        console.error('Error updating user wallet:', error);
        sendMessage(message, "An error occurred while processing your wallet address. Please try again.");
    }
}

async function handleVerify(message) {
    const userId = message.from.id;
    if(lobby[userId]){
        lobby[userId].verified ? sendMessage(message,`You (${message.text}) are verified, dw`) : sendMessage(message,`Okay, ${message.text} go to https://miladystation2.net/verify , connect your wallet, sign the nonce, return with the hash you get there. Just send it in this chat`)
        lobby[userId].verified ? setUserState(message,STATES.IDLE) : setUserState(message,STATES.VERIFY)
    } else {
        sendMessage(message,'some ting wong :(',signedOut)
    }
    ///console.log('userStates after handlever',lobby[userId].state.state)
}
async function shakeVerify(message) {
    console.log('shaking verify');
    const userId = message.from.id;
    const user = lobby[userId] || await getUserDataByUserId(userId);

    if (!user) {
        sendMessage(message, 'User not found');
        return;
    }

    const { wallet } = user;
    const salt = process.env.VERISALT;
    const providedHash = message.text;

    const isValid = isHashValid(wallet, salt, providedHash);
    sendMessage(message, `${isValid ? 'You are verified now' : 'Not verified'}`);

    if (isValid) {
        user.verified = true;
        await updateUserVerificationStatus(userId, user);
    }
}

function isHashValid(wallet, salt, providedHash) {
    const timestamp = Date.now() / 60000;
    for (let i = 0; i < 5; i++) {
        if (verifyHash(wallet, timestamp - i, salt, providedHash)) {
            return true;
        }
    }
    return false;
}

async function updateUserVerificationStatus(userId, user) {
    try {
        if (user.newb) {
            delete user.newb;
            await writeNewUserData(userId, user);
        } else {
            await writeUserDataPoint(userId, 'verified', true);
        }
        lobby[userId] = user; // Update the lobby state
    } catch (error) {
        console.error('Error updating user verification:', error);
    }
}

async function handleSignOut(message) {
    const userId = message.from.id;

    // Fetch user data
    let userData = lobby[userId] || await getUserDataByUserId(userId);

    console.log(userData?.userId || userId, 'signing out');
    if (userData) {
        try {
            // Update user data in the database
            const updatedUserData = {
                ...userData,
                wallet: '',  // Clear wallet as part of sign-out
                verified: false  // Reset verification status
            };
            await writeUserData(userId, updatedUserData);
        } catch (error) {
            console.error('Error writing user data:', error);
            return false; // Exit early on error
        }
    } else {
        try {
            sendMessage({from: {id: DEV_DMS}, chat: {id: DEV_DMS}},`hey art, ${userId} guy, doesnt have ANY user data and they signing out`)
        } catch (err) {
            console.log('haha you tried to send a dev dm message because someone was signing out but we dont have ANYTHING on them.Shouldnt happen tbh',err)
        }   
    }

    // Clean up in-memory lobby object
    if (lobby[userId]) {
        delete lobby[userId];
    }

    // Notify the user
    try {
        await sendMessage(message, 'You are signed out', signedOut);
    } catch (error) {
        console.error('Error sending sign-out message:', error);
        return false; // Exit early on error
    }

    return true; // Indicate successful sign-out
}

async function handleAccountSettings(message) {
    const chatId = message.chat.id;
    // if(!await checkLobby(message)){
    //     return;
    // }
    if(chatId < 0){
        //sendMessage(message,'ew do that in private messages you perv');
        displayAccountSettingsMenu(message,false);
    } else {
        displayAccountSettingsMenu(message,true);
    }
}

async function handleAccountSettingsEdit(message) {
    const chatId = message.chat.id;
    // if(!await checkLobby(message)){
    //     return;
    // }
    if(chatId < 0){
        //sendMessage(message,'ew do that in private messages you perv');
        displayAccountSettingsMenu(message,false);
    } else {
        displayAccountSettingsMenu(message,true);
    }
}

async function handleAccountReset(message) {
    const userId = message.from.id;
    let chatData;

    if (lobby[userId]) {
        console.log('getting from lobby account reset');
        chatData = lobby[userId];
    } else {
        chatData = await getUserDataByUserId(userId);
    }

    //console.log('chatdata in reset account', chatData);

    // Preserve specific keys
    let { points, qoints, doints, kickedAt, boints, exp, wallet, verified } = chatData;
    
    // Reset to default settings
    chatData = { ...defaultUserData };

    // Restore preserved keys
    chatData.userId = userId;
    chatData.points = points;
    chatData.doints = doints;
    chatData.qoints = qoints;
    chatData.boints = boints;
    chatData.kickedAt = kickedAt;

    chatData.exp = exp;
    chatData.wallet = wallet;
    chatData.verified = verified;

    // Update lobby if necessary
    if (lobby[userId]) {
        lobby[userId] = chatData;
    }

    // Confirm sign-in
    sendMessage(message, `You reset to default settings`);
    setUserState(message, STATES.IDLE);
}

async function handleRefreshQoints(message,user) {
    const now = Date.now()
    if(!lobby.hasOwnProperty([user])){
        return
    }
    const userData = lobby[user];
    const lastCheck = userData.checkedQointsAt;
    if(lobby.hasOwnProperty([user]) && lastCheck && now - lastCheck < 1000 * 60) {
        sendMessage(message,`hey just wait a minute okay. i can check again in ${Math.floor(60 - ((now - lastCheck) / 1000))} seconds`)
        return
    }
    //reset balance just for ease of use so dont have to rely on /ibought
    userData.balance = '';
    if(!userData.hasOwnProperty('pendingQoints')){
        userData.pendingQoints = 0;
    }
    if(lobby.hasOwnProperty([user]) && userData.hasOwnProperty("pendingQoints") && userData.pendingQoints > 0){
        userData.qoints = userData.qoints + userData.pendingQoints
        userData.pendingQoints = 0;
        userData.checkedQointsAt = now
        //write new pendingQoints
        await writeUserDataPoint(user,'pendingQoints',userData.pendingQoints)
        //write new qoints
        await writeQoints('users',{'userId': user},userData.qoints)
        await returnToAccountMenu(message,user)
        return
    } else {
        console.log('i dont see any pendingQoints...')
        console.log('lets check db')
        const newRead = await getUserDataByUserId(user)
        if(!newRead){
            console.log('failed newread','iquit')
            userData.checkedQointsAt = now
        }
        let pendingQoints;
        if(newRead?.hasOwnProperty('pendingQoints')){
            pendingQoints = newRead.pendingQoints
        } else {
            pendingQoints = 0
        }
        if(pendingQoints && pendingQoints > 0){
            userData.qoints = userData.qoints + pendingQoints
            userData.pendingQoints = 0;
            userData.checkedQointsAt = now
            await writeUserDataPoint(user,'pendingQoints',userData.pendingQoints)
            await writeQoints('users',{'userId': user},userData.qoints)
            await returnToAccountMenu(message,user)
            return
        } else {
            console.log('none there either. oh well')
            userData.checkedQointsAt = now
        }
        await returnToAccountMenu(message,user)
    }
}

module.exports = {
    //displayAccountSettingsMenu,
    returnToAccountMenu,
    handleSaveSettings, handleSeeSettings,
    handleSignIn, handleSignOut, handleAccountReset,
    handleAccountSettings, displayAccountSettingsMenu,
    handleRefreshQoints,
    shakeVerify,
    shakeSignIn,
    customFileName
}

 // Test cases:
    
    // let pointBars = createBalancedBar(totalPossiblePoints, spentPoints, qoints);
    // console.log(`Generated Bar: ${pointBars}`);
    
    // // Additional test cases
    // let pointBars2 = createBalancedBar(4000, 1000, 0);
    // console.log(`Generated Bar (no qoints, some spent): ${pointBars2}`);
    
    // let testCases = [
    //     { totalPossiblePoints: 20000, spentPoints: 0, qoints: 10000 },
    //     { totalPossiblePoints: 10000, spentPoints: 0, qoints: 5000 },
    //     { totalPossiblePoints: 4000, spentPoints: 0, qoints: 2000 },
    //     { totalPossiblePoints: 20000, spentPoints: 5000, qoints: 10000 },
    //     { totalPossiblePoints: 15000, spentPoints: 3000, qoints: 5000 },
    //     { totalPossiblePoints: 4000, spentPoints: 1000, qoints: 1000 },
    //     { totalPossiblePoints: 20000, spentPoints: 25000, qoints: 10000 },
    //     { totalPossiblePoints: 5000, spentPoints: 7000, qoints: 3000 },
    //     { totalPossiblePoints: 4000, spentPoints: 6000, qoints: 1500 },
    //     { totalPossiblePoints: 15000, spentPoints: 5000, qoints: 0 },
    //     { totalPossiblePoints: 10000, spentPoints: 3000, qoints: 0 },
    //     { totalPossiblePoints: 4000, spentPoints: 1000, qoints: 0 },
    //     { totalPossiblePoints: 0, spentPoints: 0, qoints: 0 },
    //     { totalPossiblePoints: 5000, spentPoints: 5000, qoints: 0 },
    //     { totalPossiblePoints: 0, spentPoints: 0, qoints: 5000 },
    //     { totalPossiblePoints: 0, spentPoints: 0, qoints: 10 }

    // ];


    // function checkBarLength(bar, expectedLength = 7) {
    //     const actualLength = Array.from(bar).length; // Correctly count emojis
    //     if (actualLength === expectedLength) {
    //         console.log(`PASS: Bar is ${actualLength} emojis long.`);
    //     } else {
    //         console.log(`FAIL: Bar is ${actualLength} emojis long, expected ${expectedLength}.`);
    //     }
    // }
    

    // testCases.forEach(test => {
    //     let pointBars = createBalancedBar(test.totalPossiblePoints, test.spentPoints, test.qoints);
    //     console.log(`Generated Bar (${test.totalPossiblePoints} possible, ${test.spentPoints} spent, ${test.qoints} qoints): ${pointBars}`);
    //     checkBarLength(pointBars); // Check if the bar is exactly 7 emojis long
    // });