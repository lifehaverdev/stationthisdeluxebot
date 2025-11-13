# WorkflowExecutionService Refactor - Execution Prompt

## Mission

Refactor `WorkflowExecutionService.js` (841 lines) into a well-organized, maintainable service architecture following the Strangler Fig pattern. This refactor will improve code maintainability, testability, and organization while maintaining 100% backward compatibility with existing callers.

## Context & Preparation

### Key Documentation
- **Impact Analysis**: `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_IMPACT_ANALYSIS.md`
- **Dependency Graph**: `docs/WORKFLOW_EXECUTION_SERVICE_DEPENDENCY_GRAPH.md`
- **Executive Summary**: `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_SUMMARY.md`

### Current State
- **File**: `src/core/services/WorkflowExecutionService.js` (841 lines)
- **Public API**: 2 methods (`execute`, `continueExecution`)
- **Direct Callers**: 2 files (`SpellsService.js`, `notificationDispatcher.js`)
- **Risk Level**: MEDIUM (manageable with phased approach)

### Target Architecture
```
src/core/services/workflow/
├── WorkflowExecutionService.js          # Main facade (~100 lines)
├── execution/
│   ├── SpellExecutor.js                 # (~150 lines)
│   ├── StepExecutor.js                  # (~150 lines) ⭐ Much smaller - no conditionals!
│   ├── ParameterResolver.js             # (~100 lines)
│   └── strategies/                       # ⭐ NEW - Execution strategies
│       ├── ExecutionStrategy.js        # Base interface (~50 lines)
│       ├── ImmediateStrategy.js        # (~120 lines)
│       ├── AsyncAdapterStrategy.js     # (~150 lines)
│       ├── WebhookStrategy.js          # (~100 lines)
│       └── StrategyFactory.js          # (~80 lines)
├── continuation/
│   ├── StepContinuator.js               # (~150 lines)
│   ├── OutputProcessor.js               # (~120 lines)
│   └── PipelineContextBuilder.js        # (~80 lines)
├── management/
│   ├── CastManager.js                   # (~150 lines)
│   ├── GenerationRecordManager.js       # (~120 lines)
│   └── CostAggregator.js                # (~80 lines)
├── adapters/
│   ├── AdapterCoordinator.js            # (~150 lines)
│   └── AsyncJobPoller.js                # (~100 lines)
├── notifications/
│   └── WorkflowNotifier.js              # (~80 lines)
└── utils/
    ├── EventManager.js                  # (~60 lines)
    ├── RetryHandler.js                  # (~80 lines)
    └── ValidationUtils.js               # (~60 lines)
```

**Key Improvement**: Execution strategies move service-specific logic out of `StepExecutor`, making it much cleaner and eliminating the messy conditionals.

## Setup Instructions

### 1. Create Feature Branch
```bash
git checkout -b refactor/workflow-execution-service
```

### 2. Review Documentation
Read and understand:
- `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_IMPACT_ANALYSIS.md`
- `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_DEPENDENCY_GRAPH.md`
- `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_SUMMARY.md`
- `docs/TOOL_EXECUTION_STRATEGY_ENRICHMENT.md` ⭐ **CRITICAL** - Explains how to move service-specific logic to tool definitions

### 3. Review Current Implementation
- Read `src/core/services/WorkflowExecutionService.js` thoroughly
- Understand the two public methods and their responsibilities
- Identify all internal dependencies and side effects

## Execution Plan

### Phase 1: Extract Utilities (LOW RISK)

**Goal**: Extract reusable utility functions with no external dependencies.

**Tasks**:
1. Create `src/core/services/workflow/utils/` directory
2. Create `RetryHandler.js`:
   - Extract retry logic with exponential backoff
   - Function: `retryWithBackoff(fn, options)`
   - Options: `maxAttempts`, `baseDelay`, `maxDelay`
   - Pure function (no dependencies)
3. Create `EventManager.js`:
   - Extract event creation logic
   - Function: `createEvent(eventType, context, eventData, internalApiClient)`
   - Returns: `Promise<{ eventId }>`
4. Create `ValidationUtils.js`:
   - Extract validation functions
   - Functions: `validateStepIndex()`, `validateTool()`, `validateMetadata()`
   - Pure functions (no dependencies)
5. Update `WorkflowExecutionService.js` to use new utilities
6. Run tests to ensure no regressions

**Success Criteria**:
- ✅ All existing tests pass
- ✅ No performance regression
- ✅ Code is cleaner and more maintainable

