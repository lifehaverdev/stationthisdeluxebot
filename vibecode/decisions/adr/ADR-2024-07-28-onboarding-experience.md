# ADR-2024-07-28: Onboarding Experience for Web and Telegram Platforms

## Context

As StationThis expands its cross-platform capabilities, a consistent and effective onboarding experience is required for both the Web (Sandbox) and Telegram platforms. Currently, the web sandbox is built using vanilla HTML, CSS, and JavaScript, and this approach will continue for onboarding features. 

There is a need to:
- Guide new users through the main features and workflows (tool execution, spell creation, etc.) on their first visit to the web platform.
- Provide a conversational onboarding flow for Telegram users via the `/start` command.
- Persist the user's onboarding completion state so that tutorials are not shown repeatedly, and users can revisit them if desired.

For the web platform, onboarding completion will be stored in the backend using the `userPreferencesDb.js` (MongoDB), accessible via the user API (`userApi.js`). This ensures onboarding state is preserved across devices and sessions for authenticated users.

For Telegram, onboarding state may be tracked in a similar fashion, using the same preferences DB if the user is linked, or via Telegram-specific state otherwise.

---

## Decision

The onboarding experience for the web platform will be implemented as a modular, extensible JavaScript module within the sandbox directory. The onboarding flow will be composed of discrete, easily configurable steps, allowing for rapid iteration and the addition of new onboarding content as features are developed (e.g., cooks, mods, spells menus, accountDropdown).

**Onboarding Flow Priorities:**
1. Present the value proposition and unique selling points of StationThis (mirroring README.md).
2. Prompt the user to select their user type (e.g., professional artist, hobbyist, enthusiast, noob) via a quick, clickable form. This data will be stored in user preferences.
3. Guide the user through wallet connection and points purchase, with clear explanations and the option to skip.
4. Provide an interactive tour of the workspace, tools, and navigation (modals, overlays, tooltips).
5. Walk the user through executing a tool.
6. Demonstrate how to create a spell by combining tools.
7. Guide the user to execute a spell.
8. Show how to rate a delivered generation and make tweaks/adjustments.
9. Explain how to submit feedback for bugs or issues.
10. (Future) Add steps for cooks, mods, spells menus, and accountDropdown as those features are completed.

**Design Principles:**
- Each onboarding step is a self-contained module/component, with a clear API for sequencing and state management.
- Progress is tracked and persisted after each step (userPreferencesDb for authenticated users, localStorage for guests).
- The onboarding can be skipped or revisited at any time from the UI.
- The module is designed to be extensible, so new steps (e.g., for cooks, mods, spells menus, accountDropdown) can be added with minimal friction.
- Analytics will be collected to monitor onboarding completion and drop-off points.
- Accessibility and cross-device compatibility are prioritized.

The same modular approach will be adapted for the Telegram platform, using conversational flows and inline keyboards, once the web onboarding is complete and validated.

---

## Consequences

Implementing a modular, extensible onboarding system for the web platform will have several important consequences:

**Positive Impacts:**
- **Improved User Experience:** New users will be guided through the platform’s value, features, and workflows, reducing confusion and increasing engagement.
- **Higher Activation Rates:** By helping users connect wallets, purchase points, and execute their first tool/spell, onboarding will drive faster time-to-value and higher retention.
- **Personalization:** Collecting user type and onboarding analytics enables future personalization of tips, UI, and feature exposure.
- **Cross-Platform Consistency:** The modular approach can be adapted for Telegram and other platforms, ensuring a unified onboarding philosophy.
- **Easy Iteration:** The onboarding flow can be updated or extended as new features (e.g., cooks, mods, spells menus) are released, without major refactoring.
- **Persistent State:** Storing onboarding progress in userPreferencesDb (and localStorage for guests) ensures users don’t repeat onboarding unnecessarily and can resume if interrupted.
- **Analytics:** Drop-off and completion analytics will inform future UX improvements.

