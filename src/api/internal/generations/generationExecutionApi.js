const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the centralized Generation Execution API
module.exports = function generationExecutionApi(dependencies) {
  const { logger, db, toolRegistry, comfyUIService, openaiService, internalApiClient, loraResolutionService, stringService, webSocketService: websocketServer } = dependencies;
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
    let costRateInfo = null; // Defined here to be in scope for the whole request

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
      const tool = await toolRegistry.getToolById(toolId);
      if (!tool) {
        return res.status(404).json({ error: { code: 'TOOL_NOT_FOUND', message: `Tool '${toolId}' not found.` } });
      }

      // 3. --- Pre-Execution Credit Check ---
      try {
        // 3a. --- Determine Cost Rate ---
        if (!tool.costingModel || !tool.costingModel.rateSource) {
          logger.error(`[Execute] Tool '${toolId}' is missing a valid costingModel. Execution blocked.`);
          return res.status(400).json({
            error: { code: 'INVALID_TOOL_CONFIG', message: `Tool '${toolId}' is not configured for costing and cannot be executed.` }
          });
        }
        
        if (tool.costingModel.rateSource === 'machine') {
          costRateInfo = await comfyUIService.getCostRateForDeployment(tool.metadata.deploymentId);
          if (!costRateInfo) {
            logger.error(`[Execute] Could not retrieve dynamic machine cost for tool '${toolId}'.`);
            return res.status(500).json({ error: { code: 'COSTING_UNAVAILABLE', message: 'Could not determine execution cost.' } });
          }
        } else if (tool.costingModel.rateSource === 'fixed') {
          costRateInfo = {
            amount: tool.costingModel.fixedCost.amount,
            unit: tool.costingModel.fixedCost.unit
          };
        } else if (tool.costingModel.rateSource === 'static' && tool.costingModel.staticCost) {
          costRateInfo = {
            amount: tool.costingModel.staticCost.amount,
            unit: tool.costingModel.staticCost.unit
          };
        } else {
          logger.error(`[Execute] Unsupported or invalid rateSource in costingModel for tool '${toolId}'.`);
          return res.status(400).json({ error: { code: 'INVALID_TOOL_CONFIG', message: `Tool '${toolId}' has an invalid costing configuration.` } });
        }

        // 3b. --- Estimate Cost in Points ---
        let estimatedSeconds = 30; // Default estimate for variable-cost tools
        let costUsd = 0;
        
        if (costRateInfo.unit && (costRateInfo.unit.toLowerCase() === 'second' || costRateInfo.unit.toLowerCase() === 'seconds')) {
          if (tool.metadata && tool.metadata.estimatedDurationSeconds) {
            estimatedSeconds = tool.metadata.estimatedDurationSeconds;
          } else if (tool.metadata && tool.metadata.minDurationSeconds) {
            estimatedSeconds = tool.metadata.minDurationSeconds;
          }
          costUsd = estimatedSeconds * costRateInfo.amount;
        } else if (costRateInfo.unit && (costRateInfo.unit.toLowerCase() === 'run' || costRateInfo.unit.toLowerCase() === 'fixed' || costRateInfo.unit.toLowerCase() === 'token')) { // Added token for static
          costUsd = costRateInfo.amount;
        } else {
          logger.error(`[Execute] Could not determine cost for tool '${toolId}' with unhandled unit type:`, costRateInfo.unit);
          return res.status(500).json({ error: { code: 'COSTING_ERROR', message: 'Could not determine execution cost for this tool.' } });
        }
        
        const USD_PER_POINT = 0.000337;
        const pointsRequired = Math.max(1, Math.round(costUsd / USD_PER_POINT));

        // 3c. --- Fetch User's Wallet and Points ---
        const userId = user.masterAccountId;
        const userCoreRes = await internalApiClient.get(`/internal/v1/data/users/${userId}`);
        const userCore = userCoreRes.data;

        let walletAddress = null;
        if (userCore.wallets && userCore.wallets.length > 0) {
          const primary = userCore.wallets.find(w => w.isPrimary);
          walletAddress = (primary ? primary.address : userCore.wallets[0].address) || null;
        }

        if (!walletAddress) {
          logger.error(`[Execute] Pre-check failed: Could not find a wallet address for user ${userId}.`);
          return res.status(403).json({ error: { code: 'WALLET_NOT_FOUND', message: 'User wallet not available for credit check.' } });
        }

        const pointsResponse = await internalApiClient.get(`/internal/v1/data/ledger/points/by-wallet/${walletAddress}`);
        const currentPoints = pointsResponse.data.points || 0;
        
        logger.info(`[Pre-Execution Credit Check] User ${userId} (Wallet: ${walletAddress}) has ${currentPoints} points. Required: ${pointsRequired}`);
        
        if (currentPoints < pointsRequired) {
          return res.status(402).json({
            error: {
              code: 'INSUFFICIENT_FUNDS',
              message: 'You do not have enough points to execute this workflow.',
              details: { required: pointsRequired, available: currentPoints }
            }
          });
        }
      } catch (creditCheckErr) {
        logger.error(`[Pre-Execution Credit Check] Error during credit check for user ${user.masterAccountId}:`, creditCheckErr);
        return res.status(500).json({
          error: {
            code: 'CREDIT_CHECK_FAILED',
            message: 'Could not verify your available points. Please try again later.'
          }
        });
      }

      // TODO: Validate inputs against tool.inputSchema

      // 4. --- Routing based on Service ---
      const service = tool.service;
      logger.info(`[Execute] Routing tool '${toolId}' to service: '${service}'`);

      switch (service) {
        case 'comfyui': {
          const { masterAccountId } = user;
          let finalInputs = { ...inputs };
          let loraResolutionData = {};

          // --- LoRA Resolution ---
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
          
          // --- Create Generation Record ---
          const isSpellStep = metadata && metadata.isSpell;

          const generationParams = {
            masterAccountId: new ObjectId(masterAccountId),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            requestPayload: finalInputs,
            status: 'pending',
            deliveryStatus: 'pending', 
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }),
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
          generationRecord = createResponse;
          logger.info(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}'.`);

          // --- Submit to ComfyUI Service ---
          const runId = await comfyUIService.submitRequest({
            deploymentId: tool.metadata.deploymentId,
            inputs: finalInputs,
          });
          logger.info(`[Execute] Submitted job to ComfyUI for GenID ${generationRecord._id}. Run ID: ${runId}`);

          // --- Update Record with Run ID ---
          await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
            'metadata.run_id': runId,
            status: 'processing',
          });

          // --- Respond ---
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
        case 'static': {
          // Hardcoded static image response for testing
          const staticPayload = {
            generationId: 'static-image-test',
            status: 'completed',
            service: 'static',
            toolId: tool.toolId,
            outputs: [
              {
                data: {
                  images: [
                    { url: 'https://comfy-deploy-output.s3.us-east-2.amazonaws.com/outputs/runs/2011f35c-3758-4405-afa0-0fdb2b381860/ComfyUI_00001_.png' }
                  ]
                }
              }
            ],
            message: 'Static image tool executed successfully.'
          };
          if (websocketServer && user && user.masterAccountId) {
            websocketServer.sendToUser(String(user.masterAccountId), {
              type: 'generationUpdate',
              payload: staticPayload
            });
          }

          // If this was submitted by Cook orchestrator, schedule next immediately
          try {
            const isCook = metadata && metadata.source === 'cook' && metadata.collectionId && metadata.jobId;
            if (isCook) {
              const { CookOrchestratorService } = require('../../../core/services/cook');
              await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId: metadata.collectionId, userId: String(user.masterAccountId), jobId: metadata.jobId, generationId: staticPayload.generationId });
              await CookOrchestratorService.scheduleNext({ collectionId: metadata.collectionId, userId: String(user.masterAccountId), finishedJobId: metadata.jobId, success: true });
            }
          } catch (e) {
            logger.warn(`[Execute] Cook scheduleNext (static) error: ${e.message}`);
          }

          return res.status(200).json(staticPayload);
        }
        case 'openai': {
          const { masterAccountId } = user;
          const isSpellStep = metadata && metadata.isSpell;
          const prompt = inputs.prompt;
          const instructions = inputs.instructions || tool.inputSchema.instructions?.default || 'You are a helpful assistant.';
          const temperature = typeof inputs.temperature === 'number' ? inputs.temperature : tool.inputSchema.temperature?.default || 0.7;
          const model = tool.metadata?.model || 'gpt-3.5-turbo';

          if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid prompt for ChatGPT.' } });
          }

          const generationParams = {
            masterAccountId: new ObjectId(masterAccountId),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            requestPayload: { prompt, instructions, temperature, model },
            status: 'processing',
            deliveryStatus: 'pending',
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }),
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

          // Persist final tool output where the spell engine expects it.
          // responsePayload is required so WorkflowExecutionService can pick it up for the next step.
          const updatePayload = {
            status: 'completed',
            responsePayload: { result: responseContent },
            // Keep legacy field for any consumers still reading metadata.response
            'metadata.response': responseContent
          };

          // Apply update
          await db.generationOutputs.updateGenerationOutput(generationRecord._id, updatePayload);

          // --- Emit notification event for spell continuation if applicable ---
          if (isSpellStep) {
              try {
                  const notificationEvents = require('../../../core/events/notificationEvents');
                  const updatedRecord = await db.generationOutputs.findGenerationById(generationRecord._id);
                  notificationEvents.emit('generationUpdated', { ...updatedRecord, deliveryStrategy: 'spell_step' });
              } catch (emitErr) {
                  logger.error(`[Execute] Failed to emit generationUpdated event for spell step generation ${generationRecord._id}: ${emitErr.message}`);
              }
          }

          if (websocketServer) {
            logger.info(`[Execute] Sending final WebSocket update for OpenAI generation ${generationRecord._id}.`);
            websocketServer.sendToUser(generationRecord.masterAccountId.toString(), {
              type: 'generationUpdate',
              payload: {
                generationId: generationRecord._id.toString(),
                status: 'completed',
                outputs: { response: responseContent }, 
                service: tool.service,
                toolId: tool.toolId,
              }
            });
          }

          // If this was submitted by Cook orchestrator, schedule next immediately
          try {
            const isCook = metadata && metadata.source === 'cook' && metadata.collectionId && metadata.jobId;
            if (isCook) {
              const { CookOrchestratorService } = require('../../../core/services/cook');
              await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId: metadata.collectionId, userId: String(user.masterAccountId), jobId: metadata.jobId, generationId: generationRecord._id.toString() });
              await CookOrchestratorService.scheduleNext({ collectionId: metadata.collectionId, userId: String(user.masterAccountId), finishedJobId: metadata.jobId, success: true });
            }
          } catch (e) {
            logger.warn(`[Execute] Cook scheduleNext (openai) error: ${e.message}`);
          }

          return res.status(200).json({
            generationId: generationRecord._id.toString(),
            status: 'completed',
            service: tool.service,
            toolId: tool.toolId,
            response: responseContent,
            message: 'Your ChatGPT request was completed successfully.'
          });
        }
        case 'string': {
          if (!stringService) {
            logger.error('[Execute] StringService is not available.');
            return res.status(500).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'String service unavailable.' } });
          }

          try {
            const resultStr = stringService.execute(inputs);
            const payload = {
              generationId: 'string-primitive-' + Date.now(),
              status: 'completed',
              service: 'string',
              toolId: tool.toolId,
              outputs: [{ data: { result: resultStr } }],
              message: 'String operation completed.'
            };

            // Send via websocket if available
            if (websocketServer && user && user.masterAccountId) {
              websocketServer.sendToUser(String(user.masterAccountId), {
                type: 'generationUpdate',
                payload
              });
            }

            return res.status(200).json(payload);
          } catch (err) {
            logger.error('[Execute] Error executing StringService:', err);
            return res.status(500).json({ error: { code: 'EXECUTION_FAILED', message: 'String operation failed.' } });
          }
        }
        default:
          logger.error(`[Execute] Unrecognized service '${service}' for tool '${toolId}'.`);
          return res.status(501).json({
            error: { code: 'NOT_IMPLEMENTED', message: `Execution for service type '${service}' is not supported.` }
          });
      }

    } catch (error) {
      logger.error(`[Execute] An unexpected error occurred while processing tool '${toolId}': ${error.message}`, error);
      
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