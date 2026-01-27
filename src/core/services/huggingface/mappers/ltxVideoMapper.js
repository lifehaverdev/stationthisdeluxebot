/**
 * Mapper for LTX-2-Distilled — text/image-to-video generation.
 */

module.exports = {
  toolId: 'ltx-video',
  gradioFunction: 'generate_video',
  sseTimeout: 300000, // 5 minutes — video generation takes longer

  /**
   * Build the positional data array for the generate_video Gradio function.
   * @param {object} params
   * @param {import('../GradioSpaceService')} service
   * @returns {Promise<Array>}
   */
  async buildInput(params, service) {
    if (!params.prompt) throw new Error('prompt is required for LTX video generation');

    let imageRef = null;
    if (params.imageUrl) {
      const uploadedPath = await service.uploadFile(params.imageUrl);
      imageRef = { path: uploadedPath, meta: { _type: 'gradio.FileData' } };
    }

    return [
      imageRef,                              // [0] image (optional)
      params.prompt,                         // [1] prompt
      params.duration ?? 2,                  // [2] duration seconds
      params.enhancePrompt ?? true,          // [3] enhance prompt
      params.seed ?? 0,                      // [4] seed
      params.randomizeSeed ?? true,          // [5] randomize seed
      params.height ?? 512,                  // [6] height
      params.width ?? 768                    // [7] width
    ];
  },

  /**
   * Parse the raw Gradio result into a normalized tool output.
   * @param {any} rawResult - Result from invoke (array: [videoFileRef, seedNumber])
   * @param {string} spaceUrl
   * @returns {object}
   */
  parseOutput(rawResult, spaceUrl) {
    const result = Array.isArray(rawResult) ? rawResult : [rawResult];
    const videoRef = result[0];
    const videoPath = typeof videoRef === 'string' ? videoRef
      : videoRef?.path || videoRef?.url || videoRef?.value;

    const videoUrl = videoPath?.startsWith('http')
      ? videoPath
      : `${spaceUrl}/gradio_api/file=${videoPath}`;

    return {
      type: 'video',
      data: { videoUrl },
      costUsd: 0
    };
  }
};
