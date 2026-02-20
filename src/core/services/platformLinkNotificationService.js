/**
 * Platform Link Notification Service
 * 
 * Handles sending notifications for platform linking requests across platforms.
 */

class PlatformLinkNotificationService {
  constructor(platformNotifiers, logger) {
    this.platformNotifiers = platformNotifiers || {};
    this.logger = logger || console;
  }

  /**
   * Sends an approval request notification to the target platform user.
   * @param {Object} linkRequest - The link request object
   * @param {Object} targetUser - The target user object
   * @param {Object} requestingUser - The requesting user object
   * @returns {Promise<boolean>} True if notification was sent, false otherwise
   */
  async sendApprovalRequestNotification(linkRequest, targetUser, requestingUser) {
    try {
      this.logger.debug(`[PlatformLinkNotification] Attempting to send approval request notification. RequestId: ${linkRequest.requestId}`);
      this.logger.debug(`[PlatformLinkNotification] Target user ID: ${targetUser._id}`);
      this.logger.debug(`[PlatformLinkNotification] Available notifiers: ${Object.keys(this.platformNotifiers).join(', ')}`);
      
      // Get target user's platform identities
      const platformIdentities = targetUser.platformIdentities || {};
      const targetPlatforms = Object.keys(platformIdentities);

      this.logger.debug(`[PlatformLinkNotification] Target user platforms: ${targetPlatforms.join(', ')}`);
      this.logger.debug(`[PlatformLinkNotification] Platform identities: ${JSON.stringify(platformIdentities)}`);

      if (targetPlatforms.length === 0) {
        this.logger.warn(`[PlatformLinkNotification] Target user ${targetUser._id} has no platform identities. Cannot send notification.`);
        return false;
      }

      // Try to send to the first available platform (prefer telegram if available)
      let targetPlatform = targetPlatforms.find(p => p === 'telegram') || targetPlatforms[0];
      const targetPlatformId = platformIdentities[targetPlatform];

      this.logger.debug(`[PlatformLinkNotification] Selected platform: ${targetPlatform}, Platform ID: ${targetPlatformId}`);

      if (!targetPlatformId) {
        this.logger.warn(`[PlatformLinkNotification] Target platform ${targetPlatform} has no platformId.`);
        return false;
      }

      // Get the notifier for the target platform
      const notifier = this.platformNotifiers[targetPlatform];
      if (!notifier || typeof notifier.sendNotification !== 'function') {
        this.logger.warn(`[PlatformLinkNotification] No notifier found for platform ${targetPlatform}. Available notifiers: ${Object.keys(this.platformNotifiers).join(', ')}`);
        return false;
      }

      this.logger.debug(`[PlatformLinkNotification] Notifier found for ${targetPlatform}. Preparing to send notification.`);

      // Build notification message
      const requestingPlatform = linkRequest.requestingPlatform;
      const requestingUsername = requestingUser.platformContext?.username || 
                                 requestingUser.platformContext?.firstName || 
                                 'Unknown user';
      const walletAbbr = linkRequest.targetWalletAddress.substring(0, 10) + '...';
      const expiresDate = new Date(linkRequest.expiresAt);
      const expiresHuman = expiresDate.toLocaleString();

      let messageContent;
      if (targetPlatform === 'telegram') {
        // Telegram uses MarkdownV2 - use the proper escape utility
        const { escapeMarkdownV2 } = require('../../utils/stringUtils');
        const esc = escapeMarkdownV2;
        
        // Build message with proper escaping
        // Note: In MarkdownV2, we need to escape special chars but preserve formatting
        const escPlatform = esc(requestingPlatform);
        const escUsername = esc(requestingUsername);
        const escWallet = esc(walletAbbr);
        const escExpires = esc(expiresHuman);
        
        messageContent = `🔗 *Account Link Request*\n\n` +
          `${escPlatform} user *${escUsername}* wants to link accounts\\.\n` +
          `Wallet: \`${escWallet}\`\n\n` +
          `This will merge your accounts and share:\n` +
          `• Points balance\n` +
          `• Generation history\n` +
          `• Settings \\(platform\\-specific\\)\n\n` +
          `Request expires: ${escExpires}\n\n` +
          `Use /account to view and respond to this request\\.`;
      } else if (targetPlatform === 'discord') {
        // Discord uses markdown
        messageContent = `🔗 **Account Link Request**\n\n` +
          `**${requestingPlatform}** user **${requestingUsername}** wants to link accounts.\n` +
          `Wallet: \`${walletAbbr}\`\n\n` +
          `This will merge your accounts and share:\n` +
          `• Points balance\n` +
          `• Generation history\n` +
          `• Settings (platform-specific)\n\n` +
          `Request expires: ${expiresHuman}\n\n` +
          `Use \`/account\` to view and respond to this request.`;
      } else {
        // Generic format
        messageContent = `🔗 Account Link Request\n\n` +
          `${requestingPlatform} user ${requestingUsername} wants to link accounts.\n` +
          `Wallet: ${walletAbbr}\n\n` +
          `This will merge your accounts and share balance/history.\n` +
          `Request expires: ${expiresHuman}`;
      }

      // Prepare notification context
      const notificationContext = {
        chatId: targetPlatformId, // For Telegram, this is the chatId
        userId: targetPlatformId, // For Discord, this would be the user ID
        platform: targetPlatform
      };

      // For Telegram, we need to send a message with buttons
      // Note: TelegramNotifier's sendEscapedMessage will escape the entire message
      // So we should build the message WITHOUT MarkdownV2 formatting, or use raw sendMessage
      // Actually, looking at TelegramNotifier, it uses sendEscapedMessage which escapes everything
      // So we need to build a plain text message and let it escape it, OR build formatted and send directly
      
      // For now, let's build a plain message and let sendEscapedMessage handle escaping
      // But we want buttons, so we need to use the bot directly or modify the approach
      
      this.logger.debug(`[PlatformLinkNotification] Calling notifier.sendNotification with context: ${JSON.stringify(notificationContext)}`);
      this.logger.debug(`[PlatformLinkNotification] Message content (first 200 chars): ${messageContent.substring(0, 200)}`);
      
      try {
        // For Telegram, we need to send with buttons, so we'll use the bot directly
        // Check if notifier has bot property (TelegramNotifier stores bot as this.bot)
        const telegramNotifier = this.platformNotifiers.telegram;
        if (targetPlatform === 'telegram' && telegramNotifier && telegramNotifier.bot) {
          const bot = telegramNotifier.bot;
          const { escapeMarkdownV2 } = require('../../utils/stringUtils');
          
          // Build message with proper escaping for MarkdownV2
          const esc = escapeMarkdownV2;
          const escPlatform = esc(requestingPlatform);
          const escUsername = esc(requestingUsername);
          const escWallet = esc(walletAbbr);
          const escExpires = esc(expiresHuman);
          
          const telegramMessage = `🔗 *Account Link Request*\n\n` +
            `${escPlatform} user *${escUsername}* wants to link accounts\\.\n` +
            `Wallet: \`${escWallet}\`\n\n` +
            `This will merge your accounts and share:\n` +
            `• Points balance\n` +
            `• Generation history\n` +
            `• Settings \\(platform\\-specific\\)\n\n` +
            `Request expires: ${escExpires}\n\n` +
            `Use /account to view and respond to this request\\.`;
          
          // Create inline keyboard with approve/reject buttons
          const keyboard = [
            [
              { text: '✅ Approve', callback_data: `link:approve:${linkRequest.requestId}` },
              { text: '❌ Reject', callback_data: `link:reject:${linkRequest.requestId}` }
            ]
          ];
          
          await bot.sendMessage(targetPlatformId, telegramMessage, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: keyboard }
          });
          
          this.logger.info(`[PlatformLinkNotification] Successfully sent Telegram message with buttons to ${targetPlatformId}`);
          return true;
        } else {
          // For other platforms or if bot not available, use the notifier
          await notifier.sendNotification(notificationContext, messageContent, {
            linkRequestId: linkRequest.requestId,
            type: 'platform_link_request'
          });
        }

        this.logger.info(`[PlatformLinkNotification] Successfully sent approval request notification to ${targetPlatform} user ${targetPlatformId}`);
        return true;
      } catch (sendError) {
        this.logger.error(`[PlatformLinkNotification] Error calling notifier.sendNotification: ${sendError.message}`, sendError);
        this.logger.error(`[PlatformLinkNotification] Send error stack:`, sendError.stack);
        throw sendError;
      }

    } catch (error) {
      this.logger.error(`[PlatformLinkNotification] Error sending approval request notification: ${error.message}`, error);
      return false;
    }
  }

  /**
   * Sends a notification when a link request is approved.
   * @param {Object} linkRequest - The link request object
   * @param {Object} targetUser - The target user (who approved)
   * @param {Object} requestingUser - The requesting user (who was linked)
   * @returns {Promise<boolean>} True if notifications were sent
   */
  async sendApprovalSuccessNotifications(linkRequest, targetUser, requestingUser) {
    try {
      const results = [];

      // Notify requesting user
      const requestingPlatform = linkRequest.requestingPlatform;
      const requestingPlatformId = linkRequest.requestingPlatformId;
      const requestingNotifier = this.platformNotifiers[requestingPlatform];

      if (requestingNotifier && typeof requestingNotifier.sendNotification === 'function') {
        const requestingMessage = `✅ Your link request was approved!\n\n` +
          `Your ${linkRequest.requestingPlatform} account is now linked.\n` +
          `Your balance and history are now shared across platforms.`;

        try {
          await requestingNotifier.sendNotification(
            { chatId: requestingPlatformId, userId: requestingPlatformId, platform: requestingPlatform },
            requestingMessage,
            { type: 'platform_link_approved' }
          );
          results.push(true);
        } catch (err) {
          this.logger.error(`[PlatformLinkNotification] Failed to notify requesting user: ${err.message}`);
          results.push(false);
        }
      }

      // Notify target user (who approved)
      const targetPlatforms = Object.keys(targetUser.platformIdentities || {});
      for (const platform of targetPlatforms) {
        const platformId = targetUser.platformIdentities[platform];
        const notifier = this.platformNotifiers[platform];

        if (notifier && typeof notifier.sendNotification === 'function') {
          const targetMessage = `✅ Accounts linked successfully!\n\n` +
            `Your ${requestingPlatform} account is now linked.\n` +
            `Your balance and history are now shared across platforms.`;

          try {
            await notifier.sendNotification(
              { chatId: platformId, userId: platformId, platform },
              targetMessage,
              { type: 'platform_link_approved' }
            );
            results.push(true);
          } catch (err) {
            this.logger.error(`[PlatformLinkNotification] Failed to notify target user on ${platform}: ${err.message}`);
            results.push(false);
          }
        }
      }

      return results.some(r => r === true);

    } catch (error) {
      this.logger.error(`[PlatformLinkNotification] Error sending approval success notifications: ${error.message}`, error);
      return false;
    }
  }

  /**
   * Sends a notification when a link request is rejected.
   * @param {Object} linkRequest - The link request object
   * @param {Object} requestingUser - The requesting user (who was rejected)
   * @returns {Promise<boolean>} True if notification was sent
   */
  async sendRejectionNotification(linkRequest, requestingUser) {
    try {
      const requestingPlatform = linkRequest.requestingPlatform;
      const requestingPlatformId = linkRequest.requestingPlatformId;
      const notifier = this.platformNotifiers[requestingPlatform];

      if (!notifier || typeof notifier.sendNotification !== 'function') {
        this.logger.warn(`[PlatformLinkNotification] No notifier found for platform ${requestingPlatform}.`);
        return false;
      }

      const message = `❌ Your link request was rejected.\n\n` +
        `The account owner has declined to link accounts.`;

      await notifier.sendNotification(
        { chatId: requestingPlatformId, userId: requestingPlatformId, platform: requestingPlatform },
        message,
        { type: 'platform_link_rejected' }
      );

      this.logger.info(`[PlatformLinkNotification] Sent rejection notification to ${requestingPlatform} user ${requestingPlatformId}`);
      return true;

    } catch (error) {
      this.logger.error(`[PlatformLinkNotification] Error sending rejection notification: ${error.message}`, error);
      return false;
    }
  }
}

module.exports = PlatformLinkNotificationService;

