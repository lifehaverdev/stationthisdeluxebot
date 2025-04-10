# Workflow Implementations

This directory contains platform-agnostic workflow implementations for complex multi-step interactions. Each workflow follows the clean architecture principles with separation of concerns between business logic, UI rendering, and platform-specific code.

## Current Implementations

### MakeImageWorkflow.js

**Status: Active** - This is the current implementation for the image generation workflow.

- Creates a workflow for generating images using ComfyDeployService
- Handles the complete lifecycle from prompt entry to image delivery
- Integrates with the points system for cost calculation and allocation
- Provides platform-agnostic UI definitions for each step
- Implements proper validation, error handling, and analytics tracking

This workflow is used by the `/make` command and should be the standard reference for implementing other workflows.

### makeWorkflow.js

**Status: Legacy** - This is the original implementation being replaced by MakeImageWorkflow.js.

This file is kept for reference and backward compatibility but will be deprecated. All new code should use MakeImageWorkflow.js instead.

### accountPoints.js

**Status: Active** - Handles account points management workflow.

- Implements user points management interactions
- Allows checking balance, regenerating points, and points usage history
- Provides a multi-step interface for point-related operations

## Implementation Guidelines

When creating new workflow implementations, follow these guidelines:

1. **Platform Agnostic**: Keep all business logic independent of the platform (Telegram, Web, etc.)
2. **Clean Architecture**: Follow the separation of concerns between state, UI, and business logic
3. **Immutable State**: Use immutable state updates through the workflow engine
4. **Error Handling**: Implement proper validation and error handling at each step
5. **Analytics Integration**: Track important events for user journey analysis
6. **UI Definition**: Provide clear UI definitions for each step, without platform-specific code

## File Naming Conventions

- Use PascalCase for workflow file names (e.g., `MakeImageWorkflow.js`)
- Export a factory function named `create{WorkflowName}` that accepts options and returns a workflow instance
- Include comprehensive JSDoc for all exported functions and classes

## Testing

All workflows should have corresponding tests in the `tests/core/workflow/workflows/` directory. Tests should cover:

1. Workflow creation and step transitions
2. Input validation and error handling
3. State management and updates
4. Integration with services
5. Session persistence (where applicable)

## Integration with Commands

Workflows are typically initialized and managed by commands. See `src/commands/makeCommand.js` for an example of how to integrate a workflow with a command handler. 