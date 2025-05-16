require('dotenv').config();

async function getTelegramFileUrl(bot, message) {
  let fileId;
  const targetMessage = message.reply_to_message || message;

  if (targetMessage.photo) {
    fileId = targetMessage.photo[targetMessage.photo.length - 1].file_id;
  } else if (targetMessage.document && targetMessage.document.mime_type && targetMessage.document.mime_type.startsWith('image/')) {
    fileId = targetMessage.document.file_id;
  } else {
    return null;
  }

  try {
    const fileInfo = await bot.getFile(fileId);
    if (fileInfo.file_path) {
      const botToken = process.env.TELEGRAM_TOKEN;
      if (!botToken) {
        console.error('[Telegram Utils] TELEGRAM_TOKEN is not set in environment variables.');
        return null;
      }
      return `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
    }
    return null;
  } catch (error) {
    console.error("[Telegram Utils] Error fetching file URL:", error);
    return null;
  }
}

module.exports = {
  getTelegramFileUrl,
}; 