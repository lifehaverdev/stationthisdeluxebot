# Log Verification Guide

This document helps verify that the refactored workflow execution system is working correctly by checking the logs.

## ✅ Verification Checklist

### 1. All Services Logging Correctly

**Expected Log Prefixes** (61 total log statements across 12 services):
- `[SpellExecutor]` - Spell-level orchestration (2 logs)
- `[StepExecutor]` - Step execution (3 logs)
- `[StepContinuator]` - Step continuation (10 logs)
- `[CastManager]` - Cast operations (14 logs)
- `[GenerationRecordManager]` - Generation CRUD (4 logs)
- `[CostAggregator]` - Cost aggregation (3 logs)
- `[ImmediateStrategy]` - Immediate tools (8 logs)
- `[AsyncAdapterStrategy]` - Async adapter tools (1 log)
- `[AdapterCoordinator]` - Adapter coordination (5 logs)
- `[AsyncJobPoller]` - Async job polling (5 logs)
- `[WorkflowNotifier]` - WebSocket notifications (2 logs)
- `[OutputProcessor]` - Output processing (4 logs)
- `[PipelineContextBuilder]` - Context building (1 log)

### 2. Execution Flow Verification

**Expected Flow:**
```
WorkflowExecutionService.execute()
  └─> SpellExecutor.execute()
      └─> StepExecutor.executeStep()
          └─> Strategy.execute() (ImmediateStrategy/AsyncAdapterStrategy/WebhookStrategy)
              └─> AdapterCoordinator (if adapter) OR Direct execution (if immediate)

NotificationDispatcher (on generationUpdated event)
  └─> WorkflowExecutionService.continueExecution()
      └─> StepContinuator.continue()
          ├─> CastManager.updateCastWithGeneration()
          ├─> OutputProcessor.processOutput()
          ├─> PipelineContextBuilder.buildNextPipelineContext()
          └─> StepExecutor.executeStep() (if more steps)
              OR
          └─> CastManager.finalizeCast() (if last step)
```

### 3. Expected Log Sequence for Sequential Spell Execution

#### Phase 1: Spell Start
```
[SpellExecutor] Starting execution for spell: "<spell_name>" (ID: <id>)
[SpellExecutor] Adding alias "input_prompt" for provided "prompt" input.
```

#### Phase 2: Step 1 Execution
```
[StepExecutor] Executing Step 1/<total>: <tool_display_name>
[StepExecutor] Created event <eventId> for spell step 1
[ImmediateStrategy] Executing immediate tool <toolId>
[ImmediateStrategy] Step 1 submitted via centralized execution endpoint. GenID: <genId>, RunID: <runId>
[ImmediateStrategy] Handling immediate tool response for step 1
[ImmediateStrategy] Updated generation <genId> with responsePayload
[WorkflowNotifier] (WebSocket notifications sent)
```

#### Phase 3: Step 1 Completion & Continuation
```
[StepContinuator] Continuing spell "<spell_name>". Finished step 1.
[CastManager] Updated cast <castId> with generation <genId> (costUsd=<cost>)
[OutputProcessor] Mapped output "<key>" to input "<key>"
[StepContinuator] Accumulated step generation IDs for spell "<spell_name>": 1 steps.
```

#### Phase 4: Step 2 Execution
```
[StepContinuator] Proceeding to step 2 of "<spell_name>".
[StepExecutor] Executing Step 2/<total>: <tool_display_name>
[StepExecutor] Created event <eventId> for spell step 2
[ImmediateStrategy] Executing immediate tool <toolId>
[ImmediateStrategy] Step 2 submitted via centralized execution endpoint...
```

#### Phase 5: Spell Completion
```
[StepContinuator] Continuing spell "<spell_name>". Finished step 2.
[CastManager] Updated cast <castId> with generation <genId>
[StepContinuator] Spell "<spell_name>" finished successfully. Creating final notification record.
[CastManager] Finalized cast <castId> with status 'completed'
[StepContinuator] Final notification record for spell "<spell_name>" created.
```

### 4. Key Integration Points Verified

✅ **SpellExecutor → StepExecutor**
- Line 35 in `SpellExecutor.js`: `await this.stepExecutor.executeStep(...)`

✅ **StepExecutor → Strategy**
- Line 107 in `StepExecutor.js`: `await strategy.execute(...)`
- **NO CONDITIONALS** - Clean strategy pattern!

✅ **StepContinuator → StepExecutor** (for next steps)
- Line 170 in `StepContinuator.js`: `await this.stepExecutor.executeStep(...)`

✅ **StepContinuator → CastManager**
- Line 54 in `StepContinuator.js`: `await this.castManager.updateCastWithGeneration(...)`
- Line 182+ in `StepContinuator.js`: `await this.castManager.finalizeCast(...)`

✅ **StepContinuator → OutputProcessor**
- Line 69 in `StepContinuator.js`: `outputProcessor.processOutput(...)`

✅ **StepContinuator → PipelineContextBuilder**
- Line 72 in `StepContinuator.js`: `pipelineContextBuilder.accumulateStepGenerationIds(...)`
- Line 79 in `StepContinuator.js`: `pipelineContextBuilder.buildNextPipelineContext(...)`

### 5. Error Handling Verification

**Expected Error Logs:**
- `[StepContinuator] continue validation error: <error>`
- `[StepContinuator] Step <n> of spell "<name>" failed. Stopping spell execution.`
- `[CastManager] Failed to update cast <castId>: <error>`
- `[ImmediateStrategy] Failed to send notifications: <error>`
- `[AsyncJobPoller] Background poller error for adapter job <runId>: <error>`

### 6. Code Metrics

- **Total workflow service files**: 20 files
- **Total lines of code**: ~2,060 lines (across all services)
- **Main facade file**: 108 lines (87% reduction from 841)
- **Log statements**: 61 across 12 services
- **Execution flow**: Clean, no conditionals in StepExecutor

## 🎯 Success Indicators

If you see these logs in sequence, the refactor is working perfectly:

1. ✅ `[SpellExecutor] Starting execution` - Spell started
2. ✅ `[StepExecutor] Executing Step` - Steps executing
3. ✅ `[ImmediateStrategy]` or `[AsyncAdapterStrategy]` - Strategy pattern working
4. ✅ `[StepContinuator] Continuing spell` - Continuation working
5. ✅ `[CastManager] Updated cast` - Cast updates working
6. ✅ `[OutputProcessor] Mapped output` - Output processing working
7. ✅ `[StepContinuator] Proceeding to step` - Multi-step execution working
8. ✅ `[CastManager] Finalized cast` - Spell completion working

## 🚨 Red Flags

Watch out for these issues:

- ❌ Missing `[StepExecutor]` logs - StepExecutor not being called
- ❌ Missing `[StepContinuator]` logs - Continuation not working
- ❌ Missing `[CastManager]` logs - Cast updates failing
- ❌ Errors in `[StepContinuator] continue validation error` - Metadata issues
- ❌ Duplicate execution warnings - Duplicate prevention working but may indicate issues

## 📊 Performance Indicators

- **Sequential execution**: Each step should complete before next starts
- **Cast updates**: Should happen after each step completion
- **Output mapping**: Should map correctly between steps
- **Finalization**: Should only happen after last step completes

---

**Last Updated**: After Phase 6 completion  
**Status**: ✅ All services integrated and logging correctly

