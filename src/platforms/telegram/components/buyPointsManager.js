const { escapeMarkdownV2 } = require('../../../utils/stringUtils');
const { ethers } = require('ethers');

// In-memory state stores (reset on process restart)
const flowStates = new Map();          // chatId -> { step, data }
const pendingQuotes = new Map();       // quoteId -> { chatId, intervalId }

function resetChatState(chatId) {
  flowStates.delete(chatId);
}

// Step 0 – entry point from /buypoints command or dashboard button
async function startFlow(bot, chatId, masterAccountId, deps = {}) {
  const { internal, logger = console } = deps;
  try {
    const chainId = '1';
    // ETH zero address
    const ethAddress = '0x0000000000000000000000000000000000000000';
    const amountEth = '0.01';
    const amountWei = ethers.parseEther(amountEth).toString();

    const quote = (await internal.client.post('/internal/v1/data/points/quote', {
      type: 'token',
      assetAddress: ethAddress,
      amount: amountWei,
      mode: 'contribute'
    })).data;

    const { getFoundationAddress } = require('../../../core/services/alchemy/foundationConfig');
    let depositAddress;
    try {
      depositAddress = getFoundationAddress('11155111');
    } catch (_) {
      depositAddress = 'N/A';
    }

    const esc = escapeMarkdownV2;
    const msgText = [
      'Purchase Points via Contribution',
      '',
      `Send native ETH directly to our foundation address:`,
      `${depositAddress}`,
      '',
      `Direct ETH transfers are counted as contributions and must be committed for point delivery.`,
      '',
      `For reference, sending 0.01 ETH right now would credit approximately ${quote.pointsCredited} points.`,
      '',
      '• Reply with a different ETH amount for a new quote.',
      '• Reply with a token contract address for a quote in that asset.',
      '• Reply with a referral CODE to apply it.',
      '',
      'For easier purchasing (better rates, zero gas), visit noema.art.'
    ].join('\n');

    const sentMsg = await bot.sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: [[{ text: 'Ⓧ Cancel', callback_data: 'buy:cancel' }]] } });

    // Attach reply context so future replies are routed here
    deps.replyContextManager?.addContext(sentMsg, { type: 'buy_points', chatId, masterAccountId });

    // Track current asset/decimals and remain in the await_amount loop until user cancels
    flowStates.set(chatId, { assetAddress: ethAddress, decimals: 18, step: 'await_amount' });
    logger.info(`[BuyPoints] Started simplified flow for chat ${chatId}`);
  } catch (err) {
    logger.error('[BuyPoints] startFlow simplified error', err.message);
    await bot.sendMessage(chatId, '❌ Could not fetch quote.');
  }
}

async function handleCallback(bot, query, masterAccountId, deps = {}) {
  const { data } = query;
  const [, action, param] = data.split(':');
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const logger = deps.logger || console;
  const state = flowStates.get(chatId) || {};

  if (action === 'cancel') {
    // do not clear state; allow more replies
    await bot.answerCallbackQuery(query.id, { text: 'Cancelled.' });
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
    return;
  }

  if (action === 'asset') {
    const assetAddress = param;
    state.data = { ...state.data, assetAddress };
    state.step = 'enter_amount';
    flowStates.set(chatId, state);

    await bot.answerCallbackQuery(query.id);
    const promptMsg = await bot.sendMessage(chatId, 'Enter the amount you wish to spend (e.g. 25.5):', { reply_to_message_id: messageId });

    // Expect next reply with amount
    const replyContextManager = deps.replyContextManager;
    if (replyContextManager) {
      replyContextManager.setContext(promptMsg, { type: 'buy_points_amount', data: { assetAddress } });
    }
    return;
  }

  // simplified: only cancel supported

  await bot.answerCallbackQuery(query.id, { text: 'Unknown action', show_alert: true });
  logger.warn('[BuyPoints] Unknown callback action:', action);
}

