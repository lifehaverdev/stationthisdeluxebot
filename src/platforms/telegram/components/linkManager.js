/**
 * @file Handles platform linking commands and callbacks for Telegram.
 * Supports approval-based platform linking via wallet address.
 */

const { escapeMarkdownV2 } = require('../../../utils/stringUtils');
const axios = require('axios');

/**
 * Abbreviates a wallet address for display.
 * @param {string} addr - Full wallet address.
 * @returns {string} Abbreviated address (first 6 + last 4 chars).
 */
function abbreviate(addr) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

/**
 * Creates the link command handler.
 * @param {Object} dependencies - Service dependencies.
 * @returns {Function} Command handler function.
 */
function createLinkCommandHandler(dependencies) {
  return async function linkCommandHandler(bot, msg, deps) {
    const apiClient = deps.internalApiClient || deps.internal?.client;
    const { logger = console } = deps;
    if (!apiClient) {
      await bot.sendMessage(msg.chat.id, '❌ Link command unavailable. (Dependency missing)', {
        reply_to_message_id: msg.message_id
      });
      logger.error('[LinkManager] internalApiClient dependency missing');
      return;
    }

    try {
      // Get or create user
      const { masterAccountId } = await deps.userService.findOrCreate({
        platform: 'telegram',
        platformId: msg.from.id.toString(),
        platformContext: { firstName: msg.from.first_name, username: msg.from.username }
      });

      // Parse wallet address from command
      const commandParts = msg.text.split(' ');
      const walletAddress = commandParts[1];

      if (!walletAddress) {
        const esc = escapeMarkdownV2;
        await bot.sendMessage(
          msg.chat.id,
          `*Platform Linking*\n\n` +
          `Usage: \`/link <walletAddress>\`\n\n` +
          `Example: \`/link 0x1234567890abcdef1234567890abcdef12345678\`\n\n` +
          `This will request to link your Telegram account to an account with that wallet address.`,
          {
            parse_mode: 'MarkdownV2',
            reply_to_message_id: msg.message_id
          }
        );
        return;
      }

      // Validate wallet address format (basic check)
      if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
        await bot.sendMessage(
          msg.chat.id,
          '❌ Invalid wallet address format. Please provide a valid Ethereum address (0x followed by 40 hex characters).',
          { reply_to_message_id: msg.message_id }
        );
        return;
      }

      // Show linking method options
      const esc = escapeMarkdownV2;
      const keyboard = [
        [
          { text: '🔗 Request Approval', callback_data: `link:request:${walletAddress}` },
          { text: '💰 Magic Amount', callback_data: `link:magic:${walletAddress}` }
        ]
      ];

      await bot.sendMessage(
        msg.chat.id,
        `*How would you like to verify account ownership?*\n\n` +
        `Wallet: \`${esc(abbreviate(walletAddress))}\`\n\n` +
        `• *Request Approval*: Send approval request to the account owner\n` +
        `• *Magic Amount*: Send exact ETH amount to verify ownership`,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: { inline_keyboard: keyboard },
          reply_to_message_id: msg.message_id
        }
      );

    } catch (error) {
      logger.error('[LinkManager] Error in link command:', error);
      await bot.sendMessage(
        msg.chat.id,
        '❌ An error occurred while processing your request.',
        { reply_to_message_id: msg.message_id }
      );
    }
  };
}

/**
 * Creates the callback query handler for link operations.
 * @param {Object} dependencies - Service dependencies.
 * @returns {Function} Callback handler function.
 */
