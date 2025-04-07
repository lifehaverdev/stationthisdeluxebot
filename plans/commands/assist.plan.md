# assist.js Plan

## Current Purpose
`assist.js` provides AI-powered text generation capabilities for the bot, primarily focused on enhancing image generation prompts. It offers both standard OpenAI API access and an uncensored API alternative, along with specialized prompt engineering for different image generation models (SDXL and FLUX). The module also includes utility functions for formatting AI responses.

## Exported Functions/Classes
- **Main AI Functions**:
  - `main(input, unrestricted)` - Generates SDXL-optimized word lists
  - `mainFlux(input, unrestricted)` - Generates FLUX-formatted descriptive prompts
  - `promptAssist(message, flux, unrestricted)` - Entry point for prompt assistance
  - `gptAssist({ messages, model, temperature, formatResult, unrestricted })` - Generic AI assistance

- **API Interaction**:
  - `getUnrestrictedCompletion(messages, temperature, maxTokens)` - Interacts with uncensored API

- **Formatting Utilities**:
  - `formatters.raw(content)` - Returns raw text
  - `formatters.json(content)` - Formats response as JSON
  - `formatters.list(content)` - Converts response to list
  - `formatters.traits(content)` - Formats trait values

## Dependencies and Integrations
- External API services:
  - OpenAI API for standard completions
  - Heurist API for uncensored completions
- Node modules:
  - http for making requests
  - OpenAI SDK
- Environment variables:
  - OPENAI_API for API keys
  - HEURIST for uncensored API access

## Identified Issues
- Direct implementation of two separate API services
- Hard-coded system prompts embedded in code
- Duplication in API calling patterns
- Mixed responsibilities: prompt engineering, API interaction, response formatting
- Limited error handling, especially for API failures
- No abstraction for different AI providers
- No caching of common prompts or responses
- Formatting logic mixed with core functionality
- Lack of proper validation for API inputs and outputs

## Migration Plan
1. Create `src/core/ai/`:
   - `model.js` - Core data models for AI requests and responses
   - `service.js` - Generic AI service interface
   - `prompt-templates.js` - System prompt templates
   - `formatter.js` - Response formatting utilities

2. Create `src/services/ai/`:
   - `openai.js` - OpenAI-specific client implementation
   - `heurist.js` - Heurist-specific client implementation
   - `factory.js` - Factory for creating appropriate AI service

3. Create `src/core/prompt-engineering/`:
   - `sdxl.js` - SDXL-specific prompt engineering
   - `flux.js` - FLUX-specific prompt engineering
   - `common.js` - Shared prompt engineering utilities

4. Implement `src/api/ai.js`:
   - Internal API for AI operations
   - Service-agnostic interfaces
   - Request/response validation and caching

5. Suggested improvements:
   - Implement response caching for common prompts
   - Add proper error handling with retries for API failures
   - Create a configuration-based template system
   - Implement logging for tracking API usage
   - Add validation for inputs and outputs
   - Create a more extensible formatter registry
   - Add support for streaming responses
   - Implement rate limiting and quota management
   - Add analytical feedback loop for prompt quality
   - Create a provider-agnostic interface for multiple AI services 