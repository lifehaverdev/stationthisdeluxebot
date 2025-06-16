# ADR-001: Canonical Dependency Object for Inversion of Control

## Context
The application is suffering from inconsistent dependency management. Critical services like `internalApiClient` are not available in all modules (e.g., `spellMenuManager`), leading to runtime `TypeError` exceptions. Dependencies are currently assembled ad-hoc in `app.js` into a `platformServices` object. This pattern is fragile, error-prone, and makes it difficult to trace the flow of dependencies, hindering both development and testing.

## Decision
We will adopt a single, canonical `dependencies` object to be passed throughout the application, implementing a manual form of Dependency Injection.

1.  **Creation**: A single `dependencies` object will be assembled in the application entry point (`app.js`) immediately after core services are initialized. It will contain all shared services and application-level instances (e.g., the `services` object from `initializeServices`, the root `logger`, the `toolRegistry`).

2.  **Propagation**: This single `dependencies` object will be passed down through the initialization chain: `app.js` -> `initializePlatforms` -> `initializeTelegramPlatform` -> `createTelegramBot` -> `registerAllHandlers`. Platform-specific instances (like the `bot` object) will be added to a scoped copy of the `dependencies` object at the appropriate level before being passed further down.

3.  **Consumption**: All modules, including menu managers (`settingsMenuManager`, `spellMenuManager`, etc.), will be refactored to accept the `dependencies` object in their registration or initialization functions. They must access all required services via this object (e.g., `dependencies.internalApiClient`, `dependencies.logger`). Direct imports of singleton services will be disallowed in feature modules.

## Consequences

### Positive
-   **Predictability**: Dependency management becomes centralized and predictable.
-   **Reliability**: Reduces the chance of `undefined` errors due to missing dependencies.
-   **Testability**: Promotes loose coupling, making components easier to test in isolation by mocking the dependency object.
-   **Scalability**: Provides a clear and scalable pattern for adding new dependencies as the application grows.

### Negative
-   **Refactoring Effort**: Requires a one-time refactoring effort across multiple files to plumb the `dependencies` object through existing function calls.
-   **Signature Verbosity**: Functions will consistently have the `dependencies` object as a parameter, which can feel verbose but is explicit.

## Alternatives Considered

-   **Service Locator Pattern**: A global `ServiceLocator.get('serviceName')` could be used. This was rejected because it hides dependencies, makes the code harder to reason about, and is generally considered an anti-pattern compared to explicit dependency injection.
-   **Ad-hoc Passing (Current Method)**: Continue passing only the specific dependencies needed for each function. This was rejected as it is the source of the current problem. It is error-prone, hard to maintain, and does not scale.
-   **DI Framework**: Introduce a library like `awilix` or `tsyringe`. This was considered overkill for the current project needs. The proposed manual dependency injection provides the primary benefits with less complexity and no new external dependencies. 