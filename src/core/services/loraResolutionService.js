// src/core/services/loraResolutionService.js

const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Cache structure: Map<masterAccountId_or_\"public\", { data: Map<triggerKey, LoRAInfo[]>, timestamp: number }>
const triggerMapCache = new Map(); 
const logger = console; // Replace with a proper logger instance if available

/**
 * Fetches the trigger map from the internal API and caches it.
 * @param {string} [masterAccountId] - Optional user ID for permission-aware map.
 * @param {string} [toolBaseModel] - Optional tool base model for filtering.
 * @returns {Promise<Map<string, any[]>>} - The trigger map.
 * @private
 */
async function _fetchAndCacheTriggerMap(internalApiClient, masterAccountId, toolBaseModel) {
  const cacheKey = masterAccountId || 'public';
  let apiUrl = masterAccountId ? `/internal/v1/data/lora/trigger-map-data?userId=${masterAccountId}` : '/internal/v1/data/lora/trigger-map-data';
  if (toolBaseModel) {
    apiUrl += (apiUrl.includes('?') ? '&' : '?') + `baseModelType=${toolBaseModel}`;
  }
  
  try {
    const response = await internalApiClient.get(apiUrl);

    if (!response || !response.data || typeof response.data !== 'object') {
      logger.error(`[LoRAResolutionService] Invalid API response structure for trigger map. User: ${cacheKey}. Response:`, response);
      const existingCached = triggerMapCache.get(cacheKey);
      return existingCached ? existingCached.data : new Map();
    }

    const newMap = new Map();
    for (const [key, loraList] of Object.entries(response.data)) {
      newMap.set(key.toLowerCase(), loraList);
    }
    
    triggerMapCache.set(cacheKey, { data: newMap, timestamp: Date.now() });
    return newMap;
  } catch (error) {
    logger.error(`[LoRAResolutionService] Error fetching trigger map from API for ${cacheKey}: ${error.message}`, error.stack);
    const existingCached = triggerMapCache.get(cacheKey);
    if (existingCached) {
        logger.warn(`[LoRAResolutionService] Returning stale cache for ${cacheKey} due to fetch error.`);
        return existingCached.data;
    }
    return new Map();
  }
}

/**
 * Retrieves the trigger map, utilizing cache or fetching if stale/absent.
 * @param {string} [masterAccountId] - Optional user ID.
 * @param {string} [toolBaseModel] - Optional tool base model for filtering.
 * @returns {Promise<Map<string, any[]>>} - The trigger map.
 * @private
 */
async function _getTriggerMap(internalApiClient, masterAccountId, toolBaseModel) {
  const cacheKey = masterAccountId || 'public';
  const cachedEntry = triggerMapCache.get(cacheKey);

  if (cachedEntry && (Date.now() - cachedEntry.timestamp < USER_CACHE_TTL)) {
    return cachedEntry.data;
  }
  
  return _fetchAndCacheTriggerMap(internalApiClient, masterAccountId, toolBaseModel);
}

