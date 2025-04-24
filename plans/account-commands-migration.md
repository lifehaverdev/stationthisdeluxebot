# Account Commands Migration Plan

## Overview
This plan outlines the migration of account management commands from the legacy implementation to the new clean architecture. The migration focuses on decoupling platform-specific code, improving testability, and following the workflow-based approach.

## Current State
The current implementation in `src/commands/accountCommands.js` provides these core functionalities:
- Points balance and history
- Account settings and profile management
- User preferences management
- API key management
- Account deletion

The current implementation is tightly coupled with the Telegram platform and doesn't follow the clean architecture principles.

## Target State
The migrated implementation will:
1. Implement platform-agnostic command handlers in `src/core/account/commands.js`
2. Use workflows for complex interactions
3. Leverage the UI component system for rendering
4. Interact with repositories through service layers
5. Have comprehensive test coverage

## Commands to Migrate
1. `/points` - View points balance and transaction history
2. `/account` - Access account settings
   - `/account profile` - Manage profile information
   - `/account preferences` - Manage user preferences
   - `/account apikeys` - Manage API keys
   - `/account delete` - Delete user account

## Migration Steps
1. Implement core command handlers in `src/core/account/commands.js`
2. Implement workflows for complex interactions in `src/workflows/account/`
3. Create platform-specific adapters in `src/integrations/telegram/commands/account.js`
4. Create comprehensive tests for all components
5. Update registration and entry points

## Testing Strategy
1. Unit tests for all core command handlers
2. Integration tests for workflows
3. E2E tests for full command execution flow
4. Mock repositories and external dependencies

## Implementation Plan
1. Complete the implementation of `accountCommandHandler`
2. Implement specific command handlers for points, profile, preferences, API keys
3. Create workflows for complex interactions (name change, preference updates)
4. Implement UI components for rendering
5. Create adapter layer for Telegram integration
6. Write comprehensive tests

## Dependencies
- Session management system
- UI component system
- Repository interfaces
- Workflow engine
- Analytics service 