async function amountReplyHandler(bot, message, context, deps = {}) {
  const chatId = message.chat.id;
  const state = flowStates.get(chatId);
  const logger = deps.logger || console;
  if (!state || state.step !== 'await_amount') {
    return; // Not in expected state
  }
  const amount = parseFloat(message.text.trim());
  if (isNaN(amount) || amount <= 0) {
    await bot.sendMessage(chatId, '❌ Invalid amount\. Please enter a number greater than 0\.');
    return;
  }

  const assetAddress = state.data.assetAddress || '0x0000000000000000000000000000000000000000';
  try {
    const amountWei = ethers.parseEther(amount.toString()).toString();
    const quoteRes = await deps.internal.client.post('/internal/v1/data/points/quote', { type: 'token', assetAddress, amount: amountWei, mode: 'contribute' });
    const quote = quoteRes.data;
    const depositAddress = require('../../../core/services/alchemy/foundationConfig').getFoundationAddress('11155111');
    const text = [
      'Buy Points',
      '',
      `Send exactly ${quote.asset.amount} ETH to`,
      `${depositAddress}`,
      '',
      `You will receive ${quote.pointsCredited} points once confirmed.`
    ].join('\n');

    const origMsgId = message.reply_to_message.message_id;
    const editedMsg = await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: origMsgId,
      reply_markup: { inline_keyboard: [[{ text: 'Ⓧ Cancel', callback_data: 'buy:cancel' }]] }
    });

    // Re-store reply context so the next user reply is routed here again and refresh TTL
    if (deps.replyContextManager) {
      deps.replyContextManager.setContext(editedMsg, context);
    }
  } catch (err) {
    logger.error('[BuyPoints] quote error', err.response?.data || err.message);
    await bot.sendMessage(chatId, '❌ Failed to fetch quote. Please try again later.');
  }
}

