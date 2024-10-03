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
async function sendMessage(msg, text, options = {}) {
    if (text === '') {
        return null;
    }

    const chatId = msg.chat.id;
    
    // Add reply_to_message_id if available
    if (msg.message_id && !options.reply_to_message_id) {
        options.reply_to_message_id = msg.message_id;
    }

    // Add message_thread_id if available and it's a supergroup with topics
    if (msg.message_thread_id && !options.message_thread_id) {
        console.log('msg.msgthrdid in sendMessage:', msg.message_thread_id);
        options.message_thread_id = msg.message_thread_id;
    }

    const attemptSendMessage = async (opts) => {
        try {
            const response = await bot.sendMessage(chatId, text, opts);
            return response;
        } catch (error) {
            console.error(`sendMessage error:`, {
                context: text,
                message: error.message || '',
                name: error.name || '',
                code: error.code || ''
            });
            return null;
        }
    };

    // Try sending the message with both reply_to_message_id and message_thread_id
    let response = await attemptSendMessage(options);
    if (response) return response;

    // Remove reply_to_message_id and try again (handles case where reply fails)
    if (options.reply_to_message_id) {
        console.log('Retrying without reply_to_message_id');
        options.reply_to_message_id = undefined;
        response = await attemptSendMessage(options);
        if (response) return response;
    }

    // Remove message_thread_id and try again (handles case where message_thread_id is invalid)
    if (options.message_thread_id) {
        console.log('Retrying without message_thread_id');
        options.message_thread_id = undefined;
        response = await attemptSendMessage(options);
        if (response) return response;
    }

    // Return null if all retries failed
    return null;
}

async function sendPhoto(msg, fileUrl, options = {}) {
    
    const chatId = msg.chat.id;
    if (msg.message_id) {
        options.reply_to_message_id = msg.message_id;
    }
    if (msg.message_thread_id) {
        options.message_thread_id = msg.message_thread_id;
    }

    const attemptSendPhoto = async (options) => {
        try {
            const response = await bot.sendPhoto(chatId, fileUrl, options);
            return response;
        } catch (error) {
            console.error(`sendMessage error:`, {
                context: msg.text || '',
                message: error.message || '',
                name: error.name || '',
                code: error.code || ''
            });
            return null;
        }
    };

    // Try sending the message with different options
    let response = await attemptSendPhoto(options);
    if (response) return response;
    options.reply_to_message_id = null;
    response = await attemptSendPhoto(options);
    if (response) return response;
    options.message_thread_id = null;
    return await attemptSendPhoto(options);
    // try {
    //     const response = await bot.sendPhoto(msg.chat.id, fileUrl, optionAppendage(msg));
    //     return response;
    // } catch (error) {
    //     console.error('sendPhoto error:', error.message || error);
    //     return null;
    // }
}
async function sendDocument(msg, fileUrl, options = {}) {
    
    const chatId = msg.chat.id;
    if (msg.message_id) {
        options.reply_to_message_id = msg.message_id;
    }
    if (msg.message_thread_id) {
        options.message_thread_id = msg.message_thread_id;
    }

    const attemptSendFile = async (options) => {
        try {
            const response = await bot.sendDocument(chatId, fileUrl, options);
            return response;
        } catch (error) {
            console.error(`sendMessage error:`, {
                context: msg.text || '',
                message: error.message || '',
                name: error.name || '',
                code: error.code || ''
            });
            return null;
        }
    };

    // Try sending the message with different options
    let response = await attemptSendFile(options);
    if (response) return response;
    options.reply_to_message_id = null;
    response = await attemptSendFile(options);
    if (response) return response;
    options.message_thread_id = null;
    return await attemptSendFile(options);
    // try {
    //     const response = await bot.sendPhoto(msg.chat.id, fileUrl, optionAppendage(msg));
    //     return response;
    // } catch (error) {
    //     console.error('sendPhoto error:', error.message || error);
    //     return null;
    // }
}
async function sendAnimation(msg, fileUrl) {
    try {
        const response = await bot.sendAnimation(msg.chat.id, fileUrl, optionAppendage(msg));
        return response;
    } catch (error) {
        console.error('sendAnimation error:', error.message || error);
        return null;
    }
}
async function sendVideo(msg, fileUrl) {
    try {
        const response = await bot.sendVideo(msg.chat.id, fileUrl, optionAppendage(msg));
        return response;
    } catch (error) {
        console.error('sendVideo error:', error.message || error);
        return null;
    }
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
    const reacts = ["👎", "🤔", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🌚", "🌭","🤣", "🍌", "💔", "🤨", "😐","💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "🙈", "😨", "💅", "🤪", "🗿", "🙉", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"]
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