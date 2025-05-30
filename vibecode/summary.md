## System Overview & Recent Progress

We're continuing to build StationThis, a real-time, creative, cross-platform AI assistant. The primary focus remains on user-visible features and iterative, human-reviewed development. User experience is the main driver for system evolution, prioritizing practical working solutions over perfect abstractions.

The system architecture is layered: Core Services (ComfyUI, points, workflows, media, session), Platform-Agnostic Logic (image generation, training, collections, settings), Platform Adapters (Telegram, Discord, Web), an API Layer (internal/external), and Entry Points.

Key strategic documents like `REFACTOR_GENIUS_PLAN.md` guide our demonstration-first iteration, while `AGENT_COLLABORATION_PROTOCOL.md` defines how we (humans and agents) work together, emphasizing user supervision and live demos. The `REFACTOR_NORTH_STAR.md` keeps our sights on a web application with multi-platform AI generation capabilities, revenue generation, and an interactive canvas-based UI.

A major architectural decision (ADR-003) mandates that all Noema database access (for User Core, Sessions, Events, Economy, Transactions, Preferences, Generation Outputs) occurs exclusively through a dedicated Internal API layer (`src/api/internal/`). This layer is fully implemented, with all seven services accessible via RESTful endpoints, and a comprehensive test script (`scripts/test_internal_api.sh`) verifies them. This centralization ensures consistency, security, and maintainability.

We've established a unified `ToolDefinition` format and a `ToolRegistry` (ADR-004) to manage tools (like ComfyUI workflows) across services and platforms. This registry powers dynamic command generation, UI scaffolding for settings, and helps with cost tracking. The `ToolDefinition` includes details like `toolId`, `service`, `inputSchema`, `costingModel`, and `platformHints`.

A standardized debit accounting system (ADR-005) is in place. All generation services now trigger a debit via the internal economy API (`POST /internal/v1/data/users/:masterAccountId/economy/debit`) upon successful completion. The `webhookProcessor.js` calculates final costs, updates generation records, and then issues these debit requests. `usdCredit` is the canonical currency for AI tasks. EXP points are also updated post-debit.

We've introduced `UserSettingsService` and enhanced internal APIs for managing tool parameter preferences (ADR-006). Users can customize default parameters for each tool. The internal API now supports fetching a tool's `inputSchema` (`GET /internal/v1/data/tools/:toolId/input-schema`), listing a user's used tools, and deleting preferences for a specific tool. Platform adapters are responsible for merging user input, user preferences, and tool defaults.

On Telegram, a multi-level inline keyboard menu for user settings (`/settings`) is live (ADR-007). This allows users to navigate through their most frequently used tools or all tools, view tool descriptions, and edit specific input parameters. The bot waits for a user's reply to update a parameter, validates it, saves it via `UserSettingsService`, and navigates back.

A decoupled notification system (ADR-001) has been implemented. `webhookProcessor.js` updates generation records, and a separate `NotificationDispatcher.js` (monitoring `generationRecord`s ready for notification) handles sending notifications (currently via Telegram), improving modularity. The `generationRecord` now tracks notification platform, context, and delivery status.

The Telegram delivery menu for generations has been enhanced (ADR-008, status: Implemented). It now includes options to rate (usable by any user in a group), hide the menu, view generation info (parameters), tweak parameters (directing to a pre-filled settings menu), and rerun the generation with a new seed. The rerun button (`↻`) on each message interactively displays a press count, updating its own `callback_data` and text, while the overall rerun lineage is tracked in generation metadata. Debugging for `rerun_gen` callback issues was recently completed, as noted in the `HANDOFF-2025-05-28` document.

Cost rate calculation for generations is now more robust: the system determines rates by looking up a deployment's machine and GPU, mapping to predefined rates, and storing this in the `generationRecord`.

API key authentication is functional, with an external endpoint (`/api/v1/me/status`) allowing users to fetch their status.

Ongoing efforts include continuing to refactor platform adapters and core workflows to consistently use the new internal API endpoints for all Noema data access, moving away from direct DB calls.

The Telegram UI/UX for tool commands is a key focus, emphasizing immediate acknowledgments (reactions) and the enhanced delivery menu mentioned above.

Design decisions and coordination rely on artifacts in `/vibecode/` (prompts, handoffs, demos, ADRs in `/vibecode/decisions/`). Development prioritizes user checkpoints: "Can you see this working?"

Future plans, as outlined in `jobs-teams-sprint-plan.md`, involve introducing Team-based infrastructure and a Job (multi-step toolchain) system. This will include new services like `TeamService`, `TeamEconomyService`, `JobDefinitionRegistry`, and `JobOrchestrator`. Database schemas for `teams`, `teamMemberships`, `jobDefinitions`, and `jobRecords` will be added. API handlers and Telegram commands will need to support an execution context (user vs. team), and debit logic will be updated to handle team balances. The `ToolDefinition` will also get a more structured `outputSchema` to support job input/output mapping.

One thing to note is the need to define and implement mechanisms for fetching "most frequently used tools" for the Telegram `/settings` menu. We also need to ensure the Telegram notifier correctly initializes the rerun button callback data with a count of 0 for new generation messages. Test stubs and coverage for new features should be updated. Log refinement and further JSDoc for recent services are also good points to remember.

This summary provides a snapshot of our current system state and development trajectory. 