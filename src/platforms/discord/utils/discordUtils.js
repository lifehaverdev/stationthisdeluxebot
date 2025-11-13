/**
 * Discord Platform Utilities
 * 
 * Utility functions for Discord-specific operations like reactions and file handling.
 */

/**
 * Set a reaction on a Discord message
 * Note: Discord reactions are user-initiated, but bots can react to messages
 * 
 * @param {object} message - Discord Message instance
 * @param {string} emoji - Emoji to react with (can be Unicode emoji or custom emoji ID/name)
 * @returns {Promise<boolean>} Success status
 */
async function setReaction(message, emoji) {
    if (!message || !emoji) {
        console.error('[Discord Utils] Missing parameters for setReaction', { message: !!message, emoji });
        return false;
    }
    
    try {
        await message.react(emoji);
        return true;
    } catch (error) {
        console.error('[Discord Utils] Error setting message reaction:', {
            messageId: message.id,
            emoji,
            error: error.message || error,
        });
        return false;
    }
}

/**
 * Get file URL from Discord message attachment
 * Discord attachments have direct URLs, no API call needed
 * 
 * @param {object} message - Discord Message instance
 * @param {number} [index=0] - Attachment index (default: first attachment)
 * @returns {string|null} File URL or null if no attachment found
 */
async function getDiscordFileUrl(message, index = 0) {
    if (!message || !message.attachments || message.attachments.size === 0) {
        return null;
    }

    try {
        const attachments = Array.from(message.attachments.values());
        if (attachments[index]) {
            return attachments[index].url;
        }
        return null;
    } catch (error) {
        console.error('[Discord Utils] Error getting file URL:', error);
        return null;
    }
}

/**
 * Get all file URLs from a Discord message
 * 
 * @param {object} message - Discord Message instance
 * @returns {Array<string>} Array of file URLs
 */
async function getAllDiscordFileUrls(message) {
    if (!message || !message.attachments || message.attachments.size === 0) {
        return [];
    }

    try {
        const attachments = Array.from(message.attachments.values());
        return attachments.map(att => att.url);
    } catch (error) {
        console.error('[Discord Utils] Error getting file URLs:', error);
        return [];
    }
}

/**
 * Get image file from Discord message (first image attachment)
 * 
 * @param {object} message - Discord Message instance
 * @returns {object|null} Attachment object or null
 */
async function getDiscordImageFile(message) {
    if (!message || !message.attachments || message.attachments.size === 0) {
        return null;
    }

    try {
        const attachments = Array.from(message.attachments.values());
        // Find first image attachment
        const imageAttachment = attachments.find(att => 
            att.contentType && att.contentType.startsWith('image/')
        );
        return imageAttachment || attachments[0] || null;
    } catch (error) {
        console.error('[Discord Utils] Error getting image file:', error);
        return null;
    }
}

/**
 * Check if a message has attachments
 * 
 * @param {object} message - Discord Message instance
 * @returns {boolean} True if message has attachments
 */
function hasAttachments(message) {
    return message && message.attachments && message.attachments.size > 0;
}

/**
 * Get the first attachment URL from a message (for compatibility with Telegram pattern)
 * 
 * @param {object} message - Discord Message instance
 * @returns {Promise<string|null>} File URL or null
 */
async function getDiscordFileUrlFromMessage(message) {
    return await getDiscordFileUrl(message, 0);
}

module.exports = {
    setReaction,
    getDiscordFileUrl,
    getAllDiscordFileUrls,
    getDiscordImageFile,
    hasAttachments,
    getDiscordFileUrlFromMessage,
};

