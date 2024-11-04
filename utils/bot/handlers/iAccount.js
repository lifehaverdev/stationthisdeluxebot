const { getBotInstance, lobby, rooms, STATES, startup, getBurned, getNextPeriodTime } = require('../bot'); 
const bot = getBotInstance()
const { writeUserData, getUserDataByUserId, writeData, getUsersByWallet } = require('../../../db/mongodb')
const { sendMessage, editMessage, setUserState, safeExecute, makeBaseData, compactSerialize, DEV_DMS } = require('../../utils')
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
    console.log('message: ',message)
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
            {
                text: `Advanced User: ${lobby[userId].advancedUser ? '✅' : '❌'}`,
                callback_data: 'toggleAdvancedUser',
            },
        ],
        [
            { text: 'Train', callback_data: 'trainingMenu' },
        ],
        [
            { text: 'cancel', callback_data: 'cancel' }
        ],
    ];
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
        accountInfo += `<b>Locked Features:</b>\n`;
        lockedFeatures.forEach(feature => {
            accountInfo += `<b>-</b> ${feature.gate} $MS2: ${feature.name}\n`;
        });
    } else {
        accountInfo += `<b>ALL ACCESS VIP STATION THIS</b>`;
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
    const keysToIgnore = ['_id', 'runs','lastPhoto','userId', 'whaleMode', 'collections', 'loras', 'blessing', 'curse', 'fileUrl', 'collectionConfig', 'tempSize'];

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
        userData = await getUserDataByUserId(userId);
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
async function shakeSignIn (message) {
    console.log('shaking signin')
    const userId = message.from.id;
    if(!lobby[userId]){
        return;
    }
    let chatData = lobby[userId];
    chatData.wallet = message.text;
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
        return;
    }
    //console.log('chatdata wallet in shake',chatData.wallet);
    await writeUserData(userId,chatData)
    ///lobby[userId] = chatData; //redundant i think
    lobbyManager.addUser(userId,chatData)
    console.log(message.from.first_name,'has entered the chat');
    // Confirm sign-in
    //sendMessage(message, `You are now signed in to ${message.text}`);
    safeExecute(message, handleVerify);
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
    // Example data received from user
    console.log('shaking verify');
    const chatId = message.chat.id;
    const userId = message.from.id;
    setUserState(message,STATES.IDLE);
    const validity = (userData) => {
        let userWalletAddress;
        if(lobby[userId]){
            userWalletAddress = lobby[userId].wallet;
        } else {
            userWalletAddress = userData.wallet
        }
        
        const userTimestamp = Date.now() / 60000;
        const userProvidedHash = message.text;
        const salt = process.env.VERISALT; // Keep this consistent and secure
        let isValid = false;
        for(let i = 0; i < 5; i++){
            const match = verifyHash(userWalletAddress, userTimestamp-i, salt, userProvidedHash);
            //console.log(match);
            if(match){
                isValid = true;
            }
        }
        return isValid;
    }
    const handleValidity = (userData,isValid) => {
        if (isValid) {
            console.log('Verification successful: the user controls the wallet.');
            try {
                if(lobby[userId]){
                    lobby[userId].verified = true;
                }
                userData.verified = true;
                writeUserData(userId,userData);
                return true
            } catch(err) {
                console.log('verify shake error: ',err)
                return true
            }
        } else {
            console.log('Verification failed: the data does not match or has been tampered with.');
            return true
        }
    }
    if(lobby[userId]){
        isValid = validity(lobby[userId]);
        sendMessage(message,`${isValid ? 'you are verified now' : 'not verified'}`);
        return handleValidity(lobby[userId],isValid);
    } else {
        const userData = await getUserDataByUserId(userId);
        isValid = validity(userData);
        sendMessage(message,`${isValid ? 'you are verified now' : 'not verified'}`);
        return handleValidity(userData,isValid);
    }
}
async function handleSignOut(message) {
    chatId = message.chat.id;
    const userId = message.from.id;
    let userData = lobby[userId] ? lobby[userId] : await getUserDataByUserId(userId);
    
    console.log(userData.userId,'signing out');
    if (userData) {
        // Ensure the most current points (from lobby) are saved to the database
        if (lobby[userId]) {
            // Update the database with the latest points and user data from the lobby
            await writeUserData(userId, {
                ...userData,
                points: lobby[userId].points,  // Use the most up-to-date points from the lobby
                wallet: '',  // Clearing wallet as part of sign out
                verified: false  // Reset verification status
            });
        } else {
            // If the user is not in the lobby, just clear their wallet and verified status
            await writeUserData(userId, {
                ...userData,
                wallet: '',
                verified: false
            });
        }

        // Clean up the in-memory lobby object
        if (lobby[userId]) {
            delete lobby[userId];
        }
    } else {
        // If no user data is found, just clean up the lobby
        if (lobby[userId]) {
            delete lobby[userId];
        }
    }
    sendMessage(message,'You are signed out',signedOut);
    return true;
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
    let { points, exp, wallet, verified, promptDex } = chatData;
    
    // Reset to default settings
    chatData = { ...defaultUserData };

    // Restore preserved keys
    chatData.userId = userId;
    chatData.points = points;
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

module.exports = {
    //displayAccountSettingsMenu,
    returnToAccountMenu,
    handleSaveSettings,
    handleSeeSettings,
    handleSignIn,
    handleSignOut,
    handleAccountReset,
    handleAccountSettings,
    displayAccountSettingsMenu,
    shakeVerify,
    shakeSignIn
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