function createLinkCallbackHandler(dependencies) {
  return async function linkCallbackHandler(bot, query, masterAccountId, deps) {
    const apiClient = deps.internalApiClient || deps.internal?.client;
    const { logger = console } = deps;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (!apiClient) {
      await bot.answerCallbackQuery(query.id, { text: 'Service unavailable', show_alert: true });
      return;
    }

    const [prefix, action, ...rest] = query.data.split(':');
    const esc = escapeMarkdownV2;

    try {
      // Handle link request (approval method)
      if (action === 'request') {
        const walletAddress = rest.join(':'); // Rejoin in case wallet address contains colons (unlikely but safe)
        
        await bot.answerCallbackQuery(query.id, { text: 'Creating link request...', show_alert: false });

        try {
          // Create link request
          const response = await apiClient.post('/internal/v1/data/users/request-platform-link', {
            requestingPlatform: 'telegram',
            requestingPlatformId: query.from.id.toString(),
            walletAddress: walletAddress,
            linkMethod: 'approval'
          });

          if (response.status === 201) {
            const { requestId, expiresAt, targetPlatform } = response.data;
            const expiresDate = new Date(expiresAt);
            const expiresHuman = expiresDate.toLocaleString();

            await bot.editMessageText(
              `✅ *Link request sent\\!*\n\n` +
              `Waiting for approval from ${esc(targetPlatform)} account\\.\n` +
              `Request expires: ${esc(expiresHuman)}\n\n` +
              `You will be notified when the request is approved or rejected\\.`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'MarkdownV2'
              }
            );
          } else {
            throw new Error(response.data?.error?.message || 'Failed to create link request');
          }
        } catch (error) {
          // Handle duplicate request error (409)
          if (error.response?.status === 409) {
            const errorData = error.response.data?.error;
            const existingRequestId = errorData?.requestId;
            
            await bot.editMessageText(
              `⚠️ *Pending Request Already Exists*\n\n` +
              `You already have a pending link request for this wallet\\.\n\n` +
              (existingRequestId ? `Request ID: \`${esc(existingRequestId)}\`\n\n` : '') +
              `Please wait for the existing request to be approved or rejected, or check your pending requests in /account\\.`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'MarkdownV2'
              }
            );
            return;
          }
          
          // Re-throw other errors to be handled by outer catch
          throw error;
        }
      }

      // Handle approval
      else if (action === 'approve') {
        const requestId = rest.join(':');
        
        await bot.answerCallbackQuery(query.id, { text: 'Approving...', show_alert: false });

        const response = await apiClient.post(
          `/internal/v1/data/users/link-requests/${requestId}/approve`,
          { masterAccountId }
        );

        if (response.status === 200) {
          const { linkedPlatform } = response.data;
          
          await bot.editMessageText(
            `✅ *Accounts linked successfully\\!*\n\n` +
            `Your ${esc(linkedPlatform)} account is now linked\\.\n` +
            `Your balance and history are now shared across platforms\\.`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'MarkdownV2'
            }
          );
        } else {
          throw new Error(response.data?.error?.message || 'Failed to approve link request');
        }
      }

      // Handle rejection
      else if (action === 'reject') {
        const requestId = rest.join(':');
        
        await bot.answerCallbackQuery(query.id, { text: 'Rejecting...', show_alert: false });

        const response = await apiClient.post(
          `/internal/v1/data/users/link-requests/${requestId}/reject`,
          { masterAccountId }
        );

        if (response.status === 200) {
          await bot.editMessageText(
            `❌ *Link request rejected*\n\n` +
            `The link request has been rejected\\.`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'MarkdownV2'
            }
          );
        } else {
          throw new Error(response.data?.error?.message || 'Failed to reject link request');
        }
      }

      // Handle report
      else if (action === 'report') {
        const requestId = rest.join(':');
        
        await bot.answerCallbackQuery(query.id, { text: 'Reporting...', show_alert: false });
        
        try {
          const response = await apiClient.post(
            `/internal/v1/data/users/link-requests/${requestId}/report`,
            { 
              masterAccountId,
              reason: 'Suspicious link request - reported by user'
            }
          );

          if (response.status === 200) {
            const { reportedCount, autoBanned } = response.data;
            let message = `🚨 *Link request reported*\n\n` +
              `The link request has been reported for review\\.`;
            
            if (autoBanned) {
              message += `\n\n⚠️ The requester has been automatically banned after ${esc(reportedCount.toString())} reports\\.`;
            } else {
              message += `\n\nThis is report #${esc(reportedCount.toString())} for this user\\.`;
            }

            await bot.editMessageText(message, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'MarkdownV2'
            });
          } else {
            throw new Error(response.data?.error?.message || 'Failed to report link request');
          }
        } catch (error) {
          logger.error('[LinkManager] Error reporting link request:', error);
          const errorMsg = error.response?.data?.error?.message || error.message || 'Failed to report request';
          
          await bot.editMessageText(
            `❌ *Error:* ${esc(errorMsg.substring(0, 200))}`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'MarkdownV2'
            }
          );
        }
      }

      // Handle magic amount method (redirect to wallet manager)
      else if (action === 'magic') {
        await bot.answerCallbackQuery(query.id, { text: 'Redirecting to wallet linking...', show_alert: false });
        // This would integrate with walletManager's magic amount flow
        // For now, just show a message
        await bot.sendMessage(
          chatId,
          '💰 Magic amount linking is handled via the /wallet command. Please use /wallet to link via magic amount.',
          { reply_to_message_id: messageId }
        );
      }

    } catch (error) {
      logger.error('[LinkManager] Error handling callback:', error);
      const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
      
      await bot.answerCallbackQuery(query.id, {
        text: `Error: ${errorMsg.substring(0, 200)}`,
        show_alert: true
      });
    }
  };
}

