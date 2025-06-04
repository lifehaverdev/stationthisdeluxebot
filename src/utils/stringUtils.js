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
 * Escapes special characters in a string for Telegram MarkdownV2 format.
 * Telegram specifies the following characters must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * @param {string | number | undefined | null} text The text to escape.
 * @returns {string} The escaped text, or an empty string if input is null/undefined.
 */
function escapeMarkdownV2(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

module.exports = {
    sanitizeCommandName,
    escapeMarkdownV2
};