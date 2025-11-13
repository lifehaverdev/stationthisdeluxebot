// Note: Utility functions are now used by extracted services, not directly here
const CastManager = require('./workflow/management/CastManager');
const GenerationRecordManager = require('./workflow/management/GenerationRecordManager');
const CostAggregator = require('./workflow/management/CostAggregator');
const StepExecutor = require('./workflow/execution/StepExecutor');
const SpellExecutor = require('./workflow/execution/SpellExecutor');
const StepContinuator = require('./workflow/continuation/StepContinuator');

class WorkflowExecutionService {
    constructor({ logger, toolRegistry, comfyUIService, internalApiClient, db, workflowsService }) {
        this.logger = logger;
        this.toolRegistry = toolRegistry;
        this.comfyuiService = comfyUIService;
        this.internalApiClient = internalApiClient;
        this.db = db; // Contains generationOutputs
        this.workflowsService = workflowsService;
        
        // Initialize management services
        this.castManager = new CastManager({ logger, internalApiClient });
        this.generationRecordManager = new GenerationRecordManager({ logger, internalApiClient });
        this.costAggregator = new CostAggregator({ logger, internalApiClient });
        
        // Initialize execution services
        const adapterRegistry = require('./adapterRegistry');
        this.stepExecutor = new StepExecutor({
            logger,
            toolRegistry,
            workflowsService,
            internalApiClient,
            adapterRegistry,
            generationRecordManager: this.generationRecordManager
        });
        this.spellExecutor = new SpellExecutor({
            logger,
            stepExecutor: this.stepExecutor
        });
        
        // Initialize continuation services
        this.stepContinuator = new StepContinuator({
            logger,
            castManager: this.castManager,
            generationRecordManager: this.generationRecordManager,
            costAggregator: this.costAggregator,
            stepExecutor: this.stepExecutor
        });
    }

    /**
     * Kicks off the execution of a spell.
     * This method is fire-and-forget. It starts the first step, and the
     * NotificationDispatcher will drive the rest of the execution.
     * @param {object} spell - The spell document.
     * @param {object} context - The initial execution context from the /cast command.
     */
    async execute(spell, context) {
        // Delegate to SpellExecutor
        await this.spellExecutor.execute(spell, context);
    }

    /**
     * Executes a single step of a spell, creating a generation record that will be
     * picked up by the NotificationDispatcher.
     * @private
     * NOTE: This method is kept for backward compatibility with continueExecution.
     * It delegates to StepExecutor which uses Execution Strategy pattern.
     */
    async _executeStep(spell, stepIndex, pipelineContext, originalContext) {
        // Delegate to StepExecutor - uses Execution Strategy pattern (no conditionals!)
        await this.stepExecutor.executeStep(spell, stepIndex, pipelineContext, originalContext);
    }

    /**
     * Called by the NotificationDispatcher when a spell step is complete.
     * It processes the output and triggers the next step or finalizes the spell.
     * @param {object} completedGeneration - The completed generation record for the step.
     */
    async continueExecution(completedGeneration) {
        // Delegate to StepContinuator - handles all continuation logic
        await this.stepContinuator.continue(completedGeneration);
    }

    async executeGpt(tool, originalContext, mergedInputs, dependencies) {
        const { logger } = dependencies;
        const { masterAccountId, platform, notification } = originalContext;

        try {
             // --- User Handling ---
            

            // --- Event Logging ---
            const eventPayload = {
                masterAccountId: masterAccountId,
                eventType: 'gpt_execution_triggered',
                sourcePlatform: platform,
                eventData: {
                    toolId: tool.toolId
                }
            };
            const eventResponse = await this.internalApiClient.post('/internal/v1/data/events', eventPayload);
            const eventId = eventResponse.data._id;
            
            // --- OpenAI API Call ---
            const gptResponse = await axios.post(tool.apiPath, {
                // ... existing code ...
            });

            const finalGenerationParams = {
                masterAccountId: masterAccountId,
                initiatingEventId: eventId,
                serviceName: 'openai',
                toolId: tool.toolId,
                requestPayload: mergedInputs,
                responsePayload: { result: gptResponse.data.result },
                metadata: {
                    notificationContext: notification,
                },
                status: 'completed',
                deliveryStatus: 'pending',
                notificationPlatform: notification.platform,
            };

            await this.internalApiClient.post('/internal/v1/data/generations', finalGenerationParams);

            return { success: true };

        } catch (error) {
            // ... existing code ...
        }
    }
}

module.exports = WorkflowExecutionService; 