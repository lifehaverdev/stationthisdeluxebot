// src/platforms/telegram/components/groupMenuManager.js
const { sendEscapedMessage, editEscapedMessageText } = require('../utils/messaging');
const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

function getApiClient(deps) {
  return deps.internalApiClient || deps.internal?.client;
}

// Track pending fund requests: chatId -> { userId, messageId, timeout }
const pendingFunds = new Map();

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
    if (isSponsored) {
      try {
        const balanceRes = await api.get(`/internal/v1/data/groups/${chatId}/balance`);
        poolBalance = balanceRes.data?.balance || 0;
      } catch (balErr) {
        logger.warn(`[GroupMenu] Failed to fetch pool balance for group ${chatId}: ${balErr.message}`);
      }
    }

    const text = isSponsored
      ? `Group Sponsorship\nThis chat is sponsored\n\nGroup Pool: ${poolBalance.toLocaleString()} points`
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
    keyboard.push([{ text: 'Close', callback_data: 'close' }]);

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
  if (action === 'grp_sponsor') {
    const chatId = parseInt(chatIdStr, 10);
    try {
      const api = getApiClient(deps);
      // find or create user for sponsor
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
      await editEscapedMessageText(bot, 'Group Sponsorship\nThis chat is now sponsored', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text:'Close', callback_data:'close_menu'}]] } });
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
      await editEscapedMessageText(bot, 'Group Sponsorship\nNo sponsor set', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text:'Sponsor this chat', callback_data:`grp_sponsor:${chatId}` }],[{ text:'Close', callback_data:'close'}]] } });
    } catch (err) {
      logger.error(`[GroupMenu] Unsponsor failed: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Failed to withdraw', show_alert: true });
    }
    return true;
  } else if (action === 'grp_fund') {
    const chatId = parseInt(chatIdStr, 10);
    try {
      await bot.answerCallbackQuery(query.id);
      // Ask user to reply with amount
      const prompt = await bot.sendMessage(chatId, 'Reply to this message with the number of points you want to add to the group pool.', {
        reply_markup: { force_reply: true, selective: true }
      });

      // Store pending fund request
      const key = `${chatId}:${query.from.id}`;
      // Clear any existing timeout
      if (pendingFunds.has(key)) {
        clearTimeout(pendingFunds.get(key).timeout);
      }
      pendingFunds.set(key, {
        userId: query.from.id,
        promptMessageId: prompt.message_id,
        timeout: setTimeout(() => pendingFunds.delete(key), 60000) // 60s expiry
      });
    } catch (err) {
      logger.error(`[GroupMenu] Fund prompt failed: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Failed to start funding', show_alert: true });
    }
    return true;
  }
  return false;
}

/**
 * Handle reply messages that may be fund amount responses.
 */
async function handleFundReply(bot, msg, deps) {
  const { logger } = deps;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const key = `${chatId}:${userId}`;

  const pending = pendingFunds.get(key);
  if (!pending) return false;

  // Check this is a reply to our prompt
  if (!msg.reply_to_message || msg.reply_to_message.message_id !== pending.promptMessageId) return false;

  // Clean up
  clearTimeout(pending.timeout);
  pendingFunds.delete(key);

  const points = parseInt(msg.text, 10);
  if (!Number.isInteger(points) || points <= 0) {
    await bot.sendMessage(chatId, 'Please provide a valid positive number of points.', { reply_to_message_id: msg.message_id });
    return true;
  }

  try {
    const api = getApiClient(deps);
    const { masterAccountId: funderMasterAccountId } = await deps.userService.findOrCreate({
      platform: 'telegram',
      platformId: userId.toString(),
      platformContext: { firstName: msg.from.first_name, username: msg.from.username }
    });

    const fundRes = await api.post(`/internal/v1/data/groups/${chatId}/fund`, {
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
  return true;
}

module.exports = { showGroupSettingsMenu, handleCallbackQuery, handleFundReply };

function registerHandlers(dispatchers, deps) {
  const { callbackQueryDispatcher } = dispatchers;
  if (callbackQueryDispatcher && typeof callbackQueryDispatcher.register === 'function') {
    callbackQueryDispatcher.register(/^grp_(sponsor|unsponsor|fund):(-?\d+)/, async (bot, query) => {
      await handleCallbackQuery(bot, query, deps);
    });
  }
}

module.exports.registerHandlers = registerHandlers;
