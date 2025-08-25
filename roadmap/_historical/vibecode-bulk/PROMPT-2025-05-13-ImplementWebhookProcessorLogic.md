> Imported from vibecode/bulk/prompts/PROMPT-2025-05-13-ImplementWebhookProcessorLogic.md on 2025-08-21

## Agent Task: Implement ComfyDeploy Webhook Business Logic

**Objective:** Complete the implementation of the ComfyDeploy webhook handler by integrating live API calls and user notifications within `src/core/services/comfydeploy/webhookProcessor.js`.

**Current Status & Context:**

1.  **Review Core Documents:**
    *   Familiarize yourself with the overall project direction: `REFACTOR_GENIUS_PLAN.md` and `REFACTOR_NORTH_STAR.md`.
    *   Understand the agent collaboration process: `AGENT_COLLABORATION_PROTOCOL.md`.

2.  **Latest Handoff - Your Primary Guide:**
    *   **Thoroughly review: `vibecode/handoffs/HANDOFF-2025-05-13-WebhookReceptionRefactor.md`**. This document contains:
        *   A summary of work completed to successfully receive and route ComfyDeploy webhooks.
        *   The current state, confirming that webhooks are being received by `webhookProcessor.js`.
        *   **Crucially, a detailed "Next Tasks" section that you will be implementing.**
        *   Answers to previous open questions regarding duration calculation and API partial updates.
        *   A demonstration of the current working state (webhook reception and initial parsing).

3.  **Key File to Modify:**
    *   `src/core/services/comfydeploy/webhookProcessor.js`: This is where all your work will be focused. It currently simulates API calls and notifications.

4.  **Supporting Files (for context and dependency integration):**
    *   `src/platforms/web/routes/index.js`: Shows how `webhookProcessor.js` is called and where dependencies (like `internalApiClient`, `telegramNotifier`, `logger`) will be passed from (originating from the `services` object).
    *   `src/api/internal/generationOutputsApi.js`: Provides context on how the internal API for updating generation records (`PUT /generations/:generationId`) behaves (supports partial updates).
    *   `src/core/services/db/generationOutputsDb.js` and `src/core/services/db/BaseDB.js`: Confirm the database layer's handling of updates (wraps payload in `$set`).

**Your Task - Implement "Next Tasks" from the Handoff Document:**

Your primary goal is to work through the "Next Tasks" section of `vibecode/handoffs/HANDOFF-2025-05-13-WebhookReceptionRefactor.md`. This involves:

1.  **Integrate Dependencies into `webhookProcessor.js`:**
    *   Modify `src/platforms/web/routes/index.js` to correctly pass the live `internalApiClient`, `telegramNotifier` service, and the application's standard `logger` (all available via the `services` object) into the `processComfyDeployWebhook` function.
    *   Update `webhookProcessor.js` to expect and use these live dependencies instead of `null` or `console`.

2.  **Implement "Real" Generation Record Update Logic:**
    *   Replace the simulation comments in `webhookProcessor.js` with actual calls to `internalApiClient.get(...)` to fetch the generation record by `run_id`.
    *   Extract necessary data (`generationId`, `costRate`, `telegramChatId`) from the fetched record.
    *   The `costUsd` calculation logic (based on `startTime` from the first "running" webhook and `finalEventTimestamp` from the "success" webhook) is already partially in place; ensure it uses the live `costRate` and handles potential missing data gracefully.
    *   Replace the simulation with actual calls to `internalApiClient.put(...)` to update the generation record with status, outputs, and the calculated `costUsd`.

3.  **Implement "Real" User Notification Logic:**
    *   Replace the simulation with actual calls to the `telegramNotifier` service to send messages to the user based on success (with image URL) or failure (with reason).

4.  **Implement Robust Error Handling:**
    *   Wrap all external calls (to `internalApiClient` and `telegramNotifier`) in `try...catch` blocks.
    *   Log errors comprehensively using the passed-in `logger`.
    *   Make sensible decisions on how to proceed if an error occurs (e.g., if updating the database fails, should a user notification still be attempted?).

**Agent Collaboration Protocol Reminders:**

*   **Ask for Clarification:** If any part of the handoff or these tasks is unclear, ask the user before proceeding.
*   **Demonstrate Progress:** Once you have a piece of functionality working (e.g., successfully fetching the generation record, then successfully updating it, then successfully sending a notification), aim to demonstrate this if possible (e.g., by showing logs of a full successful run, or by having the user trigger a command and receive the final Telegram notification).
*   **Iterate with User:** If issues arise, work with the user to resolve them.
*   **Update Handoff:** Upon completion of these tasks, or if you need to pause, create a new handoff document detailing your work, the current state, any new open questions, and a demonstration of the implemented functionality.

**Focus on completing the lifecycle within `webhookProcessor.js` as per the detailed "Next Tasks" in the handoff.** 