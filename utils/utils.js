const { getBotInstance, lobby } = require('./bot/bot.js'); 
const defaultUserData = require('./users/defaultUserData.js')

const bot = getBotInstance();

const DEV_DMS = 5472638766;

function setUserState(message,state) {
    const stateObj = {
        state: state,
        chatId: message.chat.id,
        messageThreadId: message.message_thread_id || null  // Since not all messages might have this
    }
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
    if (msg.message_id) {
        options.reply_to_message_id = msg.message_id;
    }
    if (msg.message_thread_id) {
        options.message_thread_id = msg.message_thread_id;
    }

    const attemptSendMessage = async (options) => {
        try {
            const response = await bot.sendMessage(chatId, text, options);
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

    // Try sending the message with different options
    let response = await attemptSendMessage(options);
    if (response) return response;
    options.reply_to_message_id = null;
    response = await attemptSendMessage(options);
    if (response) return response;
    console.log('message before removing thread id',msg)
    options.message_thread_id = null;
    return await attemptSendMessage(options);
}
async function sendPhoto(msg, fileUrl) {
    try {
        const response = await bot.sendPhoto(msg.chat.id, fileUrl, optionAppendage(msg));
        return response;
    } catch (error) {
        console.error('sendPhoto error:', error.message || error);
        return null;
    }
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

async function react(message) {
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
    sendAnimation,
    sendMessage,
    sendVideo,
    safeExecute,
    setUserState,
    react,
    compactSerialize,
    makeBaseData,
    editMessage,
}