> Imported from docs/handoffs/HANDOFF-INITIAL.md on 2025-08-21

# HANDOFF: INITIAL

## Current State
This is the initial handoff document that establishes our starting point for the refactoring process. The current codebase is primarily organized around a Telegram bot with tight coupling between UI, business logic, and data access.

### Key Components:
- **Server**: Express server handling webhooks and basic routes
- **Telegram Bot**: Main interface for users in `utils/bot`
- **Command Handlers**: Individual command files in `utils/bot/handlers`
- **Queue System**: Task management in `utils/bot/queue.js`
- **State Management**: User context in global `lobby` object
- **Dynamic Workflows**: Loaded from database via `initialize.js`

### Known Issues:
- Tight coupling to Telegram
- No separation between UI and business logic
- Global state management through shared objects
- Limited modularity and reusability

## Next Tasks
1. Create the basic folder structure outlined in REFACTOR_GENIUS_PLAN.md
2. Set up the initial documentation directory structure
3. Begin implementing Phase 1: Extract Core Services
   - Start with `services/comfyui.js` as the first service
   - Extract session management from the global lobby

## Guide for First Implementation
When implementing the first service (`comfyui.js`), focus on:
1. Identifying existing functionality in `utils/bot/queue.js` and workflow handling
2. Creating a clean API that is platform-agnostic
3. Maintaining compatibility with the existing system
4. Documenting the interface thoroughly

## Open Questions
1. How deeply should we integrate with existing MongoDB models?
2. Should we introduce TypeScript gradually or maintain JavaScript?
3. How should we handle the transition period when both systems are active?

Remember to follow the AGENT_COLLABORATION_PROTOCOL when continuing this work. 