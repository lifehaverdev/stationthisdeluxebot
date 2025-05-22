We're building StationThis, a cross-platform AI assistant for creative tasks, prioritizing user experience and real-time, demonstrable features over perfect abstractions. The system is moving from a foundational infrastructure focus to a demonstration-first, human-reviewed iteration cycle.

Core architecture includes:
- Core Services (`src/core/services/`): Manages ComfyUI, points, workflows, media, sessions, user settings, and DB interactions. `ToolRegistry` is central for defining tools.
- Platform-Agnostic Logic (`src/workflows/`): Handles workflows like image generation and model training.
- Platform Adapters (`src/platforms/`): Interfaces for Telegram, Discord, and Web, each with their own command handlers and renderers.
- API Layer (`src/api/`): Internal APIs for inter-service communication and external APIs.
- Entry Points: Main application entry at `src/index.js` and Express server at `src/server.js`. `app.js` handles initialization.

Recent architectural improvements focus on user-facing features and robust backend services. The `UserSettingsService` allows per-tool, per-user preference settings, resolving previous authentication issues. This service is now integrated with the Telegram platform, enabling user-specific defaults for tools. A `NotificationDispatcher` has been introduced for decoupled, platform-aware notifications (initially for Telegram).

The system uses an Internal API (`src/api/internal/`) for all Noema database interactions (user core, sessions, events, economy, preferences, generation outputs), ensuring consistent data handling and security. ADR-003 mandates this, and ADR-002 defines the Noema schemas. ADR-004 outlines the `ToolDefinition` and `ToolRegistry` for managing tools, their inputs, costs, and platform hints. ADR-005 standardizes debit accounting, ensuring all generations deduct from `usdCredit` via the internal economy API, triggered by webhooks. ADR-006 details the Tool Parameter Preferences & Settings API, which `UserSettingsService` implements.

Ongoing refactor efforts are guided by the `REFACTOR_GENIUS_PLAN.md` and `REFACTOR_NORTH_STAR.md`, emphasizing visible, working demos. Collaboration follows `AGENT_COLLABORATION_PROTOCOL.md`, with work artifacts in `/vibecode/`.

Key design decisions include:
- User-supervised iteration and live demonstrations are paramount.
- All Noema DB access is through the Internal API.
- Standardized `ToolDefinition` and `ToolRegistry`.
- Unified debit accounting via `userEconomyApi.js`.
- Decoupled notification system.
- User-specific settings per tool.

Coordination involves human devs, ChatGPT, and agents, with handoffs and ADRs in `/vibecode/`. The `jobs-teams-sprint-plan.md` outlines future work on team-based infrastructure and multi-step job systems.

The current focus is shifting to platform-level UX, particularly for Telegram, to leverage the new settings capabilities (as per `HANDOFF-2025-05-22-SETTINGS-API-TELEGRAM-UX.md`). This includes designing a `/settings` command, displaying current settings, and enabling setting modifications.

One thing to note is the system's reliance on `comfyui-deploy` for core AI workflow execution. The `ToolRegistry` and `WorkflowsService` manage these, translating ComfyUI workflows into standardized `ToolDefinition` objects. The `webhookProcessor.js` handles ComfyUI results, updates records, and triggers debiting.

The business logic aims for revenue generation through points purchased with crypto for AI services. The web interface is envisioned as an interactive canvas.
We've recently shifted our command structure to align with the `ToolRegistry` and dynamic command generation, especially on Telegram.
The main application entry is `app.js` which initializes services, databases, and platform adapters (Telegram, Discord, Web).
The `UserSettingsService` uses an `internalApiClient` with specific API keys per platform for secure calls.
A key TODO is fleshing out the Telegram `/settings` UX, including how users select tools and modify parameters.
Friction points can arise if `ToolDefinition` schemas are not kept in sync with backend service capabilities.
Maintaining backward compatibility during incremental migration is a core principle.
The `NotificationDispatcher` currently supports Telegram and is designed to be extensible.
The `internalApiClient` in `UserSettingsService` now uses `X-Internal-Client-Key` for auth.
The system is actively being developed, with a strong emphasis on ADRs to document architectural choices. 