// ---------------------- Reply Handling ---------------------------
async function buyPointsReplyHandler(bot, message, context, deps = {}) {
  const { internal, logger = console } = deps;

  logger.info('[BuyPoints] Reply received', {
    chatId: message.chat.id,
    text: message.text,
    replyTo: message.reply_to_message?.message_id,
    contextType: context?.type,
    state: flowStates.get(message.chat.id)
  });

  const chatId = message.chat.id;
  const state = flowStates.get(chatId) || { assetAddress: '0x0000000000000000000000000000000000000000', decimals: 18 };

  const originalMsg = message.reply_to_message;
  if (!originalMsg) return;

  const messageId = originalMsg.message_id;

  const text = (message.text || '').trim();

  // Helpers
  const isEthAddress = /^0x[0-9a-fA-F]{40}$/.test(text);
  const isNumeric = /^\d+(?:\.\d+)?$/.test(text);

  const sendEphemeral = (t) => bot.sendMessage(chatId, t, { reply_to_message_id: message.message_id });

  try {
    // Handle Ethereum address — switch asset
    if (isEthAddress) {
      const assetAddress = text.toLowerCase();

      // Placeholder quote to learn decimals & rate
      const quoteRes = await internal.client.post('/internal/v1/data/points/quote', {
        type: 'token', assetAddress, amount: '1000000', mode: 'contribute'
      });
      const quote = quoteRes.data;

      // Update state
      state.assetAddress = assetAddress;
      state.decimals = quote.asset.decimals || 18;
      flowStates.set(chatId, state);

      const depositAddress = require('../../../core/services/alchemy/foundationConfig').getFoundationAddress('11155111');

      const newText = [
        'Purchase Points via Contribution',
        '',
        `Token at ${assetAddress}`,
        `${depositAddress}`,
        '',
        '⚠ Token deposits not supported in Telegram — please complete purchase on noema.art',
        '',
        `For reference, sending 1 unit would credit approximately ${quote.pointsCredited} points.`,
        '',
        '• Reply with a different amount for a new quote.',
        '• Reply with a referral CODE to apply it.',
        '',
        'For easier purchasing (better rates, zero gas), visit noema.art.'
      ].join('\n');

      const edited = await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: 'Ⓧ Cancel', callback_data: 'buy:cancel' }]] } });

      logger.info('[BuyPoints] Address switch edit complete', { original: messageId, edited: edited?.message_id });

      if (deps.replyContextManager) {
        deps.replyContextManager.setContext(edited, context);
        logger.info('[BuyPoints] Reply context refreshed after address switch');
      }
      return;
    }

    // Handle numeric amount
    if (isNumeric) {
      const amountStr = text;
      let amountWei;
      try {
        amountWei = ethers.parseUnits(amountStr, state.decimals).toString();
      } catch (_) {
        await sendEphemeral('❌ Invalid amount, try again');
        return;
      }

      // Fetch quote
      const quoteRes = await internal.client.post('/internal/v1/data/points/quote', {
        type: 'token', assetAddress: state.assetAddress, amount: amountWei, mode: 'contribute'
      });
      const quote = quoteRes.data;

      const depositAddress = require('../../../core/services/alchemy/foundationConfig').getFoundationAddress('11155111');

      const assetLabel = state.assetAddress === '0x0000000000000000000000000000000000000000' ? 'native ETH' : `token at ${state.assetAddress}`;

      const newText = [
        'Purchase Points via Contribution',
        '',
        `Send ${assetLabel} to:`,
        `${depositAddress}`,
        '',
        `Sending ${amountStr} will credit approximately ${quote.pointsCredited} points.`,
        '',
        '• Reply with a different amount for a new quote.',
        '• Reply with a referral CODE to apply it.',
        '',
        'For easier purchasing (better rates, zero gas), visit noema.art.'
      ].join('\n');

      const edited = await bot.editMessageText(newText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: 'Ⓧ Cancel', callback_data: 'buy:cancel' }]] } });
      logger.info('[BuyPoints] Amount edit complete', { original: messageId, edited: edited?.message_id });
      if (deps.replyContextManager) {
        deps.replyContextManager.setContext(edited, context);
        logger.info('[BuyPoints] Reply context refreshed after amount');
      }
      return;
    }

    // Otherwise treat as referral code
    const code = text;
    try {
      const res = await internal.client.get(`/internal/v1/data/points/charter/${encodeURIComponent(code)}`);
      const charter = res.data;

      const depositAddress = charter?.address;
      if (!depositAddress) throw new Error('missing address');

      const newTextLines = originalMsg.text.split('\n');
      // Replace deposit address line (assume line index 3 from initial messages)
      if (newTextLines.length >= 4) newTextLines[3] = depositAddress;
      // Append referral
      if (!newTextLines.includes('Referral code applied ✅')) newTextLines.splice(4, 0, 'Referral code applied ✅');

      const edited = await bot.editMessageText(newTextLines.join('\n'), { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: 'Ⓧ Cancel', callback_data: 'buy:cancel' }]] } });
      logger.info('[BuyPoints] Referral edit complete', { original: messageId, edited: edited?.message_id });
      if (deps.replyContextManager) {
        deps.replyContextManager.setContext(edited, context);
        logger.info('[BuyPoints] Reply context refreshed after referral');
      }
    } catch (err) {
      if (err.response?.status === 404) {
        await sendEphemeral('Unknown referral code');
      } else {
        logger.error('[BuyPoints] charter lookup error', err.message);
        await sendEphemeral('Could not validate referral code');
      }
    }
  } catch (err) {
    logger.error('[BuyPoints] reply handler error', err.response?.data || err.message);
    await sendEphemeral('Could not process your reply');
  }
}

function registerHandlers(dispatchers, deps = {}) {
  const { commandDispatcher, callbackQueryDispatcher, messageReplyDispatcher } = dispatchers;

  // /buypoints command
  commandDispatcher.register(/^\/buypoints(?:@\w+)?$/i, async (bot, msg) => {
    const apiClient = deps.internal.client;
    const findRes = await apiClient.post('/internal/v1/data/users/find-or-create', {
      platform: 'telegram',
      platformId: msg.from.id.toString(),
      platformContext: { firstName: msg.from.first_name, username: msg.from.username }
    });
    const masterAccountId = findRes.data.masterAccountId;
    await startFlow(bot, msg.chat.id, masterAccountId, deps);
  });

  callbackQueryDispatcher.register('buy', (bot, query, masterAccountId) => handleCallback(bot, query, masterAccountId, deps));

  // New unified reply handler
  messageReplyDispatcher.register('buy_points', buyPointsReplyHandler);

  // Keep legacy amount handler for fallback
  messageReplyDispatcher.register('buy_points_amount', amountReplyHandler);
}

module.exports = { registerHandlers, startFlow };
