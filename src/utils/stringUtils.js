/**
 * Sanitizes a workflow name to be used as a Telegram command
 * Telegram command requirements:
 * - Must start with a letter
 * - Can only contain letters, numbers, and underscores
 * - Must be lowercase
 * - Length between 1 and 32 characters
 * 
 * @param {string} name - The original workflow name
 * @returns {string} - Sanitized command name
 */
function sanitizeCommandName(name) {
    return name
        // Convert to lowercase
        .toLowerCase()
        // Replace spaces and hyphens with underscores
        .replace(/[\s-]+/g, '_')
        // Remove any characters that aren't letters, numbers, or underscores
        .replace(/[^a-z0-9_]/g, '')
        // Ensure it starts with a letter (if it doesn't, prepend 'cmd_')
        .replace(/^(?![a-z])/, 'cmd_')
        // Truncate to 32 characters max
        .slice(0, 32);
}

/**
 * Converts a string into a URL-friendly slug.
 * - Converts to lowercase
 * - Removes special characters
 * - Replaces spaces and multiple hyphens with a single hyphen
 * @param {string} text The string to convert.
 * @returns {string} The slugified string.
 */
function slugify(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars except -
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

/**
 * Escapes special characters in a string for Telegram MarkdownV2 format.
 * Telegram specifies the following characters must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * @param {string | number | undefined | null} text The text to escape.
 * @returns {string} The escaped text, or an empty string if input is null/undefined.
 */
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') {
        return '';
    }
    // Escape all characters that have a special meaning in MarkdownV2.
    // Chars to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/**
 * Strips HTML tags from a string.
 * @param {string} str - The string to strip.
 * @returns {string} The string with HTML tags removed.
 */
function stripHtml(str) {
    if (typeof str !== 'string') {
        return '';
    }
    return str.replace(/<[^>]*>/g, '');
}

/**
 * Escapes only the characters that need escaping inside a MarkdownV2 `code` span.
 * According to Telegram, only backslash and backtick must be escaped there.
 * @param {string|number|null|undefined} text
 * @returns {string}
 */
function escapeMarkdownV2ForCode(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/([\\`.])/g, '\\$1');
}

module.exports = {
    sanitizeCommandName,
    slugify,
    escapeMarkdownV2,
    escapeMarkdownV2ForCode,
    stripHtml,
};