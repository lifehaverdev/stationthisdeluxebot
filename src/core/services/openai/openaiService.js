const OpenAI = require("openai");

/**
 * Delay helper for exponential backoff
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (rate limit or server error)
 */
function isRetryableError(error) {
  const status = error.status || error.response?.status;
  // 429 = rate limit, 5xx = server errors
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Service to interact with the OpenAI API.
 *
 * Includes automatic retry with exponential backoff for rate limits (429)
 * and transient server errors (5xx).
 */
class OpenAIService {
  // Retry configuration
  static MAX_RETRIES = 3;
  static BASE_DELAY_MS = 1000;  // Start with 1 second
  static MAX_DELAY_MS = 30000;  // Cap at 30 seconds
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
   * Execute an async function with exponential backoff retry on rate limits.
   *
   * @param {Function} fn - Async function to execute
   * @param {string} operationName - Name for logging
   * @returns {Promise<any>} Result of the function
   */
  async _withRetry(fn, operationName = 'OpenAI request') {
    let lastError;

    for (let attempt = 0; attempt <= OpenAIService.MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error) || attempt === OpenAIService.MAX_RETRIES) {
          throw error;
        }

        // Calculate delay with exponential backoff + jitter
        const baseDelay = OpenAIService.BASE_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * 1000; // Add up to 1s of jitter
        const delayMs = Math.min(baseDelay + jitter, OpenAIService.MAX_DELAY_MS);

        // Check for Retry-After header (OpenAI sometimes sends this)
        const retryAfter = error.headers?.['retry-after'];
        const actualDelay = retryAfter ? Math.max(parseInt(retryAfter) * 1000, delayMs) : delayMs;

        this.logger.warn(
          `[OpenAI] ${operationName} rate limited (attempt ${attempt + 1}/${OpenAIService.MAX_RETRIES + 1}), ` +
          `retrying in ${Math.round(actualDelay / 1000)}s...`
        );

        await delay(actualDelay);
      }
    }

    throw lastError;
  }

  /**
   * Executes a chat completion request to the OpenAI API.
   * @param {object} params - The parameters for the chat completion.
   * @param {string} params.prompt - The user's prompt.
   * @param {string} [params.instructions='You are a helpful assistant.'] - System instructions.
   * @param {number} [params.temperature=0.7] - The sampling temperature.
   * @param {string} [params.model='gpt-3.5-turbo'] - The model to use.
   * @returns {Promise<{content: string, usage?: object}>} The content and usage data from the AI's response.
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
      const completion = await this._withRetry(
        () => this.openai.chat.completions.create({
          messages: messages,
          model: model,
          temperature: parseFloat(temperature),
        }),
        `chat completion (${model})`
      );

      const responseContent = completion.choices[0]?.message?.content;
      if (responseContent) {
        // Return both content and usage data for cost calculation
        return {
          content: responseContent,
          usage: completion.usage || null, // { prompt_tokens, completion_tokens, total_tokens }
          model: completion.model || model
        };
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
      const response = await this._withRetry(
        () => this.openai.images.generate({
          model,
          prompt,
          n: 1,
          size,
          response_format: responseFormat,
          ...(quality ? { quality } : {})
        }),
        `image generation (${model})`
      );

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