# AGENT COLLABORATION PROTOCOL

## Purpose
To establish strict rules and standards for documentation and communication between AI agents working on the StationThis refactor, ensuring continuity, coherence, and preventing architectural drift.

## Documentation Structure

### 1. Progress Tracking
```
docs/
  progress/
    phase1/
      services_status.md       # Status of each core service
      completed_tasks.md       # Completed migration tasks
      blockers.md              # Current blockers and issues
    phase2/
      ...
```

### 2. Architecture Decision Records (ADRs)
```
docs/
  decisions/
    ADR-001-session-management.md
    ADR-002-workflow-design.md
    ...
```

### 3. Agent Handoff Documents
```
docs/
  handoffs/
    HANDOFF-2023-12-01.md      # State of the system at handoff
```

## Communication Rules

### Before Starting Work
1. **Review Current State**
   - Read latest HANDOFF document
   - Check progress tracking for current phase
   - Review all ADRs

2. **State Intent**
   - Explicitly declare which components will be modified
   - Link to relevant sections of REFACTOR_GENIUS_PLAN.md

### During Development
3. **Document Decisions**
   - Create new ADR for any architectural change
   - Format: `ADR-XXX-brief-description.md`
   - Must include: Context, Decision, Consequences, Alternatives Considered

4. **Update Progress**
   - Update relevant progress tracking documents
   - Mark completed tasks
   - Document any deviations from the plan

### Before Handoff
5. **Create Handoff Document**
   - Summarize work completed
   - List current state of all components
   - Highlight next tasks
   - Note any changes to the original plan

## Architecture Protection Mechanisms

### Boundary Enforcement
1. **Architectural Layers**
   - Services must not import from platforms
   - Workflows must not directly call platform APIs
   - Platform adapters must not contain business logic

2. **Interface Contracts**
   - Document all interfaces between layers
   - Include expected inputs/outputs and error handling

### Progress Validation
1. **Regular Checkpoints**
   - At 25%, 50%, 75% of each phase:
     - Verify alignment with REFACTOR_GENIUS_PLAN.md
     - Check for any unauthorized abstractions
     - Ensure all components follow the layered architecture

2. **Code Migration Standards**
   - Each migrated feature must have:
     - Documentation of original behavior
     - Documentation of new implementation
     - List of changes/improvements
     - Test plan

## File Templates

### ADR Template
```md
# ADR-XXX: Title

## Context
[Describe the problem/opportunity and constraints]

## Decision
[Describe the chosen solution]

## Consequences
[Describe the resulting context after applying the decision]

## Alternatives Considered
[List alternatives and why they were not chosen]
```

### Handoff Template
```md
# HANDOFF: YYYY-MM-DD

## Work Completed
[List completed tasks since last handoff]

## Current State
[Describe the current state of the system]

## Next Tasks
[List the next tasks to be completed]

## Changes to Plan
[Document any deviations from REFACTOR_GENIUS_PLAN.md]

## Open Questions
[List any questions that need to be addressed]
```

## Implementation Guidelines

1. **Start Each Session With**:
   ```
   I've reviewed the current HANDOFF document and will be working on [component].
   This aligns with Phase [X] of the REFACTOR_GENIUS_PLAN.
   ```

2. **End Each Session With**:
   ```
   Work summary:
   - Completed: [list]
   - In progress: [list]
   - Blockers: [list]
   
   I've updated the [progress documents] and created [ADRs if applicable].
   ```

3. **When Changing Direction**:
   ```
   I'm proposing a change to the original plan for [component].
   Rationale: [explanation]
   Impact assessment: [how this affects other components]
   ```

By following this protocol, we will maintain coherence across the refactoring process regardless of which agent is working on which component. 