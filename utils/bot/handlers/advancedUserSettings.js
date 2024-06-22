const { lobby, compactSerialize } = require('../bot');
const { sendMessage, makeBaseData } = require('../../utils')



async function handleAdvancedUserOptions(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    //console.log('message in handle advanced',message);
    if (lobby[userId].advancedUser && chatId > 0) {
        // Prepare data for callback serialization
        const baseData = makeBaseData(message)
        //console.log(baseData);
        //console.log(compactSerialize({ ...baseData, action: 'regen' }))
        // Create inline keyboard with compact serialized callback data
        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Regenerate', callback_data: compactSerialize({ ...baseData, action: 'regen' }) },
                    { text: 'Set', callback_data: compactSerialize({ ...baseData, action: 'set' }) },
                ]
            ]
        };
        console.log('this is the message advanced settings is replying to ', message)
        // Send the message with inline keyboard
        sendMessage(message, `Used seed: ${lobby[userId].lastSeed}`, replyMarkup);
    }
}

module.exports = {
    handleAdvancedUserOptions
}