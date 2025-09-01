/*
 * InputCollector – Telegram helper to gather additional required inputs (e.g. supporting images)
 * --------------------------------------------------------------------------------------------
 * Usage (inside a command handler):
 *   const collector = new InputCollector(bot, dependencies);
 *   const finalInputs = await collector.collect({
 *       chatId,
 *       originatingMsg: msg,
 *       tool,
 *       currentInputs: inputs,
 *       missingInputKeys, // array of input names still required
 *   });
 *
 * Supports: image inputs (type === 'image')
 * Future: extend for video, file, text, etc.
 */

const { getTelegramFileUrl } = require('../utils/telegramUtils');

class InputCollector {
  constructor(bot, dependencies = {}) {
    this.bot = bot;
    this.logger = dependencies.logger || console;
    this.dependencies = dependencies;

    // Keep simple in-memory map of active collectors keyed by chatId to avoid overlap
    this.activeCollectors = new Map();
  }

  /**
   * Main entry – returns Promise that resolves with populated inputs or rejects on timeout/cancel.
   * @param {Object} options
   * @param {number|string} options.chatId – telegram chat id
   * @param {Object} options.originatingMsg – original /command message object
   * @param {Object} options.tool – ToolDefinition
   * @param {Object} options.currentInputs – inputs already gathered
   * @param {Array<string>} options.missingInputKeys – required input names not yet filled
   * @param {number} [options.timeoutMs=60000] – time to wait per missing input
   */
  async collect({ chatId, originatingMsg, tool, currentInputs = {}, missingInputKeys = [], timeoutMs = 60000 }) {
    if (!missingInputKeys.length) return currentInputs;

    // Guard: only one collector per chat
    if (this.activeCollectors.has(chatId)) {
      this.logger.warn('[InputCollector] Collector already active for chat', chatId);
      throw new Error('Another input collection is in progress.');
    }
    this.activeCollectors.set(chatId, true);

    try {
      for (const inputKey of missingInputKeys) {
        const inputField = tool.inputSchema[inputKey];
        if (!inputField) continue; // skip unknown

        const fieldType = (inputField.type || '').toLowerCase();
        if (fieldType === 'image') {
          this.logger.info(`[InputCollector] Starting collection for required image '${inputKey}' in chat ${chatId}`);
          await this._collectImage({ chatId, originatingMsg, inputKey, currentInputs, timeoutMs, friendlyName: this._friendlyName(inputKey), toolName: tool.displayName });
          this.logger.info(`[InputCollector] Collected image for '${inputKey}'.`);
        } else {
          if ((fieldType === 'string' || fieldType === 'text') && inputKey.toLowerCase().includes('prompt')) {
            await this._collectText({ chatId, originatingMsg, inputKey, currentInputs, timeoutMs, friendlyName: this._friendlyName(inputKey), toolName: tool.displayName });
          } else {
            this.logger.warn(`[InputCollector] Unsupported input type '${inputField.type}' for key ${inputKey}`);
          }
        }
      }
      return currentInputs;
    } finally {
      this.activeCollectors.delete(chatId);
    }
  }

  _friendlyName(inputKey) {
    return inputKey.replace(/_/g, ' ').replace(/\binput\b/i, '').trim();
  }

  async _collectImage({ chatId, originatingMsg, inputKey, currentInputs, timeoutMs, friendlyName, toolName }) {
    // Ask user
    const friendlyLabel = friendlyName.toLowerCase().includes('image') ? friendlyName : `${friendlyName} image`;
    const promptText = `*${toolName}* requires a ${friendlyLabel} to continue.\nPlease reply to this message with your ${friendlyLabel}.`;
    const promptMsg = await this.bot.sendMessage(chatId, promptText, {
      parse_mode: 'Markdown',
      reply_to_message_id: originatingMsg.message_id,
    });
    this.logger.info(`[InputCollector] Prompt message (${promptMsg.message_id}) awaiting '${inputKey}' from user ${originatingMsg.from.id}`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.logger.warn(`[InputCollector] Timeout while waiting for '${inputKey}' in chat ${chatId}`);
        this.bot.editMessageText('Timed out waiting for image. Please try the command again.', {
          chat_id: chatId,
          message_id: promptMsg.message_id,
        }).catch(() => {});
        cleanup();
        reject(new Error('Input collection timed out'));
      }, timeoutMs);

