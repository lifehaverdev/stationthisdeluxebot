/**
 * Mapper for Qwen Image Layered — image decomposition into layers.
 */

module.exports = {
  toolId: 'qwen-layered',
  gradioFunction: 'infer_1',
  sseTimeout: 300000, // 5 minutes — decomposition can be slow

  /**
   * Build the positional data array for the infer_1 Gradio function.
   * @param {object} params
   * @param {import('../GradioSpaceService')} service
   * @returns {Promise<Array>}
   */
  async buildInput(params, service) {
    if (!params.imageUrl) throw new Error('imageUrl is required for Qwen layered decomposition');

    const uploadedPath = await service.uploadFile(params.imageUrl);

    return [
      { path: uploadedPath, meta: { _type: 'gradio.FileData' } },  // [0] image
      params.seed ?? 0,                       // [1] seed
      params.randomizeSeed ?? true,           // [2] randomize seed
      params.prompt ?? '',                    // [3] prompt
      params.negativePrompt ?? ' ',           // [4] negative prompt (space = empty)
      params.guidanceScale ?? 4,              // [5] guidance scale
      params.inferenceSteps ?? 50,            // [6] steps
      params.layers ?? 4,                     // [7] layers
      params.enableCfgNorm ?? true,           // [8] CFG norm
      params.autoCaptionEnglish ?? true       // [9] auto caption EN
    ];
  },

  /**
   * Parse the raw Gradio result into a normalized tool output.
   * @param {any} rawResult - Result from invoke (array: [gallery, pptxRef, zipRef])
   * @param {string} spaceUrl
   * @returns {object}
   */
  parseOutput(rawResult, spaceUrl) {
    const result = Array.isArray(rawResult) ? rawResult : [rawResult];
    const [gallery, pptxRef, zipRef] = result;
    const files = [];

    // Gallery: array of image objects
    if (Array.isArray(gallery)) {
      gallery.forEach((item, i) => {
        const imgPath = typeof item === 'string' ? item
          : item?.image?.path || item?.path || item?.url;
        if (imgPath) {
          const url = imgPath.startsWith('http') ? imgPath
            : `${spaceUrl}/gradio_api/file=${imgPath}`;
          files.push({ url, filename: `layer_${i}.png` });
        }
      });
    }

    // PPTX file
    const pptxPath = typeof pptxRef === 'string' ? pptxRef
      : pptxRef?.path || pptxRef?.url || pptxRef?.value;
    if (pptxPath) {
      const url = pptxPath.startsWith('http') ? pptxPath
        : `${spaceUrl}/gradio_api/file=${pptxPath}`;
      files.push({ url, filename: 'layers.pptx' });
    }

    // ZIP file
    const zipPath = typeof zipRef === 'string' ? zipRef
      : zipRef?.path || zipRef?.url || zipRef?.value;
    if (zipPath) {
      const url = zipPath.startsWith('http') ? zipPath
        : `${spaceUrl}/gradio_api/file=${zipPath}`;
      files.push({ url, filename: 'layers.zip' });
    }

    return {
      type: 'file',
      data: { files },
      costUsd: 0
    };
  }
};
