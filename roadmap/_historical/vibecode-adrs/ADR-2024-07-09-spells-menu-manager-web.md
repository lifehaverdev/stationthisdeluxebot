> Imported from vibecode/decisions/adr/ADR-2024-07-09-spells-menu-manager-web.md on 2025-08-21

# ADR-2024-07-09: Spells Menu Manager for Web Platform

## Context

The StationThis project is migrating advanced menu-driven interfaces (originally built for Telegram) to the web platform, starting with the Spells Menu Manager. This menu will serve as the foundation for all future menu-driven features (e.g., Mods, Training) and must be designed for extensibility, maintainability, and a modern, responsive user experience. The implementation must align with the AGENT_COLLABORATION_PROTOCOL and architectural boundaries defined in REFACTOR_GENIUS_PLAN.md and REFACTOR_NORTH_STAR.md.

## Decision

- **Componentization:**
  - Implement the Spells Menu Manager as a standalone, reusable modal/component (e.g., `SpellsMenuModal`) in `src/platforms/web/client/src/sandbox/components/`.
  - The component manages its own state, DOM, and event listeners, and exposes a simple API for opening/closing and navigation.
  - All future menu managers (Mods, Training, etc.) will follow this pattern for consistency.

- **State Management:**
  - Use internal component state for menu navigation (main menu, spell detail, tool selection, parameter editing, etc.).
  - Integrate with global modal state (from `state.js`) to prevent UI conflicts and ensure only one modal is active at a time.

- **UI/UX:**
  - Modal overlay for focus and accessibility, with keyboard and click-outside support.
  - Responsive design, styled via CSS modules, matching the look and feel of the sandbox frontend.
  - Navigation stack or state machine for seamless transitions between menu views.
  - Entry point via main navigation or sidebar, with clear affordance for users.

- **Data Integration:**
  - Fetch spells and related data from backend APIs (mirroring Telegram endpoints, e.g., `/internal/v1/data/spells`).
  - Support create, update, delete, and step management actions, with optimistic UI updates and error handling.

- **Extensibility:**
  - The menu manager should be easily extensible to support additional features (e.g., Mods, Training) by following the same component/state/navigation patterns.
  - All menu logic (view switching, API calls, state updates) should be encapsulated within the component, with clear interfaces for integration.

- **Demonstration & Handoff:**
  - The initial implementation will include a working UI demo (manual or Playwright) showing the main menu, spell listing, and navigation.
  - A handoff document will be created in `/vibecode/handoffs/` summarizing the implementation, demo, and next steps.

## Consequences

- Provides a robust, extensible foundation for all menu-driven features on the web platform.
- Ensures architectural alignment and maintainability by following established protocols and patterns.
- Enables rapid development of future menus (Mods, Training, etc.) with minimal duplication.
- Improves user experience with modern, responsive, and accessible UI components.

## Alternatives Considered

- **Direct DOM manipulation for each menu:**
  - Rejected due to maintainability and extensibility concerns.
- **Single global menu manager for all features:**
  - Rejected in favor of modular, per-feature components for better separation of concerns and testability.
- **Framework migration (e.g., React):**
  - Deferred; current implementation will use vanilla JS and modular components to match the existing sandbox architecture. 