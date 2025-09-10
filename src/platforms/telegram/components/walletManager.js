const { ethers } = require('ethers');
const { escapeMarkdownV2 } = require('../../../utils/stringUtils');
const axios = require('axios');
const { FOUNDATION_ADDRESSES, getFoundationAddress, CHAIN_NAMES } = require('../../../core/services/alchemy/foundationConfig');

/**
 * Handler for /wallet command – initiates magic-amount linking flow
 */
async function fetchWallets(apiClient, masterAccountId) {
  try {
    const res = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/wallets`);
    return Array.isArray(res.data) ? res.data : [];
  } catch (_) {
    return [];
  }
}

function abbreviate(addr) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

async function displayWalletMenu(bot, chatId, masterAccountId, opts = {}) {
  const { apiClient, logger = console } = opts;
  const wallets = await fetchWallets(apiClient, masterAccountId);
  const esc = escapeMarkdownV2;
  const textLines = ['*Your linked wallets*', ''];
  wallets.forEach((w, idx) => {
    const tag = w.isPrimary ? ` ${esc('(primary)')}` : '';
    // Escape index dot and use escaped address within code markup
    textLines.push(`${idx + 1}\\. \`${esc(abbreviate(w.address))}\`${tag}`);
  });
  if (wallets.length === 0) textLines.push('_No wallets connected yet_');

  const keyboard = [
    ...wallets.map(w => [{ text: abbreviate(w.address), callback_data: `wallet:view:${w.address}` }]),
    [{ text: '+ Add Wallet', callback_data: 'wallet:add' }]
  ];

  const sendOpts = { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } };
  if (opts.edit && opts.messageId) {
    await bot.editMessageText(textLines.join('\n'), { chat_id: chatId, message_id: opts.messageId, ...sendOpts });
  } else {
    await bot.sendMessage(chatId, textLines.join('\n'), sendOpts);
  }
}

function createWalletCommandHandler(dependencies) {
  return async function walletCommandHandler(bot, msg, deps) {
    const apiClient = deps.internalApiClient || deps.internal?.client;
    const { logger = console } = deps;
    if (!apiClient) throw new Error('[walletCommand] internalApiClient dependency missing');

    const resp = await apiClient.post('/internal/v1/data/users/find-or-create', {
      platform: 'telegram',
      platformId: msg.from.id.toString(),
      platformContext: { firstName: msg.from.first_name, username: msg.from.username }
    });
    const masterAccountId = resp.data.masterAccountId;

    const wallets = await fetchWallets(apiClient, masterAccountId);
    if (wallets.length > 0) {
      await displayWalletMenu(bot, msg.chat.id, masterAccountId, { apiClient, logger });
    } else {
      await initiateMagicLink(bot, msg.chat.id, msg.message_id, deps, masterAccountId);
    }
  };
}

