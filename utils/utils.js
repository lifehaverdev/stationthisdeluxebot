const { getBotInstance, lobby, rooms, getBurned } = require('./bot/bot.js'); 
const defaultUserData = require('./users/defaultUserData.js')

function getGroup(message) {
    const group = rooms.find(group => group.id == message.chat.id)
    return group;
}

const bot = getBotInstance();

const DEV_DMS = 5472638766;

politeCommandList = [
    { command: 'make', description: 'SDXL txt2img'},
    { command: 'flux', description: 'FLUX txt2img'},
    { command: 'status', description: 'Check the group queue status' },
    { command: 'stationthis', description: 'Configure this stationthisbot for this chat'},
];

introductoryCommandList = [
    { command: 'help', description: 'See help description' },
    { command: 'make', description: 'SDXL txt2img'},
    { command: 'signin', description: 'Connect account' },
    { command: 'ca', description: 'Check chart buy' },
    { command: 'loralist', description: 'See available LoRAs' },
    { command: 'status', description: 'Check the group queue status' },
]

fullCommandList = [
    { command: 'stationthis', description: 'Load command keyboard'},
    { command: 'status', description: 'Check on the bot and see if it has been reset lately' },
    { command: 'regen', description: 'Make what you just did again, or with new settings' },
    { command: 'create', description: 'Make something' },
    { command: 'effect', description: 'Change something' },
    { command: 'animate', description: 'Movie maker' },
    { command: 'make', description: 'SDXL txt2img'},
    { command: 'flux', description: 'FLUX txt2img'},
    { command: 'vidthat', description: 'reply to image to create a gif'},
    { command: 'set', description: 'Change your generation settings' },
    { command: 'signin', description: 'Connect account' },
    { command: 'signout', description: 'Disconnect account' },
    { command: 'seesettings', description: 'Display your current settings' },
    { command: 'account', description: 'Change account settings' },
    { command: 'savesettings', description: 'Save your current settings to prevent loss' },
    { command: 'resetaccount', description: 'Return to default settings' },
    { command: 'quit', description: 'Exit a call and response UI' },
    { command: 'getseed', description: 'Capture the seed used on your last generation' },
    { command: 'loralist', description: 'See available LoRAs' },
    { command: 'help', description: 'See help description' },
    { command: 'ca', description: 'Check chart buy' }
];

function setUserState(message,state) {
    const stateObj = {
        state: state,
        chatId: message.chat.id,
        messageThreadId: message.message_thread_id || undefined  // Since not all messages might have this
    }
    //message.message_thread_id ? stateObj.messageThreadId = message.message_thread_id : null;
    if(lobby[message.from.id]){
        lobby[message.from.id].state = stateObj
    } else {
        lobby[message.from.id] = defaultUserData
        lobby[message.from.id].state = stateObj
    }
}

async function safeExecute(message, callback) {
    try {
        return await callback(message);
    } catch (err) {
        if(err.body){
            console.log(err.body)
        } else {
            console.log(err);
        }
        await bot.sendMessage(DEV_DMS, 'Oh no, this happened: ' + err.message);
        return false
    }
}

async function safeExecuteCallback(message, user, callback, action = null) {
    try {
        if(!action){
            return await callback(message,user);
        } else {
            return await callback(action, message, user);
        }
        
    } catch (err) {
        if(err.body){
            console.log(err.body)
        } else {
            console.log(err);
        }
        await bot.sendMessage(DEV_DMS, 'Oh no, this happened: ' + err.message);
        return false
    }
}