**Files to Create**:
- `src/core/services/workflow/utils/RetryHandler.js`
- `src/core/services/workflow/utils/EventManager.js`
- `src/core/services/workflow/utils/ValidationUtils.js`

**Files to Modify**:
- `src/core/services/WorkflowExecutionService.js`

---

### Phase 2: Extract Management Services (LOW-MEDIUM RISK)

**Goal**: Extract database and state management logic.

**Tasks**:
1. Create `src/core/services/workflow/management/` directory
2. Create `CastManager.js`:
   - Extract cast record management
   - Methods: `updateCastWithGeneration()`, `finalizeCast()`, `checkCastStatus()`, `checkForDuplicateGeneration()`
   - Uses: `internalApiClient`, `RetryHandler`
   - Constructor: `{ logger, internalApiClient }`
3. Create `GenerationRecordManager.js`:
   - Extract generation record CRUD operations
   - Methods: `createGenerationRecord()`, `updateGenerationRecord()`, `getGenerationRecord()`
   - Uses: `internalApiClient`, `RetryHandler`
   - Constructor: `{ logger, internalApiClient }`
4. Create `CostAggregator.js`:
   - Extract cost aggregation logic
   - Method: `aggregateCosts(generationIds, internalApiClient)`
   - Returns: `Promise<{ totalCostUsd, totalPointsSpent }>`
   - Uses: `internalApiClient`
5. Update `WorkflowExecutionService.js` to use new managers
6. Run tests and verify database operations

**Success Criteria**:
- ✅ All existing tests pass
- ✅ Cast updates work correctly
- ✅ Generation record operations work correctly
- ✅ Cost aggregation is accurate

**Files to Create**:
- `src/core/services/workflow/management/CastManager.js`
- `src/core/services/workflow/management/GenerationRecordManager.js`
- `src/core/services/workflow/management/CostAggregator.js`

**Files to Modify**:
- `src/core/services/WorkflowExecutionService.js`

---

### Phase 3: Extract Execution Services (MEDIUM RISK)

**Goal**: Extract spell and step execution logic. **CRITICAL**: Implement Execution Strategy pattern to eliminate service-specific conditionals.

**Tasks**:
1. Create `src/core/services/workflow/execution/` directory
2. Create `ParameterResolver.js`:
   - Extract parameter mapping and resolution logic
   - Methods: `resolveMappings()`, `pruneInputs()`, `validateRequiredInputs()`
   - Uses: `ValidationUtils`
   - Pure functions where possible
3. **Create Execution Strategy System** (NEW - See `docs/TOOL_EXECUTION_STRATEGY_ENRICHMENT.md`):
   - Create `execution/strategies/` subdirectory
   - Create `ExecutionStrategy.js` - Base interface/class defining strategy contract
   - Create `ImmediateStrategy.js` - For immediate tools (ChatGPT, String Primitive)
     - Handles immediate execution via centralized endpoint
     - Handles WebSocket notifications
     - Handles timeout errors gracefully
   - Create `AsyncAdapterStrategy.js` - For async adapter tools (HuggingFace)
     - Creates generation record first
     - Starts async job via adapter
     - Sets up polling mechanism
     - Normalizes output format
   - Create `WebhookStrategy.js` - For webhook tools (ComfyUI)
     - Creates generation record with run_id
     - Starts job via adapter
     - Relies on webhook for completion
   - Create `StrategyFactory.js` - Creates default strategies for tools without explicit strategies
     - `createDefaultStrategy(tool)` - Analyzes tool properties and creates appropriate strategy
     - Falls back to ImmediateStrategy or AsyncAdapterStrategy based on `deliveryMode` and adapter capabilities
4. Create `StepExecutor.js`:
   - Extract individual step execution logic
   - Method: `executeStep(spell, stepIndex, pipelineContext, originalContext, dependencies)`
   - **CRITICAL**: Use Execution Strategy pattern - NO service-specific conditionals
   - Flow: `tool.executionStrategy || strategyFactory.createDefaultStrategy(tool)` → `strategy.execute()`
   - Dependencies: `{ logger, toolRegistry, workflowsService, internalApiClient, adapterRegistry, strategyFactory, ... }`
   - Uses: `ParameterResolver`, `StrategyFactory`, `GenerationRecordManager`, `EventManager`
   - **Remove all**: `if (tool.deliveryMode === 'immediate')`, `if (typeof adapter.startJob === 'function')`, etc.
5. Create `SpellExecutor.js`:
   - Extract spell-level execution orchestration
   - Method: `execute(spell, context, dependencies)`
   - Uses: `StepExecutor`, `ParameterResolver`
   - Handles context normalization