      const onPhoto = async (photoMsg) => {
        this.logger.debug(`[InputCollector] Photo candidate msg ${photoMsg.message_id} received.`);
        if (photoMsg.chat.id !== chatId) return; // other chat
        if (photoMsg.from.id !== originatingMsg.from.id) return; // different user

        // Ensure photo is relevant: either in reply to the prompt OR to the original command OR no reply but within active window
        if (photoMsg.reply_to_message) {
          const repliedId = photoMsg.reply_to_message.message_id;
          if (repliedId !== promptMsg.message_id && repliedId !== originatingMsg.message_id) {
            return; // unrelated reply
          }
        }
        try {
          // Use a copy without reply_to_message so helper inspects current photo
          const tempMsg = { ...photoMsg };
          delete tempMsg.reply_to_message;
          const fileUrl = await getTelegramFileUrl(this.bot, tempMsg);
          if (!fileUrl) {
            this.logger.warn('[InputCollector] getTelegramFileUrl returned null for photo message (likely non-image or Telegram delay).');
            return; // wait for next image
          }
          this.logger.info(`[InputCollector] Photo accepted for '${inputKey}', URL: ${fileUrl}`);
          currentInputs[inputKey] = fileUrl;

          // React with writing emoji on the user's photo message if helper available
          if (this.dependencies?.setReaction) {
            try {
              await this.dependencies.setReaction(this.bot, chatId, photoMsg.message_id, '✍️');
            } catch (e) {
              this.logger.debug('[InputCollector] Failed to set writing reaction', e.message);
            }
          }

          // Acknowledge and remove prompt to keep chat clean
          await this.bot.deleteMessage(chatId, promptMsg.message_id).catch(() => {});
          // Optionally delete user photo after acknowledged? keep for now

          cleanup();
          resolve();
        } catch (err) {
          this.logger.error('[InputCollector] Error while processing photo', err);
        }
      };

      // Also listen for documents that are images (some clients send as document)
      const onDocument = async (docMsg) => {
        this.logger.debug(`[InputCollector] Document candidate msg ${docMsg.message_id} received.`);
        if (docMsg.chat.id !== chatId) return;
        if (docMsg.from.id !== originatingMsg.from.id) return;
        if (!docMsg.document || !docMsg.document.mime_type?.startsWith('image/')) return;

        if (docMsg.reply_to_message) {
          const repliedId = docMsg.reply_to_message.message_id;
          if (repliedId !== promptMsg.message_id && repliedId !== originatingMsg.message_id) return;
        }

        try {
          const tempDoc = { ...docMsg };
          delete tempDoc.reply_to_message;
          const fileUrl = await getTelegramFileUrl(this.bot, tempDoc);
          if (!fileUrl) {
            this.logger.warn('[InputCollector] getTelegramFileUrl returned null for document. mime_type:', docMsg.document?.mime_type);
            return;
          }
          this.logger.info(`[InputCollector] Document accepted for '${inputKey}', URL: ${fileUrl}`);
          currentInputs[inputKey] = fileUrl;

          if (this.dependencies?.setReaction) {
            try { await this.dependencies.setReaction(this.bot, chatId, docMsg.message_id, '✍️'); } catch(e) {}
          }

          await this.bot.deleteMessage(chatId, promptMsg.message_id).catch(()=>{});
          cleanup();
          resolve();
        } catch(err) { this.logger.error('[InputCollector] doc error',err);} 
      };

      const cleanup = () => {
        this.logger.debug('[InputCollector] Cleaning up listeners for image collection');
        clearTimeout(timeout);
        this.bot.removeListener('photo', onPhoto);
        this.bot.removeListener('document', onDocument);
      };

      this.bot.on('photo', onPhoto);
      this.bot.on('document', onDocument);
    });
  }

  async _collectText({ chatId, originatingMsg, inputKey, currentInputs, timeoutMs, friendlyName, toolName }) {
    const friendlyLabel = friendlyName.toLowerCase().includes('prompt') ? friendlyName : `${friendlyName} prompt`;
    const promptText = `*${toolName}* requires an additional ${friendlyLabel}.\nPlease reply to this message with your ${friendlyLabel}.`;

    const promptMsg = await this.bot.sendMessage(chatId, promptText, {
      parse_mode: 'Markdown',
      reply_to_message_id: originatingMsg.message_id,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.bot.editMessageText('Timed out waiting for prompt. Please try the command again.', {
          chat_id: chatId,
          message_id: promptMsg.message_id,
        }).catch(() => {});
        cleanup();
        reject(new Error('Input collection timed out'));
      }, timeoutMs);

      const onText = async (textMsg) => {
        if (textMsg.chat.id !== chatId) return;
        if (textMsg.from.id !== originatingMsg.from.id) return;

        if (textMsg.reply_to_message) {
          const repliedId = textMsg.reply_to_message.message_id;
          if (repliedId !== promptMsg.message_id && repliedId !== originatingMsg.message_id) return;
        }

        const text = (textMsg.text || '').trim();
        if (!text) return;

        currentInputs[inputKey] = text;

        // Optional reaction
        if (this.dependencies?.setReaction) {
          try { await this.dependencies.setReaction(this.bot, chatId, textMsg.message_id, '✍️'); } catch(e) {}
        }

        await this.bot.deleteMessage(chatId, promptMsg.message_id).catch(()=>{});
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.bot.removeListener('message', onText);
      };

      this.bot.on('message', onText);
    });
  }
}

module.exports = InputCollector;
