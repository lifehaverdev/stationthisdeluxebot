# 🧠 Codebase Audit Index

This document serves as the central index for the Phase 3 Structural Inventory audit of the `/src` directory. Each folder has been analyzed for its responsibility, architecture alignment, file contents, and cross-system dependencies.

## Core Domain Modules

### 📦 core/
- [audit.md](../../src/core/audit.md)
- Summary: Central business logic and domain models implementing clean architecture principles with domain-driven design

## Integration Modules

### 📦 integrations/
- [audit.md](../../src/integrations/audit.md)
- Summary: Platform adapters for external services, primarily Telegram Bot integration and web interfaces

### 📦 api/
- [audit.md](../../src/api/audit.md)
- Summary: HTTP/REST API implementation for programmatic access to system functionality

### 📦 adapters/
- [audit.md](../../src/adapters/audit.md)
- Summary: Implementation of adapter pattern to bridge between components and external systems

## Command and Service Modules

### 📦 commands/
- [audit.md](../../src/commands/audit.md)
- Summary: User-facing command implementations executing core business logic

### 📦 services/
- [audit.md](../../src/services/audit.md)
- Summary: Specialized application services implementing complex operations and business processes

## Data and Storage Modules

### 📦 db/
- [audit.md](../../src/db/audit.md)
- Summary: Database access and model definitions for data persistence

## Support Modules

### 📦 utils/
- [audit.md](../../src/utils/audit.md)
- Summary: Cross-cutting utility functions and helpers used throughout the application

### 📦 config/
- [audit.md](../../src/config/audit.md)
- Summary: Application configuration, settings, and feature flags

### 📦 tests/
- [audit.md](../../src/tests/audit.md)
- Summary: Automated tests for validating functionality and preventing regressions

### 📦 examples/
- [audit.md](../../src/examples/audit.md)
- Summary: Sample code and demonstrations showing how to use various components

## Uncertain Purpose

### 📦 mony/
- [audit.md](../../src/mony/audit.md)
- Summary: Custom module with unclear purpose, possibly related to monetary operations

## Main Application Files

### 📦 simplebot.js
- Main application entry point for a simplified version of the bot
- Initializes essential components including Telegram bot, command handlers, and API endpoints

### 📦 stationthisbot.js
- Primary application entry point with complete feature set
- Initializes all bot functionality and services

### 📦 bootstrap.js
- Module for initializing new architecture components
- Bridges between legacy code and refactored components

## Architecture Analysis

The codebase appears to be in a transition phase from a monolithic architecture to a clean, domain-driven architecture with clear separation of concerns. Key observations:

1. The `core` module implements domain-driven design principles with a focus on business rules
2. External integrations are being separated from core logic
3. Adapter patterns are being introduced to abstract external dependencies
4. Feature flags are used to toggle between legacy and new implementations

## Technical Debt Overview

1. Incomplete migration to clean architecture
2. Inconsistent documentation across modules
3. Some modules have unclear responsibilities or naming
4. Legacy code still appears to be in use alongside refactored components
5. Test coverage appears to be limited
6. Some dependencies may cross architectural boundaries inappropriately

## Next Steps

1. Complete module-level audits for any subdirectories requiring deeper analysis
2. Identify priority areas for refactoring based on architectural violations
3. Develop migration plans for remaining legacy code
4. Address inconsistent naming and unclear module responsibilities
5. Improve documentation coverage, especially for core components

## 📁 Complete File Directory Tree

