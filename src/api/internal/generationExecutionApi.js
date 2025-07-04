const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the centralized Generation Execution API
module.exports = function generationExecutionApi(dependencies) {
  const { logger, db, toolRegistry, comfyUIService, openaiService, internalApiClient, loraResolutionService } = dependencies;
  const router = express.Router();

  // Check for essential dependencies
  if (!db || !toolRegistry || !comfyUIService || !internalApiClient || !loraResolutionService) {
    const missingDependencies = [];
    if (!db) missingDependencies.push('db');
    if (!toolRegistry) missingDependencies.push('toolRegistry');
    if (!comfyUIService) missingDependencies.push('comfyUIService');
    if (!internalApiClient) missingDependencies.push('internalApiClient');
    if (!loraResolutionService) missingDependencies.push('loraResolutionService');
    logger.error(`[generationExecutionApi] Critical dependency failure: required services are missing! Missing Dependencies: ${missingDependencies.join(', ')}`);
    return (req, res, next) => {
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Core services for generation execution are not available.' } });
    };
  }

  logger.info('[generationExecutionApi] Initializing Generation Execution API routes...');

  // POST / - Executes a generation based on a toolId and inputs
  router.post('/', async (req, res) => {
    const { toolId, inputs, user, sessionId, eventId, metadata } = req.body;

    // 1. --- Basic Request Validation ---
    if (!toolId || !inputs || !user || !user.masterAccountId) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Missing required fields: toolId, inputs, and user context are required.' }
      });
    }

    let generationRecord; // To hold the created record for potential failure updates

    try {
      // 2. --- Tool Lookup & Validation ---
      logger.info(`[Execute] Received request for toolId: ${toolId}`);
      const tool = toolRegistry.getToolById(toolId);

      if (!tool) {
        return res.status(404).json({
          error: { code: 'TOOL_NOT_FOUND', message: `Tool with ID '${toolId}' not found in registry.` }
        });
      }

      // 2a. --- Costing Model Validation ---
      let costRateInfo = null;
      if (!tool.costingModel || !tool.costingModel.rateSource) {
        logger.error(`[Execute] Tool '${toolId}' is missing a valid costingModel. Execution blocked.`);
        return res.status(400).json({
          error: { code: 'INVALID_TOOL_CONFIG', message: `Tool '${toolId}' is not configured for costing and cannot be executed.` }
        });
      }
      // If rateSource is machine, we need to fetch it dynamically
      if (tool.costingModel.rateSource === 'machine') {
          costRateInfo = await comfyUIService.getCostRateForDeployment(tool.metadata.deploymentId);
          if (typeof costRateInfo === 'string' && costRateInfo.startsWith('error:')) {
              logger.error(`[Execute] Could not determine machine cost for tool '${toolId}'. Reason: ${costRateInfo}`);
              return res.status(500).json({ error: { code: 'COSTING_ERROR', message: 'Could not determine execution cost for this tool.' }});
          }
      } else {
          costRateInfo = tool.costingModel;
      }
      logger.info(`[Execute] Determined cost rate for tool ${toolId}: ${JSON.stringify(costRateInfo)}`);

      // TODO: Validate inputs against tool.inputSchema

      // 3. --- Routing based on Service ---
      const service = tool.service;
      logger.info(`[Execute] Routing tool '${toolId}' to service: '${service}'`);

      switch (service) {
        case 'comfyui': {
          const { masterAccountId } = user;
          let finalInputs = { ...inputs };
          let loraResolutionData = {};

          // 3a. --- LoRA Resolution ---
          const promptInputKey = tool.metadata?.telegramPromptInputKey || 'input_prompt';
          if (tool.metadata.hasLoraLoader && finalInputs[promptInputKey]) {
            logger.info(`[Execute] Resolving LoRA triggers for tool '${toolId}'.`);
            const { modifiedPrompt, appliedLoras, warnings } = await loraResolutionService.resolveLoraTriggers(
              finalInputs[promptInputKey],
              masterAccountId,
              tool.metadata.baseModel,
              { ...dependencies, internal: { client: internalApiClient } }
            );
            finalInputs[promptInputKey] = modifiedPrompt;
            loraResolutionData = { appliedLoras, warnings, rawPrompt: inputs[promptInputKey] };
          }
          
          // 3b. --- Create Generation Record ---
          const generationParams = {
            masterAccountId: new ObjectId(masterAccountId),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            requestPayload: finalInputs,
            status: 'pending',
            deliveryStatus: 'pending', // Assume all executions might need delivery
            notificationPlatform: user.platform || 'none',
            costUsd: null,
            metadata: {
              ...tool.metadata,
              ...metadata,
              costRate: costRateInfo,
              loraResolutionData,
              platformContext: user.platformContext
            }
          };

          const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse; // Store for potential updates
          logger.info(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}'.`);

          // 3c. --- Submit to ComfyUI Service ---
          const runId = await comfyUIService.submitRequest({
            deploymentId: tool.metadata.deploymentId,
            inputs: finalInputs,
          });
          logger.info(`[Execute] Submitted job to ComfyUI for GenID ${generationRecord._id}. Run ID: ${runId}`);

          // 3d. --- Update Record with Run ID ---
          await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
            'metadata.run_id': runId,
            status: 'processing',
          });

          // 3e. --- Respond ---
          return res.status(202).json({
            generationId: generationRecord._id.toString(),
            status: 'processing',
            service: tool.service,
            runId: runId,
            toolId: tool.toolId,
            queuedAt: generationRecord.requestTimestamp,
            message: 'Your request has been accepted and is being processed.',
          });
        }
        case 'openai': {
          // 1. Validate required inputs for ChatGPT
          const { masterAccountId } = user;
          const prompt = inputs.prompt;
          const instructions = inputs.instructions || tool.inputSchema.instructions?.default || 'You are a helpful assistant.';
          const temperature = typeof inputs.temperature === 'number' ? inputs.temperature : tool.inputSchema.temperature?.default || 0.7;
          const model = tool.metadata?.model || 'gpt-3.5-turbo';

          if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid prompt for ChatGPT.' } });
          }

          // 2. Create Generation Record (status: processing)
          const generationParams = {
            masterAccountId: new ObjectId(masterAccountId),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            requestPayload: { prompt, instructions, temperature, model },
            status: 'processing',
            deliveryStatus: 'pending',
            notificationPlatform: user.platform || 'none',
            costUsd: null,
            metadata: {
              ...tool.metadata,
              ...metadata,
              costRate: costRateInfo,
              platformContext: user.platformContext
            }
          };

          const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;
          logger.info(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}'.`);

          // 3. Call OpenAI Service
          let responseContent;
          try {
            responseContent = await openaiService.executeChatCompletion({
              prompt,
              instructions,
              temperature,
              model
            });
          } catch (err) {
            logger.error(`[Execute] OpenAIService error for tool '${toolId}': ${err.message}`);
            await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
              status: 'failed',
              'metadata.error': {
                message: err.message,
                stack: err.stack,
                step: 'openai_execution'
              }
            });
            return res.status(500).json({ error: { code: 'OPENAI_ERROR', message: err.message } });
          }

          // 4. Update Generation Record with result
          await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
            status: 'completed',
            'metadata.response': responseContent
          });

          // 5. Respond with result
          return res.status(200).json({
            generationId: generationRecord._id.toString(),
            status: 'completed',
            service: tool.service,
            toolId: tool.toolId,
            response: responseContent,
            message: 'Your ChatGPT request was completed successfully.'
          });
        }
        default:
          logger.error(`[Execute] Unrecognized service '${service}' for tool '${toolId}'.`);
          return res.status(501).json({
            error: { code: 'NOT_IMPLEMENTED', message: `Execution for service type '${service}' is not supported.` }
          });
      }
      
      res.status(501).json({ message: 'Service logic not yet implemented.' });

    } catch (error) {
      logger.error(`[Execute] An unexpected error occurred while processing tool '${toolId}': ${error.message}`, error);
      
      // If a record was created before the error, update it to failed
      if (generationRecord && generationRecord._id) {
        await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
          status: 'failed',
          'metadata.error': {
            message: error.message,
            stack: error.stack,
            step: 'execution_dispatch'
          }
        }).catch(updateErr => logger.error(`[Execute] Failed to update generation record ${generationRecord._id} to FAILED after an error: ${updateErr.message}`));
      }

      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred during execution.' }
      });
    }
  });

  logger.info('[generationExecutionApi] Generation Execution API routes initialized.');
  return router;
}; 