6. Update `WorkflowExecutionService.js` to use new executors
7. Run comprehensive tests (all tool types, adapters)

**Success Criteria**:
- ✅ All existing tests pass
- ✅ All tool types execute correctly
- ✅ Adapter integration works
- ✅ Parameter resolution works correctly
- ✅ **Execution Strategy pattern implemented** - StepExecutor has NO service-specific conditionals
- ✅ **Code is cleaner** - Single execution path: `strategy.execute()`

**Files to Create**:
- `src/core/services/workflow/execution/ParameterResolver.js`
- `src/core/services/workflow/execution/StepExecutor.js`
- `src/core/services/workflow/execution/SpellExecutor.js`
- `src/core/services/workflow/execution/strategies/ExecutionStrategy.js` (base interface)
- `src/core/services/workflow/execution/strategies/ImmediateStrategy.js`
- `src/core/services/workflow/execution/strategies/AsyncAdapterStrategy.js`
- `src/core/services/workflow/execution/strategies/WebhookStrategy.js`
- `src/core/services/workflow/execution/strategies/StrategyFactory.js`

**Files to Modify**:
- `src/core/services/WorkflowExecutionService.js`

---

### Phase 4: Extract Continuation Services (MEDIUM-HIGH RISK) ⚠️ CRITICAL

**Goal**: Extract step continuation and output processing logic.

**Tasks**:
1. Create `src/core/services/workflow/continuation/` directory
2. Create `OutputProcessor.js`:
   - Extract output extraction, normalization, and mapping logic
   - Methods: `extractOutput()`, `normalizeOutput()`, `mapOutput()`, `buildNextInputs()`
   - Pure functions where possible
   - Must maintain exact output format compatibility
3. Create `PipelineContextBuilder.js`:
   - Extract pipeline context building logic
   - Methods: `buildContext()`, `mergeContexts()`
   - Pure functions where possible
4. Create `StepContinuator.js`:
   - Extract step continuation logic
   - Method: `continue(completedGeneration, dependencies)`
   - Dependencies: `{ logger, internalApiClient, ... }`
   - Uses: `OutputProcessor`, `CastManager`, `PipelineContextBuilder`, `GenerationRecordManager`
   - Must maintain exact idempotency checks
   - Must maintain exact error handling
5. Update `WorkflowExecutionService.js` to use new continuators
6. Run extensive tests (multi-step spells, output mapping, error cases)

**Success Criteria**:
- ✅ All existing tests pass
- ✅ Multi-step spells work correctly
- ✅ Output mapping is correct
- ✅ Pipeline context is correct
- ✅ Error handling works correctly
- ✅ Duplicate prevention works

**Files to Create**:
- `src/core/services/workflow/continuation/OutputProcessor.js`
- `src/core/services/workflow/continuation/PipelineContextBuilder.js`
- `src/core/services/workflow/continuation/StepContinuator.js`

**Files to Modify**:
- `src/core/services/WorkflowExecutionService.js`

---

### Phase 5: Extract Adapter & Notification Services (LOW-MEDIUM RISK)

**Goal**: Extract adapter coordination and notification logic.

**Tasks**:
1. Create `src/core/services/workflow/adapters/` directory
2. Create `src/core/services/workflow/notifications/` directory
3. Create `AsyncJobPoller.js`:
   - Extract async job polling logic
   - Method: `startPolling(runId, generationId, adapter, dependencies)`
   - Dependencies: `{ logger, internalApiClient, ... }`
   - Uses: `GenerationRecordManager`, `EventManager`
4. Create `AdapterCoordinator.js`:
   - Extract adapter coordination logic
   - Methods: `executeWithAdapter()`, `createAsyncJob()`, `handleImmediateTool()`
   - Dependencies: `{ logger, adapterRegistry, ... }`
   - Uses: `AsyncJobPoller`, `GenerationRecordManager`
5. Create `WorkflowNotifier.js`:
   - Extract WebSocket notification logic
   - Methods: `notifyStepProgress()`, `notifyToolResponse()`
   - Dependencies: `{ logger, websocketService }`
6. Update `WorkflowExecutionService.js` to use new services
7. Run tests (async jobs, WebSocket notifications)

**Success Criteria**:
- ✅ All existing tests pass
- ✅ Async job polling works
- ✅ WebSocket notifications work
- ✅ Adapter execution works

