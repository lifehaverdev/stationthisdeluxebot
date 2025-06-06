/**
 * Reply Context Manager for Telegram
 * 
 * This utility provides a clean way to manage state for messages that require a user reply.
 * Instead of embedding context data into message text, we store it in a temporary, in-memory map.
 * The context is keyed by the chat ID and message ID of the bot's prompt message.
 * When a user replies, we can use the `reply_to_message` object to look up the original context.
 *
 * This avoids polluting user-facing messages with internal metadata and makes the reply-handling
 * logic in the main bot file cleaner and more robust.
 */

const pendingReplyContexts = new Map();

function getKey(chatId, messageId) {
    return `${chatId}_${messageId}`;
}

/**
 * Stores context for a message that expects a reply.
 * The context is automatically removed after a TTL to prevent memory leaks.
 * 
 * @param {object} sentMessage - The message object returned by bot.sendMessage or bot.editMessageText.
 * @param {object} context - The context object to store (e.g., { type: 'lora_import', masterAccountId: '...' }).
 * @param {number} ttl - Time to live in milliseconds. Defaults to 1 hour (3,600,000 ms).
 */
function addContext(sentMessage, context, ttl = 3600000) {
    if (!sentMessage || !sentMessage.chat || !sentMessage.message_id) {
        console.error('[ReplyContextManager] Invalid message object provided to addContext. Cannot store context.');
        return;
    }
    const key = getKey(sentMessage.chat.id, sentMessage.message_id);
    pendingReplyContexts.set(key, context);

    // Set a timeout to automatically remove the context if it's not cleared manually.
    setTimeout(() => {
        if (pendingReplyContexts.has(key)) {
            pendingReplyContexts.delete(key);
            console.log(`[ReplyContextManager] Expired and removed context for key: ${key}`);
        }
    }, ttl);
}

/**
 * Retrieves context for a replied-to message.
 * 
 * @param {object} repliedToMessage - The message.reply_to_message object from an incoming user reply.
 * @returns {object|null} The stored context object, or null if no context is found.
 */
function getContext(repliedToMessage) {
    if (!repliedToMessage || !repliedToMessage.chat || !repliedToMessage.message_id) {
        return null;
    }
    const key = getKey(repliedToMessage.chat.id, repliedToMessage.message_id);
    return pendingReplyContexts.get(key) || null;
}

/**
 * Removes context for a replied-to message, e.g., after it has been successfully used.
 * 
 * @param {object} repliedToMessage - The message.reply_to_message object.
 */
function removeContext(repliedToMessage) {
    if (!repliedToMessage || !repliedToMessage.chat || !repliedToMessage.message_id) {
        return;
    }
    const key = getKey(repliedToMessage.chat.id, repliedToMessage.message_id);
    pendingReplyContexts.delete(key);
}

module.exports = {
    addContext,
    getContext,
    removeContext,
}; 