# Agent Prompt: WorkflowExecutionService Refactor

## Your Mission

Refactor `src/core/services/WorkflowExecutionService.js` (841 lines) into a well-organized, maintainable service architecture. This is a critical refactor that must maintain 100% backward compatibility.

## First Steps

1. **Create branch**: `git checkout -b refactor/workflow-execution-service`
2. **Read these docs** (in order):
   - `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_IMPACT_ANALYSIS.md`
   - `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_DEPENDENCY_GRAPH.md`
   - `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_SUMMARY.md`
   - `docs/WORKFLOW_EXECUTION_SERVICE_REFACTOR_PROMPT.md` (detailed execution plan)

## Critical Constraints

⚠️ **MANDATORY**: Maintain 100% backward compatibility
- Public API: Only 2 methods (`execute`, `continueExecution`)
- Callers: `SpellsService.js` and `notificationDispatcher.js`
- **DO NOT** change method signatures, return types, or error handling

## Execution Plan (6 Phases)

Execute phases sequentially. Test thoroughly after each phase before proceeding.

### Phase 1: Extract Utilities (LOW RISK)
**Create**: `src/core/services/workflow/utils/`
- `RetryHandler.js` - Retry logic with exponential backoff
- `EventManager.js` - Event creation
- `ValidationUtils.js` - Validation functions

**Test**: All existing tests must pass

### Phase 2: Extract Management Services (LOW-MEDIUM RISK)
**Create**: `src/core/services/workflow/management/`
- `CastManager.js` - Cast record management
- `GenerationRecordManager.js` - Generation record CRUD
- `CostAggregator.js` - Cost aggregation

**Test**: Verify database operations work correctly

### Phase 3: Extract Execution Services (MEDIUM RISK)
**Create**: `src/core/services/workflow/execution/`
- `ParameterResolver.js` - Parameter mapping/resolution
- `StepExecutor.js` - Individual step execution
- `SpellExecutor.js` - Spell-level orchestration

**Test**: Verify all tool types execute correctly

### Phase 4: Extract Continuation Services (MEDIUM-HIGH RISK) ⚠️ CRITICAL
**Create**: `src/core/services/workflow/continuation/`
- `OutputProcessor.js` - Output extraction/normalization/mapping
- `PipelineContextBuilder.js` - Pipeline context building
- `StepContinuator.js` - Step continuation logic

**Test**: Extensive testing - multi-step spells, output mapping, error handling

### Phase 5: Extract Adapter & Notification Services (LOW-MEDIUM RISK)
**Create**: `src/core/services/workflow/adapters/` and `notifications/`
- `AsyncJobPoller.js` - Async job polling
- `AdapterCoordinator.js` - Adapter coordination
- `WorkflowNotifier.js` - WebSocket notifications

**Test**: Verify async jobs and notifications work

### Phase 6: Refactor to Facade (LOW RISK)
**Modify**: `WorkflowExecutionService.js`
- Transform to thin facade (~100 lines)
- Delegate all logic to extracted services
- Maintain exact public API

**Test**: Full test suite, verify code size reduction

## Success Criteria

After completion:
- ✅ All existing tests pass
- ✅ Main file reduced from 841 to ~100 lines
- ✅ Public API unchanged
- ✅ All functionality preserved
- ✅ Code is more maintainable and testable

## Testing Requirements

After **each phase**:
1. Run all existing tests
2. Manual test: Cast spell → execute → complete
3. Verify no performance regression
4. Verify no increase in error rates

## Git Strategy

- Commit after each phase with clear messages
- Example: `git commit -m "Phase 1: Extract utilities (RetryHandler, EventManager, ValidationUtils)"`

## If You Get Stuck

1. Review the impact analysis for risk areas
2. Check the dependency graph for relationships
3. Verify backward compatibility requirements
4. Test incrementally and frequently

## Start Now

Begin with Phase 1. Read the detailed prompt document for specific implementation details.

**Good luck!** 🚀

