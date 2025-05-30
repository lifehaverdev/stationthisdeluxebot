// src/core/services/loraResolutionService.js

// BEGIN ADDITION: Import a shared internal API client instance
// Assuming a singleton or factory pattern for the client.
const internalApiClient = require('../../utils/internalApiClient'); // UPDATED PATH
// END ADDITION

const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Cache structure: Map<masterAccountId_or_\"public\", { data: Map<triggerKey, LoRAInfo[]>, timestamp: number }>
const triggerMapCache = new Map(); 
const logger = console; // Replace with a proper logger instance if available

/**
 * Fetches the trigger map from the internal API and caches it.
 * @param {string} [masterAccountId] - Optional user ID for permission-aware map.
 * @returns {Promise<Map<string, any[]>>} - The trigger map.
 * @private
 */
async function _fetchAndCacheTriggerMap(masterAccountId) {
  const cacheKey = masterAccountId || 'public'; // Use 'public' if no specific user
  logger.info(`[LoRAResolutionService] Fetching trigger map from API. User: ${masterAccountId || 'N/A (public only)'}`);
  
  try {
    const apiUrl = masterAccountId 
      ? `/lora/trigger-map-data?userId=${masterAccountId}`
      : '/lora/trigger-map-data';
      
    // Use the actual internalApiClient instance
    const response = await internalApiClient.get(apiUrl);

    if (!response || !response.data || typeof response.data !== 'object') {
      logger.error(`[LoRAResolutionService] Invalid API response structure for trigger map. User: ${cacheKey}. Response:`, response);
      // Fallback to existing cache if available, otherwise empty map
      const existingCached = triggerMapCache.get(cacheKey);
      return existingCached ? existingCached.data : new Map();
    }

    const newMap = new Map();
    for (const [key, loraList] of Object.entries(response.data)) {
      newMap.set(key.toLowerCase(), loraList); // API already provides lowercase keys from our previous step, but ensure.
    }
    
    triggerMapCache.set(cacheKey, { data: newMap, timestamp: Date.now() });
    logger.info(`[LoRAResolutionService] Successfully fetched and cached trigger map for ${cacheKey}. Map size: ${newMap.size} keys.`);
    return newMap;
  } catch (error) {
    logger.error(`[LoRAResolutionService] Error fetching trigger map from API for ${cacheKey}: ${error.message}`, error.stack);
    // Fallback to existing cache if available and error fetching, otherwise empty map
    const existingCached = triggerMapCache.get(cacheKey);
    if (existingCached) {
        logger.warn(`[LoRAResolutionService] Returning stale cache for ${cacheKey} due to fetch error.`);
        return existingCached.data;
    }
    return new Map(); // Return empty map on critical error and no cache
  }
}

/**
 * Retrieves the trigger map, utilizing cache or fetching if stale/absent.
 * @param {string} [masterAccountId] - Optional user ID.
 * @returns {Promise<Map<string, any[]>>} - The trigger map.
 * @private
 */
async function _getTriggerMap(masterAccountId) {
  const cacheKey = masterAccountId || 'public';
  const cachedEntry = triggerMapCache.get(cacheKey);

  if (cachedEntry && (Date.now() - cachedEntry.timestamp < USER_CACHE_TTL)) {
    logger.info(`[LoRAResolutionService] Using cached trigger map for ${cacheKey}.`);
    return cachedEntry.data;
  }
  
  return _fetchAndCacheTriggerMap(masterAccountId);
}


// Regex to find <lora:slug:weight> tags
const LORA_TAG_REGEX = /<lora:([^:]+):([^>]+)>/g;

