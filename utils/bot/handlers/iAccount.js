const { getBotInstance, lobby, rooms, STATES, startup, getBurned, getNextPeriodTime } = require('../bot'); 
const bot = getBotInstance()
const { writeUserData, getUserDataByUserId, writeData } = require('../../../db/mongodb')
const { sendMessage, setUserState, safeExecute, makeBaseData, compactSerialize } = require('../../utils')
const { checkLobby, NOCOINERSTARTER, POINTMULTI } = require('../gatekeep')
const { verifyHash } = require('../../users/verify.js')
const { signedOut, home } = require('../../models/userKeyboards.js')
const { features } = require('../../models/tokengatefeatures.js')
const defaultUserData = require('../../users/defaultUserData.js')
const { getGroup } = require('./iGroup')
/*
Let's upgrade protection
Cull mutliple userids on same wallet address
Cull multiple addresses same userId?
Website route?
*/

function displayAccountSettingsMenu(message,dms) {
    // Create account settings menu keyboard
    const userId = message.from.id;
    let accountSettingsKeyboard = [
        [
            {
                text: `Advanced User: ${lobby[userId].advancedUser ? '✅' : '❌'}`,
                callback_data: 'toggleAdvancedUser',
            },
        ],
        [
        ],
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
    ];

    if(lobby[userId].balance >= 400000){
        accountSettingsKeyboard[1].push(
            {
                text: `ControlNet ${lobby[userId].controlNet ? '✅' : '❌'}`,
                callback_data: 'toggleControlNet',
            },
            {
                text: `Style Transfer ${lobby[userId].styleTransfer ? '✅' : '❌'}`,
                callback_data: 'toggleStyleTransfer',
            }
        )
    }

    // Create account information text
    const totalExp = (lobby[userId].exp + lobby[userId].points);
    const level = Math.floor(Math.cbrt(totalExp));
    const nextLevel = (level + 1)**3; 
    const lastLevel = (level)**3;
    const toLevelUpRatio = (totalExp-lastLevel) / (nextLevel-lastLevel);
    let bars = '🟩';
    for(let i =0; i < 6; i++){
        if(i < toLevelUpRatio * 6){
            bars += '🟩';
        } else {
            bars += '⬜️'
        }
    }
    const burned = getBurned(userId)
    
    //let accountInfo = `Account:\n\n`;
    let accountInfo = '\n';
    accountInfo += `<b>${message.from.username}</b> \n`;
    accountInfo += `<b>MS2 Balance:</b> ${lobby[userId].balance - burned}🎮\n`;
    accountInfo += `<b>MS2 Burned:</b> ${burned/2}🔥\n`;
    accountInfo += `<b>LEVEL:</b>${level} `
    accountInfo += `<b>EXP:</b> ${bars}\n`
    accountInfo += `<b>Points:</b> ${lobby[userId].points || 0} / ${Math.floor((lobby[userId].balance + NOCOINERSTARTER) / POINTMULTI)}\n\n`;
    accountInfo += `<b>Next Points Period in ${getNextPeriodTime(startup)}m</b>\n\n`
    accountInfo += `<b>Locked Features:</b>\n`;
    
    // List locked features based on the user's balance
    const lockedFeatures = features.filter(feature => lobby[userId].balance < feature.gate);
    if (lockedFeatures.length > 0) {
        lockedFeatures.forEach(feature => {
            accountInfo += `<b>-</b> ${feature.gate} $MS2: ${feature.name}\n`;
        });
    } else {
        accountInfo += `None\n`;
    }

    // Send account settings menu with account information
    if(dms){
        sendMessage(message, accountInfo, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: accountSettingsKeyboard
            }
        });
    } else {
        sendMessage(message, 'Account Settings:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: accountSettingsKeyboard
            }
        });
    }
    
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
    let settings;

    // Define keys to ignore
    const keysToIgnore = ['_id', 'lastPhoto','userId', 'whaleMode', 'collections', 'loras', 'blessing', 'curse', 'fileUrl', 'collectionConfig', 'tempSize'];

    if (
        message.chat.id < 0 && 
        index != -1 && 
        rooms[index].admin.some(
            (appointed)=> { return message.from.id == appointed ? true : false}
        )){
        settings = rooms[index].settings;
    }
    else if (lobby[userId]) {
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
    
    userData = await getUserDataByUserId(userId);
    
    if(userData != false){
        lobby[userId] = userData;
        if(userData.wallet != ''){
            sendMessage(message, `You are signed in to ${userData.wallet}`);
            if(userData.verified == true){
                let options = {};
                    options = home
                sendMessage(message,'and you are verified. Have fun',options);
                setUserState(message,STATES.IDLE)
            } else {
                await handleVerify(message);
            }
        } else {
            sendMessage(message, "What's your Solana address?")
            setUserState(message,STATES.SIGN_IN)
            //console.log('state',lobby[userId].state)
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
    //console.log('chatdata wallet in shake',chatData.wallet);
    writeUserData(userId,chatData)
    lobby[userId] = chatData; //redundant i think
    console.log(message.from.first_name,'has entered the chat');
    // Confirm sign-in
    sendMessage(message, `You are now signed in to ${message.text}`);
    safeExecute(message, handleVerify);
}
async function handleVerify(message) {
    const userId = message.from.id;
    if(lobby[userId]){
        lobby[userId].verified ? sendMessage(message,'You are verified, dw') : sendMessage(message,'go to https://miladystation2.net/verify , connect your wallet, sign the nonce, return with the hash you get there')
        lobby[userId].verified ? setUserState(message,STATES.IDLE) : setUserState(message,STATES.VERIFY)
    } else {
        const userData = await getUserDataByUserId(userId);
        userData.verified ? sendMessage(message,'You are verified, dw') : sendMessage(message,'go to https://miladystation2.net/verify , connect your wallet, sign the nonce, return with the hash you get there')
        userData.verified ? setUserState(message,STATES.IDLE) : setUserState(message,STATES.VERIFY)
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
    let userData = await getUserDataByUserId(userId);
    console.log(userData.userId,'signing out');
        if (userData) {
            // Remove user data for this chatId
            userData.wallet = '';
            userData.verified = false;
            //fs.writeFileSync(chatFilePath, JSON.stringify(userData, null, 2))
            writeUserData(userId,userData);
            if(lobby[userId]){delete lobby[userId]}
        } else {
            // User data not found
            if(lobby[userId]){delete lobby[userId]}
        }
    sendMessage(message,'You are signed out',signedOut);
    return true;
}

async function handleAccountSettings(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    if(!await checkLobby(message)){
        return;
    }
    if(chatId < 0){
        //sendMessage(message,'ew do that in private messages you perv');
        displayAccountSettingsMenu(message,false);
    } else {
        displayAccountSettingsMenu(message,true);
    }
}

async function handleAccountReset(message) {
    const chatId = message.chat.id;
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
    chatData.promptDex = promptDex;

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