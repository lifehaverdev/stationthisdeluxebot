const { getBotInstance, lobby } = require('../bot'); 
const bot = getBotInstance()

function displayAccountSettingsMenu(message) {
    // Create account settings menu keyboard
    const userId = message.from.id;
    const chatId = message.chat.id;
    let accountSettingsKeyboard = [
        [
            {
                text: `Advanced User: ${lobby[userId].advancedUser ? 'Enabled' : 'Disabled'}`,
                callback_data: 'toggleAdvancedUser',
            },
            // {
            //     text: `Whale Mode: ${lobby[userId].whaleMode ? 'Enabled' : 'Disabled'}`,
            //     callback_data: 'toggleWhaleMode'
            // },
            
        ]
    ];

    if (lobby[userId].balance >= 0){//1000000) {
        accountSettingsKeyboard[0].push(
            {
                text: `Watermark: ${lobby[userId].waterMark ? 'ON' : 'OFF'}`,
                callback_data: 'toggleWaterMark',
            },
            {
                text: `Base Prompt Menu`,
                callback_data: 'toggleBasePrompt',
            },
            {
                text: `Voice Menu`,
                callback_data: 'toggleVoice'
            },
            {
                text: `ControlNet`,
                callback_data: 'toggleControlNet',
            },
            {
                text: 'Style Transfer',
                callback_data: 'toggleStyleTransfer'
            }
        );
    }
    if (lobby[userId].balance >= 0){//} 5000000) {
        accountSettingsKeyboard[0].push(
            {
                text: `Checkpoint Menu`,
                callback_data: 'toggleCheckpoint',
            },
        );
    }

    // Send account settings menu
    bot.sendMessage(chatId, 'Account Settings:', {
        reply_markup: {
            inline_keyboard: accountSettingsKeyboard
        }
    });
}

module.exports = {
    displayAccountSettingsMenu
}