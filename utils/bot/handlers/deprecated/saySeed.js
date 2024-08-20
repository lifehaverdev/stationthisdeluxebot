const { lobby } = require('../bot')
const { sendMessage } = require('../../utils')

function saySeed(message){
    if(lobby[message.from.id]){
        sendMessage(message,`the last seed you used was ${lobby[message.from.id].lastSeed}`);
    } else {
        sendMessage(message, 'gen something and Ill tell you what seed you used');
    }
}

module.exports = {saySeed}