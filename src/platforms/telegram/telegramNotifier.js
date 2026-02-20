// src/platforms/telegram/telegramNotifier.js

const {
    sendEscapedMessage,
    sendPhotoWithEscapedCaption,
    sendAnimationWithEscapedCaption,
    sendVideoWithEscapedCaption,
    sendDocumentWithEscapedCaption,
    sendPhotoMediaGroup
} = require('./utils/messaging');
const ResponsePayloadNormalizer = require('../../core/services/notifications/ResponsePayloadNormalizer');
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
    this.logger.debug('[TelegramNotifier] Initialized.');
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

      // --- Multi-Output Handling Logic (using centralized normalizer) ---
      const mediaToSend = [];
      const deliveryHints = generationRecord.metadata?.deliveryHints?.telegram || {};
      const sendAsDocument = deliveryHints['send-as'] === 'document'
        || generationRecord.metadata?.telegramSendAsDocument === true;
      const suggestedFilename = deliveryHints.filename || 'output.png';
      const isGroupChat = chatId < 0; // Telegram group/supergroup IDs are negative
      const targetChatForDocument = (sendAsDocument && isGroupChat && notificationContext.userId) ? notificationContext.userId : chatId;

      // Normalize responsePayload using centralized normalizer
      const normalizedPayload = ResponsePayloadNormalizer.normalize(
        generationRecord.responsePayload,
        { logger: this.logger }
      );
      this.logger.debug(`[TelegramNotifier] Normalized payload: ${normalizedPayload.length} item(s). Types: ${normalizedPayload.map(i => `${i.type}(${i.data?.images?.length || 0} images, ${i.data?.files?.length || 0} files)`).join(', ')}`);

      // Extract text and media from normalized payload
      const textOutputs = ResponsePayloadNormalizer.extractText(normalizedPayload);
      const extractedMedia = ResponsePayloadNormalizer.extractMedia(normalizedPayload);

      // Log extracted media types for debugging
      this.logger.debug(`[TelegramNotifier] Extracted ${extractedMedia.length} media items: ${extractedMedia.map(m => `${m.type} (${m.url?.substring(0, 50)}...)`).join(', ')}`);
      this.logger.debug(`[TelegramNotifier] sendAsDocument: ${sendAsDocument}, deliveryHints: ${JSON.stringify(deliveryHints)}`);

      // Process media and apply Telegram-specific formatting
      for (const media of extractedMedia) {
        if (media.type === 'photo') {
          const finalType = sendAsDocument ? 'document' : 'photo';
          this.logger.debug(`[TelegramNotifier] Processing photo media: ${finalType} (sendAsDocument=${sendAsDocument})`);
          mediaToSend.push({
            type: finalType,
            url: media.url,
            caption: '',
            filename: media.filename || suggestedFilename
                });
        } else if (media.type === 'video') {
          mediaToSend.push({ 
            type: 'video', 
            url: media.url, 
            caption: '' 
          });
        } else if (media.type === 'animation') {
          mediaToSend.push({ 
            type: 'animation', 
            url: media.url, 
            caption: '' 
          });
        } else {
          // Handle text files (fetch content)
          if (media.filename && (media.filename.endsWith('.txt') || media.format === 'text/plain')) {
                        try {
              this.logger.info(`[TelegramNotifier] Fetching text content from ${media.url}`);
              const response = await fetch(media.url);
                            if (response.ok) {
                                const textContent = await response.text();
                                textOutputs.push(textContent);
                            } else {
                this.logger.warn(`[TelegramNotifier] Failed to fetch text from ${media.url}, status: ${response.status}`);
                            }
                        } catch (e) {
              this.logger.error(`[TelegramNotifier] Error fetching text content from ${media.url}: ${e.message}`);
                        }
          } else {
            // Other file types as document
            mediaToSend.push({ 
              type: 'document', 
              url: media.url, 
              caption: '', 
              filename: media.filename || suggestedFilename 
            });
            }
        }
      }
      
      // === Deduplicate Text Outputs to avoid repeated captions ===
      if (textOutputs.length > 1) {
          const seen = new Set();
          textOutputs = textOutputs.filter(txt => {
              const normalized = typeof txt === 'string' ? txt.trim() : txt;
              if (seen.has(normalized)) return false;
              seen.add(normalized);
              return true;
          });
      }

      // Log what we found for debugging
      this.logger.info(`[TelegramNotifier] Processed responsePayload: found ${textOutputs.length} text outputs, ${mediaToSend.length} media items`);

      // If after processing there's no media but there is text, send the text.
      // If there's media, the text will be sent as a separate message after.
      if (mediaToSend.length === 0 && textOutputs.length > 0) {
          await sendEscapedMessage(this.bot, chatId, textOutputs.join('\\n\\n'), options);
          this.logger.info(`[TelegramNotifier] Successfully sent text-only output to chatId: ${chatId}.`);
          return; // Exit after sending text
      }

      // Send all collected media items.
      this.logger.info(`[TelegramNotifier] Collected ${mediaToSend.length} media items to send: ${JSON.stringify(mediaToSend.map(m => ({ type: m.type, url: m.url })))}`);

      try {
          // Separate photos from non-photo items for potential media group batching
          const photoItems = mediaToSend.filter(m => m.type === 'photo');
          const nonPhotoItems = mediaToSend.filter(m => m.type !== 'photo');
          let keyboardAttached = false;

          // --- Photos: batch as media group if 2+, otherwise send individually ---
          if (photoItems.length >= 2) {
              try {
                  await sendPhotoMediaGroup(this.bot, chatId, photoItems, { reply_to_message_id: replyToMessageId });
                  this.logger.info(`[TelegramNotifier] Sent ${photoItems.length} photos as media group`);
                  // Note: sendMediaGroup doesn't support reply_markup; keyboard goes on a later message
              } catch (groupErr) {
                  this.logger.warn(`[TelegramNotifier] sendMediaGroup failed (${groupErr.message}), falling back to individual photo sends`);
                  for (const media of photoItems) {
                      const response = await fetch(media.url);
                      if (!response.ok) throw new Error(`Failed to fetch media from URL. Status: ${response.status}`);
                      const mediaBuffer = Buffer.from(await response.arrayBuffer());
                      await sendPhotoWithEscapedCaption(this.bot, chatId, mediaBuffer, { reply_to_message_id: replyToMessageId }, media.caption);
                  }
              }
          } else if (photoItems.length === 1) {
              const media = photoItems[0];
              const photoOptions = (nonPhotoItems.length === 0 && textOutputs.length === 0) ? options : { reply_to_message_id: replyToMessageId };
              const response = await fetch(media.url);
              if (!response.ok) throw new Error(`Failed to fetch media from URL. Status: ${response.status}`);
              const mediaBuffer = Buffer.from(await response.arrayBuffer());
              await sendPhotoWithEscapedCaption(this.bot, chatId, mediaBuffer, photoOptions, media.caption);
              if (nonPhotoItems.length === 0 && textOutputs.length === 0) keyboardAttached = true;
          }

          // --- Non-photo items: send individually ---
          for (let i = 0; i < nonPhotoItems.length; i++) {
              const media = nonPhotoItems[i];
              const isLast = (i === nonPhotoItems.length - 1) && textOutputs.length === 0;
              const currentOptions = isLast && !keyboardAttached ? options : { reply_to_message_id: replyToMessageId };

              let destChatId = chatId;
              if (media.type === 'document') {
                destChatId = targetChatForDocument;
                if (destChatId !== chatId) {
                  delete currentOptions.reply_to_message_id;
                  delete currentOptions.reply_markup;
                }
              }
              this.logger.info(`[TelegramNotifier] Sending ${media.type} to ${destChatId}. Attempting to fetch from URL: ${media.url}`);

              const response = await fetch(media.url);
              if (!response.ok) {
                  const errorBody = await response.text();
                  this.logger.error(`[TelegramNotifier] Failed to fetch media from URL ${media.url}. Status: ${response.status}. Body: ${errorBody.substring(0, 500)}`);
                  throw new Error(`Failed to fetch media from URL. Status: ${response.status}`);
              }
              const mediaBuffer = Buffer.from(await response.arrayBuffer());
              this.logger.info(`[TelegramNotifier] Successfully fetched ${mediaBuffer.length} bytes for ${media.type}. Sending to Telegram.`);

              switch (media.type) {
                  case 'document':
                      await sendDocumentWithEscapedCaption(this.bot, destChatId, mediaBuffer, media.filename || 'file', currentOptions, media.caption);
                      break;
                  case 'animation':
                      await sendAnimationWithEscapedCaption(this.bot, chatId, mediaBuffer, currentOptions, media.caption);
                      break;
                  case 'video':
                      await sendVideoWithEscapedCaption(this.bot, chatId, mediaBuffer, currentOptions, media.caption);
                      break;
              }
              if (isLast && !keyboardAttached) keyboardAttached = true;
          }

          // After all media is sent, send a separate message with all the text joined together.
          let textSent = false;
          if (textOutputs.length > 0) {
              const textOptions = !keyboardAttached ? options : { reply_to_message_id: replyToMessageId };
              await sendEscapedMessage(this.bot, chatId, textOutputs.join('\\n\\n'), textOptions);
              textSent = true;
              keyboardAttached = true;
          }

          // If we redirected document to user's private chat, notify in group
          if (sendAsDocument && isGroupChat && notificationContext.userId) {
              await sendEscapedMessage(this.bot, chatId, '📄 Your file has been sent to you in a private chat.', { reply_to_message_id: replyToMessageId });
          }

          // Only log success if something was actually sent
          const mediaSent = mediaToSend.length > 0;
          if (mediaSent || textSent) {
              this.logger.info(`[TelegramNotifier] Successfully sent all media and text for COMPLETED notification to chatId: ${chatId}.`);
          } else {
              this.logger.warn(`[TelegramNotifier] No content to send for COMPLETED notification to chatId: ${chatId}. responsePayload: ${JSON.stringify(generationRecord.responsePayload)}`);
              // Fallback: send the generic messageContent if nothing else was sent
              await sendEscapedMessage(this.bot, chatId, messageContent, options);
              this.logger.info(`[TelegramNotifier] Sent fallback messageContent to chatId: ${chatId}.`);
          }

      } catch (error) {
        this.logger.error(`[TelegramNotifier] Failed to send COMPLETED notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
        try {
          this.logger.warn(`[TelegramNotifier] Attempting to send fallback text message to ${chatId} after media send failure.`);
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