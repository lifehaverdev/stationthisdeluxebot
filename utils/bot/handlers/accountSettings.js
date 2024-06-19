const { getBotInstance, lobby, rooms, STATES } = require('../bot'); 
const bot = getBotInstance()
const { writeUserData, getUserDataByUserId } = require('../../../db/mongodb')
const { sendMessage, setUserState, safeExecute } = require('../../utils')
const { checkLobby } = require('../gatekeep')
const { verifyHash } = require('../../users/verify.js')


function displayAccountSettingsMenu(message) {
    // Create account settings menu keyboard
    const userId = message.from.id;
    const chatId = message.chat.id;
    let accountSettingsKeyboard = [
        [
            {
                text: `Advanced User: ${lobby[userId].advancedUser ? 'Enabled' : 'Disabled'}`,
                callback_data: 'toggleAdvancedUser',
            },
            // {
            //     text: `Whale Mode: ${lobby[userId].whaleMode ? 'Enabled' : 'Disabled'}`,
            //     callback_data: 'toggleWhaleMode'
            // },
            
        ],
        [
            {
                text: `Watermark: ${lobby[userId].waterMark ? 'ON' : 'OFF'}`,
                callback_data: 'toggleWaterMark',
            },
            
        ],
        [
            {
                text: `Base Prompt Menu`,
                callback_data: 'toggleBasePrompt',
            },
            {
                text: `Voice Menu`,
                callback_data: 'toggleVoice'
            },
            {
                text: `Checkpoint Menu`,
                callback_data: 'toggleCheckpoint',
            }
            
        ],
        [
            {
                text: `ControlNet`,
                callback_data: 'toggleControlNet',
            },
            {
                text: 'Style Transfer',
                callback_data: 'toggleStyleTransfer'
            }
        ]
    ];

    // if (lobby[userId].balance >= 0){//1000000) {
    //     accountSettingsKeyboard[0].push(
            
    //     );
    // }
    // if (lobby[userId].balance >= 0){//} 5000000) {
    //     accountSettingsKeyboard[0].push(

    //     );
    // }

    // Send account settings menu
    bot.sendMessage(chatId, 'Account Settings:', {
        reply_markup: {
            inline_keyboard: accountSettingsKeyboard
        }
    });
}

async function handleSaveSettings(message) {
    writeUserData(userId,lobby[message.from.id]);
    await sendMessage(message,`I just saved your settings. So when the bot resets, this is what you'll be on`);
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
                if(message.chat.id > 0){
                    options = {
                        reply_markup: {
                            keyboard: [
                                [{ text: '/create' }],
                                [{ text: '/effect' }],
                                [{ text: '/animate' }],
                                [{ text: '/set' },{text: '/regen' }],
                                [{ text: '/accountsettings' }]
                            ],
                          resize_keyboard: true,
                          one_time_keyboard: false
                        }
                      };
                }
                sendMessage(message,'and you are verified. Have fun',options);
                setUserState(message,STATES.IDLE)
            } else {
                await handleVerify(message);
            }
        } else {
            sendMessage(message, "What's your Solana address?")
            setUserState(message,STATES.SIGN_IN)
            console.log('state',lobby[userId].state)
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
    console.log('userStates after handlever',lobby[userId].state.state)
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
            console.log(match);
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
    console.log(userData,'signing out');
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
    sendMessage(message,'You are signed out');
    return true;
}

async function handleAccountSettings(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    if(!await checkLobby(message)){
        return;
    }
    if(chatId < 0){
        sendMessage(message,'ew do that in private messages you perv');
    } else {
        displayAccountSettingsMenu(message);
    }
}

async function handleAccountReset(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let chatData;
    if(lobby[userId]){
        chatData = lobby[userId]
    } else {
        chatData = await getUserDataByUserId(userId);
    }
    let wallet = chatData.wallet;
    chatData=defaultUserData;
    chatData.wallet = wallet;
    if(lobby[userId]){lobby[userId] = chatData;}
    // Confirm sign-in
    sendMessage(message, `You reset to default settings`);
    setUserState(message,STATES.IDLE);
}

module.exports = {
    //displayAccountSettingsMenu,
    handleSaveSettings,
    handleSeeSettings,
    handleSignIn,
    handleSignOut,
    handleAccountReset,
    handleAccountSettings,
    shakeVerify,
    shakeSignIn
}