// Regex for tokenizing prompt: captures words, words with weights, and preserves some punctuation contextually
const PROMPT_TOKENIZATION_REGEX = /(<lora:[^:]+:[^>]+>|\\b[a-zA-Z0-9_]+(?:[:\\\\.]\\d+)?\\b|[.,!?()[\]{}'"]+|\\s+)/g;


/**
 * Parses the prompt string, identifies LoRA triggers, resolves conflicts,
 * applies permissions, and substitutes triggers with LoRA syntax.
 *
 * @param {string} promptString - The raw prompt input by the user.
 * @param {string} masterAccountId - The ID of the user making the request.
 * @returns {Promise<{modifiedPrompt: string, rawPrompt: string, appliedLoras: Array<{slug: string, weight: number, originalWord: string, replacedWord: string, modelId: string}>, warnings: string[]}>}
 */
async function resolveLoraTriggers(promptString, masterAccountId) {
  const rawPrompt = promptString;
  let modifiedPromptElements = []; 
  const appliedLoras = [];
  const warnings = [];
  const lorasAppliedThisRun = new Set(); 

  // ADR-009 specifies masterAccountId is required.
  // If no masterAccountId, we can fetch a "public-only" map, or skip processing.
  // For now, let's be strict as per previous logic - if MAID needed for permissions, it must be there.
  // However, the API can handle no userId to return public. Let's allow fetching public if MAID is missing.
  // Caller (WorkflowsService) logs a warning if MAID is missing for a LoRA-enabled tool.

  logger.info(`[LoRAResolutionService] Resolving LoRAs for user: ${masterAccountId || 'N/A (public map only)'}. Prompt: "${promptString.substring(0,50)}..."`);
  const triggerMap = await _getTriggerMap(masterAccountId);

  if (!triggerMap || triggerMap.size === 0) {
    logger.info(`[LoRAResolutionService] Trigger map is empty for ${masterAccountId || 'public'}. Returning original prompt.`);
    return { modifiedPrompt: rawPrompt, rawPrompt, appliedLoras, warnings };
  }

  const tokens = promptString.match(PROMPT_TOKENIZATION_REGEX) || [];
  
  for (const token of tokens) {
    if (LORA_TAG_REGEX.test(token)) {
      LORA_TAG_REGEX.lastIndex = 0; 
      const match = LORA_TAG_REGEX.exec(token);
      if (match) {
        const slug = match[1];
        const weight = parseFloat(match[2]);
        if (!isNaN(weight)) {
            if (!lorasAppliedThisRun.has(slug)) {
                // TODO ADR Q6: Validate inline tags against triggerMap/permissions if strict validation is needed.
                // For now, assume valid and add to appliedLoras to prevent re-triggering.
                // The API fetched map would already be permission-filtered for the user.
                // If the slug from an inline tag isn't in *any* value of the triggerMap, it's an unknown LoRA.
                let foundInMap = false;
                triggerMap.forEach(loraList => {
                    if (loraList.some(l => l.slug === slug)) foundInMap = true;
                });
                if (foundInMap || !masterAccountId) { // If public map, or found in user's map
                    appliedLoras.push({ slug, weight, originalWord: token, replacedWord: token, modelId: 'N/A_INLINE_TAG' });
                    lorasAppliedThisRun.add(slug);
                } else {
                    warnings.push(`Inline tag <lora:${slug}:${weight}> refers to an unknown or inaccessible LoRA.`);
                }
            }
        }
      }
      modifiedPromptElements.push(token); 
      continue;
    }

    if (/\\s+/.test(token) || /[.,!?()[\]{}'"]+/.test(token)) {
        modifiedPromptElements.push(token); 
        continue;
    }
    
    let baseToken = token.toLowerCase();
    let userSpecifiedWeight = null;

    const weightMatch = token.match(/^([a-zA-Z0-9_]+):([0-9]*\\\\.?([0-9]+))$/i);
    if (weightMatch) {
      baseToken = weightMatch[1].toLowerCase();
      userSpecifiedWeight = parseFloat(weightMatch[2]);
    }

    if (triggerMap.has(baseToken)) {
      if (userSpecifiedWeight === 0.0) {
        logger.info(`[LoRAResolutionService] LoRA trigger suppression for: ${baseToken} via weight 0.0`);
        modifiedPromptElements.push(token); 
        continue;
      }

      let potentialLoras = triggerMap.get(baseToken) || [];
      let selectedLora = null;

      if (potentialLoras.length > 0) {
        const publicLoras = potentialLoras.filter(l => l.access === 'public');
        const privateLoras = potentialLoras.filter(l => l.access === 'private' && l.ownerAccountId === masterAccountId); // User's own
        const sharedPrivateLoras = potentialLoras.filter(l => l.access === 'private' && l.ownerAccountId !== masterAccountId); // Private but shared via permission

        // ADR-009 Conflict Resolution
        if (privateLoras.length > 0) { // Prefer user's own private
            privateLoras.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            selectedLora = privateLoras[0];
        } else if (sharedPrivateLoras.length > 0) { // Then prefer shared private (API already permission-filtered)
            sharedPrivateLoras.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            selectedLora = sharedPrivateLoras[0];
        } else if (publicLoras.length > 0) { // Then public
          if (publicLoras.length > 1) {
            const conflictWarning = `Multiple public LoRAs found for trigger '${baseToken}'. Slugs: ${publicLoras.map(l=>l.slug).join(', ')}. Using the most recently updated: ${publicLoras.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0].slug}.`;
            logger.warn(`[LoRAResolutionService] ${conflictWarning}`);
            warnings.push(conflictWarning);
            publicLoras.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            selectedLora = publicLoras[0];
          } else {
            selectedLora = publicLoras[0]; 
          }
        }
      }

      if (selectedLora && !lorasAppliedThisRun.has(selectedLora.slug)) {
        const weightToApply = userSpecifiedWeight !== null ? userSpecifiedWeight : selectedLora.defaultWeight;

        if (weightToApply === 0.0) {
            modifiedPromptElements.push(token);
            continue;
        }

        const loraTag = `<lora:${selectedLora.slug}:${weightToApply}>`;
        
        // ADR Q5: "the trigger becomes <lora:slug:1> trigger"
        // The 'baseTrigger' field from loraDataForMap (in API response) is the original trigger.
        // If it's a cognate, API provides `replaceWithBaseTrigger`.
        const replacementWordSegment = selectedLora.isCognate ? selectedLora.replaceWithBaseTrigger : selectedLora.baseTrigger;

        modifiedPromptElements.push(`${loraTag} ${replacementWordSegment}`);
        
        appliedLoras.push({
          slug: selectedLora.slug,
          weight: weightToApply,
          originalWord: token, 
          replacedWord: `${loraTag} ${replacementWordSegment}`,
          modelId: selectedLora.modelId 
        });
        lorasAppliedThisRun.add(selectedLora.slug);
      } else {
        modifiedPromptElements.push(token);
      }
    } else {
      modifiedPromptElements.push(token);
    }
  }
  
  const finalPrompt = modifiedPromptElements.join("");

  logger.info(`[LoRAResolutionService] Resolution complete for user ${masterAccountId || 'public'}. Modified prompt: "${finalPrompt.substring(0,100)}...". Applied LoRAs: ${appliedLoras.length}. Warnings: ${warnings.length}.`);
  return { modifiedPrompt: finalPrompt, rawPrompt, appliedLoras, warnings };
}

/**
 * Manually invalidates the LoRA trigger map cache for a specific user or all users.
 * @param {string} [masterAccountId] - Optional. If provided, clears cache for this user. Otherwise, clears all.
 */
function refreshTriggerMapCache(masterAccountId) {
  if (masterAccountId) {
    if (triggerMapCache.has(masterAccountId)) {
      triggerMapCache.delete(masterAccountId);
      logger.info(`[LoRAResolutionService] LoRA trigger map cache cleared for user: ${masterAccountId}`);
    } else {
      logger.info(`[LoRAResolutionService] No cache found for user ${masterAccountId} to clear.`);
    }
  } else {
    triggerMapCache.clear();
    logger.info('[LoRAResolutionService] Entire LoRA trigger map cache cleared.');
  }
}

module.exports = {
  resolveLoraTriggers,
  refreshTriggerMapCache,
}; 