async function sendWithRetry(sendFunction, msg, fileUrlOrText, options = {}) {
    const chatId = msg.chat.id;
    
    // Add reply_to_message_id if available
    if (msg.message_id && !options.reply_to_message_id) {
        options.reply_to_message_id = msg.message_id;
    }

    // Only add message_thread_id if the chat is a forum (supergroup with topics)
    if (msg.chat.is_forum && msg.message_thread_id) {
        options.message_thread_id = msg.message_thread_id;
    }

    const attemptSend = async (opts) => {
        try {
            const response = await sendFunction(chatId, fileUrlOrText, opts);
            return response;
        } catch (error) {
            console.error(`Error while sending:`, {
                context: msg.text || '',
                message: error.message || '',
                name: error.name || '',
                code: error.code || ''
            });
            return null;
        }
    };

    // Try sending the message with the options
    let response = await attemptSend(options);
    if (response) return response;

    // If message_thread_id caused the error, remove it and try again
    if (options.message_thread_id) {
        console.log('Retrying without message_thread_id');
        options.message_thread_id = undefined;
        response = await attemptSend(options);
        if (response) return response;
    }

    // If reply_to_message_id caused the error, remove it and try again
    if (options.reply_to_message_id) {
        console.log('Retrying without reply_to_message_id');
        options.reply_to_message_id = undefined;
        response = await attemptSend(options);
        if (response) return response;
    }

    // Return null if all retries failed
    return null;
}
// Function to handle command context and set bot commands dynamically
async function setCommandContext(bot, msg) {
    if (!isValidMessage(msg)) return;

    const { chatId, userId } = extractChatAndUserIds(msg);
    const group = getGroup(msg);
    initializeUserCommandListIfNeeded(userId);

    if (isUserAlreadyStationed(userId, chatId)) {
        console.log(`User ${userId} is already stationed for chatId: ${chatId}.`);
        return;
    }

    const { commands, scope } = determineCommandsAndScope(chatId, userId, group);
    await updateBotCommandsIfNeeded(bot, userId, group, commands, scope, msg);
    markUserAsStationed(userId, chatId);
}

function cleanPrompt(rawText, taskType) {
    const botName = process.env.BOT_NAME;

    // Regular expressions to match command names and bot mentions
    const commandRegex = new RegExp(`/(\\w+)`, 'gi');
    const botNameRegex = new RegExp(`@${botName}`, 'gi');

    // Remove the taskType command, bot mention, and other commands
    let cleanedText = rawText.replace(commandRegex, '').replace(botNameRegex, '');

    // Remove any lingering taskType mentions
    cleanedText = cleanedText.replace(new RegExp(taskType, 'gi'), '');

    // Trim the text to clean up any extra spaces
    return cleanedText.trim();
}

// Utility function to validate the message
function isValidMessage(msg) {
    return msg && msg.chat && msg.from;
}

// Utility function to extract chat and user IDs
function extractChatAndUserIds(msg) {
    return {
        chatId: msg?.chat?.id,
        userId: msg?.from?.id
    };
}

// Initialize the user's command list if it does not exist
function initializeUserCommandListIfNeeded(userId) {
    if (!lobby.hasOwnProperty(userId)) {
        console.log(`User ${userId} is not in the lobby.`);
        return;
    }
    if (!lobby[userId].hasOwnProperty('commandList') || !Array.isArray(lobby[userId].commandList)) {
        console.log(`Initializing commandList for userId: ${userId}`);
        lobby[userId].commandList = introductoryCommandList;
    }
}

// Check if the user is already stationed for the given chat ID
function isUserAlreadyStationed(userId, chatId) {
    return lobby[userId]?.stationed?.[chatId];
}

// Determine the commands and scope for setting the context
function determineCommandsAndScope(chatId, userId, group) {
    let commands = [];
    let scope = { type: 'default' };

    if (chatId < 0) { // Group chat
        if (group?.commandList) {
            commands = group.commandList;
            scope = { type: 'chat', chat_id: chatId };
            console.log(`Using group-specific commands for chatId: ${chatId}`);
        } else if (lobby[userId]?.verified) {
            commands = lobby[userId].commandList;
            scope = { type: 'chat_member', chat_id: chatId, user_id: userId };
            console.log(`User ${userId} is verified, using personalized commands in group chatId: ${chatId}`);
        } else {
            commands = politeCommandList;
            scope = { type: 'all_group_chats' };
            console.log(`Using politeCommandList for group chatId: ${chatId}`);
        }
    } else { // Private chat
        commands = lobby[userId]?.commandList?.length > 0 ? lobby[userId].commandList : introductoryCommandList;
        scope = { type: 'chat', chat_id: chatId };
        console.log(`Private chat detected for userId: ${userId}, using commands: ${JSON.stringify(commands)}`);
    }

    return { commands, scope };
}