**Files to Create**:
- `src/core/services/workflow/adapters/AsyncJobPoller.js`
- `src/core/services/workflow/adapters/AdapterCoordinator.js`
- `src/core/services/workflow/notifications/WorkflowNotifier.js`

**Files to Modify**:
- `src/core/services/WorkflowExecutionService.js`

---

### Phase 6: Refactor to Facade (LOW RISK)

**Goal**: Transform `WorkflowExecutionService` into a thin facade.

**Tasks**:
1. Refactor `WorkflowExecutionService.js`:
   - Keep only public API methods (`execute`, `continueExecution`)
   - Delegate all logic to extracted services
   - Maintain exact method signatures
   - Maintain exact return types
   - Maintain exact error handling
2. Update constructor to initialize all services
3. Remove all old implementation code
4. Update documentation/comments
5. Run full test suite
6. Verify code size reduction (~841 lines → ~100 lines)

**Success Criteria**:
- ✅ All tests pass
- ✅ Code is ~100 lines (main file)
- ✅ Public API unchanged
- ✅ All functionality preserved
- ✅ Documentation updated

**Files to Modify**:
- `src/core/services/WorkflowExecutionService.js`

---

## Critical Requirements

### 1. Backward Compatibility (MANDATORY)
- ✅ Public API methods must have **exact same signatures**
- ✅ Return types must remain **exactly the same**
- ✅ Error handling must remain **exactly the same**
- ✅ Side effects must remain **exactly the same**

### 2. Code Quality
- ✅ Each service should be independently testable
- ✅ Use dependency injection for all dependencies
- ✅ Follow existing code style and patterns
- ✅ Add JSDoc comments for all public methods
- ✅ Keep functions pure where possible

### 3. Testing
- ✅ Run all existing tests after each phase
- ✅ Add unit tests for new services
- ✅ Add integration tests for critical paths
- ✅ Verify no performance regression
- ✅ Verify no increase in error rates

### 4. Documentation
- ✅ Update JSDoc comments
- ✅ Add README.md in `workflow/` directory explaining architecture
- ✅ Document any design decisions or trade-offs

## Testing Checklist

After each phase, verify:

- [ ] All existing unit tests pass
- [ ] All existing integration tests pass
- [ ] Manual spell execution test (cast → execute → complete)
- [ ] Multi-step spell test
- [ ] Error handling test
- [ ] Performance test (no regression)
- [ ] Code coverage maintained or improved

## Rollback Plan

If issues are detected at any phase:

1. **Immediate**: Revert to previous commit
2. **Investigate**: Identify root cause
3. **Fix**: Address issues before continuing
4. **Retest**: Verify fixes before proceeding

## Success Metrics

### Code Quality
- [ ] Main file reduced from 841 lines to ~100 lines
- [ ] Each service file is < 200 lines
- [ ] Code is more maintainable and testable
- [ ] Clear separation of concerns

### Functionality
- [ ] All existing features work
- [ ] No performance regression
- [ ] No increase in error rates
- [ ] All tests pass

### Developer Experience
- [ ] Easier to understand codebase
- [ ] Easier to add new features
- [ ] Easier to fix bugs
- [ ] Better code organization

## Final Deliverables

1. ✅ Refactored code in `src/core/services/workflow/` directory
2. ✅ Updated `WorkflowExecutionService.js` (thin facade)
3. ✅ All tests passing
4. ✅ Documentation updated
5. ✅ README.md in `workflow/` directory
6. ✅ Git commits for each phase (with clear messages)

## Git Commit Strategy

Use clear, descriptive commit messages:

```
Phase 1: Extract utilities (RetryHandler, EventManager, ValidationUtils)
Phase 2: Extract management services (CastManager, GenerationRecordManager, CostAggregator)
Phase 3: Extract execution services (ParameterResolver, StepExecutor, SpellExecutor)
Phase 4: Extract continuation services (OutputProcessor, PipelineContextBuilder, StepContinuator)
Phase 5: Extract adapter and notification services (AsyncJobPoller, AdapterCoordinator, WorkflowNotifier)
Phase 6: Refactor WorkflowExecutionService to thin facade
```

## Questions or Issues?

If you encounter any issues or have questions:
1. Review the documentation files
2. Check the impact analysis for risk areas
3. Verify backward compatibility requirements
4. Test thoroughly before proceeding

## Start Here

1. **Create branch**: `git checkout -b refactor/workflow-execution-service`
2. **Read documentation**: Review all three documentation files
3. **Start Phase 1**: Begin with utilities extraction
4. **Test thoroughly**: After each phase
5. **Commit frequently**: With clear messages

Good luck! 🚀

