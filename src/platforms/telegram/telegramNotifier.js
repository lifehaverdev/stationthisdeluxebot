// src/platforms/telegram/telegramNotifier.js

const { 
    sendEscapedMessage, 
    sendPhotoWithEscapedCaption, 
    sendAnimationWithEscapedCaption, 
    sendVideoWithEscapedCaption,
    sendDocumentWithEscapedCaption
} = require('./utils/messaging');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Placeholder for actual Telegram message sending utilities
// These might come from a central bot service or utils like '../../utils/utils.js'
// For now, we assume sendMessage is a function available or passed via a bot instance.

class TelegramNotifier {
  constructor(bot, logger) {
    if (!bot) {
      throw new Error('[TelegramNotifier] Telegram bot instance is required.');
    }
    if (!logger) {
      throw new Error('[TelegramNotifier] Logger is required.');
    }
    this.bot = bot;
    this.logger = logger;
    this.logger.info('[TelegramNotifier] Initialized.');
  }

  /**
   * Sends a notification to Telegram.
   * @param {Object} notificationContext - Context for the notification.
   * @param {string} notificationContext.chatId - The Telegram chat ID to send to.
   * @param {string} [notificationContext.userId] - The Telegram user ID (optional, for logging or context).
   * @param {string} [notificationContext.messageId] - The original message ID to reply to (optional).
   * @param {string} messageContent - The text message to send.
   * @param {Object} generationRecord - The full generation record for additional context (optional).
   * @returns {Promise<void>} 
   */
  async sendNotification(notificationContext, messageContent, generationRecord) {
    const { chatId, replyToMessageId } = notificationContext;

    if (!chatId) {
      this.logger.error('[TelegramNotifier] Attempted to send notification but chatId is missing in notificationContext.', notificationContext);
      throw new Error('Missing chatId in notificationContext for Telegram notification.');
    }

    this.logger.info(`[TelegramNotifier] Sending notification to chatId: ${chatId}, replyToMessageId: ${replyToMessageId || 'N/A'}.`);

    const options = {};
    if (replyToMessageId) {
      options.reply_to_message_id = replyToMessageId;
    }

    if (generationRecord && generationRecord.status === 'completed') {
      const generationId = generationRecord._id || generationRecord.id;
      options.reply_markup = {
        inline_keyboard: [
          [
            { text: '😻', callback_data: `rate_gen:${generationId}:beautiful` },
            { text: '😹', callback_data: `rate_gen:${generationId}:funny` },
            { text: '😿', callback_data: `rate_gen:${generationId}:negative` }
          ],
          [
            { text: '-', callback_data: 'hide_menu'},
            { text: 'ℹ︎', callback_data: `view_gen_info:${generationId}` },
            { text: '✎', callback_data: `tweak_gen:${generationId}` },
            { text: (generationRecord.metadata?.rerunCount || 0) > 0 ? `↻${generationRecord.metadata.rerunCount}` : '↻', callback_data: `rerun_gen:${generationId}` }
          ]
        ]
      };

      // --- New Multi-Output Handling Logic ---
      const mediaToSend = [];
      let textOutputs = [];
      const deliveryHints = generationRecord.metadata?.deliveryHints?.telegram || {};
      const sendAsDocument = deliveryHints['send-as'] === 'document';
      const suggestedFilename = deliveryHints.filename || 'output.png';

      if (generationRecord.responsePayload && Array.isArray(generationRecord.responsePayload)) {
        for (const output of generationRecord.responsePayload) {
            if (!output.data) continue;

            // Collect Text
            if (output.data.text && Array.isArray(output.data.text)) {
                textOutputs.push(...output.data.text);
            }

            // Collect Images
            if (output.data.images && Array.isArray(output.data.images)) {
                output.data.images.forEach(image => {
                    if (image.url) mediaToSend.push({ type: sendAsDocument ? 'document' : 'photo', url: image.url, caption: '', filename: suggestedFilename });
                });
            }

            // Collect Videos/Animations from 'files'
            if (output.data.files && Array.isArray(output.data.files)) {
                for (const file of output.data.files) {
                    if (!file.url) continue;

                    if (file.format && file.format.startsWith('video/')) {
                        mediaToSend.push({ type: 'video', url: file.url, caption: '' });
                    } else if (file.filename && (file.filename.endsWith('.txt') || file.format === 'text/plain')) {
                        try {
                            this.logger.info(`[TelegramNotifier] Fetching text content from ${file.url}`);
                            const response = await fetch(file.url);
                            if (response.ok) {
                                const textContent = await response.text();
                                textOutputs.push(textContent);
                            } else {
                                this.logger.warn(`[TelegramNotifier] Failed to fetch text from ${file.url}, status: ${response.status}`);
                            }
                        } catch (e) {
                            this.logger.error(`[TelegramNotifier] Error fetching text content from ${file.url}: ${e.message}`);
                        }
                    }
                }
            }
        }
      }
      
      // If after processing there's no media but there is text, send the text.
      // If there's media, the text will be sent as a separate message after.
      if (mediaToSend.length === 0 && textOutputs.length > 0) {
          await sendEscapedMessage(this.bot, chatId, textOutputs.join('\\n\\n'), options);
          this.logger.info(`[TelegramNotifier] Successfully sent text-only output to chatId: ${chatId}.`);
          return; // Exit after sending text
      }

      // Send all collected media items.
      try {
          for (let i = 0; i < mediaToSend.length; i++) {
              const media = mediaToSend[i];
              // Only attach the inline keyboard to the *last* media item to avoid clutter.
              const currentOptions = (i === mediaToSend.length - 1) ? options : { reply_to_message_id: replyToMessageId };

              this.logger.info(`[TelegramNotifier] Sending ${media.type} to ${chatId}. Attempting to fetch from URL: ${media.url}`);
              
              try {
                  const response = await fetch(media.url);
                  if (!response.ok) {
                      const errorBody = await response.text();
                      this.logger.error(`[TelegramNotifier] Failed to fetch media from URL ${media.url}. Status: ${response.status}. Body: ${errorBody.substring(0, 500)}`);
                      throw new Error(`Failed to fetch media from URL. Status: ${response.status}`);
                  }
                  
                  const arrayBuffer = await response.arrayBuffer();
                  const mediaBuffer = Buffer.from(arrayBuffer);
                  
                  this.logger.info(`[TelegramNotifier] Successfully fetched ${mediaBuffer.length} bytes for ${media.type} from ${media.url}. Sending to Telegram.`);

                  switch (media.type) {
                      case 'photo':
                          await sendPhotoWithEscapedCaption(this.bot, chatId, mediaBuffer, currentOptions, media.caption);
                          break;
                      case 'document':
                          await sendDocumentWithEscapedCaption(this.bot, chatId, mediaBuffer, media.filename || 'file', currentOptions, media.caption);
                          break;
                      case 'animation':
                          await sendAnimationWithEscapedCaption(this.bot, chatId, mediaBuffer, currentOptions, media.caption);
                          break;
                      case 'video':
                          await sendVideoWithEscapedCaption(this.bot, chatId, mediaBuffer, currentOptions, media.caption);
                          break;
                  }
              } catch (fetchError) {
                  this.logger.error(`[TelegramNotifier] Could not process media from URL ${media.url}. Error: ${fetchError.message} ${fetchError.stack}` );
                  // Propagate the error to the outer catch block to trigger the main fallback logic.
                  throw fetchError;
              }
          }
          // After all media is sent, send a separate message with all the text joined together.
          if (textOutputs.length > 0) {
              await sendEscapedMessage(this.bot, chatId, textOutputs.join('\\n\\n'), { reply_to_message_id: replyToMessageId });
          }

          this.logger.info(`[TelegramNotifier] Successfully sent all media and text for COMPLETED notification to chatId: ${chatId}.`);

      } catch (error) {
        this.logger.error(`[TelegramNotifier] Failed to send COMPLETED notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
        try {
          this.logger.warn(`[TelegramNotifier] Attempting to send fallback text message to ${chatId} after media send failure.`);
          // Send the original generic success message as fallback if media sending fails
          await sendEscapedMessage(this.bot, chatId, messageContent, options);
        } catch (fallbackError) {
          this.logger.error(`[TelegramNotifier] Fallback text message also failed for ${chatId}: ${fallbackError.message}`);
        }
        throw error; 
      }
    } else {
      // For FAILED messages or other types (non-completed jobs)
      try {
        await sendEscapedMessage(this.bot, chatId, messageContent, options);
        this.logger.info(`[TelegramNotifier] Successfully sent basic (non-completed) notification to chatId: ${chatId}.`);
      } catch (error) {
        this.logger.error(`[TelegramNotifier] Failed to send basic (non-completed) notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
        throw error; 
      }
    }
  }
}

module.exports = TelegramNotifier; 