// Update bot commands if the commands have changed
async function updateBotCommandsIfNeeded(bot, userId, group, commands, scope, msg) {
    try {
        const existingCommands = await bot.getMyCommands({ scope });
        const newCommandsJson = JSON.stringify(commands);
        const existingCommandsJson = JSON.stringify(existingCommands);

        if (newCommandsJson !== existingCommandsJson) {
            console.log(`Commands are different, updating commands for scope: ${JSON.stringify(scope)}`);
            await bot.setMyCommands(commands, { scope });
            console.log(`Commands set successfully for userId: ${userId}`);
        } else {
            console.log(`Commands are the same, no update needed for userId: ${userId}`);
        }

        // Set chat menu button for all cases except group-specific commands
        if (scope.type === 'chat' || (group && group.commandButton)) {
            await bot.setChatMenuButton({ type: 'commands' });
            console.log(`Chat menu button set for userId: ${userId}`);
        }
    } catch (error) {
        console.error(`Error while setting commands or menu:`, {
            context: msg.text || '',
            message: error.message || '',
            name: error.name || '',
            code: error.code || ''
        });
    }
}

// Mark the user as stationed to avoid redundant updates
function markUserAsStationed(userId, chatId) {
    if (!lobby[userId]) return;

    if (!lobby[userId].stationed) {
        lobby[userId].stationed = {};
    }
    if (typeof chatId !== 'undefined') {
        lobby[userId].stationed[chatId] = true;
        console.log(`User ${userId} is now stationed for chatId: ${chatId}.`);
    }
}


async function updateMessage(chatId, messageId, menu, text) {
    await editMessage({
        reply_markup: menu.reply_markup,
        chat_id: chatId,
        message_id: messageId,
        text: text
    });
}

// Specific send functions using the helper function
async function sendMessage(msg, text, options = {}) {
    await setCommandContext(bot, msg)
    return await sendWithRetry(bot.sendMessage.bind(bot), msg, text, options);
}

async function sendPrivateMessage(user, msg, text, options = {}) {
    msg.chat.id = user
    delete msg.message_thread_id
    delete msg.message_id
    delete msg.reply_to_message_id
    //console.log('send private message')
    return await sendWithRetry(bot.sendMessage.bind(bot), msg, text, options)
}

async function sendPhoto(msg, fileUrl, options = {}) {
    await setCommandContext(bot, msg)
    return await sendWithRetry(bot.sendPhoto.bind(bot), msg, fileUrl, options);
}

async function sendDocument(msg, fileUrl, options = {}) {
    await setCommandContext(bot, msg)
    // If it's a group chat (chatId < 0), send privately to user instead
    if (msg.chat.id < 0) {
        const privateMsgCopy = {...msg};
        privateMsgCopy.chat.id = msg.from.id;
        delete privateMsgCopy.message_thread_id;
        delete privateMsgCopy.message_id;
        delete privateMsgCopy.reply_to_message_id;
        
        // Send document privately
        await sendWithRetry(bot.sendDocument.bind(bot), privateMsgCopy, fileUrl, options);
        
        // Notify in group chat
        await sendWithRetry(bot.sendMessage.bind(bot), msg, "I've sent your document in a private message 📨");
        
        return;
    }
    return await sendWithRetry(bot.sendDocument.bind(bot), msg, fileUrl, options);
}

async function sendAnimation(msg, fileUrl, options = {}) {
    await setCommandContext(bot, msg)
    return await sendWithRetry(bot.sendAnimation.bind(bot), msg, fileUrl, options);
}

async function sendVideo(msg, fileUrl, options = {}) {
    await setCommandContext(bot, msg)
    return await sendWithRetry(bot.sendVideo.bind(bot), msg, fileUrl, options);
}

function optionAppendage(msg){
    const options = {};
    if (msg.message_id) {
        options.reply_to_message_id = msg.message_id
    }
    // Include msg_thread_id in options if it exists
    if (msg.message_thread_id) {
        options.message_thread_id = msg.message_thread_id;
    }
    return options
}

async function react(message, emoji = null) {
    if(emoji){
        await bot.setMessageReaction(message.chat.id, message.message_id, {
            reaction: [
                {
                    type: 'emoji',
                    emoji: emoji
                }
            ]
        })
    } else {
        bot.sendChatAction(message.chat.id,'upload_photo')
        await bot.setMessageReaction(message.chat.id, message.message_id, {
            reaction: [
                {
                    type: 'emoji',
                    emoji: '👌'
                }
            ]
        })
    }
    
}

