/**
 * WorkflowExecutionService - Thin facade for workflow execution
 * 
 * This service orchestrates spell execution by delegating to specialized services:
 * - SpellExecutor: Spell-level orchestration
 * - StepExecutor: Step execution using Execution Strategy pattern
 * - StepContinuator: Step continuation and output processing
 * 
 * Architecture:
 * - Management: CastManager, GenerationRecordManager, CostAggregator
 * - Execution: SpellExecutor, StepExecutor, ParameterResolver, Execution Strategies
 * - Continuation: StepContinuator, OutputProcessor, PipelineContextBuilder
 * - Adapters: AdapterCoordinator, AsyncJobPoller
 * - Notifications: WorkflowNotifier
 * 
 * Public API (maintained for backward compatibility):
 * - execute(spell, context): Start spell execution
 * - continueExecution(completedGeneration): Continue after step completion
 */

const CastManager = require('./workflow/management/CastManager');
const GenerationRecordManager = require('./workflow/management/GenerationRecordManager');
const CostAggregator = require('./workflow/management/CostAggregator');
const StepExecutor = require('./workflow/execution/StepExecutor');
const SpellExecutor = require('./workflow/execution/SpellExecutor');
const StepContinuator = require('./workflow/continuation/StepContinuator');
const AsyncJobPoller = require('./workflow/adapters/AsyncJobPoller');
const AdapterCoordinator = require('./workflow/adapters/AdapterCoordinator');
const WorkflowNotifier = require('./workflow/notifications/WorkflowNotifier');

class WorkflowExecutionService {
    constructor({ logger, toolRegistry, comfyUIService, internalApiClient, db, workflowsService }) {
        this.logger = logger;
        this.toolRegistry = toolRegistry;
        this.internalApiClient = internalApiClient;
        // Note: comfyUIService, db are kept for backward compatibility but may not be used
        this.comfyuiService = comfyUIService;
        this.db = db;
        this.workflowsService = workflowsService;
        
        // Initialize management services
        this.castManager = new CastManager({ logger, internalApiClient });
        this.generationRecordManager = new GenerationRecordManager({ logger, internalApiClient });
        this.costAggregator = new CostAggregator({ logger, internalApiClient });
        
        // Initialize adapter and notification services
        const adapterRegistry = require('./adapterRegistry');

        // Register ComfyDeploy adapter so WebhookStrategy is selected for comfyui tools
        if (comfyUIService) {
            const ComfyDeployAdapter = require('./comfydeploy/comfyDeployAdapter');
            adapterRegistry.register('comfyui', new ComfyDeployAdapter(comfyUIService));
        }

        this.asyncJobPoller = new AsyncJobPoller({
            logger, 
            generationRecordManager: this.generationRecordManager 
        });
        this.adapterCoordinator = new AdapterCoordinator({
            logger,
            adapterRegistry,
            generationRecordManager: this.generationRecordManager,
            asyncJobPoller: this.asyncJobPoller
        });
        this.workflowNotifier = new WorkflowNotifier({ logger });
        
        // Initialize execution services
        this.stepExecutor = new StepExecutor({
            logger,
            toolRegistry,
            workflowsService,
            internalApiClient,
            adapterRegistry,
            generationRecordManager: this.generationRecordManager,
            adapterCoordinator: this.adapterCoordinator,
            workflowNotifier: this.workflowNotifier
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
     * Called by the NotificationDispatcher when a spell step is complete.
     * It processes the output and triggers the next step or finalizes the spell.
     * @param {object} completedGeneration - The completed generation record for the step.
     */
    async continueExecution(completedGeneration) {
        // Delegate to StepContinuator - handles all continuation logic
        await this.stepContinuator.continue(completedGeneration);
    }
}

module.exports = WorkflowExecutionService; 