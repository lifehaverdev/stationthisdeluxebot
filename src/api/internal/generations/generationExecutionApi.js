const express = require('express');
const { ObjectId } = require('mongodb');
const { getPricingService } = require('../../../core/services/pricing');

/**
 * Convert masterAccountId to appropriate format for storage.
 * For x402 executions, keeps the synthetic string ID (e.g., "x402:0x...")
 * For regular users, converts to ObjectId.
 */
function toMasterAccountId(id, isX402 = false) {
  if (isX402) {
    // x402 uses synthetic IDs like "x402:0x1234..." - store as string
    return id;
  }
  return new ObjectId(id);
}

// This function initializes the routes for the centralized Generation Execution API
module.exports = function generationExecutionApi(dependencies) {
  const { logger, db, toolRegistry, comfyUIService, openaiService, huggingfaceService, internalApiClient, loraResolutionService, stringService, webSocketService: websocketServer, adminActivityService } = dependencies;
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

  logger.debug('[generationExecutionApi] Initializing Generation Execution API routes...');

  // POST / - Executes a generation based on a toolId and inputs
  router.post('/', async (req, res) => {
    const { toolId, inputs, user, sessionId, eventId, metadata = {} } = req.body;
    let costRateInfo = null; // Defined here to be in scope for the whole request
    // Variables needed across validation and execution phases
    let estimatedSeconds = 30;
    let costUsd = 0;
    let baseCostUsd = 0; // Raw compute cost before platform fees
    let pointsRequired = 0;
    let isMs2User = false;
    let pricingBreakdown = null;

    // 1. --- Basic Request Validation ---
    if (!toolId || !inputs || !user || !user.masterAccountId) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Missing required fields: toolId, inputs, and user context are required.' }
      });
    }

    let generationRecord; // To hold the created record for potential failure updates

    try {
      // 2. --- Tool Lookup & Validation ---
      logger.debug(`[Execute] Received request for toolId: ${toolId}`);

      // Try direct lookup first, then resolve alias if not found
      let tool = await toolRegistry.getToolById(toolId);
      let resolvedToolId = toolId;

      if (!tool) {
        // Try alias resolution: commandName (with or without /), displayName
        const commandName = toolId.startsWith('/') ? toolId : `/${toolId}`;
        tool = toolRegistry.findByCommand(commandName);

        if (!tool) {
          // Try by displayName (case-insensitive)
          const allTools = toolRegistry.getAllTools();
          const lowerName = toolId.toLowerCase();
          tool = allTools.find(t =>
            (t.displayName && t.displayName.toLowerCase() === lowerName) ||
            (t.commandName && t.commandName.replace(/^\//, '').toLowerCase() === lowerName)
          );
        }

        if (tool) {
          resolvedToolId = tool.toolId;
          logger.debug(`[Execute] Resolved alias "${toolId}" to toolId "${resolvedToolId}"`);
        }
      }

      if (!tool) {
        logger.warn(`[Execute] Tool not found: "${toolId}". Available tools: ${toolRegistry.getAllTools().slice(0, 5).map(t => t.commandName || t.displayName).join(', ')}...`);
        return res.status(404).json({ error: { code: 'TOOL_NOT_FOUND', message: `Tool '${toolId}' not found. Use tools/list to see available tools.` } });
      }

      // 3. --- Pre-Execution Credit Check ---
      // Skip credit check for x402 payments - they pay directly in USDC
      const isX402Execution = user.isX402 === true;
      if (isX402Execution) {
        logger.debug(`[Execute] x402 payment detected - skipping credit check for payer ${user.payerAddress}`);
        // For x402, we still need cost info for record-keeping, so continue to calculate it
        // but don't do the user lookup or points check
      }

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

        // 3b. --- Estimate Base Compute Cost ---
        estimatedSeconds = 30; // reset default each request
        baseCostUsd = 0;

        if (costRateInfo.unit && (costRateInfo.unit.toLowerCase() === 'second' || costRateInfo.unit.toLowerCase() === 'seconds')) {
          if (tool.metadata && tool.metadata.estimatedDurationSeconds) {
            estimatedSeconds = tool.metadata.estimatedDurationSeconds;
          } else if (tool.metadata && tool.metadata.minDurationSeconds) {
            estimatedSeconds = tool.metadata.minDurationSeconds;
          }
          baseCostUsd = estimatedSeconds * costRateInfo.amount;
        } else if (costRateInfo.unit && (costRateInfo.unit.toLowerCase() === 'run' || costRateInfo.unit.toLowerCase() === 'fixed' || costRateInfo.unit.toLowerCase() === 'token' || costRateInfo.unit.toLowerCase() === 'request')) {
          baseCostUsd = costRateInfo.amount;
        } else {
          logger.error(`[Execute] Could not determine cost for tool '${toolId}' with unhandled unit type:`, costRateInfo.unit);
          return res.status(500).json({ error: { code: 'COSTING_ERROR', message: 'Could not determine execution cost for this tool.' } });
        }

        // 3c. --- Fetch User's Wallet, Determine MS2 Status, Apply Platform Pricing ---
        // Skip for x402 executions - they pay directly in USDC, not points
        const pricingService = getPricingService(logger);

        if (!isX402Execution) {
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

          // Check user's active deposits to determine MS2 status
          try {
            const depositsResponse = await internalApiClient.get(`/internal/v1/data/ledger/deposits/by-wallet/${walletAddress}`);
            const activeDeposits = depositsResponse.data.deposits || [];
            isMs2User = pricingService.userQualifiesForMs2Pricing(activeDeposits);
            logger.debug(`[Pricing] User ${userId} MS2 status: ${isMs2User}`);
          } catch (depositErr) {
            logger.warn(`[Pricing] Could not determine MS2 status for user ${userId}: ${depositErr.message}. Defaulting to standard pricing.`);
            isMs2User = false;
          }

          // Apply platform fee pricing
          const pricingResult = pricingService.calculateCost({
            computeCostUsd: baseCostUsd,
            serviceName: tool.service,
            isMs2User,
            toolId: tool.toolId,
          });
          costUsd = pricingResult.finalCostUsd;
          pricingBreakdown = pricingResult.breakdown;

          logger.debug(`[Pricing] Service: ${tool.service}, Base: $${baseCostUsd.toFixed(4)}, Final: $${costUsd.toFixed(4)}, Tier: ${isMs2User ? 'MS2' : 'standard'}`);

          // Calculate points from the adjusted cost
          const USD_PER_POINT = 0.000337;
          pointsRequired = Math.max(1, Math.round(costUsd / USD_PER_POINT));

          const pointsResponse = await internalApiClient.get(`/internal/v1/data/ledger/points/by-wallet/${walletAddress}`);
          const currentPoints = pointsResponse.data.points || 0;

          logger.debug(`[Pre-Execution Credit Check] User ${userId} (Wallet: ${walletAddress}) has ${currentPoints} points. Required: ${pointsRequired}`);

          if (currentPoints < pointsRequired) {
            return res.status(402).json({
              error: {
                code: 'INSUFFICIENT_FUNDS',
                message: 'You do not have enough points to execute this workflow.',
                details: {
                  required: pointsRequired,
                  available: currentPoints,
                  pricing: pricingBreakdown // Include breakdown for transparency
                }
              }
            });
          }
        } else {
          // For x402, still calculate pricing for transparency/logging
          const pricingResult = pricingService.calculateCost({
            computeCostUsd: baseCostUsd,
            serviceName: tool.service,
            isMs2User: false, // x402 users pay standard rate
            toolId: tool.toolId,
          });
          costUsd = pricingResult.finalCostUsd;
          pricingBreakdown = pricingResult.breakdown;
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
      logger.debug(`[Execute] Routing tool '${toolId}' to service: '${service}'`);

      /* ---------------------------------------------------------------
       * 🌟 Adapter-based execution path (new architecture)            
       * -------------------------------------------------------------
       * 1. We ask the central AdapterRegistry if a ToolAdapter exists
       *    for the requested service (e.g. 'openai', 'huggingface').
       * 2. If an adapter is present AND the tool declares deliveryMode
       *    'immediate', we delegate execution to adapter.execute() and
       *    bypass the legacy switch–case block entirely.
       * 3. For now we leave the old switch in place for async tools or
       *    services that we haven’t migrated yet; they will fall back.
       * 4. The adapter returns a standardized ToolResult object which
       *    we wrap into the minimal response shape expected by clients
       *    that call this endpoint directly (mainly the front-end).
       *
       * NOTE: Full generation record creation & credit-debit logic is
       * still handled in the legacy branches. Those will be migrated in
       * the next refactor wave when we support startJob / parseWebhook.
       * ------------------------------------------------------------- */
      const adapterRegistry = require('../../../core/services/adapterRegistry');
      const adapter = adapterRegistry.get(service);
      if (adapter && typeof adapter.execute === 'function' && (tool.deliveryMode === 'immediate' || !tool.deliveryMode)) {
        try {
          const execInputs = {
             ...(tool.metadata?.defaultAdapterParams || {}),
             ...inputs,
             // Pass costTable for DALL-E tools so adapter can calculate actual cost
             ...(tool.metadata?.costTable && { costTable: tool.metadata.costTable })
          };
          const toolResult = await adapter.execute(execInputs);
          // --- Persist generation record (immediate completion) ---
          const { masterAccountId } = user;
          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';

          // Wrap tool output into array-of-outputs structure expected by delivery pipeline
          let normalizedData = toolResult.data;
          if (toolResult.type === 'text' && toolResult.data) {
            if (typeof toolResult.data.text === 'string') {
              normalizedData = { text: [toolResult.data.text] };
            } else if (typeof toolResult.data.description === 'string') {
              normalizedData = { text: [toolResult.data.description] };
            }
          }
          const outputEntry = { type: toolResult.type, data: normalizedData };

          // CRITICAL: Check if this is a spell step - if so, set deliveryStrategy
          const isSpellStep = metadata && metadata.isSpell;
          
          const generationParams = {
            masterAccountId: toMasterAccountId(masterAccountId, isX402Execution),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            requestPayload: inputs,
            responsePayload: [outputEntry],
            status: 'completed',
            deliveryStatus: initialDeliveryStatus,
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }), // CRITICAL: Mark spell steps for NotificationDispatcher routing
            notificationPlatform: user.platform || 'none',
            pointsSpent: isX402Execution ? 0 : pointsRequired, // x402 pays in USDC, not points
            protocolNetPoints: 0,
            // Use adapter's calculated cost if available, otherwise fall back to pre-calculated estimate
            costUsd: (toolResult.costUsd !== undefined && toolResult.costUsd !== null) ? toolResult.costUsd : costUsd,
            metadata: {
              ...tool.metadata,
              ...metadata,
              ...(tool.deliveryHints && { deliveryHints: tool.deliveryHints }),
              costRate: costRateInfo,
              platformContext: user.platformContext
            }
          };

          const newGeneration = await db.generationOutputs.createGenerationOutput(generationParams);

          // CRITICAL: For spell steps, ensure deliveryStrategy is set on the emitted record
          // This ensures NotificationDispatcher routes to spell continuation
          const recordToEmit = {
            ...newGeneration,
            ...(isSpellStep && { deliveryStrategy: 'spell_step' })
          };

          // Emit event so notifier can deliver (or continue spell execution)
          try {
            const notificationEvents = require('../../../core/events/notificationEvents');
            notificationEvents.emit('generationUpdated', recordToEmit);
            logger.debug(`[Execute] Emitted generationUpdated for immediate ${isSpellStep ? 'spell step' : 'generation'} ${newGeneration._id}`);
          } catch (emitErr) {
            logger.warn(`[Execute] Failed to emit generationUpdated for immediate generation ${newGeneration._id}: ${emitErr.message}`);
          }

          // Optional websocket push for web clients
          if (websocketServer) {
            websocketServer.sendToUser(String(masterAccountId), {
              type: 'generationUpdate',
              payload: { generationId: newGeneration._id.toString(), status: 'completed', ...toolResult.data, service: tool.service, toolId: tool.toolId }
            });
          }

          // --- ADMIN ACTIVITY NOTIFICATION ---
          if (adminActivityService) {
            adminActivityService.emitPointSpend({
              masterAccountId,
              points: pointsRequired,
              serviceName: tool.service,
              toolId: tool.toolId,
              toolDisplayName: tool.displayName || tool.name || tool.toolId,
              generationId: newGeneration._id,
              costUsd: costUsd
            });
          }
          // --- END ADMIN ACTIVITY NOTIFICATION ---

          // Build response for caller (keep legacy fields)
          const basePayload = {
            generationId: newGeneration._id.toString(),
            status: 'completed',
            final: true,
            outputs: outputEntry,
            toolId: tool.toolId,
            service,
            costUsd: toolResult.costUsd || 0
          };

          if (toolResult.type === 'text' && toolResult.data?.text) {
            basePayload.response = toolResult.data.text;
          }

          return res.status(200).json(basePayload);
        } catch (execErr) {
          logger.error(`[Adapter Execute] Error executing tool via adapter for service ${service}:`, execErr);
          return res.status(500).json({ error: { code: 'ADAPTER_EXECUTION_FAILED', message: execErr.message } });
        }
      }

      /* ---------------------------------------------------------------
       * 🌟 Adapter-based ASYNC path (startJob)                         
       * ------------------------------------------------------------- */
      if (adapter && typeof adapter.startJob === 'function') {
        try {
          const jobInputs = {
             ...(tool.metadata?.defaultAdapterParams || {}),
             ...inputs,
             // Pass costTable for DALL-E tools so adapter can calculate actual cost
             ...(tool.metadata?.costTable && { costTable: tool.metadata.costTable })
          };
          const { runId, meta } = await adapter.startJob(jobInputs);

          const { masterAccountId } = user;
          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';

          const generationParams = {
            masterAccountId: toMasterAccountId(masterAccountId, isX402Execution),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            requestPayload: inputs,
            status: 'processing',
            deliveryStatus: initialDeliveryStatus,
            notificationPlatform: user.platform || 'none',
            pointsSpent: isX402Execution ? 0 : pointsRequired,
            protocolNetPoints: 0,
            costUsd: costUsd,
            metadata: {
              ...tool.metadata,
              ...metadata,
              ...(tool.deliveryHints && { deliveryHints: tool.deliveryHints }),
              costRate: costRateInfo,
              platformContext: user.platformContext,
              ...(meta ? { adapterMeta: meta } : {}),
              runId,
              ...(user.platform === 'web-sandbox' ? { notificationContext: { platform: 'web-sandbox', windowId: metadata?.windowId || null } } : {})
            }
          };

          const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;

          // --- kick off background poller ---
          (async () => {
            try {
              let attempts = 0;
              const maxAttempts = 60; // 5 min at 5s interval
              while (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 5000));
                const pollRes = await adapter.pollJob(runId);
                if (pollRes.status === 'succeeded' || pollRes.status === 'failed' || pollRes.status === 'completed') {
                  const finalStatus = (pollRes.status === 'failed') ? 'failed' : 'completed';
                  let finalData = pollRes.data;
                  if (pollRes.type === 'text' && finalData) {
                    if (typeof finalData.text === 'string') {
                      finalData = { text: [finalData.text] };
                    } else if (typeof finalData.description === 'string') {
                      finalData = { text: [finalData.description] };
                    }
                  }
                  const updatePayload = {
                    status: finalStatus,
                    responsePayload: [ { type: pollRes.type, data: finalData } ],
                    costUsd: pollRes.costUsd || null,
                    ...(pollRes.error ? { 'metadata.error': { message: pollRes.error, step: 'adapter_poll' } } : {}),
                  };
                  await db.generationOutputs.updateGenerationOutput(generationRecord._id, updatePayload);
                  const notificationEvents = require('../../../core/events/notificationEvents');
                  const updated = await db.generationOutputs.findGenerationById(generationRecord._id);
                  notificationEvents.emit('generationUpdated', updated);
                  break;
                }
                attempts++;
              }
            } catch (bgErr) {
              logger.error(`[Execute] Background poller error for runId ${runId}: ${bgErr.message}`);
            }
          })();

          // respond 202
          return res.status(202).json({
            generationId: generationRecord._id.toString(),
            status: 'processing',
            service: tool.service,
            runId,
            toolId: tool.toolId,
            queuedAt: generationRecord.requestTimestamp,
            message: 'Your request has been accepted and is being processed.'
          });
        } catch (startErr) {
          logger.error(`[Adapter startJob] Error starting job for service ${service}:`, startErr);
          return res.status(500).json({ error: { code: 'ADAPTER_START_JOB_FAILED', message: startErr.message } });
        }
      }

      // --- Legacy switch/case continues below (to be removed next) ---

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
            logger.debug(
              `[Execute] Auto-assigned random ${seedKey}=${finalInputs[seedKey]} for tool '${toolId}'.`
            );
          }

          // --- LoRA Resolution ---
          const promptInputKey = tool.metadata?.telegramPromptInputKey || 'input_prompt';
          if (tool.metadata.hasLoraLoader && finalInputs[promptInputKey]) {
            logger.debug(`[Execute] Resolving LoRA triggers for tool '${toolId}'.`);
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
          // ✅ Force notificationPlatform to 'cook' if this is a cook generation
          const isCookGeneration = metadata && (metadata.source === 'cook' || metadata.collectionId || metadata.cookId);
          const finalNotificationPlatform = isCookGeneration ? 'cook' : (user.platform || 'none');
          
          const generationParams = {
            masterAccountId: toMasterAccountId(masterAccountId, isX402Execution),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            ...(metadata?.castId && { castId: metadata.castId }),
            ...(metadata?.cookId && { cookId: metadata.cookId }),
            requestPayload: finalInputs,
            status: 'pending',
            deliveryStatus: initialDeliveryStatus,
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }),
            notificationPlatform: finalNotificationPlatform,
            pointsSpent: 0, // Points calculated later after execution for comfyui
            protocolNetPoints: 0,
            costUsd: null,
            metadata: {
              ...tool.metadata,
              ...metadata,
              ...(tool.deliveryHints && { deliveryHints: tool.deliveryHints }),
              costRate: costRateInfo,
              loraResolutionData,
              platformContext: user.platformContext,
              // Pricing transparency
              pricingBreakdown,
              isMs2User,
              // Ensure dispatcher can route sandbox notifications
              ...(user.platform === 'web-sandbox' ? { notificationContext: { platform: 'web-sandbox' } } : {})
            }
          };

          const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;
          logger.debug(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}' with costRate: ${JSON.stringify(costRateInfo)}.`);

          // --- Submit to ComfyUI Service ---
          const runId = await comfyUIService.submitRequest({
            deploymentId: tool.metadata.deploymentId,
            inputs: finalInputs,
          });
          logger.debug(`[Execute] Submitted job to ComfyUI for GenID ${generationRecord._id}. Run ID: ${runId}`);

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
            // Pricing transparency
            pricing: pricingBreakdown,
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
            castId: metadata?.castId || null,
            cookId: metadata?.cookId || null,
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
        // openai and huggingface now handled via adapters; legacy paths removed.
        case 'string': {
          if (!stringService) {
            logger.error('[Execute] StringService is not available.');
            return res.status(500).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'String service unavailable.' } });
          }

          const { masterAccountId } = user;
          const isSpellStep = metadata && metadata.isSpell;
          logger.debug(`[Execute] String service - metadata.castId: ${metadata?.castId}, full metadata:`, JSON.stringify(metadata));
          
          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';
          const generationParams = {
            masterAccountId: toMasterAccountId(masterAccountId, isX402Execution),
            ...(sessionId && { sessionId: new ObjectId(sessionId) }),
            ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            ...(metadata?.castId && { castId: metadata.castId }),
            ...(metadata?.cookId && { cookId: metadata.cookId }),
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
              ...(tool.deliveryHints && { deliveryHints: tool.deliveryHints }),
              costRate: costRateInfo,
              platformContext: user.platformContext
            }
          };

          const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;
          logger.debug(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}'.`);

          let resultStr;
          try {
            // Log inputs for debugging
            logger.debug(`[Execute] StringService inputs: ${JSON.stringify({
              operation: inputs.operation, 
              stringA_length: inputs.stringA ? String(inputs.stringA).length : 0,
              stringA_preview: inputs.stringA ? String(inputs.stringA).substring(0, 100) : null,
              stringB: inputs.stringB,
              searchValue: inputs.searchValue,
              searchValue_type: typeof inputs.searchValue,
              searchValue_length: inputs.searchValue ? String(inputs.searchValue).length : 0
            })}`);
            resultStr = stringService.execute(inputs);
            logger.debug(`[Execute] StringService result length: ${resultStr ? String(resultStr).length : 0}`);
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
            logger.debug(`[Execute] Sending final WebSocket update for String generation ${generationRecord._id}.`);
            websocketServer.sendToUser(generationRecord.masterAccountId.toString(), {
              type: 'generationUpdate',
              payload: {
                generationId: generationRecord._id.toString(),
                status: 'completed',
                outputs: { text: resultStr },
                service: tool.service,
                toolId: tool.toolId,
                castId: metadata?.castId || null,
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
            castId: metadata?.castId || null,
            message: 'String operation completed successfully.'
          });
        }
        default: {
          logger.error(`[Execute] Unrecognized or un-migrated service '${service}' for tool '${toolId}'.`);
          return res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: `Service '${service}' not supported.` } });
        }
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

  logger.debug('[generationExecutionApi] Generation Execution API routes initialized.');
  return router;
}; 