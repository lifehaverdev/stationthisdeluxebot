## System Overview & Recent Progress

We're continuing to build StationThis, a real-time, creative, cross-platform AI assistant. Our development is iterative and demonstration-first, prioritizing user-visible features and practical, working solutions, with the long-term vision of a multi-platform web application. All collaboration follows the `AGENT_COLLABORATION_PROTOCOL.md`, emphasizing user supervision and storing artifacts in `/vibecode/`.

The system has a layered architecture: Core Services, Platform-Agnostic Logic, Platform Adapters, a comprehensive API Layer, and Entry Points.

A critical architectural decision (ADR-003) has been fully implemented: all access to the seven core Noema database collections (like User Core, Economy, and Generation Outputs) now happens exclusively through a dedicated RESTful Internal API layer (`src/api/internal/`). This centralizes data access, enhances security, and ensures consistency across platforms.

We've established a unified `ToolDefinition` format and a `ToolRegistry` (ADR-004). This system defines all tools, like ComfyUI workflows, with a structured schema including inputs, costs, and platform hints. It's the source of truth for generating dynamic commands in Telegram, building settings menus, and tracking costs.

A standardized debit accounting system is live (ADR-005). When a generation is successfully completed, the `webhookProcessor.js` calculates the final `costUsd` and triggers a debit from the user's `usdCredit` balance via the internal economy API. This ensures all work is paid for and logged in the `transactions` collection.

User settings management (ADR-006) has been significantly improved. A `UserSettingsService` allows users to customize default parameters for each tool. On Telegram, a multi-level inline keyboard menu for `/settings` (ADR-007) is active, allowing users to browse their tools, view descriptions, and edit parameters directly.

The Telegram delivery menu for generations has been enhanced (ADR-008). It now offers options to rate a generation, hide the menu, view detailed parameters, tweak settings (which opens a pre-filled settings menu), and rerun the generation with a new random seed. The rerun button (`↻`) interactively tracks its press count on the message.

The system for handling LoRA trigger words is in development. It detects trigger words in prompts and substitutes them with the correct `<lora:slug:weight>` syntax. Importantly, the user's original, untransformed prompt is preserved for display in UI elements like "view info," ensuring a clean user experience.

Recent architectural work has introduced plans for on-chain finance. ADR-009 and ADR-010 outline the creation of an `EthereumService` and `CreditService` to manage user credits via an Ethereum smart contract, moving towards a decentralized balance system.

Future plans, detailed in `jobs-teams-sprint-plan.md`, revolve around introducing Team-based infrastructure and a Job system for creating multi-step toolchains. This major effort will involve new services like `TeamService` and `JobOrchestrator`, new database schemas for `teams` and `jobRecords`, and updating the debit logic to support a user vs. team execution context. The `ToolDefinition` will also be enhanced with a structured `outputSchema` to support this.

A few things to note for upcoming work: we still need to implement the mechanism for fetching a user's "most frequently used tools" for the Telegram `/settings` menu. We also need to continue refactoring any remaining direct database calls to use the new internal API endpoints, ensuring full compliance with our architectural standard.

This summary provides a snapshot of our current system state and development trajectory. 