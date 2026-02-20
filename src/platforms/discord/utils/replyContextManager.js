/**
 * Reply Context Manager for Discord
 * 
 * This utility provides a clean way to manage state for messages that require a user reply.
 * Instead of embedding context data into message text, we store it in a temporary, in-memory map.
 * The context is keyed by the channel ID and message ID of the bot's prompt message.
 * When a user replies, we can use the message reference to look up the original context.
 *
 * This avoids polluting user-facing messages with internal metadata and makes the reply-handling
 * logic cleaner and more robust.
 * 
 * Note: Discord doesn't have a direct "reply_to_message" concept like Telegram, but we can
 * use message references or store context by message ID.
 */

const pendingReplyContexts = new Map();

function getKey(channelId, messageId) {
    return `${channelId}_${messageId}`;
}

/**
 * Stores context for a message that expects a reply.
 * The context is automatically removed after a TTL to prevent memory leaks.
 * 
 * @param {object} sentMessage - The message object returned by channel.send() or message.edit().
 * @param {object} context - The context object to store (e.g., { type: 'lora_import', masterAccountId: '...' }).
 * @param {number} ttl - Time to live in milliseconds. Defaults to 1 hour (3,600,000 ms).
 */
function addContext(sentMessage, context, ttl = 3600000) {
    if (!sentMessage || !sentMessage.channel || !sentMessage.id) {
        console.error('[Discord ReplyContextManager] Invalid message object provided to addContext. Cannot store context.');
        return;
    }
    const key = getKey(sentMessage.channel.id, sentMessage.id);
    pendingReplyContexts.set(key, context);

    // Set a timeout to automatically remove the context if it's not cleared manually.
    setTimeout(() => {
        if (pendingReplyContexts.has(key)) {
            pendingReplyContexts.delete(key);
        }
    }, ttl);
}

/**
 * Retrieves context for a replied-to message.
 * 
 * @param {object} messageReference - The message.reference object from an incoming user message.
 * @param {string} channelId - Channel ID where the message was sent
 * @returns {object|null} The stored context object, or null if no context is found.
 */
function getContext(messageReference, channelId) {
    if (!messageReference || !messageReference.messageId) {
        return null;
    }
    const key = getKey(channelId, messageReference.messageId);
    return pendingReplyContexts.get(key) || null;
}

/**
 * Retrieves context by channel and message ID directly
 * 
 * @param {string} channelId - Channel ID
 * @param {string} messageId - Message ID
 * @returns {object|null} The stored context object, or null if no context is found.
 */
function getContextById(channelId, messageId) {
    const key = getKey(channelId, messageId);
    return pendingReplyContexts.get(key) || null;
}

/**
 * Removes context for a replied-to message, e.g., after it has been successfully used.
 * 
 * @param {object} messageReference - The message.reference object.
 * @param {string} channelId - Channel ID where the message was sent
 */
function removeContext(messageReference, channelId) {
    if (!messageReference || !messageReference.messageId) {
        return;
    }
    const key = getKey(channelId, messageReference.messageId);
    pendingReplyContexts.delete(key);
}

/**
 * Removes context by channel and message ID directly
 * 
 * @param {string} channelId - Channel ID
 * @param {string} messageId - Message ID
 */
function removeContextById(channelId, messageId) {
    const key = getKey(channelId, messageId);
    pendingReplyContexts.delete(key);
}

/**
 * Alias for addContext (for compatibility with Telegram pattern)
 * 
 * @param {object} sentMessage - The message object
 * @param {object} context - The context object
 * @param {number} ttl - Time to live in milliseconds
 */
function setContext(sentMessage, context, ttl) {
    addContext(sentMessage, context, ttl);
}

module.exports = {
    addContext,
    getContext,
    getContextById,
    removeContext,
    removeContextById,
    setContext,
};

