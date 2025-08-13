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
      this.logger.error('Error calling OpenAI API:', error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }
}

module.exports = OpenAIService; 