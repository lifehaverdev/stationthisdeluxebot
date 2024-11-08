const { getBotInstance, lobby, rooms } = require('./bot/bot.js'); 
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
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    let context = 'default';

    // Layered checks to determine context
    if (chatId < 0) { // Group or group chat
        const group = getGroup(msg);
        if (group && group.commands) {
            context = 'group';
        } else if (lobby[userId] && lobby[userId].verified) {
            context = 'verified_user';
        } else {
            context = 'group_chat';
        }
    } else { // Private chat
        if (lobby[userId] && lobby[userId].verified) {
            context = 'verified_private_chat';
        } else {
            context = 'private_chat';
        }
    }

    let commands = [];

    // Set commands based on context
    switch (context) {
        case 'group':
            group.commmands ? commands = group.commands : commands = politeCommandList
            break;
        case 'verified_user':
        case 'verified_private_chat':
            commands = fullCommandList
            break;
        case 'group_chat':
            commands = politeCommandList
            break;
        case 'private_chat':
            commands = introductoryCommandList
            break;
    }

    // Get existing commands and only set if different
    const existingCommands = await bot.getMyCommands();
    //console.log('existing commands',existingCommands)
    const newCommandsJson = JSON.stringify(commands);
    //console.log('new comands',newCommandsJson)
    const existingCommandsJson = JSON.stringify(existingCommands);
    try {
        if (newCommandsJson !== existingCommandsJson) {
            //console.log('new commands')
            // Set commands dynamically
            let scope = { type: 'default' };
            if (context === 'group' || context === 'group_chat') {
                console.log('what is this anyways')
                scope = { type: 'chat_member', chat_id: chatId, user_id: userId };
            } else if (context === 'private_chat') {
                console.log('what is this anyways p2s')
                scope = { type: 'all_private_chats' };
            } 
    
            await bot.setMyCommands(commands, { scope });
        }
    
        // Set chat menu button for all cases except group_chat
        if (context !== 'group_chat') {
            await bot.setChatMenuButton({ type: 'commands' });
        }
    } catch(error) {
        console.error(`Error while setting commands or menu:`, {
            context: msg.text || '',
            message: error.message || '',
            name: error.name || '',
            code: error.code || ''
        });
    }
    
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
    return await sendWithRetry(bot.sendMessage.bind(bot), msg, text, options)
}

async function sendPhoto(msg, fileUrl, options = {}) {
    await setCommandContext(bot, msg)
    return await sendWithRetry(bot.sendPhoto.bind(bot), msg, fileUrl, options);
}

async function sendDocument(msg, fileUrl, options = {}) {
    await setCommandContext(bot, msg)
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

function gated(message) {
    const reacts = ["👎", "🤔", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🌚", "🌭","🤣", "🍌", "💔", "🤨", "😐","💋", "🖕", "😈", "😴", "🤓", "👻", "🙈", "💅", "🤪", "🗿", "🙉", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"]
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
    editMessage,
    gated,
    DEV_DMS
}