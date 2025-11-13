/**
 * Platform-Agnostic Types
 * 
 * Common type definitions for platform adapters.
 * These types abstract away platform-specific differences.
 */

/**
 * @typedef {Object} MessageContext
 * @property {string} channelId - Channel/chat ID where message was sent
 * @property {string} messageId - Message ID
 * @property {string} [userId] - User ID who sent the message
 * @property {string} [replyToMessageId] - ID of message being replied to
 * @property {Object} [platformSpecific] - Platform-specific data (e.g., Discord interaction, Telegram message)
 */

/**
 * @typedef {Object} SendMessageOptions
 * @property {string} [replyToMessageId] - ID of message to reply to
 * @property {Array<Array<ButtonDefinition>>} [buttons] - Inline keyboard buttons
 * @property {string} [parseMode] - Text parsing mode ('markdown', 'html', 'none')
 * @property {boolean} [ephemeral] - Only visible to user (Discord) / private chat (Telegram)
 * @property {Object} [platformSpecific] - Platform-specific options
 */

/**
 * @typedef {Object} ButtonDefinition
 * @property {string} text - Button label
 * @property {string} action - Action identifier (maps to callback_data/custom_id)
 * @property {string} [url] - URL for link buttons
 * @property {string} [style] - Button style ('primary', 'secondary', 'success', 'danger', 'link')
 */

/**
 * @typedef {Object} MediaOptions
 * @property {string} [caption] - Media caption
 * @property {string} [filename] - Filename for documents
 * @property {string} [parseMode] - Caption parsing mode
 * @property {Array<Array<ButtonDefinition>>} [buttons] - Inline keyboard buttons
 * @property {string} [replyToMessageId] - ID of message to reply to
 */

/**
 * @typedef {Object} CommandDefinition
 * @property {string} name - Command name
 * @property {string} description - Command description
 * @property {Array<CommandOption>} [options] - Command options/arguments
 */

/**
 * @typedef {Object} CommandOption
 * @property {string} name - Option name
 * @property {string} description - Option description
 * @property {string} type - Option type ('string', 'integer', 'boolean', etc.)
 * @property {boolean} [required] - Whether option is required
 * @property {Array} [choices] - Predefined choices for the option
 */

/**
 * @typedef {Object} InteractionResponse
 * @property {string} interactionId - Interaction/callback ID
 * @property {string} [text] - Response text
 * @property {boolean} [showAlert] - Show as alert (Telegram) or ephemeral (Discord)
 * @property {boolean} [success] - Whether interaction was successful
 */

/**
 * @typedef {Object} ChatInfo
 * @property {string} id - Chat/channel ID
 * @property {string} type - Chat type ('private', 'group', 'channel', 'guild')
 * @property {string} [title] - Chat title/name
 * @property {string} [username] - Chat username (if applicable)
 */

/**
 * @typedef {Object} MemberInfo
 * @property {string} userId - User ID
 * @property {string} [username] - Username
 * @property {string} [displayName] - Display name
 * @property {boolean} [isAdmin] - Whether user is admin
 * @property {Object} [permissions] - Platform-specific permissions object
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} fileId - Platform-specific file ID
 * @property {string} url - Direct URL to file (if available)
 * @property {number} [fileSize] - File size in bytes
 * @property {string} [mimeType] - MIME type
 */

/**
 * Platform identifier
 * @typedef {'telegram'|'discord'} Platform
 */

module.exports = {
  // Types are exported via JSDoc comments
  // This file serves as documentation and type reference
};