**Tradeoffs and Risks:**
- **Initial Development Overhead:** Building a modular, extensible onboarding system requires more up-front design and engineering effort compared to a simple, hardcoded tutorial.
- **Maintenance:** As features are added, onboarding steps must be kept in sync with platform changes to avoid outdated or broken guidance.
- **State Complexity:** Managing onboarding state across authenticated and guest users, and syncing between local and server state, adds complexity.
- **Platform Divergence:** While the approach is designed for cross-platform use, some onboarding steps may need to be tailored for web vs. Telegram, requiring additional logic and content management.

Overall, this approach is expected to significantly improve user onboarding, engagement, and retention, while providing a scalable foundation for future growth and feature expansion.

---

## Alternatives Considered

[To be completed] 

## Web Platform Implementation Notes

The web onboarding module will live alongside the existing sandbox code (`src/platforms/web/client/src/sandbox/`). Key integration points and considerations:

1. **Module Location & Bootstrapping**
   - Create `sandbox/onboarding/` directory containing:
     - `onboarding.js` (controller that orchestrates the flow)
     - `steps/` (one file per step – valuePropStep.js, userTypeStep.js, walletStep.js, etc.)
     - `styles/onboarding.css` (scoped styles)
   - `onboarding.js` is imported at the end of `sandbox/index.js` after initial UI setup and state restoration.

2. **Activation Logic**
   - On `DOMContentLoaded`, the module checks `window.user` (if authenticated) for onboarding status via `/api/v1/user/onboarding-status` (to be implemented) or `userPreferencesDb`.
   - Fallback to `localStorage` key `st_onboarding_complete` for guests.
   - If onboarding is incomplete, the module initializes; otherwise, it stays dormant but exposes a `window.onboarding.show()` API for manual replay.

3. **Non-Intrusive Overlay Pattern**
   - Each step renders an overlay div (`<div class="st-onboarding-overlay">`) with `position: fixed; z-index: 9999;`.
   - Background interactions are disabled via a semi-transparent backdrop **only** when necessary; otherwise, pointer events pass through to the app.
   - Tooltips/pointers are anchored to target elements (e.g., `#sidebar-toggle`) using `getBoundingClientRect` and reposition on `resize`.

4. **Step Engine**
   - A simple state machine: `{ currentStepIndex, steps[] }`.
   - `steps[]` entries implement `{ id, render(rootEl), onNext(), canSkip }`.
   - The engine emits `customEvents` (`onboarding:step-start`, `...:complete`) for analytics and allows other modules (e.g., FAB updates) to listen.

5. **Integration with Existing Sandbox Features**
   - Steps that require interaction (e.g., “Execute a Tool”) listen for existing events (`tool-executed`, `spell-created`) already dispatched by sandbox components, or wrap existing functions where events are absent.
   - When a step needs to highlight UI in motion (e.g., dragging a tool), it temporarily disables conflicting handlers (lasso, pan) via a shared `window.sandboxInteractionLock` flag.
   - FAB visibility (`MintSpellFAB`) is observed so onboarding doesn’t obscure it.

6. **Persisting Progress**
   - After each step, call `/api/v1/user/onboarding-progress` with `{ stepId, completed: true }` (batched debounce) if authenticated.
   - For guests, update `localStorage` to avoid repetition in the same session.

7. **Extensibility**
   - New steps can be added by dropping a file into `steps/` and appending it to the array in `onboarding.js`.
   - Future UI elements (cooks, mods, spells menus, accountDropdown) expose a CSS selector so onboarding can target them.

8. **Performance & Bundle Size**
   - Lazy-load onboarding resources via dynamic `import()` only when needed.
   - CSS is scoped with a class prefix (`st-onboard`) to prevent bleeding styles.

9. **Accessibility & i18n**
   - All overlays/tooltips are keyboard-navigable and screen-reader friendly (ARIA labels, focus trapping).
   - Strings are stored in a JSON locale file for future internationalization.

These notes guide the concrete implementation to ensure the onboarding module complements, rather than disrupts, the existing sandbox experience.

--- 