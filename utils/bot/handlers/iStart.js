const { commandRegistry } = require('../bot')
const { sendMessage } = require('../../utils')

commandRegistry['/start'] = {
    handler: (message) => {
        sendMessage(message,'welcome to stationthisbot. you can create images from thin air. check out our /help to get started. you must have a solana wallet verified on your account to utilize $MS2 holder benefits. try /signin')
    }
};