/**
 * Sends an approval request message to a user.
 * This is called when a link request is created and the target user needs to be notified.
 * @param {Object} bot - Telegram bot instance.
 * @param {string} chatId - Target user's chat ID.
 * @param {Object} linkRequest - Link request object.
 * @param {Object} requestingUser - User making the request.
 * @returns {Promise<void>}
 */
async function sendApprovalRequestMessage(bot, chatId, linkRequest, requestingUser) {
  const esc = escapeMarkdownV2;
  const requestingPlatform = linkRequest.requestingPlatform;
  const requestingUsername = requestingUser.platformContext?.username || 
                             requestingUser.platformContext?.firstName || 
                             'Unknown user';
  const walletAbbr = abbreviate(linkRequest.targetWalletAddress);
  const expiresDate = new Date(linkRequest.expiresAt);
  const expiresHuman = expiresDate.toLocaleString();

  const keyboard = [
    [
      { text: '✅ Approve', callback_data: `link:approve:${linkRequest.requestId}` },
      { text: '❌ Reject', callback_data: `link:reject:${linkRequest.requestId}` }
    ]
  ];

  const message = `🔗 *Account Link Request*\n\n` +
    `${esc(requestingPlatform)} user *${esc(requestingUsername)}* wants to link accounts\\.\n` +
    `Wallet: \`${esc(walletAbbr)}\`\n\n` +
    `This will merge your accounts and share:\n` +
    `• Points balance\n` +
    `• Generation history\n` +
    `• Settings \\(platform\\-specific\\)\n\n` +
    `Request expires: ${esc(expiresHuman)}`;

  try {
    await bot.sendMessage(chatId, message, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('[LinkManager] Error sending approval request message:', error);
    throw error;
  }
}

/**
 * Registers link command and callback handlers.
 * @param {Object} dispatchers - Dispatcher instances.
 * @param {Object} dependencies - Service dependencies.
 */
function registerHandlers(dispatchers, dependencies) {
  const { commandDispatcher, callbackQueryDispatcher } = dispatchers;
  
  // Register /link command
  const linkCmdRegex = /^\/link(?:@\w+)?(?:\s+0x[a-fA-F0-9]{40})?$/i;
  commandDispatcher.register(linkCmdRegex, createLinkCommandHandler(dependencies));

  // Register link callback handler
  callbackQueryDispatcher.register('link', createLinkCallbackHandler(dependencies));
}

module.exports = {
  registerHandlers,
  sendApprovalRequestMessage
};

