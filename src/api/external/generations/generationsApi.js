const express = require('express');
const { createLogger } = require('../../../utils/logger');

function createGenerationsApi(dependencies) {
    const { internalApiClient, toolRegistry, comfyUI, userSettingsService, loraResolutionService, logger } = dependencies;
    if (!internalApiClient) {
        throw new Error('[GenerationsApi] Missing internalApiClient in dependencies');
    }
    // Backward compatibility: some legacy code expects dependencies.internal.client
    const internalClient = internalApiClient;
    const router = express.Router();

    router.post('/execute', async (req, res) => {
        const { toolId, inputs, delivery = { mode: 'poll' } } = req.body;
        const { user } = req; // Injected by apiKeyAuth middleware

        // 1. Input Validation
        if (!toolId || typeof toolId !== 'string') {
            return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing or invalid `toolId`.' } });
        }
        if (!inputs || typeof inputs !== 'object') {
            return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing or invalid `inputs` object.' } });
        }

        // 2. Tool Validation
        const tool = toolRegistry.getTool(toolId);
        if (!tool) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Tool with ID '${toolId}' not found.` } });
        }
        
        if (delivery.mode === 'await') {
            return res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'The `await` delivery mode is not yet implemented.' } });
        }

        let generationRecord;
        try {
            // 3. Create initiating event record (sessions deprecated)
            const eventResponse = await internalClient.post('/internal/v1/data/events', {
                masterAccountId: user.masterAccountId,
                eventType: 'api_command_used',
                sourcePlatform: 'external_api',
                eventData: { toolId, delivery }
            });
            const initiatingEventId = eventResponse.data._id;

            const generationRecordResponse = await internalClient.post('/internal/v1/data/generations', {
                masterAccountId: user.masterAccountId,
                initiatingEventId,
                platform: 'external_api',
                toolId: tool.toolId,
                serviceName: 'comfy-deploy', // Assuming comfy-deploy for now
                status: 'pending',
                delivery: delivery.mode === 'webhook' ? delivery : { mode: 'poll' },
                notificationPlatform: delivery.mode === 'webhook' ? 'webhook' : 'none',
                requestTimestamp: new Date().toISOString(),
                metadata: {
                    ...tool.metadata,
                    displayName: tool.displayName,
                    toolId: tool.toolId,
                }
            });
            generationRecord = generationRecordResponse.data;
        } catch (err) {
            const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
            logger.error(`[ExternalAPI EXEC /${toolId}] An error occurred during initial record creation: ${errorMessage}`, { stack: err.stack });
            return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create initial generation records.' } });
        }

        try {
            // 4. Merge Inputs & Preferences
            let userPreferences = {};
            try {
                const encodedDisplayName = encodeURIComponent(tool.displayName);
                const preferencesResponse = await internalClient.get(`/internal/v1/data/users/${user.masterAccountId}/preferences/${encodedDisplayName}`);
                if (preferencesResponse.data && typeof preferencesResponse.data === 'object') {
                    userPreferences = preferencesResponse.data;
                }
            } catch (error) {
                 if (!error.response || error.response.status !== 404) {
                    logger.warn(`[ExternalAPI EXEC /${toolId}] Could not fetch user preferences: ${error.message}`);
                }
            }
            
            // Start with preferences, then overwrite with explicit inputs from the API call
            const finalInputs = { ...userPreferences, ...inputs };
            const rawPrompt = finalInputs[tool.metadata?.telegramPromptInputKey]; // Assuming same key for now
            
            // 5. LoRA Resolution
            if (tool.metadata.hasLoraLoader && rawPrompt) {
                if (loraResolutionService) {
                    const { modifiedPrompt, appliedLoras } = await loraResolutionService.resolveLoraTriggers(
                        rawPrompt, user.masterAccountId, tool.metadata.baseModel, dependencies
                    );
                    finalInputs[tool.metadata.telegramPromptInputKey] = modifiedPrompt;
                    if (appliedLoras && appliedLoras.length > 0) {
                        internalClient.put(`/internal/v1/data/generations/${generationRecord._id}`, {
                            'metadata.appliedLoras': appliedLoras,
                            'metadata.rawPrompt': rawPrompt,
                        }).catch(updateErr => logger.error(`[ExternalAPI EXEC /${toolId}] Failed to update generation with LoRA info: ${updateErr.message}`));
                    }
                }
            }

            // 6. Submit job
            const runId = await comfyUI.submitRequest({
                deploymentId: tool.metadata.deploymentId,
                inputs: finalInputs,
            });

            // 7. Update generation record with run_id
            await internalClient.put(`/internal/v1/data/generations/${generationRecord._id}`, {
                'metadata.run_id': runId,
                'requestPayload': finalInputs,
                'status': 'processing'
            });
            
            // 8. Respond for 'poll' and 'webhook' modes
            res.status(202).json({
                status: 'accepted',
                message: 'Your request has been accepted and is being processed.',
                toolId: tool.toolId,
                generationId: generationRecord._id,
                runId: runId,
                delivery: generationRecord.delivery
            });

        } catch (err) {
            const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
            logger.error(`[ExternalAPI EXEC /${toolId}] An error occurred during job submission: ${errorMessage}`, { stack: err.stack });
            
            await internalClient.put(`/internal/v1/data/generations/${generationRecord._id}`, {
                status: 'failed',
                responsePayload: { error: errorMessage },
            }).catch(updateErr => logger.error(`[ExternalAPI EXEC /${toolId}] Failed to update generation to FAILED: ${updateErr.message}`));

            res.status(500).json({ error: { code: 'JOB_SUBMISSION_FAILED', message: 'Failed to submit the generation job.' } });
        }
    });

    router.get('/status/:generationId', async (req, res) => {
        const { generationId } = req.params;
        const { user } = req;

        if (!generationId) {
            return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing `generationId`.' } });
        }

        try {
            const response = await internalClient.get(`/internal/v1/data/generations/${generationId}`);
            const generationRecord = response.data;

            // Security Check: Ensure the user owns this record
            if (generationRecord.masterAccountId !== user.masterAccountId) {
                // Return 404 to avoid leaking information about existing generation IDs
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Generation record not found.' } });
            }

            // Return a curated view of the record
            res.status(200).json({
                generationId: generationRecord._id,
                status: generationRecord.status,
                deliveryStatus: generationRecord.deliveryStatus,
                outputs: generationRecord.outputs,
                responsePayload: generationRecord.responsePayload // Contains errors if failed
            });

        } catch (error) {
            if (error.response && error.response.status === 404) {
                 return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Generation record not found.' } });
            }
            logger.error(`[ExternalAPI STATUS /${generationId}] An error occurred while fetching generation status: ${error.message}`);
            res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve generation status.' } });
        }
    });

    // Status check endpoint for pending generations
    router.post('/status', async (req, res) => {
        const { generationIds } = req.body;
        const { user } = req; // Injected by apiKeyAuth middleware

        // Input validation
        if (!generationIds || !Array.isArray(generationIds) || generationIds.length === 0) {
            return res.status(400).json({ 
                error: { code: 'BAD_REQUEST', message: 'Missing or invalid `generationIds` array.' } 
            });
        }

        // Validate generation IDs format
        const invalidIds = generationIds.filter(id => typeof id !== 'string' || id.length === 0);
        if (invalidIds.length > 0) {
            return res.status(400).json({ 
                error: { code: 'BAD_REQUEST', message: 'Invalid generation ID format.', details: { invalidIds } } 
            });
        }

        try {
            // Query internal API for generation statuses
            const response = await internalClient.get('/internal/v1/data/generations', {
                params: {
                    _id: { $in: generationIds },
                    masterAccountId: user.masterAccountId
                }
            });

            const generations = response.data?.generations || response.data || [];
            
            logger.info(`[GenerationsApi] Status check: Found ${generations.length} generations for ${generationIds.length} requested IDs`);
            
            res.status(200).json({ generations });
        } catch (error) {
            logger.error(`[GenerationsApi] Status check failed: ${error.message}`, error);
            res.status(500).json({
                error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to check generation statuses.' }
            });
        }
    });

    return router;
}

module.exports = createGenerationsApi; 