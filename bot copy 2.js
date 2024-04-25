const TelegramBot = require("node-telegram-bot-api");
const Jimp = require('jimp');
const fs = require("fs");

const path = require('path');
const { getUserWalletAddress, getBalance } = require ('./utils/checkBalance')
const { generateImage } = require('./commands/make.js')
const { generateImage2Image } = require('./commands/ms2.js')
const { interrogateImage } = require('./commands/interrogate.js')
const { getUserData } = require('./utils/checkUser.js')
const { checkBlacklist } = require('./utils/checkBlacklist.js');
require("dotenv").config()

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

let limit = 0

const STATES = {
    IDLE: 'IDLE',
    SIGN_IN: 'SIGN_IN',
    IMG2IMG: 'IMG2IMG',
    // Add more states as needed
};

const userStates = {};
const userLocks = {};
const userLockTime = {};
const userQueue = {};

bot.on('message', async (message) => {
    if (!message || !message.chat || !message.chat.id || !message.from || !message.from.id) {
        console.error('Invalid message format:', message);
        return;
    }
    
    const userId = message.from.id;
    const text = message.text;

    // Initialize lock for new users
    if (userLocks[userId] === undefined) {
        userLocks[userId] = false;
    }

    if (userLocks[userId]) {
        const now = new Date().getTime();
        if(now > userLockTime[userId] + 20000){
            userLocks[userId] = false;
        } else {
            console.log('User is locked, ignoring message...');
            return;
        }

    }

    // Initialize state for new users
    if (!userStates[userId]) {
        userStates[userId] = STATES.IDLE;
    }

    switch (userStates[userId]) {
        case STATES.IDLE:
            if (text === '/signin') {
                
                userLockTime[userId] = new Date().getTime();
                await handleSigning
                userStates[userId] = STATES.IDLE;
                
            } else if (text === '/ms2') {
                
                userLockTime[userId] = new Date().getTime();
                await Promise.all([
                    handleMs2(message),
                    new Promise(resolve => setTimeout(resolve, 5000))  // Add a delay for better user experience
                ]);
                userStates[userId] = STATES.IDLE;
                
            }
            break;

        case STATES.SIGN_IN:
            await shakeSignIn(message);
            userStates[userId] = STATES.IDLE
            break;

        case STATES.IMG2IMG:
            break;

        // Add more cases as needed
    }
});

// Event listener for handling text messages
bot.onText(/^\/make (.+)/, async (message) => {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const now = new Date().getTime();
    if(now < userLockTime[userId] + 3000){
        bot.sendMessage(chatId, 'Please wait 3s <3');
        return;
    }

    // Check if user has a wallet address
    const walletAddress = await getUserWalletAddress(chatId);
    if (walletAddress) {
        // User has a wallet address, proceed with generating and sending the image
        if(checkBlacklist(walletAddress)){
            await bot.sendMessage(message.chat.id,`you are either on the blacklist or pretending to be the raydium pool lol gtfo`)
            return '';
        }
        const account = await getBalance(walletAddress)
        console.log('user account balance',account);
        if (account < limit){
            await bot.sendMessage(message.chat.id,`NO ACCEsS HAHAHAHA you have ${account} but you need ${limit}`)
            return '';
        } 
        userLockTime[userId] = new Date().getTime();
        try {
            //const {time,filename} =zz
            const{time,filename} = await generateImage(message, message.text);
            //console.log('time and filename',time,filename);
            // Send the watermarked image
            
            //console.log(filename);
            await bot.sendPhoto(chatId, filename);
        
            // Delete the temporary file
            fs.unlinkSync(filename);

            if(time > 10 && limit < 500000){
                limit += 100000;
                console.log('new limit',limit)
            } else if (time < 10 && limit > 0){
                limit -= 100000;
                console.log('new limit',limit)
            }
        } catch (error) {
            console.error("Error generating and sending image:", error);
        }
    } else {
        // User needs to sign in
        bot.sendMessage(chatId, "You need to /signin first.");
    }
});

