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
    // Variables needed across validation and execution phases
    let estimatedSeconds = 30;
    let costUsd = 0;
    let pointsRequired = 0;

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
          // Use the tool's costing model directly instead of looking up deployment
          if (tool.costingModel.rate && tool.costingModel.unit) {
            costRateInfo = {
              amount: tool.costingModel.rate,
              unit: tool.costingModel.unit
            };
          } else {
            logger.error(`[Execute] Tool '${toolId}' has machine costing but missing rate or unit.`);
            return res.status(500).json({ error: { code: 'COSTING_UNAVAILABLE', message: 'Could not determine execution cost.' } });
          }
        } else if (tool.costingModel.rateSource === 'fixed') {
          costRateInfo = {
            amount: tool.costingModel.fixedCost.amount,
            unit: tool.costingModel.fixedCost.unit
          };
        } else if (tool.costingModel.rateSource === 'static' && tool.costingModel.staticCost) {
          let staticAmount = tool.costingModel.staticCost.amount;
          // Special case: DALLE image tools with amount 0 – derive from costTable
          if (staticAmount === 0 && tool.metadata?.costTable) {
            const ci = req.body.inputs || {};
            const m = ci.model || tool.metadata.model || 'dall-e-3';
            const sz = ci.size || '1024x1024';
            const q = ci.quality || 'standard';
            const price = tool.metadata.costTable?.[m]?.[sz]?.[q];
            if (price) staticAmount = price;
          }
          costRateInfo = {
            amount: staticAmount,
            unit: tool.costingModel.staticCost.unit
          };
        } else {
          logger.error(`[Execute] Unsupported or invalid rateSource in costingModel for tool '${toolId}'.`);
          return res.status(400).json({ error: { code: 'INVALID_TOOL_CONFIG', message: `Tool '${toolId}' has an invalid costing configuration.` } });
        }

        // 3b. --- Estimate Cost in Points ---
        estimatedSeconds = 30; // reset default each request
        costUsd = 0;
        
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
        pointsRequired = Math.max(1, Math.round(costUsd / USD_PER_POINT));

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

          // --- Input Seed Shuffle ---
          const seedKey = tool.metadata?.seedInputKey || 'input_seed';
          if (
            finalInputs[seedKey] === undefined ||
            finalInputs[seedKey] === null ||
            finalInputs[seedKey] === ''
          ) {
            // ComfyUI expects a 32-bit unsigned int seed
            finalInputs[seedKey] = Math.floor(Math.random() * 0xffffffff);
            logger.info(
              `[Execute] Auto-assigned random ${seedKey}=${finalInputs[seedKey]} for tool '${toolId}'.`
            );
          }

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

          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';
          const generationParams = {
            masterAccountId: new ObjectId(masterAccountId),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            ...(metadata.castId && { castId: metadata.castId }),
            ...(metadata.cookId && { cookId: metadata.cookId }),
            requestPayload: finalInputs,
            status: 'pending',
            deliveryStatus: initialDeliveryStatus,
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }),
            notificationPlatform: user.platform || 'none',
            pointsSpent: 0,
            protocolNetPoints: 0,
            costUsd: null,
            metadata: {
              ...tool.metadata,
              ...metadata,
              costRate: costRateInfo,
              loraResolutionData,
              platformContext: user.platformContext
              ,
              // Ensure dispatcher can route sandbox notifications
              ...(user.platform === 'web-sandbox' ? { notificationContext: { platform: 'web-sandbox' } } : {})
            }
          };

          const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;
          logger.info(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}' with costRate: ${JSON.stringify(costRateInfo)}.`);

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
          const est = (typeof estimatedSeconds === 'number' && Number.isFinite(estimatedSeconds)) ? estimatedSeconds : null;
          return res.status(202).json({
            generationId: generationRecord._id.toString(),
            status: 'processing',
            service: tool.service,
            runId,
            toolId: tool.toolId,
            queuedAt: generationRecord.requestTimestamp,
            ...(est !== null ? { estimatedDurationSeconds: est, checkAfterMs: est * 1000 } : {}),
            estimatedCostUsd: costUsd,
            estimatedPoints: pointsRequired,
            message: 'Your request has been accepted and is being processed.',
          });
        }
        case 'static': {
          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'sent' : 'skipped';
          const defaultPoints = 0;
          const staticPayload = {
            generationId: 'static-image-test',
            status: 'completed',
            service: 'static',
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            castId: metadata.castId || null,
            cookId: metadata.cookId || null,
            pointsSpent: defaultPoints,
            protocolNetPoints: defaultPoints,
            deliveryStatus: initialDeliveryStatus,
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
          const modelInput = inputs.model || tool.inputSchema.model?.default || tool.metadata?.model || 'dall-e-3';
          const qualityInput = inputs.quality || tool.inputSchema.quality?.default;
          const sizeInput = inputs.size || tool.inputSchema.size?.default;
          const responseFormat = inputs.responseFormat || 'url';

          const isImageTool = tool.apiPath === '/llm/image';

          const instructions = inputs.instructions || tool.inputSchema.instructions?.default || 'You are a helpful assistant.';
          const temperature = typeof inputs.temperature === 'number' ? inputs.temperature : tool.inputSchema.temperature?.default || 0.7;
          const model = tool.metadata?.model || 'gpt-3.5-turbo';
           
          if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid prompt for ChatGPT.' } });
          }
          if (isImageTool) {
            // Directly generate image and create generation record
            const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';
            const generationParams = {
              masterAccountId: new ObjectId(masterAccountId),
              ...(sessionId && { sessionId: new ObjectId(sessionId) }),
              ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
              serviceName: tool.service,
              toolId: tool.toolId,
              toolDisplayName: tool.displayName || tool.name || tool.toolId,
              requestPayload: { prompt, model: modelInput, quality: qualityInput, size: sizeInput, responseFormat },
              status: 'processing',
              deliveryStatus: initialDeliveryStatus,
              notificationPlatform: user.platform || 'none',
              pointsSpent: 0,
              protocolNetPoints: 0,
              costUsd: null,
              metadata: {
                ...tool.metadata,
                ...metadata,
                costRate: costRateInfo,
                platformContext: user.platformContext,
                ...(user.platform === 'web-sandbox' ? { notificationContext: { platform: 'web-sandbox' } } : {})
              }
            };

            const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
            generationRecord = createResponse;

            // --- Submit asynchronous OpenAI image generation ---

            (async () => {
              try {
                const resultObj = await openaiService.generateImage({ prompt, model: modelInput, quality: qualityInput, size: sizeInput, responseFormat });
                const finalImage = resultObj.url ? { url: resultObj.url } : { b64_json: resultObj.b64_json };
                await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
                  status: 'completed',
                  responsePayload: { images: [finalImage] },
                  // Maintain legacy outputs structure for downstream consumers
                  outputs: [ { data: { images: [finalImage] } } ],
                  usage: resultObj.usage || null
                });

                // --- Points debit ---
                try {
                  const costRate = generationRecord.metadata?.costRate;
                  const costUsd = (costRate && typeof costRate.amount === 'number') ? costRate.amount : null;

                  if (costUsd != null && costUsd > 0) {
                    const usdPerPoint = 0.000337;
                    const pointsToSpend = Math.max(1, Math.round(costUsd / usdPerPoint));
                    const spendPayload = { pointsToSpend, spendContext: { generationId: generationRecord._id.toString(), toolId: generationRecord.toolId } };
                    const headers = { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB };
                    const internalApiClient = require('../../../utils/internalApiClient');
                    await internalApiClient.post(`/internal/v1/data/users/${generationRecord.masterAccountId}/economy/spend`, spendPayload, { headers });
                    await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
                      pointsSpent: pointsToSpend,
                      protocolNetPoints: pointsToSpend,
                      costUsd
                    });
                  }
                } catch (spendErr) {
                  logger.error(`[Execute] Points debit failed for OpenAI image generation ${generationRecord._id}: ${spendErr.message}`);
                  // non-critical
                }

                // Emit generationUpdated event so NotificationDispatcher / websocket listeners are notified
                try {
                  const notificationEvents = require('../../../core/events/notificationEvents');
                  const updatedRecord = await db.generationOutputs.findGenerationById(generationRecord._id);
                  notificationEvents.emit('generationUpdated', updatedRecord);
                } catch(eventErr) {
                  logger.warn(`[Execute] Failed to emit generationUpdated for OpenAI image generation ${generationRecord._id}: ${eventErr.message}`);
                }
              } catch (err) {
                logger.error(`[Execute] OpenAIService image error for tool '${toolId}' (async): ${err.message}`);
                const cleanMsg = (err?.message || '').slice(0, 180);
                await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
                  status: 'failed',
                  statusReason: cleanMsg || 'Generation failed',
                  'metadata.error': {
                    message: err.message,
                    stack: err.stack,
                    step: 'openai_image_generation'
                  }
                });
                try {
                  const notificationEvents = require('../../../core/events/notificationEvents');
                  const updatedRecord = await db.generationOutputs.findGenerationById(generationRecord._id);
                  notificationEvents.emit('generationUpdated', updatedRecord);
                } catch(eventErr) {
                  logger.warn(`[Execute] Failed to emit generationUpdated after error for OpenAI image generation ${generationRecord._id}: ${eventErr.message}`);
                }
              }
            })();

            const estSeconds = 30; // crude estimate
            return res.status(202).json({ generationId: generationRecord._id.toString(), status: 'processing', estimatedDurationSeconds: estSeconds, message: 'Image generation started. Poll status endpoint for completion.' });
          }

          if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid prompt for ChatGPT.' } });
          }

          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';
          const generationParams = {
            masterAccountId: new ObjectId(masterAccountId),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            ...(metadata.castId && { castId: metadata.castId }),
            ...(metadata.cookId && { cookId: metadata.cookId }),
            requestPayload: { prompt, instructions, temperature, model },
            status: 'processing',
            deliveryStatus: initialDeliveryStatus,
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }),
            notificationPlatform: user.platform || 'none',
            pointsSpent: 0,
            protocolNetPoints: 0,
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
                castId: metadata.castId || null,
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

          const { masterAccountId } = user;
          const isSpellStep = metadata && metadata.isSpell;
          
          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';
          const generationParams = {
            masterAccountId: new ObjectId(masterAccountId),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            ...(metadata.castId && { castId: metadata.castId }),
            ...(metadata.cookId && { cookId: metadata.cookId }),
            requestPayload: inputs,
            status: 'processing',
            deliveryStatus: initialDeliveryStatus,
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }),
            notificationPlatform: user.platform || 'none',
            pointsSpent: 0,
            protocolNetPoints: 0,
            costUsd: 0,
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

          let resultStr;
          try {
            resultStr = stringService.execute(inputs);
          } catch (err) {
            logger.error(`[Execute] StringService error for tool '${toolId}': ${err.message}`);
            await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
              status: 'failed',
              'metadata.error': {
                message: err.message,
                stack: err.stack,
                step: 'string_execution'
              }
            });
            return res.status(500).json({ error: { code: 'STRING_ERROR', message: err.message } });
          }

          // Persist final tool output where the spell engine expects it
          const updatePayload = {
            status: 'completed',
            responsePayload: { result: resultStr },
            'metadata.response': resultStr
          };

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
            logger.info(`[Execute] Sending final WebSocket update for String generation ${generationRecord._id}.`);
            websocketServer.sendToUser(generationRecord.masterAccountId.toString(), {
              type: 'generationUpdate',
              payload: {
                generationId: generationRecord._id.toString(),
                status: 'completed',
                outputs: { text: resultStr },
                service: tool.service,
                toolId: tool.toolId,
                castId: metadata.castId || null,
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
            logger.warn(`[Execute] Cook scheduleNext (string) error: ${e.message}`);
          }

          return res.status(200).json({
            generationId: generationRecord._id.toString(),
            status: 'completed',
            service: tool.service,
            toolId: tool.toolId,
            response: resultStr,
            message: 'String operation completed successfully.'
          });
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