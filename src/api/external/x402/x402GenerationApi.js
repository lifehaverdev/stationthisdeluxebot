/**
 * x402 Generation API
 *
 * Endpoints for x402-authenticated generation execution.
 * Payment IS the auth - no account required.
 *
 * Flow:
 * 1. POST /api/x402/generate without payment → 402 + PaymentRequired
 * 2. POST /api/x402/generate with X-PAYMENT header → execute + settle
 */

const express = require('express');
const { createLogger } = require('../../../utils/logger');
const {
  createX402ExecutionService,
  X402PricingService,
  sendPaymentRequired,
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
  NETWORKS
} = require('../../../core/services/x402');
const { encodePaymentRequiredHeader } = require('@x402/core/http');

const { validateWebhookUrl } = require('../../../utils/webhookUtils');

const logger = createLogger('x402GenerationApi');

/**
 * Create x402 generation API router
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.toolRegistry - ToolRegistry instance
 * @param {Object} dependencies.internalApiClient - Internal API client
 * @param {Object} dependencies.x402PaymentLogDb - Payment log database
 * @param {string} dependencies.receiverAddress - Address to receive payments
 * @param {string} [dependencies.network] - Network ID (defaults to Base mainnet)
 */
function createX402GenerationApi(dependencies) {
  const {
    toolRegistry,
    internalApiClient,
    x402PaymentLogDb,
    receiverAddress,
    network = NETWORKS.BASE_MAINNET
  } = dependencies;

  if (!receiverAddress) {
    throw new Error('x402GenerationApi requires receiverAddress');
  }

  const router = express.Router();

  // Initialize services
  const x402ExecutionService = createX402ExecutionService({ x402PaymentLogDb });
  const pricingService = new X402PricingService({ toolRegistry });

  // Determine USDC address based on network
  const usdcAddress = network === NETWORKS.BASE_SEPOLIA
    ? BASE_SEPOLIA_USDC_ADDRESS
    : BASE_USDC_ADDRESS;

  /**
   * POST /api/x402/generate
   *
   * Execute a tool with x402 payment.
   *
   * Without X-PAYMENT header: Returns 402 with PaymentRequired
   * With X-PAYMENT header: Validates, executes, settles
   *
   * Body:
   * - toolId: string (required)
   * - inputs: object (tool inputs)
   * - delivery: object (optional)
   *   - mode: 'poll' | 'webhook' (default: 'poll')
   *   - url: string (required if mode is 'webhook')
   *   - secret: string (optional, for webhook signature verification)
   */
  router.post('/generate', async (req, res) => {
    const { toolId, inputs, delivery } = req.body;

    if (!toolId) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'toolId is required'
      });
    }

    // Verify tool exists
    const tool = toolRegistry.getToolById(toolId);
    if (!tool) {
      return res.status(404).json({
        error: 'TOOL_NOT_FOUND',
        message: `Tool ${toolId} not found`
      });
    }

    // Validate webhook URL if webhook mode is requested
    if (delivery?.mode === 'webhook') {
      if (!delivery.url || typeof delivery.url !== 'string') {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'When using webhook delivery mode, delivery.url is required'
        });
      }

      const validation = validateWebhookUrl(delivery.url, process.env.NODE_ENV !== 'production');
      if (!validation.valid) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: `Invalid webhook URL: ${validation.error}`
        });
      }
    }

    // Calculate cost
    let quote;
    try {
      quote = pricingService.calculateToolCost(toolId, inputs || {});
    } catch (error) {
      logger.error('[x402] Pricing error', { error: error.message, toolId });
      return res.status(500).json({
        error: 'PRICING_ERROR',
        message: 'Failed to calculate cost'
      });
    }

    // Check for x402 payment
    const x402 = req.x402;

    if (!x402 || !x402.verified) {
      // No valid payment - return 402 with requirements
      logger.info('[x402] No payment provided, returning 402', { toolId, costUsd: quote.totalCostUsd });

      const paymentRequired = pricingService.generatePaymentRequired(toolId, inputs || {}, {
        receiverAddress,
        network,
        usdcAddress,
        resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
      });

      const headerValue = encodePaymentRequiredHeader(paymentRequired);

      return res.status(402)
        .set('X-PAYMENT-REQUIRED', headerValue)
        .json({
          error: 'PAYMENT_REQUIRED',
          message: 'Payment required to execute this tool',
          paymentRequired,
          quote: {
            baseCostUsd: quote.baseCostUsd,
            markupUsd: quote.markupUsd,
            totalCostUsd: quote.totalCostUsd
          }
        });
    }

    // Validate payment covers cost
    const validation = await x402ExecutionService.validatePaymentForExecution(x402, quote.totalCostUsd);

    if (!validation.valid) {
      logger.warn('[x402] Payment validation failed', {
        error: validation.errorCode,
        required: validation.requiredUsd,
        provided: validation.providedUsd
      });

      if (validation.errorCode === 'INSUFFICIENT_PAYMENT') {
        // Return 402 with correct amount
        const paymentRequired = pricingService.generatePaymentRequired(toolId, inputs || {}, {
          receiverAddress,
          network,
          usdcAddress,
          resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
        });

        const headerValue = encodePaymentRequiredHeader(paymentRequired);

        return res.status(402)
          .set('X-PAYMENT-REQUIRED', headerValue)
          .json({
            error: 'INSUFFICIENT_PAYMENT',
            message: `Payment of $${validation.providedUsd} is less than required $${validation.requiredUsd}`,
            required: validation.requiredUsd,
            provided: validation.providedUsd,
            paymentRequired
          });
      }

      if (validation.errorCode === 'PAYMENT_ALREADY_USED') {
        return res.status(400).json({
          error: 'PAYMENT_ALREADY_USED',
          message: 'This payment signature has already been used'
        });
      }

      return res.status(400).json({
        error: validation.errorCode,
        message: validation.error
      });
    }

    // Record payment as verified (before execution)
    let signatureHash;
    try {
      const record = await x402ExecutionService.recordPaymentVerified(x402, {
        toolId,
        costUsd: quote.totalCostUsd
      });
      signatureHash = record.signatureHash;
    } catch (error) {
      logger.error('[x402] Failed to record payment', { error: error.message });
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to record payment'
      });
    }

    // Execute generation via internal API
    let executionResult;
    try {
      logger.info('[x402] Executing generation', {
        toolId,
        payer: x402.payer,
        costUsd: quote.totalCostUsd
      });

      // Create a synthetic user context for the internal API
      // This marks it as an x402 execution (no account, just payer address)
      // Set platform to 'webhook' if webhook delivery is requested, so the
      // NotificationDispatcher routes to WebhookNotifier
      const isWebhookDelivery = delivery?.mode === 'webhook';
      const payload = {
        toolId,
        inputs,
        user: {
          masterAccountId: `x402:${x402.payer}`, // Synthetic ID for tracking
          platform: isWebhookDelivery ? 'webhook' : 'x402',
          isX402: true,
          payerAddress: x402.payer
        },
        metadata: {
          x402: true,
          payer: x402.payer,
          signatureHash,
          // Include webhook info if provided (webhookUrl is read by WebhookNotifier)
          ...(isWebhookDelivery && {
            webhookUrl: delivery.url,
            ...(delivery.secret && { webhookSecret: delivery.secret })
          })
        }
      };

      const response = await internalApiClient.post('/internal/v1/data/execute', payload);
      executionResult = response.data;

    } catch (error) {
      // Execution failed - DON'T settle, user keeps their USDC
      logger.error('[x402] Execution failed', {
        error: error.message,
        toolId,
        payer: x402.payer
      });

      // Mark payment as failed
      await x402ExecutionService.x402PaymentLogDb.recordFailed(
        signatureHash,
        `Execution failed: ${error.message}`
      );

      return res.status(500).json({
        error: 'EXECUTION_FAILED',
        message: 'Generation failed. Payment was not charged.',
        details: error.response?.data || error.message
      });
    }

    // Execution succeeded - settle payment
    logger.info('[x402] Execution succeeded, settling payment', { signatureHash });

    const settlement = await x402ExecutionService.settlePayment(x402, signatureHash);

    if (!settlement.success) {
      // Settlement failed but execution succeeded
      // This is a problem - we should probably queue for retry
      logger.error('[x402] Settlement failed after successful execution', {
        error: settlement.error,
        signatureHash
      });

      // Still return the result, but flag the settlement issue
      return res.status(200).json({
        ...executionResult,
        x402: {
          settled: false,
          settlementError: settlement.error,
          payer: x402.payer,
          costUsd: quote.totalCostUsd
        }
      });
    }

    // Full success - return result with settlement info
    logger.info('[x402] Generation complete with settlement', {
      transaction: settlement.transaction,
      payer: x402.payer,
      costUsd: quote.totalCostUsd
    });

    // Include settlement response header
    const { encodePaymentResponseHeader } = require('@x402/core/http');
    const responseHeader = encodePaymentResponseHeader({
      success: true,
      transaction: settlement.transaction,
      network: settlement.network,
      payer: settlement.payer
    });

    return res.status(200)
      .set('X-PAYMENT-RESPONSE', responseHeader)
      .json({
        ...executionResult,
        x402: {
          settled: true,
          transaction: settlement.transaction,
          network: settlement.network,
          payer: settlement.payer,
          costUsd: quote.totalCostUsd
        }
      });
  });

  /**
   * GET /api/x402/status/:generationId
   *
   * Poll generation status (no payment required)
   *
   * Returns:
   * - generationId: string
   * - status: 'pending' | 'processing' | 'completed' | 'failed'
   * - outputs: array (if completed)
   * - error: object (if failed)
   */
  router.get('/status/:generationId', async (req, res) => {
    const { generationId } = req.params;

    if (!generationId) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'generationId is required'
      });
    }

    try {
      const response = await internalApiClient.get(`/internal/v1/data/generations/${generationId}`);
      const generation = response.data;

      if (!generation) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Generation not found'
        });
      }

      // Return a slim response with essential status info
      const result = {
        generationId: generation._id,
        status: generation.status,
        toolId: generation.toolId,
        createdAt: generation.requestTimestamp,
        updatedAt: generation.responseTimestamp || generation.requestTimestamp
      };

      // Include outputs if completed
      if (generation.status === 'completed' && generation.responsePayload) {
        result.outputs = generation.responsePayload;
      }

      // Include error info if failed
      if (generation.status === 'failed') {
        result.error = {
          message: generation.errorMessage || 'Generation failed'
        };
      }

      return res.json(result);
    } catch (error) {
      if (error.response?.status === 404) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Generation not found'
        });
      }

      logger.error('[x402] Status check failed', { error: error.message, generationId });
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to check generation status'
      });
    }
  });

  /**
   * GET /api/x402/quote
   *
   * Get a cost quote without payment
   */
  router.get('/quote', (req, res) => {
    const { toolId, ...params } = req.query;

    if (!toolId) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'toolId query parameter is required'
      });
    }

    try {
      const quote = pricingService.calculateToolCost(toolId, params);

      return res.json({
        toolId,
        baseCostUsd: quote.baseCostUsd,
        markupUsd: quote.markupUsd,
        totalCostUsd: quote.totalCostUsd,
        totalCostAtomic: quote.totalCostAtomic,
        currency: 'USDC',
        network,
        payTo: receiverAddress
      });
    } catch (error) {
      return res.status(400).json({
        error: 'PRICING_ERROR',
        message: error.message
      });
    }
  });

  /**
   * GET /api/x402/tools
   *
   * List available tools with pricing
   */
  router.get('/tools', (req, res) => {
    const tools = toolRegistry.getAllTools();

    const toolsWithPricing = tools
      .filter(t => t.visibility === 'public')
      .map(tool => {
        try {
          const quote = pricingService.calculateToolCost(tool.toolId, {});
          return {
            toolId: tool.toolId,
            displayName: tool.displayName,
            description: tool.description,
            category: tool.category,
            baseCostUsd: quote.baseCostUsd,
            totalCostUsd: quote.totalCostUsd
          };
        } catch {
          return {
            toolId: tool.toolId,
            displayName: tool.displayName,
            description: tool.description,
            category: tool.category,
            baseCostUsd: null,
            totalCostUsd: null
          };
        }
      });

    return res.json({
      tools: toolsWithPricing,
      network,
      payTo: receiverAddress,
      currency: 'USDC'
    });
  });

  return router;
}

module.exports = createX402GenerationApi;
