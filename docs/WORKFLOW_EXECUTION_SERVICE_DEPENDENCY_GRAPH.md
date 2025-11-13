# WorkflowExecutionService Dependency Graph

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Entry Point                   │
│                  (src/core/services/index.js)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ Creates & Injects
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            WorkflowExecutionService (841 lines)             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Public API:                                           │  │
│  │  • execute(spell, context)                            │  │
│  │  • continueExecution(completedGeneration)            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Internal Responsibilities:                                  │
│  • Spell execution orchestration                             │
│  • Step execution                                           │
│  • Parameter resolution                                     │
│  • Output processing                                        │
│  • Cast management                                          │
│  • Generation record management                             │
│  • Cost aggregation                                        │
│  • Adapter coordination                                     │
│  • Async job polling                                        │
│  • WebSocket notifications                                  │
│  • Event creation                                           │
│  • Retry logic                                             │
│  • Validation                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ SpellsService │  │Notification   │  │ Internal API  │
│               │  │Dispatcher     │  │ Services      │
└───────┬───────┘  └───────┬───────┘  └───────────────┘
        │                  │
        │ Calls            │ Calls
        │ execute()        │ continueExecution()
        │                  │
        ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Spell Execution Flow                      │
└─────────────────────────────────────────────────────────────┘
```

## Direct Dependencies (What WorkflowExecutionService Uses)

```
WorkflowExecutionService
│
├─── internalApiClient (CRITICAL)
│    ├── POST /internal/v1/data/events
│    ├── POST /internal/v1/data/generations
│    ├── PUT /internal/v1/data/generations/:id
│    ├── GET /internal/v1/data/generations/:id
│    ├── GET /internal/v1/data/generations?_id_in=...
│    ├── POST /internal/v1/data/execute
│    ├── GET /internal/v1/data/spells/casts/:id
│    └── PUT /internal/v1/data/spells/casts/:id
│
├─── toolRegistry
│    ├── findByDisplayName()
│    └── getToolById()
│
├─── workflowsService
│    └── prepareToolRunPayload()
│
├─── adapterRegistry (via require)
│    ├── get(serviceName)
│    └── Adapter methods: startJob(), pollJob(), execute()
│
├─── websocketService (via require)
│    └── sendToUser()
│
└─── notificationEvents (via require)
     └── emit('generationUpdated', record)
```

## Call Graph

```
User Request
    │
    ▼
┌─────────────────┐
│  SpellsService   │
│  .castSpell()    │
└────────┬─────────┘
         │
         │ 1. execute(spell, context)
         ▼
┌─────────────────────────────┐
│ WorkflowExecutionService    │
│ .execute()                  │
│                             │
│  • Validates spell          │
│  • Creates event            │
│  • Executes step 0          │
│  • Creates generation       │
│  • Triggers tool execution  │
└────────┬────────────────────┘
         │
         │ Tool execution completes
         │ → Emits 'generationUpdated' event
         │
         ▼
┌─────────────────────────────┐
│ NotificationDispatcher       │
│ ._handleSpellStep()          │
└────────┬────────────────────┘
         │
         │ 2. continueExecution(record)
         ▼
┌─────────────────────────────┐
│ WorkflowExecutionService    │
│ .continueExecution()         │
│                             │
│  • Processes output         │
│  • Updates cast             │
│  • Executes next step       │
│  • OR finalizes spell        │
└─────────────────────────────┘
```

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│            WorkflowExecutionService (Facade)                │
│                      (~100 lines)                           │
│                                                              │
│  Public API (unchanged):                                     │
│  • execute(spell, context)                                   │
│  • continueExecution(completedGeneration)                    │
└───────────┬─────────────────────────────────────────────────┘
            │
            │ Delegates to
            │
    ┌───────┴───────┬───────────────┬───────────────┐
    │               │               │               │
    ▼               ▼               ▼               ▼
┌─────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
│Execution│  │Continuation  │  │Management│  │ Adapters │
│Services │  │  Services    │  │ Services │  │          │
└─────────┘  └──────────────┘  └──────────┘  └──────────┘
```

## Detailed Proposed Structure

