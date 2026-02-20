/**
 * HuggingFace Service — backward-compatible facade.
 * Delegates to GradioSpaceService + joycaptionMapper for image interrogation.
 */

const GradioSpaceService = require('./GradioSpaceService');
const joycaptionMapper = require('./mappers/joycaptionMapper');

class HuggingFaceService {
  /**
   * @param {object} options - Service configuration.
   * @param {object} options.logger - A logger instance.
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this._space = new GradioSpaceService({
      spaceUrl: 'https://fancyfeast-joy-caption-beta-one.hf.space',
      logger: this.logger
    });
    this.logger.debug('HuggingFaceService initialized successfully.');
  }

  /**
   * Interrogates an image using the JoyCaption Beta One API to generate a text description.
   * @param {object} params - Parameters for image interrogation.
   * @param {string} params.imageUrl - URL of the image to interrogate.
   * @param {string} [params.captionType]
   * @param {string} [params.captionLength]
   * @param {string|string[]} [params.extraOptions]
   * @param {string} [params.personName]
   * @param {number} [params.temperature]
   * @param {number} [params.topP]
   * @param {number} [params.maxNewTokens]
   * @param {boolean} [params.logPrompt]
   * @returns {Promise<string>} The generated text description of the image.
   */
  async interrogateImage(params = {}) {
    if (!params.imageUrl || typeof params.imageUrl !== 'string') {
      throw new Error('Image URL is required for interrogation.');
    }

    this.logger.info(`Starting image interrogation for URL: ${params.imageUrl}`);

    try {
      const dataArray = await joycaptionMapper.buildInput(params, this._space);
      const rawResult = await this._space.invoke(joycaptionMapper.gradioFunction, dataArray, {
        timeout: joycaptionMapper.sseTimeout
      });
      const result = joycaptionMapper.parseOutput(rawResult, this._space.baseUrl);
      const description = result.data.text[0];

      if (!description || typeof description !== 'string') {
        throw new Error('Invalid description format received');
      }

      this.logger.info('Image interrogation completed successfully');
      return description;
    } catch (error) {
      // Re-throw quota errors with user-friendly JoyCaption-specific messaging
      if (error.message.includes('quota exceeded') || error.message.includes('quota exhausted')) {
        this.logger.error(`HuggingFace quota/rate limit error: ${error.message}`);
        throw error;
      }

      this.logger.error(`Image interrogation failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = HuggingFaceService;
