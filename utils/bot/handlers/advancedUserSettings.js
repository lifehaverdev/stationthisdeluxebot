const { lobby, compactSerialize } = require('../bot');
const { sendMessage } = require('../../utils')



async function handleAdvancedUserOptions(message) {
    const userId = message.from.id;
    const chatId = message.chat.id;
    //console.log('message in handle advanced',message);
    if (lobby[userId].advancedUser && chatId > 0) {
        // Prepare data for callback serialization
        const baseData = {
            text: 'k',
            id: message.message_id,
            fromId: message.from.id,
            chatId: message.chat.id,
            firstName: message.from.first_name.slice(0, 10), // Limit length of the name to avoid exceeding limit
            threadId: message.message_thread_id || 0 // Use 0 if thread ID is not available
        };
        console.log(baseData);
        console.log(compactSerialize({ ...baseData, action: 'regen' }))
        // Create inline keyboard with compact serialized callback data
        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Regenerate', callback_data: compactSerialize({ ...baseData, action: 'regen' }) },
                    { text: 'Set CFG', callback_data: compactSerialize({ ...baseData, action: 'setcfg' }) },
                    { text: 'Set Prompt', callback_data: compactSerialize({ ...baseData, action: 'setprompt' }) }
                ]
            ]
        };

        // Send the message with inline keyboard
        sendMessage(message, `Used seed: ${lobby[userId].lastSeed}`, replyMarkup);
    }
}

module.exports = {
    handleAdvancedUserOptions
}