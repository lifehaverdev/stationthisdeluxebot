// src/platforms/telegram/components/groupMenuManager.js
const { sendEscapedMessage, editEscapedMessageText } = require('../utils/messaging');

function getApiClient(deps) {
  return deps.internalApiClient || deps.internal?.client;
}

async function showGroupSettingsMenu(bot, msg, deps) {
  const { logger } = deps;
  const chatId = msg.chat.id;
  if (chatId >= 0) {
    return; // not a group
  }
  try {
    const api = getApiClient(deps);
    const groupRes = await api.get(`/internal/v1/data/groups/${chatId}`).catch(e => e.response && e.response.status === 404 ? null : Promise.reject(e));
    const groupDoc = groupRes ? groupRes.data : null;
    const isSponsored = groupDoc && groupDoc.sponsorMasterAccountId;

    // Determine current user's MAID
    const { masterAccountId: currentMasterAccountId } = await deps.userService.findOrCreate({
      platform: 'telegram',
      platformId: msg.from.id.toString(),
      platformContext: { firstName: msg.from.first_name, username: msg.from.username }
    });
    const isSponsor = isSponsored && groupDoc.sponsorMasterAccountId === currentMasterAccountId;

    // Fetch pool balance if sponsored
    let poolBalance = 0;
    let poolExp = 0;
    if (isSponsored) {
      try {
        const balanceRes = await api.get(`/internal/v1/data/groups/${chatId}/balance`);
        poolBalance = balanceRes.data?.balance || 0;
        poolExp = balanceRes.data?.exp || 0;
      } catch (balErr) {
        logger.warn(`[GroupMenu] Failed to fetch pool balance for group ${chatId}: ${balErr.message}`);
      }
    }

    const text = isSponsored
      ? `Group Sponsorship\nThis chat is sponsored\n\nGroup Pool: ${poolBalance.toLocaleString()} points\nGroup EXP: ${poolExp.toLocaleString()}`
      : 'Group Sponsorship\nNo sponsor set';

    const keyboard = [];
    if (!isSponsored) {
      keyboard.push([{ text: 'Sponsor this chat', callback_data: `grp_sponsor:${chatId}` }]);
    } else {
      // Fund button — visible to everyone
      keyboard.push([{ text: 'Fund this chat', callback_data: `grp_fund:${chatId}` }]);
      if (isSponsor) {
        keyboard.push([{ text: 'Withdraw sponsorship', callback_data: `grp_unsponsor:${chatId}` }]);
      }
    }
    keyboard.push([{ text: 'Close', callback_data: 'grp_close' }]);

    await sendEscapedMessage(bot, chatId, text, {
      reply_to_message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    logger.error(`[GroupMenu] Failed to show settings: ${err.message}`);
  }
}

async function handleCallbackQuery(bot, query, deps) {
  const { logger } = deps;
  const data = query.data || '';
  if (!data.startsWith('grp_')) return false;
  const [action, chatIdStr] = data.split(':');
  if (action === 'grp_close') {
    try {
      await bot.answerCallbackQuery(query.id);
      await bot.deleteMessage(query.message.chat.id, query.message.message_id);
    } catch (err) {
      logger.warn(`[GroupMenu] Failed to delete menu message: ${err.message}`);
    }
    return true;
  } else if (action === 'grp_sponsor') {
    const chatId = parseInt(chatIdStr, 10);
    try {
      const api = getApiClient(deps);
      const { masterAccountId: sponsorMasterAccountId } = await deps.userService.findOrCreate({
        platform: 'telegram',
        platformId: query.from.id.toString(),
        platformContext: { firstName: query.from.first_name, username: query.from.username }
      });
      await api.post('/internal/v1/data/groups/sponsor', {
        chatId,
        chatTitle: query.message.chat.title,
        sponsorMasterAccountId
      });
      await bot.answerCallbackQuery(query.id, { text: 'Chat sponsored!' });
      await editEscapedMessageText(bot, 'Group Sponsorship\nThis chat is now sponsored', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text:'Close', callback_data:'grp_close'}]] } });
    } catch (err) {
      logger.error(`[GroupMenu] Sponsor action failed: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Failed to sponsor', show_alert: true });
    }
    return true;
  } else if (action === 'grp_unsponsor') {
    const chatId = parseInt(chatIdStr, 10);
    try {
      const api = getApiClient(deps);
      await api.patch(`/internal/v1/data/groups/${chatId}/sponsor`, { sponsorMasterAccountId: null });
      await bot.answerCallbackQuery(query.id, { text: 'Sponsorship withdrawn' });
      await editEscapedMessageText(bot, 'Group Sponsorship\nNo sponsor set', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text:'Sponsor this chat', callback_data:`grp_sponsor:${chatId}` }],[{ text:'Close', callback_data:'grp_close'}]] } });
    } catch (err) {
      logger.error(`[GroupMenu] Unsponsor failed: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Failed to withdraw', show_alert: true });
    }
    return true;
  } else if (action === 'grp_fund') {
    const actualChatId = query.message.chat.id;
    try {
      await bot.answerCallbackQuery(query.id);
      const prompt = await bot.sendMessage(actualChatId, 'Reply to this message with the number of points you want to add to the group pool.', {
        reply_markup: { force_reply: true, selective: true }
      });

      // Use the established replyContextManager pattern
      if (deps.replyContextManager) {
        deps.replyContextManager.addContext(prompt, {
          type: 'group_fund',
          groupChatId: chatIdStr // the original group chatId for the API call
        }, 60000);
      } else {
        logger.error('[GroupMenu] replyContextManager not available in dependencies. Cannot set context for fund reply.');
      }
    } catch (err) {
      logger.error(`[GroupMenu] Fund prompt failed: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Failed to start funding', show_alert: true });
    }
    return true;
  }
  return false;
}

/**
 * Handle fund reply via MessageReplyDispatcher.
 * Called when user replies to the fund prompt message.
 */
async function handleFundReply(bot, msg, context, deps) {
  const { logger } = deps;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const points = parseInt(msg.text, 10);
  if (!Number.isInteger(points) || points <= 0) {
    await bot.sendMessage(chatId, 'Please provide a valid positive number of points.', { reply_to_message_id: msg.message_id });
    return;
  }

  try {
    const api = getApiClient(deps);
    const { masterAccountId: funderMasterAccountId } = await deps.userService.findOrCreate({
      platform: 'telegram',
      platformId: userId.toString(),
      platformContext: { firstName: msg.from.first_name, username: msg.from.username }
    });

    const groupChatId = context.groupChatId || chatId;
    const fundRes = await api.post(`/internal/v1/data/groups/${groupChatId}/fund`, {
      funderMasterAccountId,
      points
    });

    if (fundRes.data?.success) {
      await bot.sendMessage(chatId, `Successfully funded ${points.toLocaleString()} points to the group pool!`, { reply_to_message_id: msg.message_id });
    } else {
      await bot.sendMessage(chatId, 'Funding failed. Please try again.', { reply_to_message_id: msg.message_id });
    }
  } catch (err) {
    logger.error(`[GroupMenu] Fund reply error: ${err.message}`);
    const errMsg = err.response?.data?.error?.code === 'INSUFFICIENT_FUNDS'
      ? 'You do not have enough points.'
      : 'Failed to fund the group pool. Please try again.';
    await bot.sendMessage(chatId, errMsg, { reply_to_message_id: msg.message_id });
  }
}

module.exports = { showGroupSettingsMenu, handleCallbackQuery, handleFundReply };

function registerHandlers(dispatchers, deps) {
  const { callbackQueryDispatcher, messageReplyDispatcher } = dispatchers;
  if (callbackQueryDispatcher && typeof callbackQueryDispatcher.register === 'function') {
    const handler = async (bot, query, masterAccountId, passedDeps) => {
      await handleCallbackQuery(bot, query, passedDeps);
    };
    callbackQueryDispatcher.register('grp_sponsor:', handler);
    callbackQueryDispatcher.register('grp_unsponsor:', handler);
    callbackQueryDispatcher.register('grp_fund:', handler);
    callbackQueryDispatcher.register('grp_close', handler);
  }
  if (messageReplyDispatcher && typeof messageReplyDispatcher.register === 'function') {
    messageReplyDispatcher.register('group_fund', (bot, msg, ctx) => handleFundReply(bot, msg, ctx, deps));
  }
}

module.exports.registerHandlers = registerHandlers;