```
WorkflowExecutionService (Facade)
│
├─── execution/
│    ├── SpellExecutor
│    │    └── Uses: StepExecutor, ParameterResolver
│    │
│    ├── StepExecutor
│    │    └── Uses: ParameterResolver, AdapterCoordinator,
│    │              GenerationRecordManager, EventManager
│    │
│    └── ParameterResolver
│         └── Uses: ValidationUtils
│
├─── continuation/
│    ├── StepContinuator
│    │    └── Uses: OutputProcessor, CastManager,
│    │              PipelineContextBuilder, GenerationRecordManager
│    │
│    ├── OutputProcessor
│    │    └── Standalone (pure functions)
│    │
│    └── PipelineContextBuilder
│         └── Standalone (pure functions)
│
├─── management/
│    ├── CastManager
│    │    └── Uses: RetryHandler, internalApiClient
│    │
│    ├── GenerationRecordManager
│    │    └── Uses: RetryHandler, internalApiClient
│    │
│    └── CostAggregator
│         └── Uses: internalApiClient
│
├─── adapters/
│    ├── AdapterCoordinator
│    │    └── Uses: AsyncJobPoller, GenerationRecordManager
│    │
│    └── AsyncJobPoller
│         └── Uses: GenerationRecordManager, EventManager
│
├─── notifications/
│    └── WorkflowNotifier
│         └── Uses: websocketService
│
└─── utils/
     ├── EventManager
     │    └── Uses: internalApiClient
     │
     ├── RetryHandler
     │    └── Standalone (pure functions)
     │
     └── ValidationUtils
          └── Standalone (pure functions)
```

## Impact Visualization

### Files That Will Change

```
Current:
  src/core/services/
    └── WorkflowExecutionService.js (841 lines)

After Refactor:
  src/core/services/
    ├── WorkflowExecutionService.js (100 lines - facade)
    └── workflow/
        ├── execution/ (3 files, ~450 lines)
        ├── continuation/ (3 files, ~350 lines)
        ├── management/ (3 files, ~350 lines)
        ├── adapters/ (2 files, ~250 lines)
        ├── notifications/ (1 file, ~80 lines)
        └── utils/ (3 files, ~200 lines)
```

### External Dependencies (Unchanged)

```
WorkflowExecutionService
    │
    ├─── Still uses: internalApiClient
    ├─── Still uses: toolRegistry
    ├─── Still uses: workflowsService
    ├─── Still uses: adapterRegistry
    ├─── Still uses: websocketService
    └─── Still uses: notificationEvents
```

### Callers (Unchanged)

```
SpellsService
    │
    └─── Still calls: workflowExecutionService.execute()

NotificationDispatcher
    │
    └─── Still calls: workflowExecutionService.continueExecution()
```

## Risk Zones

### 🔴 High Risk (Must Test Thoroughly)
- Step continuation logic (critical path)
- Output processing and mapping
- Cast and generation record updates
- Error handling and retry logic

### 🟡 Medium Risk (Test Well)
- Parameter resolution
- Tool execution
- Adapter coordination
- Cost aggregation

### 🟢 Low Risk (Standard Testing)
- Utility functions (retry, validation, events)
- WebSocket notifications
- Event creation

## Migration Path Visualization

```
Phase 1: Extract Utils
  [WorkflowExecutionService] ──┐
                                ├──> [RetryHandler]
                                ├──> [EventManager]
                                └──> [ValidationUtils]

Phase 2: Extract Management
  [WorkflowExecutionService] ──┐
                                ├──> [CastManager]
                                ├──> [GenerationRecordManager]
                                └──> [CostAggregator]

Phase 3: Extract Execution
  [WorkflowExecutionService] ──┐
                                ├──> [SpellExecutor]
                                ├──> [StepExecutor]
                                └──> [ParameterResolver]

Phase 4: Extract Continuation
  [WorkflowExecutionService] ──┐
                                ├──> [StepContinuator]
                                ├──> [OutputProcessor]
                                └──> [PipelineContextBuilder]

Phase 5: Extract Adapters/Notifications
  [WorkflowExecutionService] ──┐
                                ├──> [AdapterCoordinator]
                                ├──> [AsyncJobPoller]
                                └──> [WorkflowNotifier]

Phase 6: Refactor to Facade
  [WorkflowExecutionService] ──> Thin facade delegating to all services
```

