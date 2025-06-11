const express = require('express');

function initializeLlmApi(services) {
  const router = express.Router();
  const { openai: openAIService, logger } = services;

  if (!openAIService) {
    logger.warn('LLM API could not be initialized: OpenAIService is not available.');
    // Return a router that returns a 503 Service Unavailable for all requests
    router.use((req, res) => {
      res.status(503).json({ error: 'The OpenAI service is not configured or available.' });
    });
    return router;
  }

  router.post('/chat', async (req, res) => {
    logger.info(`[API /llm/chat] Received request: ${JSON.stringify(req.body)}`);
    
    // Extract parameters from the request body, matching the tool definition's inputSchema
    const { prompt, instructions, temperature, model } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Missing required 'prompt' parameter." });
    }

    try {
      const result = await openAIService.executeChatCompletion({
        prompt,
        instructions,
        temperature,
        model
      });
      
      logger.info(`[API /llm/chat] Successfully received response from OpenAI.`);
      // The tool's webhookStrategy expects a certain structure.
      // For a synchronous tool, we can just return the final result directly.
      res.status(200).json({
        status: 'completed',
        result: result,
        choices: [{ message: { content: result } }] // Mimic OpenAI structure for resultPath
      });
    } catch (error) {
      logger.error(`[API /llm/chat] Error during chat completion: ${error.message}`);
      res.status(500).json({ error: 'An error occurred while processing your request with the AI service.' });
    }
  });

  return router;
}

module.exports = { initializeLlmApi }; 