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
async function sendMessage(msg, text, replyMarkup = null) {
    console.log('I would love to send a message here',text);
    if(text == ''){
        return
    }
    const chatId = msg.chat.id;
    const options = {
        chat_id: chatId,
        text: text,
        reply_markup: replyMarkup,  // Include the inline keyboard if provided
    };
    if (msg.message_id) {
        options.reply_to_message_id = msg.message_id
    }
    if (msg.message_thread_id) {
        options.message_thread_id = msg.message_thread_id;
    }
    
    try {
        console.log('alright lets try to send this then',options)
        const messageOutput = await bot.sendMessage(chatId, text, options);
        console.log('Message sent successfully:', messageOutput);
        return messageOutput;
    } catch (error) {
        console.error('Error sending message:', error.response.body);
        throw error;
    }
}
async function sendPhoto(msg, fileUrl) {
    return await bot.sendPhoto(msg.chat.id,fileUrl,optionAppendage(msg));    
}
async function sendAnimation(msg, fileUrl) {
    return await bot.sendAnimation(msg.chat.id,fileUrl,optionAppendage(msg));    
}
async function sendVideo(msg, fileUrl) {
    return await bot.sendVideo(chatId,fileUrl,optionAppendage(msg));    
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

module.exports = {
    sendPhoto,
    sendAnimation,
    sendMessage,
    sendVideo,
    safeExecute,
    setUserState
}