## System Overview & Recent Progress

We're continuing to build StationThis, a real-time, creative, cross-platform AI assistant. The primary focus has shifted to user-visible features and iterative, human-reviewed development. User experience is now the main driver for system evolution, prioritizing practical working solutions.

**Core Architecture:**
The system is structured into Core Services (ComfyUI, points, workflows, media, session), Platform-Agnostic Logic (image generation, training, collections, settings), Platform Adapters (Telegram, Discord, Web), an API Layer (internal/external), and Entry Points (main app, Express server).

**Key Strategic Documents:**
- `REFACTOR_GENIUS_PLAN.md`: Guides the overall refactor with a focus on demonstration-first iteration.
- `AGENT_COLLABORATION_PROTOCOL.md`: Defines interaction for agents, emphasizing user supervision and live demos.
- `ADR-003-InternalAPIForNoemaServices.md`: Mandates that all Noema DB access occurs exclusively through a dedicated Internal API layer (`src/api/internal/`) for consistency and security. All seven internal API services are now implemented and tested.
- `ADR-004-Tool_Definition_and_Registry.md`: Establishes a unified `ToolDefinition` format and `ToolRegistry` to manage tools across services and platforms. This registry powers dynamic command generation and UI scaffolding.
- `ADR-005-DEBIT.md`: Implemented a unified debit accounting system. All generation services now trigger a debit via the internal economy API upon successful completion. Webhook processors calculate final costs and issue debits. EXP points are also updated post-debit.
- `ADR-006-SETTINGS.md`: Introduced the `UserSettingsService` and enhanced internal APIs for managing tool parameter preferences. This allows users to customize tool behavior.
- `ADR-007-TELEGRAM-MENU-SETTINGS.md`: A multi-level inline keyboard menu for user settings is live on Telegram (`/settings`), allowing users to manage per-tool preferences.

**Recent Architectural Improvements & Notable Changes:**
- **Internal API Layer:** Fully implemented for all Noema database services (User Core, Sessions, Events, Economy, Transactions, Preferences, Generation Outputs), centralizing data access and enforcing business logic. A comprehensive test script (`scripts/test_internal_api.sh`) verifies all endpoints.
- **Decoupled Notification System (ADR-001):** Implemented. The `webhookProcessor.js` updates generation records, and a separate `NotificationDispatcher.js` handles sending notifications (currently via Telegram) based on these records, improving modularity and resilience.
- **Standardized Debit Accounting (ADR-005):** Generations are now consistently debited from user `usdCredit`. The `webhookProcessor.js` handles cost calculation and triggers debits and EXP updates via the internal API.
- **Tool Definition & Registry (ADR-004):** `ToolRegistry` is integrated with `WorkflowCacheManager` and `WorkflowsService`. Telegram dynamic commands leverage this for registration and execution. Image and text-based ComfyUI tools are functional on Telegram.
- **Telegram Settings Menu (ADR-007):** Users can now manage their tool-specific settings via an interactive menu in Telegram.
- **Cost Rate Calculation:** The system now determines generation cost rates by looking up a deployment's machine and GPU, mapping it to predefined rates, and storing this in the generation record.
- **API Key Authentication:** An external API endpoint (`/api/v1/me/status`) allows users to fetch their status using API key authentication. The internal infrastructure for API key validation is in place.

**Ongoing Efforts & Motivations:**
- **Refactoring Platform Adapters:** Gradually updating platform adapters (Telegram, Discord, Web) and core workflows to use the new internal API endpoints for data access, moving away from direct DB calls.
- **Telegram UI/UX Overhaul for Tool Commands:** The current focus is on improving the Telegram experience for tool commands by adding immediate acknowledgments (reactions) and an enhanced delivery system with options to rate, view info, and tweak/iterate on generations.

**Design Decisions & Coordination:**
- All collaboration artifacts are managed in the `/vibecode/` directory structure (prompts, handoffs, demos, etc.).
- Architectural decisions are documented in ADRs within `vibecode/decisions/`.
- Development emphasizes user checkpoints: "Can you see this working?" before proceeding.
- Handoff documents (`vibecode/handoffs/`) track progress and next steps.
- `usdCredit` is the canonical spendable currency for AI tasks.

**TODOs & Friction Points:**
- Continue refactoring platform adapters and core workflows to use the internal API.
- Implement the planned Telegram UI/UX overhaul (acknowledgments, enhanced delivery).
- Define and implement mechanisms for fetching "most frequently used tools" for the Telegram settings menu.
- Address future considerations like `PointsService.js` refactoring and support for other media types in Telegram commands if needed.
- Update test stubs and enhance test coverage for newly implemented features.
- Consider log refinement and further internal documentation (JSDoc) for recently developed services.
- Plan for Team-based infrastructure and a Job (multi-step toolchain) system, as outlined in `jobs-teams-sprint-plan.md`. This includes `TeamService`, `TeamEconomyService`, `JobDefinitionRegistry`, and `JobOrchestrator`. Database schemas for `teams`, `teamMemberships`, `jobDefinitions`, and `jobRecords` will be added. API handlers and Telegram commands will need to support execution context (user vs. team).

This summary provides a snapshot of our current system state and development trajectory. 