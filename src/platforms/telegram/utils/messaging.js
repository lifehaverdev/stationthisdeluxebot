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
 * @param {string} text - The new, raw, unescaped text for the message.
 * @param {object} options - Additional options for the editMessageText call. Must contain chat_id and message_id. `parse_mode` will be overwritten.
 * @returns {Promise<object|boolean>} The edited message object or `true` on success.
 */
async function editEscapedMessageText(bot, text, options) {
    const finalOptions = { ...options, parse_mode: 'MarkdownV2' };
    const escapedText = escapeMarkdownV2(text);
    return bot.editMessageText(escapedText, finalOptions);
}

/**
 * Edits the caption of an existing message with automatic MarkdownV2 escaping.
 *
 * @param {object} bot - The node-telegram-bot-api instance.
 * @param {string} caption - The new, raw, unescaped caption.
 * @param {object} options - Options object, must contain chat_id and message_id. `parse_mode` will be overwritten.
 * @returns {Promise<object|boolean>} The edited message object or `true` on success.
 */
async function editEscapedMessageCaption(bot, caption, options) {
    const escapedCaption = escapeMarkdownV2(caption);
    const finalOptions = { ...options, parse_mode: 'MarkdownV2' };
    return bot.editMessageCaption(escapedCaption, finalOptions);
}

/**
 * Edits the media of an existing message, escaping the caption if provided.
 *
 * @param {object} bot - The node-telegram-bot-api instance.
 * @param {object} media - The media object (e.g., { type: 'photo', media: 'url', caption: 'raw_caption' }).
 * @param {object} options - Options object, must contain chat_id and message_id. `parse_mode` will be overwritten on the media object.
 * @returns {Promise<object|boolean>} The edited message object or `true` on success.
 */
async function editEscapedMessageMedia(bot, media, options) {
    const mediaWithEscapedCaption = { ...media };

    if (mediaWithEscapedCaption.caption) {
        mediaWithEscapedCaption.caption = escapeMarkdownV2(mediaWithEscapedCaption.caption);
    }
    
    mediaWithEscapedCaption.parse_mode = 'MarkdownV2';

    return bot.editMessageMedia(mediaWithEscapedCaption, options);
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

/**
 * Sends an animation (GIF, MP4) with a caption that is automatically MarkdownV2 escaped.
 *
 * @param {object} bot - The node-telegram-bot-api instance.
 * @param {number|string} chatId - The ID of the chat to send the animation to.
 * @param {string|stream.Stream|Buffer} animation - The animation to send.
 * @param {object} [options={}] - Additional options for the sendAnimation call.
 * @param {string} [caption=''] - The raw, unescaped caption for the animation.
 * @returns {Promise<object>} The sent message object.
 */
async function sendAnimationWithEscapedCaption(bot, chatId, animation, options = {}, caption = '') {
    const escapedCaption = escapeMarkdownV2(caption);
    const finalOptions = {
        ...options,
        caption: escapedCaption,
        parse_mode: 'MarkdownV2',
    };
    return bot.sendAnimation(chatId, animation, finalOptions);
}

/**
 * Sends a video with a caption that is automatically MarkdownV2 escaped.
 *
 * @param {object} bot - The node-telegram-bot-api instance.
 * @param {number|string} chatId - The ID of the chat to send the video to.
 * @param {string|stream.Stream|Buffer} video - The video to send.
 * @param {object} [options={}] - Additional options for the sendVideo call.
 * @param {string} [caption=''] - The raw, unescaped caption for the video.
 * @returns {Promise<object>} The sent message object.
 */
async function sendVideoWithEscapedCaption(bot, chatId, video, options = {}, caption = '') {
    const escapedCaption = escapeMarkdownV2(caption);
    const finalOptions = {
        ...options,
        caption: escapedCaption,
        parse_mode: 'MarkdownV2',
    };
    return bot.sendVideo(chatId, video, finalOptions);
}

module.exports = {
    sendEscapedMessage,
    editEscapedMessageText,
    editEscapedMessageCaption,
    editEscapedMessageMedia,
    sendPhotoWithEscapedCaption,
    sendAnimationWithEscapedCaption,
    sendVideoWithEscapedCaption,
}; 