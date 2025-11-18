/**
 * Test Message Reference Command Handler for Discord
 * 
 * This command is designed to test and debug message reference and image extraction.
 * It provides rich diagnostic information without executing any tools.
 */

const { EmbedBuilder, codeBlock } = require('discord.js');
const { getDiscordFileUrl } = require('../utils/discordUtils');

/**
 * Create test message reference command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createTestMessageReferenceCommandHandler(dependencies) {
  const { logger = console } = dependencies;
  
  /**
   * Handle the test message reference command
   * @param {Object} client - Discord client instance
   * @param {Object} interaction - Discord interaction
   * @param {Object} dependencies - Dependencies object
   * @returns {Promise<void>}
   */
  return async function handleTestMessageReferenceCommand(client, interaction, dependencies) {
    try {
      logger.info('[Test Message Reference] Command received');
      
      // Acknowledge the interaction immediately
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      
      const channelId = interaction.channel?.id;
      const userId = interaction.user?.id;
      const channel = await client.channels.fetch(channelId);
      
      // Collect diagnostic information
      const diagnostics = {
        timestamp: new Date().toISOString(),
        channelId,
        userId,
        userName: interaction.user?.tag || interaction.user?.username || 'unknown',
        guildId: interaction.guild?.id || 'DM',
        botPermissions: {},
        messageFetch: {},
        userReplies: [],
        referencedMessages: [],
        fallbackMessages: [],
        extractedFileUrl: null
      };
      
      // Check bot permissions
      const botMember = interaction.guild?.members?.me;
      if (botMember) {
        const perms = botMember.permissionsIn(channel);
        diagnostics.botPermissions = {
          viewChannel: perms.has('ViewChannel'),
          readMessageHistory: perms.has('ReadMessageHistory'),
          sendMessages: perms.has('SendMessages'),
          attachFiles: perms.has('AttachFiles')
        };
      }
      
      // Fetch recent messages
      try {
        const messages = await channel.messages.fetch({ limit: 100, cache: false });
        diagnostics.messageFetch = {
          success: true,
          messageCount: messages.size,
          oldestMessage: messages.last()?.id || 'none',
          newestMessage: messages.first()?.id || 'none'
        };
        
        // Find user replies
        const userReplies = Array.from(messages.values())
          .filter(msg => msg.author.id === userId && msg.reference?.messageId)
          .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        
        diagnostics.userReplies = userReplies.map(reply => ({
          replyId: reply.id,
          replyContent: reply.content?.substring(0, 50) || '(no content)',
          replyTimestamp: new Date(reply.createdTimestamp).toISOString(),
          referencedMessageId: reply.reference.messageId,
          referencedChannelId: reply.reference.channelId || channelId,
          hasReferencedMessage: !!reply.referencedMessage,
          referencedMessageResolved: reply.referencedMessage ? {
            id: reply.referencedMessage.id,
            author: reply.referencedMessage.author?.tag || 'unknown',
            authorBot: reply.referencedMessage.author?.bot || false,
            hasAttachments: reply.referencedMessage.attachments?.size > 0,
            attachmentCount: reply.referencedMessage.attachments?.size || 0,
            hasEmbeds: reply.referencedMessage.embeds?.length > 0,
            embedCount: reply.referencedMessage.embeds?.length || 0,
            content: reply.referencedMessage.content?.substring(0, 50) || '(no content)'
          } : null
        }));
        
        // Check if referenced messages are in the batch
        for (const reply of userReplies) {
          const refId = reply.reference.messageId;
          const refMsg = messages.get(refId);
          
          diagnostics.referencedMessages.push({
            referencedMessageId: refId,
            inBatch: !!refMsg,
            fetchAttempted: false,
            fetchSuccess: false,
            fetchError: null,
            messageDetails: refMsg ? {
              id: refMsg.id,
              author: refMsg.author?.tag || 'unknown',
              authorBot: refMsg.author?.bot || false,
              hasAttachments: refMsg.attachments?.size > 0,
              attachmentCount: refMsg.attachments?.size || 0,
              hasEmbeds: refMsg.embeds?.length > 0,
              embedCount: refMsg.embeds?.length || 0,
              content: refMsg.content?.substring(0, 50) || '(no content)',
              timestamp: new Date(refMsg.createdTimestamp).toISOString()
            } : null
          });
          
          // Try to fetch if not in batch
          if (!refMsg) {
            try {
              const fetched = await channel.messages.fetch(refId, { cache: false, force: true });
              diagnostics.referencedMessages[diagnostics.referencedMessages.length - 1].fetchAttempted = true;
              diagnostics.referencedMessages[diagnostics.referencedMessages.length - 1].fetchSuccess = true;
              diagnostics.referencedMessages[diagnostics.referencedMessages.length - 1].messageDetails = {
                id: fetched.id,
                author: fetched.author?.tag || 'unknown',
                authorBot: fetched.author?.bot || false,
                hasAttachments: fetched.attachments?.size > 0,
                attachmentCount: fetched.attachments?.size || 0,
                hasEmbeds: fetched.embeds?.length > 0,
                embedCount: fetched.embeds?.length || 0,
                content: fetched.content?.substring(0, 50) || '(no content)',
                timestamp: new Date(fetched.createdTimestamp).toISOString()
              };
            } catch (fetchError) {
              diagnostics.referencedMessages[diagnostics.referencedMessages.length - 1].fetchAttempted = true;
              diagnostics.referencedMessages[diagnostics.referencedMessages.length - 1].fetchSuccess = false;
              diagnostics.referencedMessages[diagnostics.referencedMessages.length - 1].fetchError = {
                message: fetchError.message,
                code: fetchError.code,
                name: fetchError.name
              };
            }
          }
        }
        
        // Check for user messages with images (fallback candidates)
        if (userReplies.length > 0) {
          const mostRecentReply = userReplies[0];
          const replyTime = mostRecentReply.createdTimestamp;
          const timeWindowMs = 15 * 60 * 1000;
          
          const userMessagesWithImages = Array.from(messages.values())
            .filter(msg => {
              const isFromUser = msg.author.id === userId;
              const timeDiff = replyTime - msg.createdTimestamp;
              const isBeforeReply = timeDiff > 0 && timeDiff <= timeWindowMs;
              const hasImage = (msg.attachments?.size > 0 && 
                              Array.from(msg.attachments.values()).some(att => 
                                att.contentType?.startsWith('image/') || att.contentType?.startsWith('video/')
                              )) ||
                             (msg.embeds?.length > 0 && 
                              msg.embeds.some(embed => embed.image?.url || embed.thumbnail?.url));
              return isFromUser && isBeforeReply && hasImage;
            })
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
          
          diagnostics.fallbackMessages = userMessagesWithImages.map(msg => ({
            id: msg.id,
            timestamp: new Date(msg.createdTimestamp).toISOString(),
            timeFromReply: Math.round((replyTime - msg.createdTimestamp) / 1000),
            hasAttachments: msg.attachments?.size > 0,
            attachmentCount: msg.attachments?.size || 0,
            hasEmbeds: msg.embeds?.length > 0,
            embedCount: msg.embeds?.length || 0
          }));
        }
        
        // Check intent diagnostic
        const userMessagesInBatch = Array.from(messages.values())
          .filter(msg => msg.author.id === userId && !msg.author.bot);
        const userMessagesWithContent = userMessagesInBatch.filter(msg => msg.content && msg.content.length > 0);
        diagnostics.intentDiagnostic = {
          userMessagesInBatch: userMessagesInBatch.length,
          userMessagesWithContent: userMessagesWithContent.length,
          intentWorking: userMessagesInBatch.length === 0 || userMessagesWithContent.length > 0
        };
        
      } catch (error) {
        diagnostics.messageFetch = {
          success: false,
          error: error.message
        };
      }
      
      // Try to extract file URL using the actual function
      try {
        diagnostics.extractedFileUrl = await getDiscordFileUrl(interaction, client);
      } catch (error) {
        diagnostics.extractionError = error.message;
      }
      
      // Build response embed
      const embed = new EmbedBuilder()
        .setTitle('🔍 Message Reference Test Results')
        .setColor(diagnostics.extractedFileUrl ? 0x00ff00 : 0xff0000)
        .setTimestamp();
      
      // Bot Permissions
      embed.addFields({
        name: '🤖 Bot Permissions',
        value: codeBlock('json', JSON.stringify(diagnostics.botPermissions, null, 2)),
        inline: false
      });
      
      // Intent Diagnostic
      embed.addFields({
        name: '🔐 Intent Diagnostic',
        value: codeBlock('json', JSON.stringify(diagnostics.intentDiagnostic, null, 2)),
        inline: false
      });
      
      // Message Fetch
      embed.addFields({
        name: '📥 Message Fetch',
        value: codeBlock('json', JSON.stringify(diagnostics.messageFetch, null, 2)),
        inline: false
      });
      
      // User Replies
      if (diagnostics.userReplies.length > 0) {
        embed.addFields({
          name: `💬 User Replies (${diagnostics.userReplies.length})`,
          value: codeBlock('json', JSON.stringify(diagnostics.userReplies, null, 2).substring(0, 1000)),
          inline: false
        });
      } else {
        embed.addFields({
          name: '💬 User Replies',
          value: 'No reply messages found from user in recent 100 messages',
          inline: false
        });
      }
      
      // Referenced Messages
      if (diagnostics.referencedMessages.length > 0) {
        embed.addFields({
          name: `🔗 Referenced Messages (${diagnostics.referencedMessages.length})`,
          value: codeBlock('json', JSON.stringify(diagnostics.referencedMessages, null, 2).substring(0, 1000)),
          inline: false
        });
      }
      
      // Fallback Messages
      if (diagnostics.fallbackMessages.length > 0) {
        embed.addFields({
          name: `🔄 Fallback Messages (${diagnostics.fallbackMessages.length})`,
          value: codeBlock('json', JSON.stringify(diagnostics.fallbackMessages, null, 2).substring(0, 1000)),
          inline: false
        });
      }
      
      // Extracted File URL
      if (diagnostics.extractedFileUrl) {
        embed.addFields({
          name: '✅ Extracted File URL',
          value: diagnostics.extractedFileUrl.substring(0, 1024),
          inline: false
        });
      } else {
        embed.addFields({
          name: '❌ No File URL Extracted',
          value: diagnostics.extractionError || 'No image/video found',
          inline: false
        });
      }
      
      // Send response
      await interaction.editReply({
        embeds: [embed],
        content: diagnostics.extractedFileUrl ? '✅ File URL extracted successfully!' : '❌ No file URL could be extracted'
      });
      
      // Also log full diagnostics to console
      logger.info('[Test Message Reference] Full diagnostics:', JSON.stringify(diagnostics, null, 2));
      
    } catch (error) {
      logger.error('[Test Message Reference] Error:', error);
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          embeds: []
        });
      } catch (replyError) {
        logger.error('[Test Message Reference] Error replying:', replyError);
      }
    }
  };
}

module.exports = createTestMessageReferenceCommandHandler;

