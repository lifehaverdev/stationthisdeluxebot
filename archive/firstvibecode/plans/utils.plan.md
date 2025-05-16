# Refactoring Plan: utils.js

## Current Role
`utils.js` currently serves as a mixed utility file with several responsibilities:
- Telegram bot message sending and handling functions
- Command management and context setting
- User state management helpers
- Error handling and retry logic for Telegram API operations
- Message formatting and cleaning
- Economic functions (discounts, points calculations)

## Current Issues
1. **Mixed Responsibilities**:
   - Combines Telegram-specific operations with business logic
   - Handles both UI concerns and core application concerns
   - Mixes state management with message sending

2. **Global Dependencies**:
   - Direct references to global objects (`lobby`, `rooms`, `getBotInstance`)
   - Hard-coded values and IDs (e.g., `DEV_DMS`)

3. **Error Handling Inconsistencies**:
   - Custom retry logic for Telegram operations
   - Inconsistent error reporting patterns

4. **Tight Coupling**:
   - Functions directly depend on Telegram message structure
   - Business logic (like points calculations) mixed with UI operations

## Migration Plan

### Phase 1: Organize and Separate Functions
1. **Group Related Functions**:
   - Telegram API operations (`sendMessage`, `sendPhoto`, etc.)
   - Command management functions
   - Error handling utilities
   - Economic utilities

2. **Create Basic Abstraction Layer**:
   - Move Telegram-specific code into adapters (but maintain compatibility)
   - Extract business logic into separate helper functions

### Phase 2: Extract Core Services
1. **Move Business Logic to Core**:
   - Extract points/discount calculations to `src/core/points/calculation.js`
   - Move user state functions to `src/core/session/service.js`

2. **Create Telegram Adapter**:
   - Move message sending functions to `src/integrations/telegram/messaging.js`
   - Move command management to `src/integrations/telegram/commands/manager.js`

3. **Implement Proper Error Handling**:
   - Create standardized error types in `src/utils/errors.js`
   - Replace direct console logging with structured logging service

### Phase 3: Finalize Clean Architecture
1. **Complete Decoupling**:
   - Remove all direct dependencies on global state
   - Implement dependency injection for services
   - Create proper interfaces for all external dependencies

2. **Add Proper Testing**:
   - Unit tests for economic functions
   - Mock-based tests for Telegram operations

## New File Locations

### Core Business Logic
- `src/core/points/calculation.js` - Points and discount calculations
- `src/core/session/state.js` - User state management
- `src/core/user/service.js` - User verification and status management

### Telegram Integration
- `src/integrations/telegram/messaging.js` - Message sending operations
- `src/integrations/telegram/commands/manager.js` - Command registration and context
- `src/integrations/telegram/utils/retry.js` - Retry logic for API calls

### Utilities
- `src/utils/logger.js` - Structured logging
- `src/utils/errors.js` - Error handling utilities
- `src/utils/formatting.js` - Text formatting helpers

## Migration Strategy
1. Create new files and gradually move functionality
2. Maintain backward compatibility during migration
3. Update imports in other files as functions are moved
4. Add deprecation warnings to original functions
5. Remove original file only after all dependencies are updated

## Testing Strategy
1. Create unit tests for economic functions first
2. Implement integration tests for Telegram operations
3. Add mocks for external dependencies
4. Test parallel running of old and new implementations

## Dependencies to Update
- All files importing from `utils.js` will need updates
- Command handlers will need to adapt to new message sending interfaces
- User state management code will need to use new session service 