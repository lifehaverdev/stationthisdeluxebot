const axios = require('axios');
const logger = console; // Placeholder

/**
 * Sends a notification to the admin via Telegram about a new LoRA pending review.
 *
 * @param {object} lora - The newly created LoRA object from the database.
 */
async function sendAdminLoraApprovalRequest(lora) {
    const botToken = process.env.TELEGRAM_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_USER_ID;

    if (!botToken || !adminChatId) {
        logger.error('[TelegramNotifier] TELEGRAM_TOKEN or TELEGRAM_ADMIN_USER_ID not set. Cannot send admin notification.');
        return;
    }

    const loraId = lora._id.toString();
    const requesterId = lora.moderation?.requestedBy?.toString() || 'Unknown';

    // Using backticks for code blocks, which works with Telegram's MarkdownV2 parse mode
    const text = `
New LoRA Import Request for Review
-----------------------------------
*Name:* ${lora.name}
*Slug:* \`${lora.slug}\`
*Checkpoint:* ${lora.checkpoint || 'N/A'}
*Source:* [Civitai Link](${lora.importedFrom.url})
*Requested by MAID:* \`${requesterId}\`
    `;

    const keyboard = {
        inline_keyboard: [[
            { text: '✅ Approve Public', callback_data: `lora_admin:approve_public:${loraId}` },
            { text: '🔒 Approve Private', callback_data: `lora_admin:approve_private:${loraId}` },
            { text: '❌ Reject', callback_data: `lora_admin:reject:${loraId}` }
        ]]
    };

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
        await axios.post(telegramApiUrl, {
            chat_id: adminChatId,
            text: text,
            parse_mode: 'Markdown', // Using standard Markdown for this simple message
            reply_markup: keyboard,
        });
        logger.info(`[TelegramNotifier] Successfully sent admin approval request for LoRA ${loraId} to chat ${adminChatId}.`);
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`[TelegramNotifier] Failed to send admin notification for LoRA ${loraId}: ${errorMsg}`);
    }
}

module.exports = { sendAdminLoraApprovalRequest }; 