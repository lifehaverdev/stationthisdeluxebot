# Core Domain Module Audit

## 🧾 Folder Overview

The core module contains the central business logic and domain models for the application. It follows a clean architecture approach with domain-driven design principles, separating concerns and providing a foundation for the refactored codebase.

This folder represents the heart of the new architecture, implementing domain models, services, and repositories that encapsulate the business rules independent of external integrations and delivery mechanisms.

## 📁 File-by-file Summary

### index.js
Serves as the entry point to the core module, exporting all domain services, models, and utilities. This allows other parts of the codebase to access core functionality through a single import.

### README.md
Documentation for the core module that explains the architecture, domain modules, and integration strategy. It outlines the migration path and provides guidance on how to use the core components within the larger system.

## 🧾 Subdirectories

### account/
Manages user accounts, authentication, and profile information.

### analytics/
Handles tracking, metrics, and reporting of user actions and system events.

### command/
Contains command processing logic and registration mechanisms.

### generation/
Manages AI content generation tasks including scheduling, execution, and result management.

### points/
Handles the points economy system, including point allocation, spending, and balance tracking.

### queue/
Manages task queues, job scheduling, and background processing.

### session/
Handles user session state, persistence, and lifecycle management.

### shared/
Contains utilities, interfaces, and common functionality shared across core modules.

### tasks/
Manages task definitions, execution contexts, and task state transitions.

### ui/
Contains UI-related logic that's platform-independent, likely defining presentation models.

### user/
Manages user identity, verification, preferences, and data.

### validation/
Contains validation rules, schemas, and error handling logic.

### workflow/
Orchestrates multi-step processes and state transitions between tasks.

## 🛠️ Service/Dependency Notes

The core module depends on:
- Event-based communication (likely through an internal event bus)
- Repository interfaces for data access
- Domain-specific services for business logic

The core module specifically avoids direct dependencies on:
- Telegram or any other external platform
- Database-specific implementations
- HTTP or any specific transport mechanism
- Third-party services

## 📌 Cross-System Notes

### Dependencies on other folders:
- Likely uses `src/db` for repository implementations
- May use `src/utils` for general utilities

### Dependencies from other folders:
- `src/commands` likely uses core services
- `src/integrations` adapts core functionality to external platforms
- `src/api` exposes core functionality through REST/GraphQL interfaces
- `src/bootstrap.js` initializes and wires core components 