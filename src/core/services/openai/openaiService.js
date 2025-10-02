const OpenAI = require("openai");

/**
 * Service to interact with the OpenAI API.
 */
class OpenAIService {
  /**
   * @param {object} options - Service configuration.
   * @param {object} options.logger - A logger instance.
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    const apiKey = process.env.OPENAI_API;

    if (!apiKey) {
      this.logger.warn('OPENAI_API is not set in environment variables. OpenAIService will be inoperable.');
      this.openai = null;
    } else {
      this.openai = new OpenAI({ apiKey });
      this.logger.info('OpenAIService initialized successfully.');
    }
  }

  /**
   * Executes a chat completion request to the OpenAI API.
   * @param {object} params - The parameters for the chat completion.
   * @param {string} params.prompt - The user's prompt.
   * @param {string} [params.instructions='You are a helpful assistant.'] - System instructions.
   * @param {number} [params.temperature=0.7] - The sampling temperature.
   * @param {string} [params.model='gpt-3.5-turbo'] - The model to use.
   * @returns {Promise<string>} The content of the AI's response.
   */
  async executeChatCompletion({
    prompt,
    instructions = 'You are a helpful assistant.',
    temperature = 0.7,
    model = 'gpt-3.5-turbo'
  }) {
    // --- Normalise inputs ---
    if (Array.isArray(prompt)) {
      prompt = prompt.join('\n');
    }
    if (Array.isArray(instructions)) {
      instructions = instructions.join('\n');
    }

    if (!this.openai) {
      this.logger.error('Cannot execute chat completion: OpenAIService is not initialized (missing API key).');
      throw new Error('OpenAIService is not initialized. Please set the OPENAI_API environment variable.');
    }

    const messages = [
      { "role": "user", "content": instructions },
      { "role": "system", "content": "Acknowledged. I will follow these instructions. Exactly how you instructed. Please provide your prompt."},
      { "role": "user", "content": prompt }
    ];

    this.logger.info(`Sending completion request to OpenAI with model ${model}...`);
    try {
      const completion = await this.openai.chat.completions.create({
        messages: messages,
        model: model,
        temperature: parseFloat(temperature),
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (responseContent) {
        return responseContent;
      } else {
        this.logger.warn('OpenAI response was successful but content was empty.', completion);
        throw new Error('Received an empty response from OpenAI.');
      }
    } catch (error) {
      // Sanitize potential API key leakage in error messages
      const sanitizedMessage = String(error.message).replace(/sk-[a-zA-Z0-9-]{20,}/g, 'sk-************************************');
      this.logger.error('Error calling OpenAI API:', sanitizedMessage);
      const err = new Error(sanitizedMessage);
      err.original = error;
      throw err; // Re-throw sanitized error to be handled by the caller
    }
  }

  /**
   * Generates an image using OpenAI's DALL·E model.
   * @param {object} params - Parameters for image generation.
   * @param {string} params.prompt - Description of the desired image.
   * @param {string} [params.model='dall-e-3'] - The model to use.
   * @param {string} [params.size='1024x1024'] - Image size (e.g., "1024x1024").
   * @param {'url'|'b64_json'} [params.responseFormat='url'] - Desired response format.
   * @returns {Promise<string>} URL or base64 string of the generated image.
   */
  async generateImage({
    prompt,
    model = 'dall-e-3',
    size = '1024x1024',
    responseFormat = 'url',
    quality
  }) {
    if (!this.openai) {
      this.logger.error('Cannot generate image: OpenAIService is not initialized (missing API key).');
      throw new Error('OpenAIService is not initialized. Please set the OPENAI_API environment variable.');
    }

    if (!prompt) {
      throw new Error('Prompt is required to generate an image.');
    }

    this.logger.info(`Requesting image generation with model ${model}...`);
    try {
      const response = await this.openai.images.generate({
        model,
        prompt,
        n: 1,
        size,
        response_format: responseFormat,
        ...(quality ? { quality } : {})
      });

      const resultObj = response.data?.[0];
      if (resultObj) {
        return resultObj; // { url: ..., b64_json: ... }
      } else {
        this.logger.warn('OpenAI image generation succeeded but result was empty.', response);
        throw new Error('Received an empty image response from OpenAI.');
      }
    } catch (error) {
      // Sanitize potential API key leakage in error messages
      const sanitizedMessage = String(error.message).replace(/sk-[a-zA-Z0-9-]{20,}/g, 'sk-************************************');
      this.logger.error('Error generating image via OpenAI:', sanitizedMessage);
      const err = new Error(sanitizedMessage);
      err.original = error;
      throw err; // Re-throw sanitized error to be handled by the caller
    }
  }
}

module.exports = OpenAIService; 