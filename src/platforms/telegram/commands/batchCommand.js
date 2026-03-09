/**
 * /batch command handler for Telegram
 *
 * Usage: send a photo album (or image-file album) with the caption:
 *   /batch <toolname_or_spellname> <prompt>
 *
 * Architecture note — timing-safe accumulation:
 *   Telegram sends each photo in a media group as a separate update. node-telegram-bot-api
 *   emits all those events before any async handler (like the command dispatcher) completes.
 *   To avoid losing photos, `handleBatchMediaSync` must be called synchronously at the
 *   TOP of bot.on('photo') and bot.on('document') — before any await — so every photo is
 *   captured even if the async command handler hasn't run yet.
 */

const { getTelegramFileUrl, setReaction } = require('../utils/telegramUtils');
const InputCollector = require('../components/inputCollector');
const notificationEvents = require('../../../core/events/notificationEvents');
const ResponsePayloadNormalizer = require('../../../core/services/notifications/ResponsePayloadNormalizer');

// Active media group accumulator: Map<`${chatId}:${media_group_id}`, group>
const activeGroups = new Map();

// Regex used both here and in the registration (single source of truth)
const BATCH_CAPTION_RE = /^\/batch(?:@\w+)?\s+\S/i;

// --- Fuzzy matching ---

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Fuzzy-match a query against all tools/spells by displayName and toolId.
 * Exact match > starts-with > Levenshtein (under 50% edit distance).
 */
function fuzzyMatchTool(query, tools) {
  if (!query || !tools || !tools.length) return null;
  const q = query.toLowerCase().replace(/[-_\s]+/g, '');

  let bestTool = null;
  let bestScore = Infinity;

  for (const tool of tools) {
    const candidates = [
      (tool.displayName || '').toLowerCase().replace(/[-_\s]+/g, ''),
      (tool.toolId || '').toLowerCase().replace(/[-_\s]+/g, ''),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate === q) return tool;

      if (candidate.startsWith(q) || q.startsWith(candidate)) {
        const score = Math.abs(candidate.length - q.length);
        if (score < bestScore) { bestScore = score; bestTool = tool; }
        continue;
      }

      const dist = levenshtein(q, candidate);
      const maxLen = Math.max(q.length, candidate.length);
      if (maxLen > 0 && dist / maxLen < 0.5 && dist < bestScore) {
        bestScore = dist;
        bestTool = tool;
      }
    }
  }
  return bestTool;
}

// --- Tool validation ---

/**
 * Returns the key of the single required image-type input, or null if 0 or 2+.
 */
function getSingleImageInputKey(tool) {
  const keys = [];
  for (const [key, def] of Object.entries(tool.inputSchema || {})) {
    if ((def.type || '').toLowerCase() === 'image' && def.required) keys.push(key);
  }
  return keys.length === 1 ? keys[0] : null;
}

// --- Synchronous pre-accumulator (called from bot.js BEFORE any await) ---

/**
 * Synchronously initialise or accumulate a photo/image-document message.
 *
 * MUST be called at the very top of bot.on('photo') and bot.on('document') before
 * any async work, so that all album messages land in activeGroups immediately.
 *
 * @returns {boolean} true if the message was handled (belongs to a batch group)
 */
function handleBatchMediaSync(msg) {
  const isPhoto = !!msg.photo;
  const isImageDoc = !!(msg.document && msg.document.mime_type?.startsWith('image/'));
  if (!isPhoto && !isImageDoc) return false;
  if (!msg.media_group_id) return false;

  const groupKey = `${msg.chat.id}:${msg.media_group_id}`;
  const group = activeGroups.get(groupKey);

  if (group) {
    // Add to existing group (deduplicate by message_id)
    if (!group.photos.some(p => p.message_id === msg.message_id)) {
      group.photos.push(msg);
    }
    if (msg.caption && !group.caption) group.caption = msg.caption;
    // Reset debounce if the async handler has already set up the timer
    if (typeof group._resetTimer === 'function') group._resetTimer();
    return true;
  }

  // Start a new group only when this is the first captioned /batch message
  const caption = msg.caption || '';
  if (BATCH_CAPTION_RE.test(caption)) {
    activeGroups.set(groupKey, {
      photos: [msg],
      caption,
      chatId: msg.chat.id,
      firstMsgId: msg.message_id,
      timer: null,
      _resetTimer: null, // populated by the async command handler
    });
    return true;
  }

  return false;
}

// --- Batch processing ---

