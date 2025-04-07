# Project Overhaul: Strategic Goals

## High-Level Problems with the Codebase
- Tight coupling between Telegram commands and core logic
- No clear separation between core, integrations, and API layers
- Global state via `lobby`, leading to brittle user state logic
- Redundant helper functions across modules
- Poor error handling and inconsistent async flows
- Missing tests and weak modularity
- Folder sprawl (e.g. everything in `utils/bot/handlers`)

## Refactor Goals
- Migrate all logic into `src/`
- Establish a clear core → integration → api pipeline
- Remove Telegram-specific logic from business logic
- Replace global state with interface-driven services
- Add internal API for core logic access
- Modularize everything for future testing and web use, especially external API interactions

## Optional Stretch Goals
- Full test coverage
- Plugin system for commands or services
