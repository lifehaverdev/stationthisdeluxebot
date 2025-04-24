# Phase 4: Legacy Command Migration - Status

## Overview
This phase focuses on migrating legacy commands to the new architecture. The migration includes implementing platform-agnostic core logic, workflows for complex operations, and comprehensive tests.

## Completed Tasks

### Account Commands Migration
- ✅ Created `src/core/account/commands.js` with platform-agnostic command handlers
- ✅ Implemented account workflow in `src/core/workflow/workflows/AccountWorkflow.js`
- ✅ Created Telegram integration in `src/integrations/telegram/commands/account.js`
- ✅ Added comprehensive unit tests for core commands
- ✅ Added end-to-end tests for workflows
- ✅ Added integration tests for Telegram adapter

### Image Generation & ComfyDeploy Integration
- ✅ Implemented parameter filtering approach to replace overengineered normalization
- ✅ Created whitelist of valid ComfyDeploy API parameters
- ✅ Simplified parameter handling in PromptBuilder to filter out internal objects
- ✅ Fixed parameter priority to ensure web UI input values (like seed) are correctly used
- ✅ Ensured consistent parameter format between UI and API
- ✅ Fixed API request structure to match ComfyDeploy expectations
- ✅ Reduced API request payload to only send essential and explicitly provided parameters
- ⚠️ Over-aggressive parameter filtering causes workflow type handling to fail (falls back to MAKE)

### Other Commands Migration
- ⏳ Media commands
- ⏳ Status commands
- ⏳ Make commands

## Current Focus
- ✅ Fixed ComfyDeploy parameter handling to eliminate API errors
- ⚠️ Need to balance parameter filtering to support all workflow types
- Integration testing of command workflows
- Test coverage improvements
- Documentation updates
- Simplifying overengineered solutions

## Next Steps
1. Fix over-filtered parameters to ensure correct workflow type handling
2. Complete migration of remaining legacy commands
3. Implement web interface adapters
4. Add error handling and logging improvements
5. Update client-side code to use consistent parameter naming conventions

## Known Issues
- ✅ Fixed: Parameter normalization causing 400 errors with ComfyDeploy API
- ✅ Fixed: ComfyDeploy API rejecting object parameters like input_photoStats
- ✅ Fixed: Web UI seed values being overridden by default values
- ✅ Fixed: Sending unnecessary parameters that could cause API conflicts
- ⚠️ New issue: Parameter filtering too aggressive, causing workflow type handling to fall back to MAKE incorrectly
- Some edge cases in account workflow error handling need further testing
- API integration for key verification needs implementation 