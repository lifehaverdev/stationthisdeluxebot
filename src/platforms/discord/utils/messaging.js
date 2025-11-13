/**
 * Discord Messaging Utilities
 * 
 * A centralized collection of Discord messaging functions that enforce
 * consistent behavior, such as automatic markdown escaping.
 * All user-facing messages sent from the Discord platform should use these helpers.
 */

const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Escapes special characters in a string for Discord markdown format.
 * Discord markdown uses: *bold*, _italic_, `code`, ~~strikethrough~~, ||spoiler||
 * Characters to escape: * _ ` ~ | \
 * 
 * @param {string|number|undefined|null} text - The text to escape.
 * @returns {string} The escaped text, or an empty string if input is null/undefined.
 */
function escapeDiscordMarkdown(text) {
    if (typeof text !== 'string' && typeof text !== 'number') {
        return '';
    }
    const textStr = String(text);
    // Escape characters that have special meaning in Discord markdown
    // Chars to escape: * _ ` ~ | \
    return textStr.replace(/([*_`~|\\])/g, '\\$1');
}

/**
 * Converts platform-agnostic buttons to Discord message components
 * @param {Array<Array<Object>>} buttons - Button layout (rows of buttons)
 * @returns {Array<ActionRowBuilder>} Discord action rows
 */
function convertButtonsToComponents(buttons) {
    if (!buttons || buttons.length === 0) {
        return [];
    }

    // Discord limit: 5 action rows, 5 buttons per row
    const maxRows = 5;
    const maxButtonsPerRow = 5;
    
    const rows = [];
    for (let i = 0; i < Math.min(buttons.length, maxRows); i++) {
        const row = buttons[i];
        const actionRow = new ActionRowBuilder();
        
        for (let j = 0; j < Math.min(row.length, maxButtonsPerRow); j++) {
            const button = row[j];
            const discordButton = new ButtonBuilder()
                .setLabel(button.text)
                .setCustomId(button.action);

            // Set button style
            if (button.style) {
                const styleMap = {
                    'primary': ButtonStyle.Primary,
                    'secondary': ButtonStyle.Secondary,
                    'success': ButtonStyle.Success,
                    'danger': ButtonStyle.Danger,
                    'link': ButtonStyle.Link
                };
                discordButton.setStyle(styleMap[button.style] || ButtonStyle.Primary);
            } else {
                discordButton.setStyle(ButtonStyle.Primary);
            }

            // Handle URL buttons
            if (button.url) {
                discordButton.setStyle(ButtonStyle.Link).setURL(button.url);
                discordButton.setCustomId(null); // URL buttons don't use custom_id
            }

            actionRow.addComponents(discordButton);
        }
        
        rows.push(actionRow);
    }

    return rows;
}

/**
 * Sends a text message with automatic markdown escaping.
 *
 * @param {object} channel - The Discord TextChannel instance.
 * @param {string} text - The raw, unescaped text to send.
 * @param {object} [options={}] - Additional options for the send call.
 * @param {string} [options.replyToMessageId] - Message ID to reply to
 * @param {Array<Array<Object>>} [options.buttons] - Button layout
 * @param {boolean} [options.ephemeral] - Ephemeral message (only for interactions)
 * @returns {Promise<object>} The sent message object from Discord.
 */
async function sendEscapedMessage(channel, text, options = {}) {
    const escapedText = escapeDiscordMarkdown(text);
    
    const messageOptions = {
        content: escapedText
    };

    // Handle reply
    if (options.replyToMessageId) {
        messageOptions.reply = {
            messageReference: options.replyToMessageId,
            failIfNotExists: false
        };
    }

    // Handle buttons
    if (options.buttons && options.buttons.length > 0) {
        messageOptions.components = convertButtonsToComponents(options.buttons);
    }

    // Merge any additional options
    if (options.platformSpecific) {
        Object.assign(messageOptions, options.platformSpecific);
    }

    return await channel.send(messageOptions);
}

/**
 * Edits the text of an existing message with automatic markdown escaping.
 *
 * @param {object} message - The Discord Message instance to edit.
 * @param {string} text - The new, raw, unescaped text for the message.
 * @param {object} [options={}] - Additional options for the edit call.
 * @param {Array<Array<Object>>} [options.buttons] - New button layout (optional)
 * @returns {Promise<object>} The edited message object.
 */
async function editEscapedMessageText(message, text, options = {}) {
    const escapedText = escapeDiscordMarkdown(text);
    
    const editOptions = {
        content: escapedText
    };

    // Handle buttons update
    if (options.buttons !== undefined) {
        editOptions.components = convertButtonsToComponents(options.buttons);
    }

    // Merge any additional options
    if (options.platformSpecific) {
        Object.assign(editOptions, options.platformSpecific);
    }

    return await message.edit(editOptions);
}

/**
 * Sends a photo/image with a caption that is automatically markdown escaped.
 *
 * @param {object} channel - The Discord TextChannel instance.
 * @param {Buffer|string} photoBuffer - The photo buffer or URL to send.
 * @param {object} [options={}] - Additional options for the send call.
 * @param {string} [caption=''] - The raw, unescaped caption for the photo.
 * @param {string} [filename='image.png'] - Filename for the attachment
 * @returns {Promise<object>} The sent message object.
 */
async function sendPhotoWithEscapedCaption(channel, photoBuffer, options = {}, caption = '') {
    const escapedCaption = escapeDiscordMarkdown(caption);
    
    const attachment = photoBuffer instanceof Buffer
        ? new AttachmentBuilder(photoBuffer, { name: options.filename || 'image.png' })
        : photoBuffer; // If it's a URL, Discord can handle it directly

    const messageOptions = {
        files: [attachment]
    };

    if (escapedCaption) {
        messageOptions.content = escapedCaption;
    }

    if (options.replyToMessageId) {
        messageOptions.reply = {
            messageReference: options.replyToMessageId,
            failIfNotExists: false
        };
    }

    if (options.buttons && options.buttons.length > 0) {
        messageOptions.components = convertButtonsToComponents(options.buttons);
    }

    if (options.platformSpecific) {
        Object.assign(messageOptions, options.platformSpecific);
    }

    try {
        return await channel.send(messageOptions);
    } catch (error) {
        console.error('[Discord messaging] sendPhotoWithEscapedCaption error:', error.message);
        throw error;
    }
}

/**
 * Sends a video with a caption that is automatically markdown escaped.
 *
 * @param {object} channel - The Discord TextChannel instance.
 * @param {Buffer|string} videoBuffer - The video buffer or URL to send.
 * @param {object} [options={}] - Additional options for the send call.
 * @param {string} [caption=''] - The raw, unescaped caption for the video.
 * @param {string} [filename='video.mp4'] - Filename for the attachment
 * @returns {Promise<object>} The sent message object.
 */
async function sendVideoWithEscapedCaption(channel, videoBuffer, options = {}, caption = '') {
    const escapedCaption = escapeDiscordMarkdown(caption);
    
    const attachment = videoBuffer instanceof Buffer
        ? new AttachmentBuilder(videoBuffer, { name: options.filename || 'video.mp4' })
        : videoBuffer;

    const messageOptions = {
        files: [attachment]
    };

    if (escapedCaption) {
        messageOptions.content = escapedCaption;
    }

    if (options.replyToMessageId) {
        messageOptions.reply = {
            messageReference: options.replyToMessageId,
            failIfNotExists: false
        };
    }

    if (options.buttons && options.buttons.length > 0) {
        messageOptions.components = convertButtonsToComponents(options.buttons);
    }

    if (options.platformSpecific) {
        Object.assign(messageOptions, options.platformSpecific);
    }

    try {
        return await channel.send(messageOptions);
    } catch (error) {
        console.error('[Discord messaging] sendVideoWithEscapedCaption error:', error.message);
        throw error;
    }
}

/**
 * Sends a document/file with a caption that is automatically markdown escaped.
 *
 * @param {object} channel - The Discord TextChannel instance.
 * @param {Buffer|string} docBuffer - The document buffer or URL to send.
 * @param {string} [filename='file'] - The filename for the document.
 * @param {object} [options={}] - Additional options for the send call.
 * @param {string} [caption=''] - The raw, unescaped caption for the document.
 * @returns {Promise<object>} The sent message object.
 */
async function sendDocumentWithEscapedCaption(channel, docBuffer, filename = 'file', options = {}, caption = '') {
    const escapedCaption = escapeDiscordMarkdown(caption);
    
    const attachment = docBuffer instanceof Buffer
        ? new AttachmentBuilder(docBuffer, { name: filename })
        : docBuffer;

    const messageOptions = {
        files: [attachment]
    };

    if (escapedCaption) {
        messageOptions.content = escapedCaption;
    }

    if (options.replyToMessageId) {
        messageOptions.reply = {
            messageReference: options.replyToMessageId,
            failIfNotExists: false
        };
    }

    if (options.buttons && options.buttons.length > 0) {
        messageOptions.components = convertButtonsToComponents(options.buttons);
    }

    if (options.platformSpecific) {
        Object.assign(messageOptions, options.platformSpecific);
    }

    try {
        return await channel.send(messageOptions);
    } catch (error) {
        console.error('[Discord messaging] sendDocumentWithEscapedCaption error:', error.message);
        throw error;
    }
}

module.exports = {
    escapeDiscordMarkdown,
    convertButtonsToComponents,
    sendEscapedMessage,
    editEscapedMessageText,
    sendPhotoWithEscapedCaption,
    sendVideoWithEscapedCaption,
    sendDocumentWithEscapedCaption,
};