```
src/
├── adapters/
│   ├── audit.md
│   └── sessionAdapter.js
├── api/
│   ├── audit.md
│   ├── index.js
│   └── test.js
├── bootstrap.js
├── commands/
│   ├── accountCommands.js
│   ├── audit.md
│   ├── makeCommand.js
│   ├── mediaCommand.js
│   └── statusCommand.js
├── config/
│   ├── audit.md
│   └── featureFlags.js
├── core/
│   ├── account/
│   │   └── points.js
│   ├── analytics/
│   │   ├── analyticsEventsAdapter.js
│   │   ├── analyticsService.js
│   │   └── index.js
│   ├── audit.md
│   ├── command/
│   │   ├── adapters/
│   │   │   ├── abstractAdapter.js
│   │   │   └── telegramAdapter.js
│   │   ├── index.js
│   │   ├── middleware/
│   │   │   └── validation.js
│   │   ├── middleware.js
│   │   ├── README.md
│   │   ├── registry.js
│   │   ├── router.js
│   │   └── tests/
│   │       ├── adapter.test.js
│   │       └── router.test.js
│   ├── generation/
│   │   ├── index.js
│   │   ├── models.js
│   │   ├── README.md
│   │   ├── repository.js
│   │   └── service.js
│   ├── index.js
│   ├── points/
│   │   ├── calculation-service.js
│   │   ├── index.js
│   │   ├── models.js
│   │   ├── README.md
│   │   ├── repository.js
│   │   ├── service.js
│   │   └── task-points-service.js
│   ├── queue/
│   │   ├── examples/
│   │   │   ├── runTaskQueueExample.js
│   │   │   └── taskQueueExample.js
│   │   ├── models/
│   │   │   └── TaskState.js
│   │   ├── QueueStateContainer.js
│   │   └── TaskQueueService.js
│   ├── README.md
│   ├── session/
│   │   ├── adapter.js
│   │   ├── examples/
│   │   │   └── lobby-replacement.js
│   │   ├── index.js
│   │   ├── manager.js
│   │   ├── models.js
│   │   ├── README.md
│   │   ├── repository.js
│   │   └── service.js
│   ├── shared/
│   │   ├── errors/
│   │   │   ├── AppError.js
│   │   │   ├── AuthenticationError.js
│   │   │   ├── AuthorizationError.js
│   │   │   ├── ErrorHandler.js
│   │   │   ├── index.js
│   │   │   ├── README.md
│   │   │   └── ValidationError.js
│   │   ├── events.js
│   │   ├── mongo/
│   │   │   ├── index.js
│   │   │   ├── MongoRepository.js
│   │   │   ├── MongoRepositoryFactory.js
│   │   │   └── README.md
│   │   ├── README.md
│   │   ├── repository.js
│   │   └── state.js
│   ├── tasks/
│   │   ├── index.js
│   │   ├── README.md
│   │   └── TaskPointsService.js
│   ├── ui/
│   │   ├── components/
│   │   │   ├── ButtonComponent.js
│   │   │   ├── CarouselComponent.js
│   │   │   ├── index.js
│   │   │   ├── InputComponent.js
│   │   │   ├── MessageComponent.js
│   │   │   ├── PointsBarComponent.js
│   │   │   ├── SelectComponent.js
│   │   │   ├── tests/
│   │   │   │   └── MessageComponent.test.js
│   │   │   └── TextComponent.js
│   │   ├── index.js
│   │   ├── interfaces/
│   │   │   ├── index.js
│   │   │   ├── UIComponent.js
│   │   │   ├── UIManager.js
│   │   │   └── UIRenderer.js
│   │   └── README.md
│   ├── user/
│   │   ├── index.js
│   │   ├── models.js
│   │   ├── README.md
│   │   ├── repository.js
│   │   └── service.js
│   ├── validation/
│   │   ├── formatValidators.js
│   │   ├── index.js
│   │   ├── README.md
│   │   ├── registry.js
│   │   ├── schema.js
│   │   ├── schemaRegistry.js
│   │   ├── tests/
│   │   │   ├── formatValidators.test.js
│   │   │   ├── schemaRegistry.test.js
│   │   │   └── validator.test.js
│   │   └── validator.js
│   └── workflow/
│       ├── adapters/
│       │   └── telegramAdapter.js
│       ├── examples/
│       │   ├── basicGeneration.js
│       │   └── loraTraining.js
│       ├── index.js
│       ├── manager.js
│       ├── README.md
│       ├── sequence.js
│       ├── sessionIntegration.js
│       ├── state.js
│       ├── tests/
│       │   ├── sessionIntegration.test.js
│       │   ├── telegramAdapter.test.js
│       │   ├── workflowSequence.test.js
│       │   ├── workflowState.test.js
│       │   └── workflowStep.test.js
│       └── workflows/
│           ├── accountPoints.js
│           └── makeWorkflow.js
├── db/
│   ├── audit.md
│   └── models/
│       └── analyticsEvents.js
├── examples/
│   ├── analyticsExample.js
│   ├── audit.md
│   ├── commandHandlerExample.js
│   ├── errorHandlingExample.js
│   ├── featureFlagsExample.js
│   ├── integrationExample.js
│   ├── preferencesManagerExample.js
│   ├── rateLimiterExample.js
│   ├── README.md
│   ├── runAllExamples.js
│   ├── runCommandExample.js
│   ├── sessionAdapterExample.js
│   ├── sessionManagerExample.js
│   ├── sessionManagerWithTelegram.js
│   └── webhookHandlerExample.js
├── integrations/
│   ├── audit.md
│   ├── telegram/
│   │   ├── adapters/
│   │   │   ├── accountAdapter.js
│   │   │   ├── commandAdapter.js
│   │   │   ├── generationAdapter.js
│   │   │   └── mediaAdapter.js
│   │   ├── index.js
│   │   ├── makeCommandIntegration.js
│   │   ├── README.md
│   │   ├── renderers/
│   │   │   └── telegramRenderer.js
│   │   ├── statusCommandIntegration.js
│   │   └── ui/
│   │       └── TelegramRenderer.js
│   └── web/
│       ├── index.js
│       └── ui/
│           └── WebRenderer.js
├── mony/
│   ├── audit.md
│   ├── loraExamples/
│   │   ├── HPOS10iflux.jpg
│   │   └── petravoiceflux2.jpg
│   └── watermarks/
│       ├── .DS_Store
│       ├── ms2black.png
│       ├── ms2disc.png
│       ├── msw.png
│       ├── mswmc.png
│       ├── poundhound.jpg
│       ├── poundhounds.jpg
│       ├── quickfoot.png
│       ├── stbexplicit.jpg
│       ├── watermark_new.png
│       ├── whitemonster.jpg
│       └── wifeydisc.png
├── services/
│   ├── assist.js
│   ├── audit.md
│   ├── comfydeploy/
│   │   ├── client.js
│   │   ├── config.js
│   │   ├── index.js
│   │   ├── mapper.js
│   │   └── media.js
│   ├── fry.js
│   ├── make.js
│   ├── sessionManager.js
│   ├── sessionManager.md
│   ├── speak.js
│   ├── tripo.js
│   └── waterMark.js
├── simplebot.js
├── stationthisbot.js
├── tests/
│   ├── audit.md
│   ├── comfydeploy-test.js
│   ├── run-all-tests.js
│   └── telegram-media-test.js
└── utils/
    ├── audit.md
    ├── errors.js
    ├── formatters.js
    ├── helpers.js
    └── logger.js
``` 