async function processBatch(bot, group, deps, apiClient, toolRegistry) {
  const { logger } = deps;
  const { photos, caption, chatId, firstMsgId } = group;

  const sendFail = (text) =>
    bot.sendMessage(chatId, text, { reply_to_message_id: firstMsgId }).catch(() => {});

  // Validation 1: minimum 2 photos
  if (photos.length < 2) {
    await sendFail(
      '❌ Batch requires at least 2 images. Send them as an album with /batch <tool> <prompt> as the caption.'
    );
    return;
  }

  // Parse caption: /batch <toolname> [<prompt>]
  const captionMatch = (caption || '').match(/^\/batch(?:@\w+)?\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (!captionMatch) {
    await sendFail('❌ Send your images as an album with /batch <tool> <prompt> as the caption.');
    return;
  }
  const toolName = captionMatch[1];
  const promptText = (captionMatch[2] || '').trim();

  // Validation 2: fuzzy match tool/spell name
  const allTools = toolRegistry ? toolRegistry.getAllTools() : [];
  const tool = fuzzyMatchTool(toolName, allTools);
  if (!tool) {
    await sendFail(
      `❌ Couldn't find a tool or spell called \`${toolName}\`. Try /tools to see what's available.`
    );
    return;
  }

  // Validation 3: single-image-input check
  const imageInputKey = getSingleImageInputKey(tool);
  if (!imageInputKey) {
    await sendFail(
      `❌ \`${tool.displayName}\` isn't a single-image tool and can't be batched. Batch works with tools that take one image in, one image out.`
    );
    return;
  }

  // Resolve user identity
  let masterAccountId;
  try {
    ({ masterAccountId } = await deps.userService.findOrCreate({
      platform: 'telegram',
      platformId: photos[0].from.id.toString(),
      platformContext: {
        firstName: photos[0].from.first_name,
        username: photos[0].from.username,
      },
    }));
  } catch (err) {
    logger.error('[batchCommand] findOrCreate error:', err.message);
    await sendFail('Something went wrong starting the batch. Please try again.');
    return;
  }

  // Fetch user preferences for this tool
  let userPreferences = {};
  try {
    const encodedDisplayName = encodeURIComponent(tool.displayName);
    const prefsRes = await apiClient.get(
      `/internal/v1/data/users/${masterAccountId}/preferences/${encodedDisplayName}`
    );
    if (prefsRes.data && typeof prefsRes.data === 'object') userPreferences = prefsRes.data;
  } catch (err) {
    if (!err.response || err.response.status !== 404) {
      logger.warn(`[batchCommand] Could not fetch preferences for '${tool.displayName}': ${err.message}`);
    }
  }

  // Build inputs: preferences as base, prompt from caption fills prompt slot
  const inputs = { ...userPreferences };
  const textInputKey = tool.metadata && tool.metadata.telegramPromptInputKey;
  if (textInputKey && promptText) inputs[textInputKey] = promptText;
  // Image slot intentionally excluded — provided per-piece by batch loop

  // Collect any remaining required params (excluding image slot)
  const missingRequiredKeys = [];
  for (const [key, def] of Object.entries(tool.inputSchema || {})) {
    if (!def.required || inputs[key]) continue;
    if (key === imageInputKey) continue;
    const fieldType = (def.type || '').toLowerCase();
    if (fieldType === 'string' || fieldType === 'text' || fieldType === 'image') {
      missingRequiredKeys.push(key);
    }
  }

  if (missingRequiredKeys.length > 0) {
    logger.info(`[batchCommand] Collecting missing required inputs: ${missingRequiredKeys.join(', ')}`);
    const collector = new InputCollector(bot, { logger, setReaction });
    try {
      await collector.collect({
        chatId,
        originatingMsg: photos[0],
        tool,
        currentInputs: inputs,
        missingInputKeys: missingRequiredKeys,
        timeoutMs: 60000,
      });
    } catch (err) {
      logger.warn(`[batchCommand] Input collection failed or timed out: ${err.message}`);
      return;
    }
  }

  // Resolve photo URLs from Telegram
  const imageUrls = [];
  for (const photoMsg of photos) {
    const url = await getTelegramFileUrl(bot, photoMsg);
    if (url) imageUrls.push(url);
  }

  if (imageUrls.length < 2) {
    await sendFail(
      '❌ Batch requires at least 2 images. Send them as an album with /batch <tool> <prompt> as the caption.'
    );
    return;
  }

  // Confirmation message
  await bot
    .sendMessage(
      chatId,
      `⚡ Batching ${imageUrls.length} images through **${tool.displayName}** — results coming in as they finish.`,
      { parse_mode: 'Markdown', reply_to_message_id: firstMsgId }
    )
    .catch(() => {});

  // POST batch/start
  let collectionId, total;
  try {
    const batchRes = await apiClient.post('/internal/v1/data/cook/batch/start', {
      userId: masterAccountId,
      images: imageUrls,
      toolId: tool.toolId,
      imageParamKey: imageInputKey,
      paramOverrides: inputs,
    });
    collectionId = batchRes.data.collectionId;
    total = batchRes.data.total || imageUrls.length;
  } catch (err) {
    logger.error(`[batchCommand] batch/start error: ${err.message}`);
    await sendFail('Something went wrong starting the batch. Please try again.');
    return;
  }

  // Subscribe to notificationEvents to stream results back as pieces complete
  let completed = 0;
  let failed = 0;
  let finished = false;

  const onPieceComplete = async (record) => {
    if (finished) return;
    if (record.notificationPlatform !== 'cook') return;
    if (record.metadata?.collectionId !== collectionId) return;

    if (record.status === 'completed') {
      completed++;
      try {
        const normalized = ResponsePayloadNormalizer.normalize(record.responsePayload, { logger });
        const mediaItems = ResponsePayloadNormalizer.extractMedia(normalized);
        const photoItem = mediaItems.find((m) => m.type === 'photo');
        if (photoItem?.url) {
          await bot
            .sendPhoto(chatId, photoItem.url, { reply_to_message_id: firstMsgId })
            .catch((err) => logger.warn(`[batchCommand] sendPhoto error: ${err.message}`));
        }
      } catch (err) {
        logger.warn(`[batchCommand] Error processing piece result: ${err.message}`);
      }
    } else {
      failed++;
    }

    if (completed + failed >= total) {
      cleanup();
      const summaryText =
        failed > 0
          ? `✅ ${completed}/${total} done · ${failed} failed`
          : `✅ Batch complete — ${total}/${total} done`;
      await bot.sendMessage(chatId, summaryText, { reply_to_message_id: firstMsgId }).catch(() => {});
    }
  };

  const cleanup = () => {
    if (finished) return;
    finished = true;
    notificationEvents.removeListener('generationUpdated', onPieceComplete);
    clearTimeout(safetyTimeout);
  };

  // Safety timeout: clean up listener after 10 minutes even if not all pieces arrive
  const safetyTimeout = setTimeout(() => {
    if (!finished) {
      logger.warn(`[batchCommand] Safety timeout for collectionId ${collectionId}. Cleaning up.`);
      cleanup();
    }
  }, 10 * 60 * 1000);

  notificationEvents.on('generationUpdated', onPieceComplete);
  logger.info(`[batchCommand] Subscribed for collectionId ${collectionId}, total=${total}`);
}

// --- Async command handler factory ---

/**
 * Creates the /batch command handler registered in the CommandRegistry.
 * Expects handleBatchMediaSync to have already populated activeGroups.
 * @returns {Function} async (bot, msg, deps, match) => void
 */
function createBatchCommandHandler() {
  return async (bot, msg, deps, _match) => {
    const { logger } = deps;
    const apiClient = deps.internalApiClient || (deps.internal && deps.internal.client);
    const { toolRegistry } = deps;
    const chatId = msg.chat.id;

    if (!apiClient) {
      logger.error('[batchCommand] internalApiClient missing from dependencies');
      return;
    }

    // Hard fail: not a photo/image-doc, or not in an album
    const isPhoto = !!msg.photo;
    const isImageDoc = !!(msg.document && msg.document.mime_type?.startsWith('image/'));
    if ((!isPhoto && !isImageDoc) || !msg.media_group_id) {
      await bot
        .sendMessage(
          chatId,
          '❌ Send your images as an album with /batch <tool> <prompt> as the caption.',
          { reply_to_message_id: msg.message_id }
        )
        .catch(() => {});
      return;
    }

    const groupKey = `${chatId}:${msg.media_group_id}`;
    const group = activeGroups.get(groupKey);

    if (!group) {
      // Defensive: handleBatchMediaSync should have created this already
      logger.warn('[batchCommand] Group missing from activeGroups for key:', groupKey);
      return;
    }

    // React to acknowledge receipt
    setReaction(bot, chatId, msg.message_id, '✍').catch(() => {});

    // Set up debounce finalization
    let finalizeFired = false;
    const finalize = () => {
      if (finalizeFired) return;
      finalizeFired = true;
      activeGroups.delete(groupKey);
      group._resetTimer = null;
      processBatch(bot, group, deps, apiClient, toolRegistry).catch((err) => {
        logger.error('[batchCommand] processBatch error:', err.message, err.stack);
      });
    };

    // Give the sync accumulator a way to reset the debounce as more photos arrive
    group._resetTimer = () => {
      clearTimeout(group.timer);
      group.timer = setTimeout(finalize, 1500);
    };

    // Start initial debounce
    clearTimeout(group.timer);
    group.timer = setTimeout(finalize, 1500);
  };
}

module.exports = { createBatchCommandHandler, handleBatchMediaSync };
