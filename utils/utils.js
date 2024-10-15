const { getBotInstance, lobby } = require('./bot/bot.js'); 
const defaultUserData = require('./users/defaultUserData.js')

const bot = getBotInstance();

const DEV_DMS = 5472638766;

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


// Specific send functions using the helper function
async function sendMessage(msg, text, options = {}) {
    return await sendWithRetry(bot.sendMessage.bind(bot), msg, text, options);
}

async function sendPhoto(msg, fileUrl, options = {}) {
    return await sendWithRetry(bot.sendPhoto.bind(bot), msg, fileUrl, options);
}

async function sendDocument(msg, fileUrl, options = {}) {
    return await sendWithRetry(bot.sendDocument.bind(bot), msg, fileUrl, options);
}

async function sendAnimation(msg, fileUrl, options = {}) {
    return await sendWithRetry(bot.sendAnimation.bind(bot), msg, fileUrl, options);
}

async function sendVideo(msg, fileUrl, options = {}) {
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

async function editMessage({reply_markup = null, chat_id, message_id, text = null}) {
    if(text){
        await bot.editMessageText(
            text,
            {
                chat_id,
                message_id
            }
        ).catch(error => {
            console.error("Error editing message text:", 
            {
                message: error.message ? error.message : '',
                name: error.name ? error.name : '',
                code: error.code ? error.code : ''
            });
        });
    }
    if(reply_markup) {
        await bot.editMessageReplyMarkup(
            reply_markup,
            {
                chat_id, 
                message_id,
            }
        ).catch(error => {
            console.error("Error editing message reply markup:", 
            {
                message: error.message ? error.message : '',
                name: error.name ? error.name : '',
                code: error.code ? error.code : ''
            });
        });
    }
}



module.exports = {
    sendPhoto,
    sendDocument,
    sendAnimation,
    sendMessage,
    sendVideo,
    safeExecute,
    setUserState,
    react,
    compactSerialize,
    makeBaseData,
    editMessage,
    gated,
    DEV_DMS
}