function chargeGated(message) {
    const reacts = ["👎", "🤔", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🌚", "🌭","🤣", "🍌", "💔", "😐", "🖕", "😈", "🙈", "🤪", "🗿", "🙉", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"]
    const which = Math.floor(Math.random() * reacts.length)
    react(message,reacts[which])
    const reply_markup = {
        inline_keyboard: [
            [{text: 'Add Charge ⚡️', url: `https://miladystation2.net/charge`}]
        ]
    }
    sendMessage(message, "You need to have charge on your account to use this feature. Please add funds to continue.", {reply_markup})
    lobby[message.from.id].balance = '';
}

function gated(message) {
    const reacts = ["👎", "🤔", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🌚", "🌭","🤣", "🍌", "💔", "😐", "🖕", "😈", "🙈", "🤪", "🗿", "🙉", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"]
    const which = Math.floor(Math.random() * reacts.length)
    react(message,reacts[which])
    //sendMessage(message,`You don't have enough tokens to use this feature lol \n\n Buy${lobby[message.from.id].balance > 0 ? ' more' : ''} MS2 🥂\n\n\`AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg\``,{parse_mode: 'MarkdownV2'})
    lobby[message.from.id].balance = '';
}

function compactSerialize(data) {
    return `${data.action}|${data.fromId}|${data.userId}`;
}

function makeBaseData(message,userId) {
    return {
        //text: 'k',
        //id: message.message_id,
        fromId: message.from.id,
        //chatId: message.chat.id,
        //firstName: message.from.first_name.slice(0, 4), // Limit length of the name to avoid exceeding limit
        //threadId: message.message_thread_id || 0 ,// Use 0 if thread ID is not available
        userId: userId
    };
}
async function editMessage({ reply_markup = null, chat_id, message_id, text = null, photo = null, caption = null, options = {} }) {
    
    // Helper function for error handling
    const handleError = (error, context) => {
        console.error(`Error editing message ${context}:`, {
            message: error.message || '',
            name: error.name || '',
            code: error.code || '',
            chat_id,
            message_id,
            text,
        });
    };

    try {
        //console.log('Editing message with the following details:', { chat_id, message_id, text, reply_markup, ...options });

        // Edit the message text if provided
        if (text) {
            await bot.editMessageText(text, { chat_id, message_id, ...options });
        }

        // Edit the reply markup if provided
        if (reply_markup) {
            await bot.editMessageReplyMarkup(reply_markup, { chat_id, message_id, ...options });
        }

        // Edit the message media if a photo URL is provided
        if (photo) {
            const media = {
                type: 'photo',
                media: photo
            };
            await bot.editMessageMedia(media, { chat_id, message_id, reply_markup, ...options });
        }

        // Edit the message caption if provided
        if (caption) {
            await bot.editMessageCaption(caption, { chat_id, message_id, ...options });
        }

    } catch (error) {
        handleError(error, text ? "text" : photo ? "photo" : caption ? "caption" : "reply markup");
    }
}

async function calculateDiscount(user) {
    // Get user's MS2 balance, burns, and exp
    
    const balance = lobby[user].balance || 0;
    const burns = getBurned(user);
    const exp = lobby[user].exp || 0;

    // Discount based on MS2 balance (25% discount if balance >= 600,000)
    const ms2BalanceDiscount = balance >= 6000000 ? 25 : (balance / 600000) * 25;
    console.log('ms2 balance discount',ms2BalanceDiscount)
    // Discount based on MS2 burned (25% discount if burned >= 300,000) 
    const ms2BurnDiscount = burns >= 300000 ? 25 : (burns / 300000) * 25;
    console.log('ms2 burn discount',ms2BurnDiscount)
    // Discount based on user level (25% discount if level >= 100)
    const userLevel = Math.floor(Math.cbrt(exp));
    const levelDiscount = userLevel >= 100 ? 25 : (userLevel / 100) * 25;
    console.log('level discount',levelDiscount)
    // Calculate total discount (capped at 75%)
    const totalDiscount = Math.min(ms2BalanceDiscount + ms2BurnDiscount + levelDiscount, 75);
    console.log('total discount',totalDiscount)
    return totalDiscount;
}



module.exports = {
    sendPhoto,
    sendDocument,
    sendAnimation,
    sendMessage, sendPrivateMessage,
    sendVideo,
    safeExecute, safeExecuteCallback,
    setUserState,
    react,
    compactSerialize,
    makeBaseData,
    editMessage, updateMessage,
    gated, chargeGated,
    calculateDiscount,
    cleanPrompt,
    DEV_DMS,
    fullCommandList,
}