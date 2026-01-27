/**
 * Mapper for JoyCaption Beta One — image-to-text captioning.
 * Translates tool params into Gradio positional arguments and parses the result.
 */

module.exports = {
  toolId: 'joycaption',
  gradioFunction: 'chat_joycaption',
  sseTimeout: 180000,

  /**
   * Build the positional data array for the chat_joycaption Gradio function.
   * @param {object} params - Tool input parameters
   * @param {import('../GradioSpaceService')} service - GradioSpaceService instance
   * @returns {Promise<Array>}
   */
  async buildInput(params, service) {
    const extraOptions = normalizeExtraOptions(params.extraOptions);

    // Pre-step: call build_prompt on the space to construct the prompt
    const prompt = await buildPrompt(service, {
      captionType: params.captionType || 'Descriptive',
      captionLength: params.captionLength || 'long',
      extraOptions,
      personName: params.personName || ''
    });

    // Upload image
    const uploadedPath = await service.uploadFile(params.imageUrl);

    return [
      { path: uploadedPath },
      prompt,
      sanitizeNumber(params.temperature, 0, 2, 0.6),
      sanitizeNumber(params.topP, 0, 1, 0.9),
      Math.round(sanitizeNumber(params.maxNewTokens, 1, 2048, 512)),
      Boolean(params.logPrompt)
    ];
  },

  /**
   * Parse the raw Gradio result into a normalized tool output.
   * @param {any} rawResult - Result from GradioSpaceService.invoke (single string for JoyCaption)
   * @param {string} spaceUrl - Base URL of the space
   * @returns {object}
   */
  parseOutput(rawResult, spaceUrl) {
    const description = typeof rawResult === 'string' ? rawResult : String(rawResult);
    return {
      type: 'text',
      data: { text: [description] },
    };
  }
};

// ── Helpers ─────────────────────────────────────────────────────────

async function buildPrompt(service, { captionType, captionLength, extraOptions, personName }) {
  try {
    const result = await service.invoke('build_prompt', [
      captionType || 'Descriptive',
      captionLength || 'long',
      Array.isArray(extraOptions) ? extraOptions : [],
      personName || ''
    ]);
    if (typeof result === 'string') return result;
    if (Array.isArray(result) && typeof result[0] === 'string') return result[0];
  } catch (error) {
    service.logger.warn(`[joycaptionMapper] Prompt builder failed (${error.message}). Falling back to default prompt.`);
  }
  return 'Write a long detailed description for this image.';
}

function normalizeExtraOptions(extraOptions) {
  if (Array.isArray(extraOptions)) {
    return extraOptions.map(option => option && option.toString().trim()).filter(Boolean);
  }
  if (typeof extraOptions === 'string') {
    return extraOptions.split(/[\n,;]+/).map(part => part.trim()).filter(Boolean);
  }
  return [];
}

function sanitizeNumber(value, min, max, fallback) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}
