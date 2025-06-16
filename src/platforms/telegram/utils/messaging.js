const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

/**
 * A centralized collection of Telegram messaging functions that enforce
 * consistent behavior, such as automatic MarkdownV2 escaping.
 * All user-facing messages sent from the Telegram platform should use these helpers.
 */

/**
 * Sends a text message with automatic MarkdownV2 escaping.
 *
 * @param {object} bot - The node-telegram-bot-api instance.
 * @param {number|string} chatId - The ID of the chat to send the message to.
 * @param {string} text - The raw, unescaped text to send.
 * @param {object} [options={}] - Additional options for the sendMessage call. `parse_mode` will be overwritten.
 * @returns {Promise<object>} The sent message object from the Telegram API.
 */
async function sendEscapedMessage(bot, chatId, text, options = {}) {
    const defaultOptions = {
        parse_mode: 'MarkdownV2',
    };

    const finalOptions = { ...options, ...defaultOptions };
    const escapedText = escapeMarkdownV2(text);

    return bot.sendMessage(chatId, escapedText, finalOptions);
}

/**
 * Edits the text of an existing message with automatic MarkdownV2 escaping.
 *
 * @param {object} bot - The node-telegram-bot-api instance.
 * @param {number|string} chatId - The ID of the chat where the message is.
 * @param {number} messageId - The ID of the message to edit.
 * @param {string} text - The new, raw, unescaped text for the message.
 * @param {object} [options={}] - Additional options for the editMessageText call. `parse_mode` will be overwritten.
 * @returns {Promise<object|boolean>} The edited message object or `true` on success.
 */
async function editEscapedMessageText(bot, chatId, messageId, text, options = {}) {
    const defaultOptions = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
    };

    const finalOptions = { ...options, ...defaultOptions };
    const escapedText = escapeMarkdownV2(text);

    return bot.editMessageText(escapedText, finalOptions);
}

/**
 * Sends a photo with a caption that is automatically MarkdownV2 escaped.
 *
 * @param {object} bot - The node-telegram-bot-api instance.
 * @param {number|string} chatId - The ID of the chat to send the photo to.
 * @param {string|stream.Stream|Buffer} photo - The photo to send. Can be a file_id, URL, file path, or buffer.
 * @param {object} [options={}] - Additional options for the sendPhoto call. `parse_mode` and `caption` will be overwritten.
 * @param {string} [caption=''] - The raw, unescaped caption for the photo.
 * @returns {Promise<object>} The sent message object from the Telegram API.
 */
async function sendPhotoWithEscapedCaption(bot, chatId, photo, options = {}, caption = '') {
    const escapedCaption = escapeMarkdownV2(caption);

    const finalOptions = {
        ...options,
        caption: escapedCaption,
        parse_mode: 'MarkdownV2',
    };

    return bot.sendPhoto(chatId, photo, finalOptions);
}


module.exports = {
    sendEscapedMessage,
    editEscapedMessageText,
    sendPhotoWithEscapedCaption,
}; 