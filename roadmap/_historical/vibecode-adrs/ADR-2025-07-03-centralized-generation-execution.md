> Imported from vibecode/decisions/adr/ADR-2025-07-03-centralized-generation-execution.md on 2025-08-21

# ADR-2025-07-03: Centralized Generation Execution Endpoint

## Context

Currently, generation execution logic (for image, video, text, and other generative tasks) is duplicated across multiple parts of the codebase:
- Dynamic command handlers (e.g., Telegram)
- Workflow and spell execution services
- External API endpoints

Each consumer is responsible for:
1. Creating a generation record in the database
2. Submitting a job to the appropriate backend service (e.g., ComfyUI, OpenAI)
3. Updating the record with run IDs, status, and results

This distributed approach leads to:
- Duplicated and inconsistent logic
- Increased maintenance burden
- Difficulty in adding new tool types or backend services
- Inconsistent error handling and auditing

Additionally, the current `ToolDefinition` structure does not provide enough metadata to fully automate execution routing for all tool types (e.g., ComfyUI, OpenAI/ChatGPT, future third-party APIs).

## Decision

We will create a single internal API endpoint (e.g., `/internal/v1/execute`) that:
- Accepts a canonical generation execution request (including toolId, inputs, user/session/event context, etc.)
- Handles all record creation, job submission (to ComfyUI, OpenAI, etc.), and record updates
- Returns a unified response (generationId, status, etc.)

All consumers (dynamic commands, workflow engine, external API, etc.) will be refactored to use this endpoint for generation execution.

We will also:
- Extend `ToolDefinition` to include execution metadata (e.g., service type, API path, execution strategy) to support routing in the new endpoint
- Design the endpoint to be extensible for future backend services and tool types

## Consequences

**Pros:**
- Single source of truth for generation execution
- Easier to add new tool types and backend services
- Consistent auditing, error handling, and extensibility
- Reduced maintenance burden and code duplication

**Cons:**
- Requires significant refactor of all current consumers
- Must design a flexible execution contract to support all tool types
- Transitional period may require supporting both old and new pathways

## Alternatives Considered

**Status Quo:**
- Continue with distributed, duplicated logic
- Rejected due to maintainability and extensibility issues

**Partial Centralization:**
- Only centralize ComfyUI execution, leave others as-is
- Rejected for lack of long-term flexibility and consistency

## Open Questions
- What is the minimal contract for a generation execution request?
- How should the new endpoint handle tool-specific logic (e.g., ComfyUI vs. OpenAI)?
- How do we support future tool types and third-party APIs?
- How do we ensure backward compatibility during the transition?
- What changes are required for `ToolDefinition` to support this model?

## Next Steps
1. Map out all tool types and their execution requirements
2. Define a canonical execution contract (inputs, outputs, context, error handling)
3. Design the new internal endpoint and its routing logic
4. Plan the refactor for all consumers to use the new endpoint
5. Update `ToolDefinition` to support the new execution model 