/**
 * Discord Platform Utilities
 * 
 * Utility functions for Discord-specific operations, analogous to Telegram's telegramUtils.js
 */

/**
 * Extracts image/video URL from a Discord message that the user replied to.
 * Similar to Telegram's getTelegramFileUrl, but for Discord.
 * 
 * In Discord, slash commands don't have direct access to message replies, so we check:
 * 1. The interaction's message reference (if it's a message command)
 * 2. Recent messages in the channel to find if the user recently replied to a message
 * 
 * @param {object} interaction - The Discord interaction object
 * @param {object} client - The Discord client instance
 * @returns {Promise<string|null>} The URL of the image/video, or null if not found
 */
async function getDiscordFileUrl(interaction, client) {
  try {
    const channelId = interaction.channel?.id;
    const userId = interaction.user?.id;
    
    if (!channelId) {
      return null;
    }
    
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      return null;
    }
    
    // Check if interaction has a message reference (for message context menu commands)
    const referencedMessageId = interaction.messageReference?.messageId || interaction.targetId;
    if (referencedMessageId) {
      try {
        const targetMessage = await channel.messages.fetch(referencedMessageId);
        const fileUrl = extractFileUrlFromMessage(targetMessage);
        if (fileUrl) {
          console.log(`[Discord Utils] ✅ Found image/video in interaction-referenced message: ${fileUrl}`);
          return fileUrl;
        }
      } catch (fetchError) {
        console.warn(`[Discord Utils] Could not fetch interaction-referenced message ${referencedMessageId}:`, fetchError.message);
        // Continue to check recent messages
      }
    }
    
    // For slash commands, check recent messages to see if user replied to something
    // Use Discord's maximum limit of 100 messages for better coverage
    try {
      // Verify bot has necessary permissions
      const botMember = interaction.guild?.members?.me;
      if (botMember) {
        const hasViewChannel = botMember.permissionsIn(channel).has('ViewChannel');
        const hasReadHistory = botMember.permissionsIn(channel).has('ReadMessageHistory');
        console.log(`[Discord Utils] Bot permissions in channel:`, {
          hasViewChannel,
          hasReadHistory,
          channelId: channel.id
        });
        if (!hasViewChannel || !hasReadHistory) {
          console.warn(`[Discord Utils] ⚠️ Bot missing required permissions: ViewChannel=${hasViewChannel}, ReadMessageHistory=${hasReadHistory}`);
        }
      }
      
      const messages = await channel.messages.fetch({ limit: 100, cache: false });
      
      // Diagnostic: Check if we can see user message content (verifies MESSAGE_CONTENT intent is working)
      const userMessagesInBatch = Array.from(messages.values())
        .filter(msg => msg.author.id === userId && !msg.author.bot);
      const userMessagesWithContent = userMessagesInBatch.filter(msg => msg.content && msg.content.length > 0);
      console.log(`[Discord Utils] Intent diagnostic: Found ${userMessagesInBatch.length} user messages in batch, ${userMessagesWithContent.length} have readable content`);
      if (userMessagesInBatch.length > 0 && userMessagesWithContent.length === 0) {
        console.warn(`[Discord Utils] ⚠️ MESSAGE_CONTENT intent may not be working - user messages have no readable content!`);
      }
      
      // Find the most recent message from this user that is a reply
      // Sort by creation time (most recent first) to get the latest reply
      const userReplies = Array.from(messages.values())
        .filter(msg => msg.author.id === userId && msg.reference?.messageId)
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      
      console.log(`[Discord Utils] Found ${userReplies.length} reply message(s) from user ${userId}`);
      
      // Check the most recent reply first
      for (const userReply of userReplies) {
        const referencedMessageId = userReply.reference.messageId;
        const referencedChannelId = userReply.reference.channelId || channelId;
        console.log(`[Discord Utils] Checking reply to message ${referencedMessageId} (channel: ${referencedChannelId})...`);
        console.log(`[Discord Utils] Reply message details:`, {
          replyId: userReply.id,
          replyContent: userReply.content?.substring(0, 50) || '(no content)',
          replyTimestamp: new Date(userReply.createdTimestamp).toISOString(),
          hasReferencedMessage: !!userReply.referencedMessage,
          referenceType: userReply.reference?.type,
          referenceGuildId: userReply.reference?.guildId
        });
        
        // KEY INSIGHT: Discord may already resolve the referenced message in the reply message!
        // Check if the referenced message is already available on the reply message object
        let repliedToMessage = userReply.referencedMessage;
        if (repliedToMessage) {
          console.log(`[Discord Utils] ✅ Referenced message ${referencedMessageId} already resolved on reply message!`);
          console.log(`[Discord Utils] Resolved message details:`, {
            messageId: repliedToMessage.id,
            author: repliedToMessage.author?.tag || repliedToMessage.author?.username || 'unknown',
            authorBot: repliedToMessage.author?.bot || false,
            hasAttachments: repliedToMessage.attachments?.size > 0,
            hasEmbeds: repliedToMessage.embeds?.length > 0,
            content: repliedToMessage.content?.substring(0, 50) || '(no content)'
          });
        } else {
          console.log(`[Discord Utils] ⚠️ Referenced message not resolved on reply message, will attempt to fetch`);
        // Handle cross-channel references
        let targetChannel = channel;
        if (referencedChannelId !== channelId) {
          try {
            targetChannel = await client.channels.fetch(referencedChannelId);
            console.log(`[Discord Utils] Cross-channel reference detected, fetching from channel ${referencedChannelId}`);
          } catch (channelError) {
            console.warn(`[Discord Utils] Could not fetch referenced channel ${referencedChannelId}:`, channelError.message);
            continue;
          }
        }
        
          // Check if the referenced message is already in the batch we fetched
          repliedToMessage = messages.get(referencedMessageId);
        
        if (!repliedToMessage) {
          // Not in the batch, try to fetch it directly from the target channel
          try {
            repliedToMessage = await targetChannel.messages.fetch(referencedMessageId, { cache: false, force: true });
            console.log(`[Discord Utils] Successfully fetched replied message ${repliedToMessage.id} directly (force: true)`);
              console.log(`[Discord Utils] Fetched message details:`, {
                messageId: repliedToMessage.id,
                author: repliedToMessage.author?.tag || repliedToMessage.author?.username || 'unknown',
                authorBot: repliedToMessage.author?.bot || false,
                hasAttachments: repliedToMessage.attachments?.size > 0,
                hasEmbeds: repliedToMessage.embeds?.length > 0,
                content: repliedToMessage.content?.substring(0, 50) || '(no content)'
              });
          } catch (fetchError) {
            // Referenced message might be deleted, too old, or inaccessible
            console.warn(`[Discord Utils] Could not fetch replied message ${referencedMessageId}:`, fetchError.message);
              console.warn(`[Discord Utils] Error details:`, {
                errorCode: fetchError.code,
                errorName: fetchError.name,
                targetChannelId: referencedChannelId,
                currentChannelId: channelId
              });
              // Don't continue here - let the fallback mechanism handle it
              // Continue to next reply to check
            continue;
          }
        } else {
          console.log(`[Discord Utils] Found referenced message ${referencedMessageId} in recent messages batch`);
            // Check if the message already has attachments/embeds before refetching
            const hasAttachments = repliedToMessage.attachments?.size > 0;
            const hasEmbeds = repliedToMessage.embeds?.length > 0;
            
            // Only refetch if we don't have attachment/embed data and we think we need it
            // Discord.js bulk fetches should include attachments, but sometimes they might be missing
            if (!hasAttachments && !hasEmbeds) {
              try {
                // Try to refetch to get full data, but don't fail if it doesn't work
            repliedToMessage = await targetChannel.messages.fetch(referencedMessageId, { cache: false, force: true });
            console.log(`[Discord Utils] Refetched message ${referencedMessageId} to ensure full data`);
          } catch (refetchError) {
                console.warn(`[Discord Utils] Could not refetch message ${referencedMessageId}, using batch version:`, refetchError.message);
                // Continue with the batch version - it might still have the data we need
              }
            } else {
              console.log(`[Discord Utils] Message ${referencedMessageId} already has attachment/embed data, skipping refetch`);
            }
          }
        }
        
        // Extract file URL from the replied-to message
        const fileUrl = extractFileUrlFromMessage(repliedToMessage);
        if (fileUrl) {
          console.log(`[Discord Utils] ✅ Found image/video in replied message ${repliedToMessage.id}: ${fileUrl}`);
          return fileUrl;
        } else {
          console.log(`[Discord Utils] No image/video found in replied message ${repliedToMessage.id} (has ${repliedToMessage.attachments?.size || 0} attachments, ${repliedToMessage.embeds?.length || 0} embeds)`);
        }
      }
      
      // Fallback: If we couldn't find an image from replies, look for messages with images
      // This handles cases where the referenced message is too old, deleted, or inaccessible
      if (userReplies.length > 0) {
        console.log(`[Discord Utils] Checked ${userReplies.length} reply(ies) but no image found. Trying fallback...`);
        
        const mostRecentReply = userReplies[0];
        const mostRecentReplyTime = mostRecentReply.createdTimestamp;
        const referencedMessageId = mostRecentReply.reference.messageId;
        const timeWindowMs = 15 * 60 * 1000; // 15 minutes
        const lookAheadMs = 2 * 60 * 1000; // 2 minutes look-ahead
        
        console.log(`[Discord Utils] Fallback: Looking for messages with images near reply time ${new Date(mostRecentReplyTime).toISOString()}`);
        console.log(`[Discord Utils] Fallback: Reply was to message ${referencedMessageId}, but that message couldn't be fetched`);
        
        // Strategy 1: Look for messages from the SAME author as the referenced message (if we know who that is)
        // Since the user replied to their own message, look for user messages with images
        // Strategy 2: If that doesn't work, look for bot messages with images
        
        // First, try to find messages from the user (since they replied to their own message)
        // Check ALL user messages in the batch for images, not just those in time window
        // The image message might be very recent (even after the reply if user sent image then replied)
        const allUserMessages = Array.from(messages.values())
          .filter(msg => msg.author.id === userId && !msg.author.bot);
        
        console.log(`[Discord Utils] Fallback: Checking ${allUserMessages.length} total user messages in batch for images...`);
        
        // Log all user messages to see what we have
        allUserMessages.forEach(msg => {
          const hasImage = (msg.attachments?.size > 0 || msg.embeds?.length > 0);
          if (hasImage) {
            const timeDiff = mostRecentReplyTime - msg.createdTimestamp;
            console.log(`[Discord Utils] Fallback: User message ${msg.id} - hasImage: ${hasImage}, ${Math.round(timeDiff / 1000)}s ${timeDiff > 0 ? 'before' : 'after'} reply`);
          }
        });
        
        const userMessagesWithImages = allUserMessages
          .filter(msg => {
            // Check if it has an image
            const hasImage = (msg.attachments?.size > 0 && 
                            Array.from(msg.attachments.values()).some(att => {
                              const contentType = att.contentType || '';
                              const name = att.name || '';
                              console.log(`[Discord Utils] Fallback: Checking user message ${msg.id} attachment: ${name}, type: ${contentType}`);
                              return contentType.startsWith('image/') || contentType.startsWith('video/') ||
                                     name.toLowerCase().endsWith('.png') || name.toLowerCase().endsWith('.jpg') ||
                                     name.toLowerCase().endsWith('.jpeg') || name.toLowerCase().endsWith('.gif') ||
                                     name.toLowerCase().endsWith('.webp');
                            })) ||
                           (msg.embeds?.length > 0 && 
                            msg.embeds.some(embed => {
                              const hasEmbedImage = embed.image?.url || embed.thumbnail?.url || embed.video?.url;
                              if (hasEmbedImage) {
                                console.log(`[Discord Utils] Fallback: User message ${msg.id} has embed image: ${embed.image?.url || embed.thumbnail?.url || embed.video?.url}`);
                              }
                              return hasEmbedImage;
                            }));
            
            return hasImage;
          })
          .sort((a, b) => {
            // Prefer messages before the reply, but also consider messages after
            const aBefore = mostRecentReplyTime - a.createdTimestamp > 0;
            const bBefore = mostRecentReplyTime - b.createdTimestamp > 0;
            
            if (aBefore && !bBefore) return -1; // a is before, b is after - prefer a
            if (!aBefore && bBefore) return 1;  // b is before, a is after - prefer b
            
            // Both before or both after - prefer closest to reply time
            const aDiff = Math.abs(a.createdTimestamp - mostRecentReplyTime);
            const bDiff = Math.abs(b.createdTimestamp - mostRecentReplyTime);
            return aDiff - bDiff;
          });
        
        console.log(`[Discord Utils] Fallback: Found ${userMessagesWithImages.length} user message(s) with images`);
        if (userMessagesWithImages.length > 0) {
          console.log(`[Discord Utils] Fallback: User messages with images (sorted by most recent first):`, 
            userMessagesWithImages.map(msg => ({
              id: msg.id,
              timeFromReply: Math.round((mostRecentReplyTime - msg.createdTimestamp) / 1000),
              hasAttachments: msg.attachments?.size > 0,
              hasEmbeds: msg.embeds?.length > 0
            }))
          );
        }
        
        // Try user messages first
        if (userMessagesWithImages.length > 0) {
          for (const fallbackMessage of userMessagesWithImages) {
            const fileUrl = extractFileUrlFromMessage(fallbackMessage);
            if (fileUrl) {
              const timeFromReply = Math.round((mostRecentReplyTime - fallbackMessage.createdTimestamp) / 1000);
              console.log(`[Discord Utils] ✅ Found image/video in fallback USER message ${fallbackMessage.id} (${timeFromReply}s before reply): ${fileUrl}`);
              return fileUrl;
            }
          }
        }
        
        // Strategy 2: If no user messages found, look for bot messages
        // But prefer messages sent BEFORE the reply (user likely replied to a bot message)
        console.log(`[Discord Utils] Fallback: No user messages with images found, trying bot messages...`);
        
        const botMessagesWithImages = Array.from(messages.values())
          .filter(msg => {
            // Check if it's a bot message
            const isBot = msg.author?.bot === true;
            // Prefer messages sent BEFORE the reply
            const timeDiff = mostRecentReplyTime - msg.createdTimestamp; // Positive = message is before reply
            const isBeforeReply = timeDiff > 0 && timeDiff <= timeWindowMs; // Must be before reply, within window
            // Also allow messages slightly after (in case bot sent after user replied)
            const isAfterReply = timeDiff < 0 && Math.abs(timeDiff) <= lookAheadMs;
            const isRecent = isBeforeReply || isAfterReply;
            // Check if it has an image (check both attachments and embeds)
            const hasImage = (msg.attachments?.size > 0 && 
                            Array.from(msg.attachments.values()).some(att => {
                              const contentType = att.contentType || '';
                              return contentType.startsWith('image/') || contentType.startsWith('video/');
                            })) ||
                           (msg.embeds?.length > 0 && 
                            msg.embeds.some(embed => embed.image?.url || embed.thumbnail?.url || embed.video?.url));
            
            return isBot && isRecent && hasImage;
          })
          .sort((a, b) => {
            // Prefer messages sent BEFORE the reply
            const aBefore = mostRecentReplyTime - a.createdTimestamp > 0;
            const bBefore = mostRecentReplyTime - b.createdTimestamp > 0;
            
            if (aBefore && !bBefore) return -1; // a is before, b is after - prefer a
            if (!aBefore && bBefore) return 1;  // b is before, a is after - prefer b
            
            // Both are before or both are after - prefer closest to reply time
            const aDiff = Math.abs(a.createdTimestamp - mostRecentReplyTime);
            const bDiff = Math.abs(b.createdTimestamp - mostRecentReplyTime);
            return aDiff - bDiff;
          });
        
        console.log(`[Discord Utils] Fallback: Found ${botMessagesWithImages.length} bot message(s) with images`);
        
        if (botMessagesWithImages.length > 0) {
          // Try each message until we find one with an extractable URL
          for (const fallbackMessage of botMessagesWithImages) {
          const fileUrl = extractFileUrlFromMessage(fallbackMessage);
          if (fileUrl) {
              console.log(`[Discord Utils] ✅ Found image/video in fallback BOT message ${fallbackMessage.id} (${Math.round((fallbackMessage.createdTimestamp - mostRecentReplyTime) / 1000)}s from reply): ${fileUrl}`);
            return fileUrl;
            }
          }
          console.log(`[Discord Utils] Fallback search found ${botMessagesWithImages.length} bot message(s) with images, but none had extractable URLs`);
        } else {
          console.log(`[Discord Utils] Fallback search found no bot messages with images in the time window`);
        }
      } else {
        console.log(`[Discord Utils] No reply messages found from user ${userId} in recent ${messages.size} messages`);
      }
    } catch (error) {
      console.error('[Discord Utils] Error fetching recent messages:', error);
    }
    
    return null;
  } catch (error) {
    console.error('[Discord Utils] Error extracting file URL:', error);
    return null;
  }
}

