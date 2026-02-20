// src/platforms/discord/discordNotifier.js

const { 
    sendEscapedMessage,
    escapeDiscordMarkdown
} = require('./utils/messaging');
const ResponsePayloadNormalizer = require('../../core/services/notifications/ResponsePayloadNormalizer');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class DiscordNotifier {
  constructor(client, logger) {
    if (!client) {
      throw new Error('[DiscordNotifier] Discord client instance is required.');
    }
    if (!logger) {
      throw new Error('[DiscordNotifier] Logger is required.');
    }
    this.client = client;
    this.logger = logger;
    this.logger.debug('[DiscordNotifier] Initialized.');
  }

  /**
   * Sends a notification to Discord.
   * @param {Object} notificationContext - Context for the notification.
   * @param {string} notificationContext.channelId - The Discord channel ID to send to.
   * @param {string} [notificationContext.userId] - The Discord user ID (optional, for logging or context).
   * @param {string} [notificationContext.messageId] - The original message ID to reply to (optional).
   * @param {string} messageContent - The text message to send.
   * @param {Object} generationRecord - The full generation record for additional context (optional).
   * @returns {Promise<void>} 
   */
  async sendNotification(notificationContext, messageContent, generationRecord) {
    const { channelId, messageId } = notificationContext;

    if (!channelId) {
      this.logger.error('[DiscordNotifier] Attempted to send notification but channelId is missing in notificationContext.', notificationContext);
      throw new Error('Missing channelId in notificationContext for Discord notification.');
    }

    this.logger.info(`[DiscordNotifier] Sending notification to channelId: ${channelId}, messageId: ${messageId || 'N/A'}.`);

    // Get the channel
    let channel;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (error) {
      this.logger.error(`[DiscordNotifier] Failed to fetch channel ${channelId}:`, error.message);
      throw new Error(`Failed to fetch Discord channel: ${error.message}`);
    }

    const options = {};
    if (messageId) {
      options.replyToMessageId = messageId;
    }

    if (generationRecord && generationRecord.status === 'completed') {
      const generationId = generationRecord._id || generationRecord.id;
      
      // Build action buttons for completed generations
      const actionButtons = [
        new ButtonBuilder()
          .setCustomId(`rate_gen:${generationId}:beautiful`)
          .setLabel('😻')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`rate_gen:${generationId}:funny`)
          .setLabel('😹')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`rate_gen:${generationId}:negative`)
          .setLabel('😿')
          .setStyle(ButtonStyle.Secondary)
      ];

      const controlButtons = [
        new ButtonBuilder()
          .setCustomId('hide_menu')
          .setLabel('-')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`view_gen_info:${generationId}`)
          .setLabel('ℹ︎')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`tweak_gen:${generationId}`)
          .setLabel('✎')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`rerun_gen:${generationId}`)
          .setLabel((generationRecord.metadata?.rerunCount || 0) > 0 ? `↻${generationRecord.metadata.rerunCount}` : '↻')
          .setStyle(ButtonStyle.Secondary)
      ];

      const actionRow1 = new ActionRowBuilder().addComponents(...actionButtons);
      const actionRow2 = new ActionRowBuilder().addComponents(...controlButtons);
      options.components = [actionRow1, actionRow2];

      // --- Multi-Output Handling Logic (using centralized normalizer) ---
      const mediaToSend = [];
      const deliveryHints = generationRecord.metadata?.deliveryHints?.discord || generationRecord.metadata?.deliveryHints?.telegram || {};
      const sendAsDocument = deliveryHints['send-as'] === 'document';
      const suggestedFilename = deliveryHints.filename || 'output.png';
      const isGuildChannel = channel.guild !== null;
      const targetChannelForDocument = (sendAsDocument && isGuildChannel && notificationContext.userId) 
        ? await this.client.users.fetch(notificationContext.userId).then(u => u.createDM()).catch(() => null)
        : channel;

      // Normalize responsePayload using centralized normalizer
      const normalizedPayload = ResponsePayloadNormalizer.normalize(
        generationRecord.responsePayload,
        { logger: this.logger }
      );

      // Extract text and media from normalized payload
      const textOutputs = ResponsePayloadNormalizer.extractText(normalizedPayload);
      const extractedMedia = ResponsePayloadNormalizer.extractMedia(normalizedPayload);

      // Process media and apply Discord-specific formatting
      for (const media of extractedMedia) {
        if (media.type === 'photo') {
          mediaToSend.push({ 
                      type: sendAsDocument ? 'document' : 'photo', 
            url: media.url, 
                      caption: '', 
                      filename: suggestedFilename 
                    });
        } else if (media.type === 'video') {
          mediaToSend.push({ 
            type: 'video', 
            url: media.url, 
            caption: '' 
          });
        } else {
          // Handle text files (fetch content)
          if (media.filename && (media.filename.endsWith('.txt') || media.format === 'text/plain')) {
                        try {
              this.logger.info(`[DiscordNotifier] Fetching text content from ${media.url}`);
              const response = await fetch(media.url);
                            if (response.ok) {
                                const textContent = await response.text();
                                textOutputs.push(textContent);
                            } else {
                this.logger.warn(`[DiscordNotifier] Failed to fetch text from ${media.url}, status: ${response.status}`);
                            }
                        } catch (e) {
              this.logger.error(`[DiscordNotifier] Error fetching text content from ${media.url}: ${e.message}`);
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
      
      // Deduplicate Text Outputs
      if (textOutputs.length > 1) {
          const seen = new Set();
          textOutputs = textOutputs.filter(txt => {
              const normalized = typeof txt === 'string' ? txt.trim() : txt;
              if (seen.has(normalized)) return false;
              seen.add(normalized);
              return true;
          });
      }

      // If after processing there's no media but there is text, send the text.
      if (mediaToSend.length === 0 && textOutputs.length > 0) {
          await channel.send({
              content: escapeDiscordMarkdown(textOutputs.join('\n\n')),
              components: options.components,
              reply: messageId ? { messageReference: messageId, failIfNotExists: false } : undefined
          });
          this.logger.info(`[DiscordNotifier] Successfully sent text-only output to channelId: ${channelId}.`);
          return;
      }

      // Send all collected media items.
      this.logger.info(`[DiscordNotifier] Collected ${mediaToSend.length} media items to send: ${JSON.stringify(mediaToSend.map(m => ({ type: m.type, url: m.url })))}`);
      
      try {
          for (let i = 0; i < mediaToSend.length; i++) {
              const media = mediaToSend[i];
              // Only attach the action buttons to the *last* media item to avoid clutter.
              const currentComponents = (i === mediaToSend.length - 1) ? options.components : [];
              const currentReply = messageId ? { messageReference: messageId, failIfNotExists: false } : undefined;

              // Override channel for document in guild
              let destChannel = channel;
              if (media.type === 'document' && targetChannelForDocument && targetChannelForDocument !== channel) {
                destChannel = targetChannelForDocument;
                // If sending privately, do not set reply options or buttons
                delete currentOptions.replyToMessageId;
                delete currentOptions.buttons;
              }

              this.logger.info(`[DiscordNotifier] Sending ${media.type} to ${destChannel.id}. Attempting to fetch from URL: ${media.url}`);
              
              try {
                  const response = await fetch(media.url);
                  if (!response.ok) {
                      const errorBody = await response.text();
                      this.logger.error(`[DiscordNotifier] Failed to fetch media from URL ${media.url}. Status: ${response.status}. Body: ${errorBody.substring(0, 500)}`);
                      throw new Error(`Failed to fetch media from URL. Status: ${response.status}`);
                  }
                  
                  const arrayBuffer = await response.arrayBuffer();
                  const mediaBuffer = Buffer.from(arrayBuffer);
                  
                  this.logger.info(`[DiscordNotifier] Successfully fetched ${mediaBuffer.length} bytes for ${media.type} from ${media.url}. Sending to Discord.`);

                  // Build message options with components
                  const messageOptions = {
                      files: [new AttachmentBuilder(mediaBuffer, { 
                          name: media.type === 'document' ? (media.filename || 'file') : 
                                media.type === 'photo' ? 'image.png' : 'video.mp4'
                      })],
                      components: currentComponents,
                      reply: currentReply
                  };
                  
                  if (media.caption) {
                      messageOptions.content = escapeDiscordMarkdown(media.caption);
                  }
                  
                  await destChannel.send(messageOptions);
              } catch (fetchError) {
                  this.logger.error(`[DiscordNotifier] Could not process media from URL ${media.url}. Error: ${fetchError.message} ${fetchError.stack}`);
                  throw fetchError;
              }
          }
          
          // After all media is sent, send a separate message with all the text joined together.
          if (textOutputs.length > 0) {
              await sendEscapedMessage(channel, textOutputs.join('\n\n'), { replyToMessageId: messageId });
          }

          // If we redirected document to user's DM, notify in guild channel
          if (sendAsDocument && isGuildChannel && notificationContext.userId && targetChannelForDocument !== channel) {
              await sendEscapedMessage(channel, '📄 Your file has been sent to you in a private message.', { replyToMessageId: messageId });
          }

          this.logger.info(`[DiscordNotifier] Successfully sent all media and text for COMPLETED notification to channelId: ${channelId}.`);

      } catch (error) {
        this.logger.error(`[DiscordNotifier] Failed to send COMPLETED notification to channelId: ${channelId}. Error: ${error.message}`, error.stack);
        try {
          this.logger.warn(`[DiscordNotifier] Attempting to send fallback text message to ${channelId} after media send failure.`);
          // Send the original generic success message as fallback if media sending fails
          await sendEscapedMessage(channel, messageContent, options);
        } catch (fallbackError) {
          this.logger.error(`[DiscordNotifier] Fallback text message also failed for ${channelId}: ${fallbackError.message}`);
        }
        throw error; 
      }
    } else {
      // For FAILED messages or other types (non-completed jobs)
      try {
        // Extract more detailed error message from generation record if available
        let errorMessage = messageContent;
        if (generationRecord && generationRecord.status === 'failed') {
          const statusReason = generationRecord.statusReason?.trim();
          const errorDetails = generationRecord.error?.message || generationRecord.error;
          
          if (statusReason) {
            errorMessage = `❌ ${statusReason}`;
          } else if (errorDetails) {
            errorMessage = `❌ ${typeof errorDetails === 'string' ? errorDetails : errorDetails.message || 'Generation failed'}`;
          } else if (messageContent && messageContent !== '❌ Sorry, something went wrong.') {
            errorMessage = messageContent; // Use the provided messageContent
          } else {
            errorMessage = '❌ Generation failed. Please try again.';
          }
        }
        
        await sendEscapedMessage(channel, errorMessage, options);
        this.logger.info(`[DiscordNotifier] Successfully sent basic (non-completed) notification to channelId: ${channelId}.`);
      } catch (error) {
        this.logger.error(`[DiscordNotifier] Failed to send basic (non-completed) notification to channelId: ${channelId}. Error: ${error.message}`, error.stack);
        throw error; 
      }
    }
  }
}

module.exports = DiscordNotifier;

