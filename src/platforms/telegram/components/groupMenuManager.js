// src/platforms/telegram/components/groupMenuManager.js
const { sendEscapedMessage, editEscapedMessageText } = require('../utils/messaging');
const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

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
    const userResp = await api.post('/internal/v1/data/users/find-or-create', {
      platform: 'telegram',
      platformId: msg.from.id.toString(),
      platformContext: { firstName: msg.from.first_name, username: msg.from.username }
    });
    const currentMasterAccountId = userResp.data.masterAccountId;
    const isSponsor = isSponsored && groupDoc.sponsorMasterAccountId === currentMasterAccountId;

    const text = isSponsored ?
      'Group Sponsorship\nThis chat is sponsored' :
      'Group Sponsorship\nNo sponsor set';

    const keyboard = [];
    if (!isSponsored) {
      keyboard.push([{ text: 'Sponsor this chat', callback_data: `grp_sponsor:${chatId}` }]);
    } else if (isSponsor) {
      keyboard.push([{ text: 'Withdraw sponsorship', callback_data: `grp_unsponsor:${chatId}` }]);
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
      const userResp = await api.post('/internal/v1/data/users/find-or-create', {
        platform: 'telegram',
        platformId: query.from.id.toString(),
        platformContext: { firstName: query.from.first_name, username: query.from.username }
      });
      const sponsorMasterAccountId = userResp.data.masterAccountId;
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
  }
  return false;
}

module.exports = { showGroupSettingsMenu, handleCallbackQuery };

function registerHandlers(dispatchers, deps) {
  const { callbackQueryDispatcher } = dispatchers;
  if (callbackQueryDispatcher && typeof callbackQueryDispatcher.register === 'function') {
    callbackQueryDispatcher.register(/^grp_(sponsor|unsponsor):(-?\d+)/, async (bot, query) => {
      await handleCallbackQuery(bot, query, deps);
    });
  }
}

module.exports.registerHandlers = registerHandlers;
