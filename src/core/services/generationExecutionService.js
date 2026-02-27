const { ObjectId } = require('mongodb');
const { getPricingService } = require('./pricing');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('GenerationExecutionService');

/**
 * Converts masterAccountId to ObjectId or keeps as string for x402.
 */
function toMasterAccountId(id, isX402 = false) {
  if (isX402) return id;
  return new ObjectId(id);
}

class GenerationExecutionService {
  constructor({
    db,
    toolRegistry,
    comfyUIService,
    stringService,
    loraResolutionService,
    internalApiClient,
    webSocketService,
    adminActivityService,
    notificationEvents,
    logger: injectedLogger,
  } = {}) {
    this.db = db;
    this.toolRegistry = toolRegistry;
    this.comfyUIService = comfyUIService;
    this.stringService = stringService;
    this.loraResolutionService = loraResolutionService;
    this.internalApiClient = internalApiClient;
    this.webSocketService = webSocketService;
    this.adminActivityService = adminActivityService;
    this.notificationEvents = notificationEvents;
    this.logger = injectedLogger || logger;
  }

  /**
   * Execute a generation.
   * @param {object} params
   * @param {string} params.toolId
   * @param {object} params.inputs
   * @param {object} params.user  - { masterAccountId, platform, platformId, platformContext, isX402 }
   * @param {object} [params.metadata]
   * @param {string} [params.eventId]
   * @param {string} [params.sessionId]
   * @returns {Promise<{ statusCode: number, body: object }>}
   */
  async execute({ toolId, inputs, user, metadata = {}, eventId, sessionId }) {
    // 1. Basic validation
    if (!toolId || !inputs || !user || !user.masterAccountId) {
      return { statusCode: 400, body: { error: { code: 'INVALID_INPUT', message: 'Missing required fields: toolId, inputs, and user context are required.' } } };
    }

    let costRateInfo = null;
    let estimatedSeconds = 30;
    let costUsd = 0;
    let baseCostUsd = 0;
    let pointsRequired = 0;
    let isMs2User = false;
    let pricingBreakdown = null;

    let generationRecord;

    try {
      // 2. Tool Lookup & Validation
      this.logger.debug(`[Execute] Received request for toolId: ${toolId}`);

      let tool = await this.toolRegistry.getToolById(toolId);
      let resolvedToolId = toolId;

      if (!tool) {
        const commandName = toolId.startsWith('/') ? toolId : `/${toolId}`;
        tool = this.toolRegistry.findByCommand(commandName);

        if (!tool) {
          const allTools = this.toolRegistry.getAllTools();
          const lowerName = toolId.toLowerCase();
          tool = allTools.find(t =>
            (t.displayName && t.displayName.toLowerCase() === lowerName) ||
            (t.commandName && t.commandName.replace(/^\//, '').toLowerCase() === lowerName)
          );
        }

        if (tool) {
          resolvedToolId = tool.toolId;
          this.logger.debug(`[Execute] Resolved alias "${toolId}" to toolId "${resolvedToolId}"`);
        }
      }

      if (!tool) {
        this.logger.warn(`[Execute] Tool not found: "${toolId}". Available tools: ${this.toolRegistry.getAllTools().slice(0, 5).map(t => t.commandName || t.displayName).join(', ')}...`);
        return { statusCode: 404, body: { error: { code: 'TOOL_NOT_FOUND', message: `Tool '${toolId}' not found. Use tools/list to see available tools.` } } };
      }

      // 3. Pre-Execution Credit Check
      const isX402Execution = user.isX402 === true;
      if (isX402Execution) {
        this.logger.debug(`[Execute] x402 payment detected - skipping credit check for payer ${user.payerAddress}`);
      }

      try {
        // 3a. Determine Cost Rate
        if (!tool.costingModel || !tool.costingModel.rateSource) {
          this.logger.error(`[Execute] Tool '${toolId}' is missing a valid costingModel. Execution blocked.`);
          return { statusCode: 400, body: { error: { code: 'INVALID_TOOL_CONFIG', message: `Tool '${toolId}' is not configured for costing and cannot be executed.` } } };
        }

        if (tool.costingModel.rateSource === 'machine') {
          if (tool.costingModel.rate && tool.costingModel.unit) {
            costRateInfo = {
              amount: tool.costingModel.rate,
              unit: tool.costingModel.unit
            };
          } else {
            this.logger.error(`[Execute] Tool '${toolId}' has machine costing but missing rate or unit.`);
            return { statusCode: 500, body: { error: { code: 'COSTING_UNAVAILABLE', message: 'Could not determine execution cost.' } } };
          }
        } else if (tool.costingModel.rateSource === 'fixed') {
          costRateInfo = {
            amount: tool.costingModel.fixedCost.amount,
            unit: tool.costingModel.fixedCost.unit
          };
        } else if (tool.costingModel.rateSource === 'static' && tool.costingModel.staticCost) {
          let staticAmount = tool.costingModel.staticCost.amount;
          if (staticAmount === 0 && tool.metadata?.costTable) {
            const ci = inputs || {};
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
          this.logger.error(`[Execute] Unsupported or invalid rateSource in costingModel for tool '${toolId}'.`);
          return { statusCode: 400, body: { error: { code: 'INVALID_TOOL_CONFIG', message: `Tool '${toolId}' has an invalid costing configuration.` } } };
        }

        // 3b. Estimate Base Compute Cost
        estimatedSeconds = 30;
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
          this.logger.error(`[Execute] Could not determine cost for tool '${toolId}' with unhandled unit type:`, costRateInfo.unit);
          return { statusCode: 500, body: { error: { code: 'COSTING_ERROR', message: 'Could not determine execution cost for this tool.' } } };
        }

        // 3c. Fetch User's Wallet, Determine MS2 Status, Apply Platform Pricing
        const pricingService = getPricingService(this.logger);

        if (!isX402Execution) {
          const userId = user.masterAccountId;
          const userCore = this.db.userCore
            ? await this.db.userCore.findUserCoreById(userId)
            : (await this.internalApiClient.get(`/internal/v1/data/users/${userId}`)).data;

          let walletAddress = null;
          if (userCore && userCore.wallets && userCore.wallets.length > 0) {
            const primary = userCore.wallets.find(w => w.isPrimary);
            walletAddress = (primary ? primary.address : userCore.wallets[0].address) || null;
          }

          if (!walletAddress) {
            this.logger.error(`[Execute] Pre-check failed: Could not find a wallet address for user ${userId}.`);
            return { statusCode: 403, body: { error: { code: 'WALLET_NOT_FOUND', message: 'User wallet not available for credit check.' } } };
          }

          try {
            const activeDeposits = this.db.creditLedger
              ? await this.db.creditLedger.findActiveDepositsForWalletAddress(walletAddress)
              : (await this.internalApiClient.get(`/internal/v1/data/ledger/deposits/by-wallet/${walletAddress}`)).data.deposits || [];
            isMs2User = pricingService.userQualifiesForMs2Pricing(activeDeposits);
            this.logger.debug(`[Pricing] User ${userId} MS2 status: ${isMs2User}`);
          } catch (depositErr) {
            this.logger.warn(`[Pricing] Could not determine MS2 status for user ${userId}: ${depositErr.message}. Defaulting to standard pricing.`);
            isMs2User = false;
          }

          const pricingResult = pricingService.calculateCost({
            computeCostUsd: baseCostUsd,
            serviceName: tool.service,
            isMs2User,
            toolId: tool.toolId,
          });
          costUsd = pricingResult.finalCostUsd;
          pricingBreakdown = pricingResult.breakdown;

          this.logger.debug(`[Pricing] Service: ${tool.service}, Base: $${baseCostUsd.toFixed(4)}, Final: $${costUsd.toFixed(4)}, Tier: ${isMs2User ? 'MS2' : 'standard'}`);

          const USD_PER_POINT = 0.000337;
          pointsRequired = Math.max(1, Math.round(costUsd / USD_PER_POINT));

          const currentPoints = this.db.creditLedger
            ? (await this.db.creditLedger.sumPointsRemainingForWalletAddress(walletAddress)) || 0
            : ((await this.internalApiClient.get(`/internal/v1/data/ledger/points/by-wallet/${walletAddress}`)).data.points || 0);

          this.logger.debug(`[Pre-Execution Credit Check] User ${userId} (Wallet: ${walletAddress}) has ${currentPoints} points. Required: ${pointsRequired}`);

          if (currentPoints < pointsRequired) {
            return {
              statusCode: 402,
              body: {
                error: {
                  code: 'INSUFFICIENT_FUNDS',
                  message: 'You do not have enough points to execute this workflow.',
                  details: {
                    required: pointsRequired,
                    available: currentPoints,
                    pricing: pricingBreakdown
                  }
                }
              }
            };
          }
        } else {
          const pricingResult = pricingService.calculateCost({
            computeCostUsd: baseCostUsd,
            serviceName: tool.service,
            isMs2User: false,
            toolId: tool.toolId,
          });
          costUsd = pricingResult.finalCostUsd;
          pricingBreakdown = pricingResult.breakdown;
        }
      } catch (creditCheckErr) {
        this.logger.error(`[Pre-Execution Credit Check] Error during credit check for user ${user.masterAccountId}:`, creditCheckErr);
        return { statusCode: 500, body: { error: { code: 'CREDIT_CHECK_FAILED', message: 'Could not verify your available points. Please try again later.' } } };
      }

      // 4. Routing based on Service
      const service = tool.service;
      this.logger.debug(`[Execute] Routing tool '${toolId}' to service: '${service}'`);

      // Pre-routing LoRA Resolution
      let resolvedInputs = { ...inputs };
      if (service === 'comfyui' && tool.metadata?.hasLoraLoader) {
        const promptInputKey = tool.metadata?.telegramPromptInputKey || 'input_prompt';
        if (resolvedInputs[promptInputKey]) {
          const { masterAccountId } = user;
          this.logger.debug(`[Execute] Pre-routing LoRA resolution for tool '${toolId}'.`);
          const { modifiedPrompt } = await this.loraResolutionService.resolveLoraTriggers(
            resolvedInputs[promptInputKey],
            masterAccountId,
            tool.metadata.baseModel,
            { internal: { client: this.internalApiClient } }
          );
          resolvedInputs[promptInputKey] = modifiedPrompt;
        }
      }

      // Adapter-based execution path
      // Note: adapterRegistry is required inline (not injected) to avoid a circular dependency
      // between generationExecutionService and the adapter modules that may themselves require services.
      const adapterRegistry = require('./adapterRegistry');
      const adapter = adapterRegistry.get(service);
      if (adapter && typeof adapter.execute === 'function' && (tool.deliveryMode === 'immediate' || !tool.deliveryMode)) {
        try {
          const execInputs = {
            ...(tool.metadata?.defaultAdapterParams || {}),
            ...resolvedInputs,
            ...(tool.metadata?.costTable && { costTable: tool.metadata.costTable })
          };
          const toolResult = await adapter.execute(execInputs);
          const { masterAccountId } = user;
          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';

          let normalizedData = toolResult.data;
          if (toolResult.type === 'text' && toolResult.data) {
            if (typeof toolResult.data.text === 'string') {
              normalizedData = { text: [toolResult.data.text] };
            } else if (typeof toolResult.data.description === 'string') {
              normalizedData = { text: [toolResult.data.description] };
            }
          }
          const outputEntry = { type: toolResult.type, data: normalizedData };

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
            ...(isSpellStep && { deliveryStrategy: 'spell_step' }),
            notificationPlatform: user.platform || 'none',
            pointsSpent: isX402Execution ? 0 : pointsRequired,
            protocolNetPoints: 0,
            costUsd: (toolResult.costUsd !== undefined && toolResult.costUsd !== null) ? toolResult.costUsd : costUsd,
            metadata: {
              ...tool.metadata,
              ...metadata,
              ...(tool.deliveryHints && { deliveryHints: tool.deliveryHints }),
              costRate: costRateInfo,
              platformContext: user.platformContext
            }
          };

          const newGeneration = await this.db.generationOutputs.createGenerationOutput(generationParams);

          const recordToEmit = {
            ...newGeneration,
            ...(isSpellStep && { deliveryStrategy: 'spell_step' })
          };

          try {
            this.notificationEvents?.emit?.('generationUpdated', recordToEmit);
            this.logger.debug(`[Execute] Emitted generationUpdated for immediate ${isSpellStep ? 'spell step' : 'generation'} ${newGeneration._id}`);
          } catch (emitErr) {
            this.logger.warn(`[Execute] Failed to emit generationUpdated for immediate generation ${newGeneration._id}: ${emitErr.message}`);
          }

          if (this.webSocketService) {
            this.webSocketService.sendToUser(String(masterAccountId), {
              type: 'generationUpdate',
              payload: { generationId: newGeneration._id.toString(), status: 'completed', ...toolResult.data, service: tool.service, toolId: tool.toolId }
            });
          }

          if (this.adminActivityService) {
            this.adminActivityService.emitPointSpend({
              masterAccountId,
              points: pointsRequired,
              serviceName: tool.service,
              toolId: tool.toolId,
              toolDisplayName: tool.displayName || tool.name || tool.toolId,
              generationId: newGeneration._id,
              costUsd: costUsd
            });
          }

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

          return { statusCode: 200, body: basePayload };
        } catch (execErr) {
          this.logger.error(`[Adapter Execute] Error executing tool via adapter for service ${service}:`, execErr);
          return { statusCode: 500, body: { error: { code: 'ADAPTER_EXECUTION_FAILED', message: execErr.message } } };
        }
      }

      // Adapter-based ASYNC path (startJob)
      if (adapter && typeof adapter.startJob === 'function') {
        try {
          const jobInputs = {
            ...(tool.metadata?.defaultAdapterParams || {}),
            ...resolvedInputs,
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
              run_id: runId,
              ...(user.platform === 'web-sandbox' ? { notificationContext: { platform: 'web-sandbox', windowId: metadata?.windowId || null } } : {})
            }
          };

          const createResponse = await this.db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;

          if (tool.deliveryMode === 'webhook') {
            this.logger.debug(`[Execute] Skipping background poller for webhook tool ${tool.toolId} (runId ${runId})`);
          } else (async () => {
            try {
              let attempts = 0;
              const maxAttempts = 60;
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
                    responsePayload: [{ type: pollRes.type, data: finalData }],
                    costUsd: pollRes.costUsd || null,
                    ...(pollRes.error ? { 'metadata.error': { message: pollRes.error, step: 'adapter_poll' } } : {}),
                  };
                  await this.db.generationOutputs.updateGenerationOutput(generationRecord._id, updatePayload);
                  const updated = await this.db.generationOutputs.findGenerationById(generationRecord._id);
                  this.notificationEvents?.emit?.('generationUpdated', updated);
                  break;
                }
                attempts++;
              }
            } catch (bgErr) {
              this.logger.error(`[Execute] Background poller error for runId ${runId}: ${bgErr.message}`);
            }
          })();

          return {
            statusCode: 202,
            body: {
              generationId: generationRecord._id.toString(),
              status: 'processing',
              service: tool.service,
              runId,
              toolId: tool.toolId,
              queuedAt: generationRecord.requestTimestamp,
              message: 'Your request has been accepted and is being processed.'
            }
          };
        } catch (startErr) {
          this.logger.error(`[Adapter startJob] Error starting job for service ${service}:`, startErr);
          return { statusCode: 500, body: { error: { code: 'ADAPTER_START_JOB_FAILED', message: startErr.message } } };
        }
      }

      // Legacy switch/case
      switch (service) {
        case 'comfyui': {
          const { masterAccountId } = user;
          let finalInputs = { ...resolvedInputs }; // Use pre-resolved inputs (LoRA already resolved above)

          const seedKey = tool.metadata?.seedInputKey || 'input_seed';
          if (
            finalInputs[seedKey] === undefined ||
            finalInputs[seedKey] === null ||
            finalInputs[seedKey] === ''
          ) {
            finalInputs[seedKey] = Math.floor(Math.random() * 0xffffffff);
            this.logger.debug(`[Execute] Auto-assigned random ${seedKey}=${finalInputs[seedKey]} for tool '${toolId}'.`);
          }

          const isSpellStep = metadata && metadata.isSpell;
          const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';
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
            pointsSpent: 0,
            protocolNetPoints: 0,
            costUsd: null,
            metadata: {
              ...tool.metadata,
              ...metadata,
              ...(tool.deliveryHints && { deliveryHints: tool.deliveryHints }),
              costRate: costRateInfo,
              loraResolutionData: {},
              platformContext: user.platformContext,
              pricingBreakdown,
              isMs2User,
              ...(user.platform === 'web-sandbox' ? { notificationContext: { platform: 'web-sandbox' } } : {})
            }
          };

          const createResponse = await this.db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;
          this.logger.debug(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}' with costRate: ${JSON.stringify(costRateInfo)}.`);

          const runId = await this.comfyUIService.submitRequest({
            deploymentId: tool.metadata.deploymentId,
            inputs: finalInputs,
          });
          this.logger.debug(`[Execute] Submitted job to ComfyUI for GenID ${generationRecord._id}. Run ID: ${runId}`);

          await this.db.generationOutputs.updateGenerationOutput(generationRecord._id, {
            'metadata.run_id': runId,
            status: 'processing',
          });

          const est = (typeof estimatedSeconds === 'number' && Number.isFinite(estimatedSeconds)) ? estimatedSeconds : null;
          return {
            statusCode: 202,
            body: {
              generationId: generationRecord._id.toString(),
              status: 'processing',
              service: tool.service,
              runId,
              toolId: tool.toolId,
              queuedAt: generationRecord.requestTimestamp,
              ...(est !== null ? { estimatedDurationSeconds: est, checkAfterMs: est * 1000 } : {}),
              estimatedCostUsd: costUsd,
              estimatedPoints: pointsRequired,
              pricing: pricingBreakdown,
              message: 'Your request has been accepted and is being processed.',
            }
          };
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

          if (this.webSocketService && user && user.masterAccountId) {
            this.webSocketService.sendToUser(String(user.masterAccountId), {
              type: 'generationUpdate',
              payload: staticPayload
            });
          }

          try {
            const isCook = metadata && metadata.source === 'cook' && metadata.collectionId && metadata.jobId;
            if (isCook) {
              const { CookOrchestratorService } = require('./cook');
              await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId: metadata.collectionId, cookId: metadata.cookId, userId: String(user.masterAccountId), jobId: metadata.jobId, generationId: staticPayload.generationId });
              await CookOrchestratorService.scheduleNext({ collectionId: metadata.collectionId, userId: String(user.masterAccountId), finishedJobId: metadata.jobId, success: true });
            }
          } catch (e) {
            this.logger.warn(`[Execute] Cook scheduleNext (static) error: ${e.message}`);
          }

          return { statusCode: 200, body: staticPayload };
        }

        case 'string': {
          if (!this.stringService) {
            this.logger.error('[Execute] StringService is not available.');
            return { statusCode: 500, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'String service unavailable.' } } };
          }

          const { masterAccountId } = user;
          const isSpellStep = metadata && metadata.isSpell;
          this.logger.debug(`[Execute] String service - metadata.castId: ${metadata?.castId}, full metadata:`, JSON.stringify(metadata));

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

          const createResponse = await this.db.generationOutputs.createGenerationOutput(generationParams);
          generationRecord = createResponse;
          this.logger.debug(`[Execute] Created generation record ${generationRecord._id} for tool '${toolId}'.`);

          let resultStr;
          try {
            this.logger.debug(`[Execute] StringService inputs: ${JSON.stringify({
              operation: inputs.operation,
              stringA_length: inputs.stringA ? String(inputs.stringA).length : 0,
              stringA_preview: inputs.stringA ? String(inputs.stringA).substring(0, 100) : null,
              stringB: inputs.stringB,
              searchValue: inputs.searchValue,
              searchValue_type: typeof inputs.searchValue,
              searchValue_length: inputs.searchValue ? String(inputs.searchValue).length : 0
            })}`);
            resultStr = this.stringService.execute(inputs);
            this.logger.debug(`[Execute] StringService result length: ${resultStr ? String(resultStr).length : 0}`);
          } catch (err) {
            this.logger.error(`[Execute] StringService error for tool '${toolId}': ${err.message}`);
            await this.db.generationOutputs.updateGenerationOutput(generationRecord._id, {
              status: 'failed',
              'metadata.error': {
                message: err.message,
                stack: err.stack,
                step: 'string_execution'
              }
            });
            return { statusCode: 500, body: { error: { code: 'STRING_ERROR', message: err.message } } };
          }

          const updatePayload = {
            status: 'completed',
            responsePayload: { result: resultStr },
            'metadata.response': resultStr
          };

          await this.db.generationOutputs.updateGenerationOutput(generationRecord._id, updatePayload);

          if (isSpellStep) {
            try {
              const updatedRecord = await this.db.generationOutputs.findGenerationById(generationRecord._id);
              this.notificationEvents?.emit?.('generationUpdated', { ...updatedRecord, deliveryStrategy: 'spell_step' });
            } catch (emitErr) {
              this.logger.error(`[Execute] Failed to emit generationUpdated event for spell step generation ${generationRecord._id}: ${emitErr.message}`);
            }
          }

          if (this.webSocketService) {
            this.logger.debug(`[Execute] Sending final WebSocket update for String generation ${generationRecord._id}.`);
            this.webSocketService.sendToUser(generationRecord.masterAccountId.toString(), {
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

          try {
            const isCook = metadata && metadata.source === 'cook' && metadata.collectionId && metadata.jobId;
            if (isCook) {
              const { CookOrchestratorService } = require('./cook');
              await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId: metadata.collectionId, cookId: metadata.cookId, userId: String(user.masterAccountId), jobId: metadata.jobId, generationId: generationRecord._id.toString() });
              await CookOrchestratorService.scheduleNext({ collectionId: metadata.collectionId, userId: String(user.masterAccountId), finishedJobId: metadata.jobId, success: true });
            }
          } catch (e) {
            this.logger.warn(`[Execute] Cook scheduleNext (string) error: ${e.message}`);
          }

          return {
            statusCode: 200,
            body: {
              generationId: generationRecord._id.toString(),
              status: 'completed',
              service: tool.service,
              toolId: tool.toolId,
              response: resultStr,
              castId: metadata?.castId || null,
              message: 'String operation completed successfully.'
            }
          };
        }

        default: {
          this.logger.error(`[Execute] Unrecognized or un-migrated service '${service}' for tool '${toolId}'.`);
          return { statusCode: 501, body: { error: { code: 'NOT_IMPLEMENTED', message: `Service '${service}' not supported.` } } };
        }
      }

    } catch (error) {
      this.logger.error(`[Execute] An unexpected error occurred while processing tool '${toolId}': ${error.message}`, error);

      if (generationRecord && generationRecord._id) {
        await this.db.generationOutputs.updateGenerationOutput(generationRecord._id, {
          status: 'failed',
          'metadata.error': {
            message: error.message,
            stack: error.stack,
            step: 'execution_dispatch'
          }
        }).catch(() => {});
      }

      return { statusCode: 500, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred during execution.' } } };
    }
  }
}

module.exports = { GenerationExecutionService };
