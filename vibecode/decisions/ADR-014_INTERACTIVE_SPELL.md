# ADR-014: Interactive Spell Execution with User Input

## Context
**Date:** 2025-06-17

Currently, Spells are executed as a non-interactive, "fire-and-forget" sequence of tool steps. The entire context for the spell must be provided in the initial `/cast` command. This limits the complexity and creative potential of spells, as they cannot adapt or be guided by the user mid-execution. For example, a user cannot run a text-to-image step and then provide a new prompt for a subsequent image-to-image step within the same spell. The workflow is entirely static once initiated.

## Decision
We will enhance the spell system to allow for dynamic user input during execution. This will be achieved by introducing a new, special step type and enhancing the `WorkflowExecutionService` to manage an interactive, stateful process.

1.  **New `UserInput` Step Type:**
    *   A new step type, `userInput`, will be added to the spell schema.
    *   This step will be defined by two key properties:
        *   `prompt`: A string containing the question that will be asked to the user (e.g., "What background should the character have?").
        *   `targetParameter`: The name of the input parameter this step will populate for subsequent steps (e.g., `input_background_prompt`).

2.  **Updated `WorkflowExecutionService` Logic:**
    *   **Scan-Ahead Execution:** When a spell is cast, the `WorkflowExecutionService` will first scan the entire list of steps. It will identify all `userInput` steps and all tool steps.
    *   **Concurrent Operations:** The service will initiate two processes in parallel:
        *   **User Interaction:** It will immediately send all prompts from the `userInput` steps to the user via the appropriate platform adapter (e.g., Telegram). It will use the `ReplyContextManager` to listen for replies to these specific prompt messages.
        *   **Independent Step Execution:** Simultaneously, it will begin executing any initial tool steps that do not depend on outputs from the pending user inputs.
    *   **Stateful Pause & Resume:** The workflow execution will be stateful. If the execution reaches a tool step that requires a parameter targeted by a pending `userInput` step, the workflow for that branch will pause. As the user replies, the `WorkflowExecutionService` will be notified, it will populate the `targetParameter` with the user's response, and any paused steps waiting for that specific parameter will be un-paused and executed.

## Consequences

*   **Positive:**
    *   Spells become dramatically more powerful, enabling complex, guided, multi-stage creative workflows.
    *   The user experience is significantly improved by asking all necessary questions upfront and reducing total wait time by running independent tool steps concurrently.
    *   This design reuses and extends existing architecture (`WorkflowExecutionService`, `ReplyContextManager`) rather than requiring a fundamental rewrite.
    *   The `UserInput` step type is explicit and clear, making spells easy to read and debug.

*   **Negative / Systemic Impact:**
    *   The `WorkflowExecutionService` will increase in complexity, as it must now manage state, dependencies, and concurrent operations for each spell execution.
    *   We will need to implement a timeout mechanism. What happens if a user is prompted but never replies? The workflow cannot be left in a pending state indefinitely.
    *   The spell creation UI (`spellMenuManager.js`) must be updated to allow users to add and configure these new `userInput` steps.
    *   The database schema (`spellsDb.js`) and the internal API (`spellsApi.js`) must be updated to recognize and store this new step type.

## Alternatives Considered

1.  **Strictly Sequential Execution:** The initial idea was to pause the entire workflow at each `userInput` step and wait for a reply before continuing. This was rejected because it provides a slower, less efficient user experience (one question at a time) and fails to leverage the opportunity for parallel processing.
2.  **Implicit Input via Placeholders:** We considered a system where a user could put a placeholder like `{{user_input_1}}` in a tool's parameter field. The executor would then have to parse these and prompt the user. This was rejected because it is less explicit and makes the spell definition harder to read and validate. A dedicated step type is cleaner and more robust.