// Regex to find <lora:slug:weight> tags
const LORA_TAG_REGEX = /<lora:([^:]+):([^>]+)>/g;
// Regex to parse a word and its optional weight: captures word part, then :weight part.
// Allows for punctuation attached to the word which will be handled separately.
const WORD_AND_WEIGHT_REGEX = /^([a-zA-Z0-9_.-]+)(?::(\d*\.?\d+))?([\s.,!?()[\]{}\'\"]*)$/;
// More general split regex to preserve spaces and punctuation as tokens
const SPLIT_KEEP_DELIMITERS_REGEX = /(\s+|[.,!?()[\]{}\'\"]+)/g;

/**
 * Parses the prompt string, identifies LoRA triggers, resolves conflicts,
 * applies permissions, and substitutes triggers with LoRA syntax.
 *
 * @param {string} promptString - The raw prompt input by the user.
 * @param {string} masterAccountId - The ID of the user making the request.
 * @param {string} [toolBaseModel] - Optional tool base model for filtering.
 * @returns {Promise<{modifiedPrompt: string, rawPrompt: string, appliedLoras: Array<{slug: string, weight: number, originalWord: string, replacedWord: string, modelId: string}>, warnings: string[]}>}
 */
async function resolveLoraTriggers(promptString, masterAccountId, toolBaseModel, dependencies) {
  const rawPrompt = promptString;
  const internalApiClient = dependencies && dependencies.internal ? dependencies.internal.client : null;
  if(!internalApiClient){
      logger.warn('[LoRAResolutionService] Missing internalApiClient dependency, skipping LoRA resolution.');
      return { modifiedPrompt: rawPrompt, rawPrompt, appliedLoras: [], warnings: ['LoRA resolution skipped due to internal error'] };
  }
  const appliedLoras = [];
  const warnings = [];
  const lorasAppliedThisRun = new Set(); // Tracks slugs of LoRAs applied in this run

  const triggerMap = await _getTriggerMap(internalApiClient, masterAccountId, toolBaseModel);

  if (!triggerMap || triggerMap.size === 0) {
    return { modifiedPrompt: rawPrompt, rawPrompt, appliedLoras, warnings };
  }

  let remainingPrompt = promptString;
  const finalPromptParts = [];
  
  // Pass 1: Extract and process existing <lora:...> tags
  let loraTagMatch;
  let lastIndex = 0;
  while ((loraTagMatch = LORA_TAG_REGEX.exec(remainingPrompt)) !== null) {
    // Add text before this tag
    finalPromptParts.push(remainingPrompt.substring(lastIndex, loraTagMatch.index));
    
    const fullTag = loraTagMatch[0];
    const slug = loraTagMatch[1];
    const weight = parseFloat(loraTagMatch[2]);

    if (!isNaN(weight)) {
        if (!lorasAppliedThisRun.has(slug)) {
            // ADR Q6: Validate inline tags
            let foundInMap = false;
            triggerMap.forEach(loraList => { // Check if this slug is known (permissioned)
                if (loraList.some(l => l.slug === slug)) foundInMap = true;
            });

            if (foundInMap || !masterAccountId) { // Allow if public map or found in user's permissioned map
                appliedLoras.push({ slug, weight, originalWord: fullTag, replacedWord: fullTag, modelId: 'N/A_INLINE_TAG' });
                lorasAppliedThisRun.add(slug);
                finalPromptParts.push(fullTag); // Keep the valid, permissioned tag
            } else {
                warnings.push(`Inline tag ${fullTag} refers to an unknown or inaccessible LoRA. It will be stripped.`);
                // Do not add the tag to finalPromptParts, effectively stripping it.
            }
        } else {
             finalPromptParts.push(fullTag); // Already processed (e.g. duplicate), just pass it through
        }
    } else {
        warnings.push(`Invalid weight in inline tag ${fullTag}. Tag will be preserved as text.`);
        finalPromptParts.push(fullTag); // Invalid weight, treat as plain text
    }
    lastIndex = LORA_TAG_REGEX.lastIndex;
  }
  // Add any remaining text after the last LoRA tag (or the whole prompt if no tags)
  finalPromptParts.push(remainingPrompt.substring(lastIndex));

  // Pass 2: Process remaining text for triggers
  let currentPromptText = finalPromptParts.join("");
  finalPromptParts.length = 0; // Clear for reconstruction

  // Split by spaces and punctuation, keeping them as separate tokens
  const segments = currentPromptText.split(SPLIT_KEEP_DELIMITERS_REGEX).filter(s => s && s.length > 0);

  // Merge decimal weight tokens broken by the split (e.g., "trigger:.4" or "trigger:0.4")
  const mergedSegments = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const next = segments[i + 1];
    const next2 = segments[i + 2];
    const hasColon = seg && seg.includes(':');
    const weightPrefixPattern = /^[a-zA-Z0-9_.-]+(?::\d*)?$/; // word with optional :digits (allow none after colon)

    if (hasColon && weightPrefixPattern.test(seg) && next === '.' && next2 && /^\d+$/.test(next2)) {
      // Combine into a single token to preserve decimal weights: "trigger:"+"."+"4" => "trigger:.4"
      mergedSegments.push(seg + '.' + next2);
      i += 2; // Skip the next two tokens we've merged
      continue;
    }

    mergedSegments.push(seg);
  }

  for (const segment of mergedSegments) {
    if (LORA_TAG_REGEX.test(segment)) { // Skip already processed <lora:...> tags
        finalPromptParts.push(segment);
        continue;
    }
    if (SPLIT_KEEP_DELIMITERS_REGEX.test(segment) && segment.match(SPLIT_KEEP_DELIMITERS_REGEX)[0] === segment) { // Is a delimiter token
        finalPromptParts.push(segment);
        continue;
    }

    // Try to parse word and potential weight (e.g., "word:0.5" or "word" or "word.")
    // WORD_AND_WEIGHT_REGEX: 1=word, 2=weight (optional), 3=trailing punctuation/space (optional)
    const wordMatch = segment.match(/^([a-zA-Z0-9_.-]+)(?::(\d*\.?\d+))?/);
    
    let baseToken = "";
    let userSpecifiedWeight = null;
    let trailingPunctuation = ""; // Punctuation attached to the word
    let originalSegmentForPush = segment; // What to push if no LoRA found

    if (wordMatch) {
        baseToken = wordMatch[1].toLowerCase();
        if (wordMatch[2] !== undefined) { // Weight is present
            userSpecifiedWeight = parseFloat(wordMatch[2]);
        }
        // Check for trailing punctuation that was part of the segment but not the baseToken/weight
        const matchedPartLength = wordMatch[0].length;
        if (segment.length > matchedPartLength) {
            trailingPunctuation = segment.substring(matchedPartLength);
        }
    } else { // Not a word[:weight] pattern, likely just a word or unmatchable segment
        baseToken = segment.toLowerCase().replace(/[.,!?()[\]{}\'\"]+$/, ''); // Clean trailing punctuation for map lookup
        originalSegmentForPush = segment; // Keep original for re-adding
    }
    
    if (triggerMap.has(baseToken)) {
      if (userSpecifiedWeight === 0.0) {
        finalPromptParts.push(originalSegmentForPush); 
        continue;
      }

      let potentialLoras = triggerMap.get(baseToken) || [];

      // BEGIN MODIFICATION: Filter by toolBaseModel if provided
      if (toolBaseModel && potentialLoras.length > 0) {
        const initialCount = potentialLoras.length;
        const upperCaseToolBaseModel = toolBaseModel.toUpperCase();

        // Updated logic for flexible LoRA compatibility
        if (upperCaseToolBaseModel === 'SD1.5-XL' || upperCaseToolBaseModel === 'SDXL') {
          // SDXL-based models can often handle both SDXL and SD1.5 LoRAs.
          potentialLoras = potentialLoras.filter(lora =>
            lora.checkpoint && ['SD1.5', 'SDXL', 'ILLUSTRIOUS'].includes(lora.checkpoint.toUpperCase())
          );
        } else if (upperCaseToolBaseModel === 'SD1.5') {
          // SD1.5 models can only handle SD1.5 LoRAs.
          potentialLoras = potentialLoras.filter(lora =>
            lora.checkpoint && lora.checkpoint.toUpperCase() === 'SD1.5'
          );
        } else if (upperCaseToolBaseModel === 'FLUX') {
          // FLUX models only use FLUX LoRAs
          potentialLoras = potentialLoras.filter(lora =>
            lora.checkpoint && lora.checkpoint.toUpperCase().startsWith('FLUX')
          );
        } else if (upperCaseToolBaseModel === 'KONTEXT') {
          // KONTEXT prefers KONTEXT LoRAs, but can use FLUX LoRAs (less effective)
          potentialLoras = potentialLoras.filter(lora => {
            const cp = lora.checkpoint?.toUpperCase() || '';
            return cp === 'KONTEXT' || cp.startsWith('FLUX');
          });
        } else {
          // For other models (e.g., SD3), require an exact match.
          potentialLoras = potentialLoras.filter(lora =>
            lora.checkpoint && lora.checkpoint.toUpperCase() === upperCaseToolBaseModel
          );
        }

      }
      // END MODIFICATION

      let selectedLora = null;

      if (potentialLoras.length > 0) {
        // ADR-009 Conflict Resolution (simplified for brevity, full logic was there)
        const privateLoras = potentialLoras.filter(l => l.access === 'private' && l.ownerAccountId === masterAccountId);
        const sharedPrivateLoras = potentialLoras.filter(l => l.access === 'private' && l.ownerAccountId !== masterAccountId);
        const publicLoras = potentialLoras.filter(l => l.access === 'public');

        if (privateLoras.length > 0) {
            privateLoras.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            selectedLora = privateLoras[0];
        } else if (sharedPrivateLoras.length > 0) {
            sharedPrivateLoras.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            selectedLora = sharedPrivateLoras[0];
        } else if (publicLoras.length > 0) {
          publicLoras.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          if (publicLoras.length > 1) {
            const conflictWarning = `Multiple public LoRAs for trigger '${baseToken}'. Slugs: ${publicLoras.map(l=>l.slug).join(', ')}. Using: ${publicLoras[0].slug}.`;
            warnings.push(conflictWarning);
          }
          selectedLora = publicLoras[0];
        }
      }

      if (selectedLora) {
        if (lorasAppliedThisRun.has(selectedLora.slug)) {
          // This LoRA has already been applied, so just remove the trigger word.
          finalPromptParts.push(trailingPunctuation);
          continue;
        }

        const weight = userSpecifiedWeight !== null ? userSpecifiedWeight : (selectedLora.defaultWeight || 1.0);
        const loraTag = `<lora:${selectedLora.slug}:${weight}>`;

        appliedLoras.push({
          slug: selectedLora.slug,
          weight: weight,
          originalWord: segment,
          replacedWord: loraTag,
          modelId: selectedLora.modelId
        });
        lorasAppliedThisRun.add(selectedLora.slug);

        // Add the LoRA tag for reconstruction.
        finalPromptParts.push(loraTag);

        // If the trigger was a generated hash, we are done with this segment.
        // If it was a normal trigger, add the original text back to preserve user phrasing.
        if (!baseToken.startsWith('lorahash_')) {
          finalPromptParts.push(baseToken);
        }

        // Always add any trailing punctuation back.
        finalPromptParts.push(trailingPunctuation);

      } else {
        // No *valid* LoRA for this trigger (e.g., filtered out), so add the original segment back.
        finalPromptParts.push(originalSegmentForPush);
      }
    } else {
      // Not a trigger, just add the segment back
      finalPromptParts.push(segment);
    }
  }
  
  const finalPrompt = finalPromptParts.join("");

  return { modifiedPrompt: finalPrompt, rawPrompt, appliedLoras, warnings };
}

/**
 * Manually invalidates the LoRA trigger map cache for a specific user or all users.
 * @param {string} [masterAccountId] - Optional. If provided, clears cache for this user. Otherwise, clears all.
 */
function refreshTriggerMapCache(masterAccountId) {
  if (masterAccountId) {
    triggerMapCache.delete(masterAccountId);
  } else {
    triggerMapCache.clear();
  }
}

module.exports = {
  resolveLoraTriggers,
  refreshTriggerMapCache,
}; 