/**
 * Extracts image/video URL from a Discord message object.
 * Handles bot messages which send images as attachments.
 * 
 * @param {object} message - The Discord message object
 * @returns {string|null} The URL of the image/video, or null if not found
 */
function extractFileUrlFromMessage(message) {
  if (!message) {
    return null;
  }
  
  // Log message details for debugging
  const attachmentCount = message.attachments?.size || 0;
  const embedCount = message.embeds?.length || 0;
  console.log(`[Discord Utils] Extracting file from message ${message.id}:`, {
    hasAttachments: attachmentCount > 0,
    attachmentCount,
    hasEmbeds: embedCount > 0,
    embedCount,
    author: message.author?.tag || message.author?.username || 'unknown',
    content: message.content?.substring(0, 50) || '(no content)'
  });
  
  // Check attachments for images first (bot messages typically use attachments)
  if (message.attachments && message.attachments.size > 0) {
    console.log(`[Discord Utils] Message has ${message.attachments.size} attachment(s)`);
    
    // Convert to array for easier iteration and filtering
    const attachments = Array.from(message.attachments.values());
    
    // First pass: find images (prioritize images over videos)
    for (const attachment of attachments) {
      const contentType = attachment.contentType || '';
      const url = attachment.url;
      
      console.log(`[Discord Utils] Checking attachment: ${attachment.name}, type: ${contentType}, url: ${url?.substring(0, 100)}`);
      
      // Check content type first
      if (contentType.startsWith('image/')) {
        if (url) {
          console.log(`[Discord Utils] ✅ Found image attachment: ${url}`);
          return url;
        } else {
          console.warn(`[Discord Utils] Attachment has image content type but no URL: ${attachment.name}`);
        }
      }
      
      // Also check filename extension as fallback (some attachments might not have contentType)
      if (url && attachment.name) {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'];
        if (imageExtensions.some(ext => attachment.name.toLowerCase().endsWith(ext))) {
          console.log(`[Discord Utils] ✅ Found image attachment by filename: ${url}`);
          return url;
      }
    }
    }
    
    // Second pass: find videos if no images found
    for (const attachment of attachments) {
      const contentType = attachment.contentType || '';
      const url = attachment.url;
      
      if (contentType.startsWith('video/')) {
        if (url) {
          console.log(`[Discord Utils] ✅ Found video attachment: ${url}`);
          return url;
        }
      }
      
      // Check filename extension for videos too
      if (url && attachment.name) {
        const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
        if (videoExtensions.some(ext => attachment.name.toLowerCase().endsWith(ext))) {
          console.log(`[Discord Utils] ✅ Found video attachment by filename: ${url}`);
          return url;
        }
      }
    }
  }
  
  // Check embeds for images/videos (some messages use embeds)
  if (message.embeds && message.embeds.length > 0) {
    console.log(`[Discord Utils] Message has ${message.embeds.length} embed(s)`);
    
    // First pass: find image embeds (prioritize image over thumbnail over video)
    for (let i = 0; i < message.embeds.length; i++) {
      const embed = message.embeds[i];
      const imageUrl = embed.image?.url;
      const thumbnailUrl = embed.thumbnail?.url;
      const videoUrl = embed.video?.url;
      
      console.log(`[Discord Utils] Checking embed ${i}:`, {
        hasImage: !!imageUrl,
        hasThumbnail: !!thumbnailUrl,
        hasVideo: !!videoUrl,
        imageUrl: imageUrl?.substring(0, 100),
        thumbnailUrl: thumbnailUrl?.substring(0, 100),
        videoUrl: videoUrl?.substring(0, 100)
      });
      
      // Prioritize main image over thumbnail
      if (imageUrl) {
        console.log(`[Discord Utils] ✅ Found image in embed: ${imageUrl}`);
        return imageUrl;
      }
      
      // Thumbnails are often images
      if (thumbnailUrl) {
        console.log(`[Discord Utils] ✅ Found thumbnail in embed: ${thumbnailUrl}`);
        return thumbnailUrl;
      }
    }
    
    // Second pass: find video embeds
    for (const embed of message.embeds) {
      const videoUrl = embed.video?.url;
      if (videoUrl) {
        console.log(`[Discord Utils] ✅ Found video in embed: ${videoUrl}`);
        return videoUrl;
      }
    }
  }
  
  console.log(`[Discord Utils] ❌ No image/video found in message ${message.id}`);
  return null;
}

/**
 * Sets a reaction on a Discord message.
 * 
 * @param {object} message - The Discord message object
 * @param {string} emoji - The emoji to react with (can be Unicode emoji or custom emoji ID)
 * @returns {Promise<void>}
 */
async function setReaction(message, emoji) {
  if (!message || !emoji) {
    console.error('[Discord Utils] Missing parameters for setReaction', { message: !!message, emoji });
    return;
  }
  try {
    await message.react(emoji);
  } catch (error) {
    console.error('[Discord Utils] Error setting message reaction:', {
      messageId: message.id,
      emoji,
      error: error.message || error,
    });
  }
}

module.exports = {
  getDiscordFileUrl,
  setReaction,
};