async function initiateMagicLink(bot, chatId, replyToMessageId, deps = {}, masterAccountId) {
  const { logger = console } = deps;
  const apiClient = deps.internalApiClient || deps.internal?.client;
  if (!apiClient || !masterAccountId) {
    await bot.sendMessage(chatId, '❌ Wallet-link flow unavailable. (Dependency missing)', { reply_to_message_id: replyToMessageId });
    logger.error('[WalletManager] initiateMagicLink missing apiClient or masterAccountId');
    return;
  }

  try {
    // Create magic amount linking request via INTERNAL API (avoids CSRF)
    const resp = await apiClient.post(`/internal/v1/data/users/${masterAccountId}/wallets/requests/magic-amount`, {
      tokenAddress: '0x0000000000000000000000000000000000000000',
    });

    const { magicAmountWei, tokenAddress, expiresAt } = resp.data;
    const requestId = resp.data.requestId || '';
    const magicAmount = ethers.formatEther(magicAmountWei);
    // Default to Sepolia (11155111) for now; later we may infer user-chosen chain
    let depositToAddress;
    try {
      depositToAddress = getFoundationAddress('11155111');
    } catch (_) {
      depositToAddress = 'N/A';
    }

    const chainsText = Object.keys(FOUNDATION_ADDRESSES)
        .map(id => CHAIN_NAMES[id] || `Chain ${id}`)
        .join(', ');

    const esc = escapeMarkdownV2;
    const expiresHuman = new Date(expiresAt).toLocaleTimeString();
    const tokenLabel = tokenAddress === '0x0000000000000000000000000000000000000000' ? 'ETH' : 'token';

    const text = [
      '*Wallet Linking Instructions*',
      '',
      `Send *exactly* \`${esc(magicAmount)}\` ${tokenLabel} to`,
      `\`${esc(depositToAddress)}\``,
      `Supported chains: ${esc(chainsText)}`,
      '',
      `_Expires:_ ${esc(expiresHuman)}`
    ].join('\n');

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', reply_to_message_id: replyToMessageId });
    logger.info(`[WalletManager] Magic linking initiated (masterAccountId=${masterAccountId}).`);
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message || 'Unknown error';
    await bot.sendMessage(chatId, `❌ Failed to start wallet-link flow: ${errMsg}`, { reply_to_message_id: replyToMessageId });
    logger.error('[WalletManager] initiate flow failed:', errMsg);
  }
}

/**
 * Compatibility wrapper for Dashboard "Connect" button.
 *   Expected signature: (bot, chatId, messageId, masterAccountId, dependencies)
 */
async function promptForWallet(bot, chatId, messageId, masterAccountId, deps = {}) {
  const apiClient = deps.internalApiClient || deps.internal?.client;
  const { logger = console } = deps;
  if (!apiClient) throw new Error('[promptForWallet] internalApiClient dependency missing');

  const wallets = await fetchWallets(apiClient, masterAccountId);
  if (wallets.length > 0) {
    await displayWalletMenu(bot, chatId, masterAccountId, { apiClient, logger });
  } else {
    await initiateMagicLink(bot, chatId, messageId, deps, masterAccountId);
  }
}

function createCallbackHandler(dependencies) {
  return async function walletCallbackHandler(bot, query, masterAccountId, deps) {
    // Ensure we have escape helper for MarkdownV2
    const esc = escapeMarkdownV2;
    const apiClient = deps.internalApiClient || deps.internal?.client;
    const { logger = console } = deps;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    const [prefix, action, param] = query.data.split(':');
    if (action === 'add') {
      await bot.answerCallbackQuery(query.id);
      await initiateMagicLink(bot, chatId, messageId, deps, masterAccountId);
      return;
    }
    if (action === 'view') {
      await bot.answerCallbackQuery(query.id);
      try {
        const res = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/wallets/${param}`);
        const w = res.data;
        const text = [
          '*Wallet Details*',
          '',
          `Address: \`${esc(w.address)}\``,
          `Primary: ${esc(w.isPrimary ? 'yes' : 'no')}`,
          `Verified: ${esc(w.verified ? 'yes' : 'no')}`
        ].join('\n');
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: '← Back', callback_data: 'wallet:back' }]] } });
      } catch (err) {
        await bot.answerCallbackQuery(query.id, { text: 'Failed to fetch wallet', show_alert: true });
      }
      return;
    }
    if (action === 'back') {
      await bot.answerCallbackQuery(query.id);
      await displayWalletMenu(bot, chatId, masterAccountId, { apiClient, logger, edit: true, messageId });
    }
  };
}

function registerHandlers(dispatchers, dependencies) {
  const { commandDispatcher, callbackQueryDispatcher } = dispatchers;
  const walletCmdRegex = /^\/wallet(?:@\w+)?$/i;
  commandDispatcher.register(walletCmdRegex, createWalletCommandHandler(dependencies));

  callbackQueryDispatcher.register('wallet', createCallbackHandler(dependencies));
}

module.exports = {
  registerHandlers,
  promptForWallet,
};