bot.onText(/^\/interrogate(.*)/, async (message) => {
    const chatId = message.chat.id;
    bot.sendMessage(chatId, "Send in the photo you want to reverse engineer a prompt from.");
    bot.once('photo',async(photoMessage)=>{
        const photoId = photoMessage.photo[0].file_id;
        const photoInfo = await bot.getFile(photoId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${photoInfo.file_path}`;
        try {
            const{time,result} = await interrogateImage(message, photoUrl);
            bot.sendMessage(chatId, result)
        } catch(err){
            console.log(err);
        }
        
    })
});

async function handleMs2(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const userData = await getUserData(chatId); // Assuming you have a function to get user data
    const isAdvancedMode = userData.advancedUser || false;
    const now = new Date().getTime();
    let cfg, strength;
    //const prompt = message.txt
    if (userLocks[userId]) {
        
        if(now < userLocks[userId] + 10000){
            bot.sendMessage(chatId, 'Please finish what you were doing <3');
            return;
        }

    }
    userLocks[userId] = true;
    userLockTime[userId] = now;

    // Step 1: Ask user to send photo
    bot.sendMessage(chatId, "Send in the photo you want to img to img.");

    const fileMessage = await new Promise((resolve) => {
        bot.once('photo', (photoMessage)=>{
            if (photoMessage.chat.id != chatId){
                return
            } else {
                resolve(photoMessage)
            }
        });
        bot.once('document', (fileMessage)=>{
            //console.log(fileMessage);
            console.log(fileMessage.chat.id == chatId)
            if (fileMessage.chat.id != chatId){
                return
            } else {
                resolve(fileMessage)
            }
        });
    });

    let fileId, fileUrl;

    if (fileMessage.photo) {
        fileId = fileMessage.photo[fileMessage.photo.length - 1].file_id;
    } else if (fileMessage.document) {
        fileId = fileMessage.document.file_id;
    }

    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;

    try {
        const photo = await Jimp.read(fileUrl);
            const { width, height } = photo.bitmap;

            const photoStats = {
                width: width,
                height: height,
                prompt: ''
            };

        await bot.sendMessage(chatId, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);

        // const response = await new Promise((resolve) => {
        //     bot.once('message', resolve);
        // });
        let response;
        bot.on('message', async (response) => {
            if (response.chat.id !== chatId) {
                // If the message is not from the expected chatId, continue waiting
                return;
            }

            response = response.text;
        });

        const userInput = response;
        photoStats.prompt = userInput;

        let time
        let filename

        if (isAdvancedMode) {
            // Ask for CFG value
            await bot.sendMessage(chatId, 'Advanced mode is on. Please enter the CFG value (e.g., 7):');
            const cfgResponse = await new Promise((resolve) => {
                bot.once('message', resolve);
            });
            cfg = parseInt(cfgResponse.text);
            if(cfg > 20){
                cfg = 20;
            }

            // Ask for strength value
            await bot.sendMessage(chatId, 'Please enter the strength value (e.g., 0.75):');
            const strengthResponse = await new Promise((resolve) => {
                bot.once('message', resolve);
            });
            strength = parseFloat(strengthResponse.text);
            if(strength > 1){
                strength = 1;
            }

            const result = await generateImage2Image(message, fileUrl, photoStats, {strength, cfg});
            time = result.time;
            filename = result.filename;
        } else {
            const result = await generateImage2Image(message, fileUrl, photoStats);
            time = result.time;
            filename = result.filename;
        }

        

        if(time && filename){
            await bot.sendPhoto(chatId, filename);
            fs.unlinkSync(filename);
        }

        if(time > 10 && limit < 500000){
            limit += 100000;
            console.log('new limit',limit)
        } else if (time < 10 && limit > 0){
            limit -= 100000;
            console.log('new limit',limit)
        } else if (!time) {
            throw error 
        }
        
    } catch (error) {
        console.error("Error processing photo:", error);
        bot.sendMessage(chatId, "An error occurred while processing the photo. Please try again later.");
        
    }
    
    userLocks[userId] = false;
    userStates[userId] = STATES.IDLE;
};

async function handleSignIn (message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    if (userLocks[userId]) {
        const now = new Date().getTime();
        if(now < userLockTime[userId] + 3000){
            bot.sendMessage(chatId, 'Please wait 3s <3');
            return;
        }
    }
    userLocks[userId] = true;

    // Check if chat folder exists, create it if not
    const chatsFolderPath = path.join(__dirname, 'chats');
    if (!fs.existsSync(chatsFolderPath)) {
        fs.mkdirSync(chatsFolderPath);
    }

    // Check if JSON file exists for this chat ID
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    let chatData = {};
    if (fs.existsSync(chatFilePath)) {
        // If JSON file exists, read its content
        const rawData = fs.readFileSync(chatFilePath);
        chatData = JSON.parse(rawData);
    }

    if (chatData.wallet) {
        // If wallet address exists in chat data, user is already signed in
        bot.sendMessage(chatId, `You are signed in to ${chatData.wallet}`);
    } else {
        // Ask for Solana address
        bot.sendMessage(chatId, "What's your Solana address?").then(() => {
            // Listen for the user's response
            // bot.once('message', async (response) => {
            //     // Update chat data with user's Solana address
            //     chatData.wallet = response.text;

            //     // Save updated chat data to JSON file
            //     fs.writeFileSync(chatFilePath, JSON.stringify(chatData));

            //     // Confirm sign-in
            //     bot.sendMessage(chatId, `You are now signed in to ${response.text}`);
            // });
            bot.on('message', async (response) => {
                if (response.chat.id !== chatId) {
                    // If the message is not from the expected chatId, continue waiting
                    return;
                }

                // Update chat data with user's Solana address
                chatData.wallet = response.text;

                // Save updated chat data to JSON file
                fs.writeFileSync(chatFilePath, JSON.stringify(chatData));

                // Confirm sign-in
                bot.sendMessage(chatId, `You are now signed in to ${response.text}`);

                // Remove the listener after processing the message
                bot.removeListener('message', void);
            });
        });
        
    }
    userLocks[userId] = false;
    userStates[chatId] = STATES.IDLE;
};

async function handleSignOut(message) {
    chatId = message.chat.id;
    const chatsFolderPath = path.join(__dirname, '/chats');
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);

    userId = message.from.id;
    userLocks[userId] = false;
    if (!fs.existsSync(chatsFolderPath)) {
        fs.mkdirSync(chatsFolderPath);
    }
    return new Promise((resolve, reject) => {
        fs.readFile(chatFilePath, 'utf8', (err, data) => {
            if (err) {
                console.error("Error reading user data:", err);
                reject(err);
                return;
            }

            let userData = JSON.parse(data);


            if (userData) {
                // Remove user data for this chatId
                userData.wallet = '';

                fs.writeFile(chatFilePath, JSON.stringify(userData, null, 2), (err) => {
                    if (err) {
                        console.error("Error updating user data:", err);
                        reject(err);
                        return;
                    }
                    resolve();
                });
            } else {
                // User data not found
                resolve();
            }
        });
    });
}

// Usage in your bot:
bot.onText(/^\/signout$/, async (message) => {
    const chatId = message.chat.id;

    try {
        await handleSignOut(message);
        await bot.sendMessage(chatId, "You have been signed out successfully.");
    } catch (error) {
        console.error("Error signing out:", error);
        await bot.sendMessage(chatId, "An error occurred while signing out. Please try again later.");
    }
});
 
bot.onText(/^\/checkgate$/, async (message) => {
    bot.sendMessage(message.chat.id, `The current token gate limit is ${limit}`);
});

bot.onText(/^\/accountsettings$/, (message) => {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let userData = {};

    // Check if JSON file exists for the chatId
    const filePath = path.join(__dirname, 'chats', `${chatId}.json`);
    if (fs.existsSync(filePath)) {
        userData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    // Set default values for Batch and Steps if not already set
    if (!userData.batch && process.env.DEFAULT_BATCH) {
        userData.batch = parseInt(process.env.BATCH);
    }

    if (!userData.steps && process.env.DEFAULT_STEPS) {
        userData.steps = parseInt(process.env.STEPS);
    }

    // Write updated user data to JSON file
    fs.writeFileSync(filePath, JSON.stringify(userData, null, 2));

    // Display account settings menu
    displayAccountSettingsMenu(chatId, userData);
});

function displayAccountSettingsMenu(chatId, userData) {
    // Create account settings menu keyboard
    const accountSettingsKeyboard = [
        [
            {
                text: `Advanced User: ${userData.advancedUser ? 'Enabled' : 'Disabled'}`,
                callback_data: 'toggleAdvancedUser'
            },
        //     {
        //         text: `Prompt Settings`,
        //         callback_data: 'promptSettings'
        //     }
        // ],
        // [
        //     {
        //         text: `Inline Prompt: ${userData.inlinePrompt ? 'Enabled' : 'Disabled'}`,
        //         callback_data: 'toggleInlinePrompt'
        //     }
        ]
    ];

    // Send account settings menu
    bot.sendMessage(chatId, 'Account Settings:', {
        reply_markup: {
            inline_keyboard: accountSettingsKeyboard
        }
    });
}

bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const userData = JSON.parse(fs.readFileSync(path.join(__dirname, 'chats', `${chatId}.json`), 'utf-8'));

    switch (callbackQuery.data) {
        case 'toggleAdvancedUser':
            userData.advancedUser = !userData.advancedUser;
            fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(userData, null, 2));
            bot.answerCallbackQuery(callbackQuery.id, { text: `Advanced User setting updated to ${userData.advancedUser ? 'enabled' : 'disabled'}.` });
            break;

        // case 'toggleInlinePrompt':
        //     userData.inlinePrompt = !userData.inlinePrompt;
        //     fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(userData, null, 2));
        //     bot.answerCallbackQuery(callbackQuery.id, { text: `Inline Prompt setting updated to ${userData.inlinePrompt ? 'enabled' : 'disabled'}.` });
        //     break;

        // case 'promptSettings':
        //     const promptSettingsKeyboard = [
        //         [
        //             {
        //                 text: `CFG: ${userData.cfg}`,
        //                 callback_data: 'setCFG'
        //             }
        //         ],
        //         [
        //             {
        //                 text: `Batch: ${userData.batch}`,
        //                 callback_data: 'setBatch'
        //             }
        //         ],
        //         [
        //             {
        //                 text: `Steps: ${userData.steps}`,
        //                 callback_data: 'setSteps'
        //             }
        //         ]
        //     ];
        
        //     const promptSettingsOpts = {
        //         reply_markup: {
        //             inline_keyboard: promptSettingsKeyboard
        //         }
        //     };
        
        //     bot.editMessageText('Prompt Settings:', {
        //         chat_id: chatId,
        //         message_id: callbackQuery.message.message_id,
        //         reply_markup: promptSettingsOpts.reply_markup
        //     });
        //     break;
            
        // case 'setBatch':
        //     bot.sendMessage(chatId, 'Please enter the new Batch value (e.g., 1, 2, 5, 10):').then(sentMessage => {
        //         bot.once('message', newMessage => {
        //             const newBatch = parseInt(newMessage.text);
        //             if (!isNaN(newBatch)) {
        //                 userData.batch = newBatch;
        //                 fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(userData, null, 2));
        //                 bot.answerCallbackQuery(callbackQuery.id, { text: `Batch setting updated to ${userData.batch}.` });

        //                 // Update "Prompt Settings" menu
        //                 updatePromptSettingsMenu(chatId, callbackQuery.message.message_id);
        //             } else {
        //                 bot.sendMessage(chatId, 'Invalid Batch value. Please enter a valid number.');
        //             }
        //         });
        //     });
        //     break;

        // case 'setSteps':
        //     bot.sendMessage(chatId, 'Please enter the new Steps value (e.g., 10, 50, 100):').then(sentMessage => {
        //         bot.once('message', newMessage => {
        //             const newSteps = parseInt(newMessage.text);
        //             if (!isNaN(newSteps)) {
        //                 userData.steps = newSteps;
        //                 fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(userData, null, 2));
        //                 bot.answerCallbackQuery(callbackQuery.id, { text: `Steps setting updated to ${userData.steps}.` });

        //                 // Update "Prompt Settings" menu
        //                 updatePromptSettingsMenu(chatId, callbackQuery.message.message_id);
        //             } else {
        //                 bot.sendMessage(chatId, 'Invalid Steps value. Please enter a valid number.');
        //             }
        //         });
        //     });
        //     break;

        default:
            break;
    }

    

        // Update the account settings menu
        // let inlineKeyboard = [
        //     [
        //         {
        //             text: `Advanced User: ${userData.advancedUser ? '✅' : '❌'}`,
        //             callback_data: 'toggleAdvancedUser'
        //         }
        //     ]
        // ];
    
        // if (userData.advancedUser) {
        //     inlineKeyboard.push(
        //         [
        //             {
        //                 text: 'Prompt Settings',
        //                 callback_data: 'promptSettings'
        //             }
        //         ],
        //         [
        //             {
        //                 text: `Inline Prompt Settings: ${userData.inlinePrompt ? '✅' : '❌'}`,
        //                 callback_data: 'toggleInlinePrompt'
        //             }
        //         ]
        //     );
        // }
    
        // const opts = {
        //     reply_markup: {
        //         inline_keyboard: inlineKeyboard
        //     }
        // };
    
        bot.editMessageText('Account Settings:', {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            //reply_markup: opts.reply_markup
        });
});

bot.onText(/^\/help$/, (message) => {
    const chatId = message.chat.id;

    const helpMessage = `
This is the StationThis bot, a Telegram StableDiffusion bot using Arthur's computer to generate stunning images in a MiladyStation style. Here are the commands you can use:

/make <INSERT PROMPT> - The make command creates a txt2img generation from the prompt of your choosing
/ms2 - The ms2 command initiates the call and response UI to create an img2img generation (beta version)
/interrogate - The interrogate command initiates the call and response UI to analyze a photo you send and return a prompt for it (beta version)

the /make, /ms2 and /interrogate prompts are token gated, the token gate is dynamic according to the generation volume of all the users. If you want to see what the current limit is, use:
/checkgate - The checkgate command returns the current token gate limit which you can expect to fluctuate between 200k and 600k depending on the time of day

/signin - The signin command initiates the call and response UI to connect your Telegram account to a wallet. Have your wallet ready to paste into the chat for best results
/signout - The signout command removes your wallet from your account. Useful for dealing with buggy sign-in

/accountsettings - The accountsettings command gives you the menu to edit your prompt settings, advanced mode toggle, inline prompt toggle, and more to come`;

    bot.sendMessage(chatId, helpMessage);
});