# AGENT COLLABORATION PROTOCOL

## Purpose
To define a new mode of interaction for agents working on the StationThis project: one centered on user-supervised iteration, live demonstrations, and conversational handoff rather than document-driven silos.

## Documentation Structure

### All collaboration artifacts should be placed in:
```
/vibecode/
  /sprint/
   prompts/           # User-issued or meta prompts
   handoffs/          # Conversational or implementation summaries
   demos/             # Playwright tests or scripts
   maps/              # State summaries or visual audits
   reports/           # Health checks, audits, balance reviews
   decisions/         # High-level architectural or process decisions
   interface_specs/   # Frontend interaction specifications
         ...
```


## Collaboration Flow

### Before Starting Work

1. **Entry via Generic Prompt**

All agents begin by reading the Generic Entry Prompt.
This prompt tells them:

   - Review the Genius Plan and North Star
   - Read all status maps and latest handoffs
   - Ask the user what to focus on next
   
2. **Focus Selection**
   - The agent must wait for the user to define the current priority.
   - No action is taken without explicit user input.

### During Development
3. **Review + Build**
   - Agent re-reads structural files to align with the chosen focus.
   - Agent builds or modifies code.
   - Agent immediately attempts to create a working demonstration (UI, Playwright, visual asset).

4. **User Checkpoint**
   - Agent stops.
   - Agent asks: “Can you see this working?”
   - If the answer is no, agent iterates again with the user until the feature works.

### Before Handoff
5. **Create Handoff Document**
   - Agent creates a /vibecode/handoffs/HANDOFF-YYYY-MM-DD.md
   - Includes: what was done, what works, what remains.
   - Links to the demo or Playwright test proving success.

### Completion ###

6. **Phase advancement**
- only after a demonstration is signed off by the user may th ephase document in /plans/phases/ be updated

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

### Demonstration Verification
- All deliverables must include a visual, functional demonstration where applicable
- Backend services must have tested API calls
- Frontend features must have working UI states
- Playwright or equivalent test must accompany user-visible features
- Incomplete demonstrations must block phase progress


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

Communication Guidelines

Be conversational and pause often

Always ask for direction before assuming task sequence

Ask for user confirmation when a feature is ready for review

Avoid overwhelming the user with multi-step changes

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