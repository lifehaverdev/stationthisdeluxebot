> Imported from vibecode/decisions/adr/ADR-2024-07-20-api-dependency-injection-refactor.md on 2025-08-21

# ADR-2024-07-20: Standardized Dependency Injection and API Module Structure

## Context

Over time, the StationThis application’s API modules (`app.js`, `src/api/index.js`, `src/api/internal/`, `src/api/external/`) have grown organically, resulting in inconsistencies in dependency injection, middleware placement, router mounting, and configuration management. This has led to:

- Ad-hoc and sometimes partial dependency objects passed to submodules
- Scattered authentication and error-handling middleware
- Imperative and conditional router mounting
- Redundant or unclear configuration loading

These inconsistencies make onboarding, testing, and scaling more difficult, and risk architectural drift from our intended layered design. This ADR proposes a formal, standardized approach to dependency injection and API module structure, in alignment with the AGENT_COLLABORATION_PROTOCOL.md and REFACTOR_GENIUS_PLAN.md.

## Decision

We will refactor the API layer to adopt the following standards:

1. **Canonical Dependency Object**
   - Define a single, canonical `AppDependencies` object, documented in `src/types/AppDependencies.js` (or equivalent).
   - All API modules (internal, external, submodules) will accept this object and destructure only what they need.
   - The dependency contract will be documented and versioned.

2. **Centralized Middleware**
   - All authentication and error-handling middleware will be moved to `src/api/middleware/`.
   - Middleware will be imported and used consistently in both internal and external API routers.

3. **Declarative Router Registration**
   - API route registration will be driven by a manifest or registry, describing all available routes and their dependencies.
   - Router mounting will be declarative, not imperative, and will fail fast or provide clear fallbacks if dependencies are missing.

4. **Unified Error Handling**
   - A shared error utility will be created for formatting and logging errors.
   - Both internal and external APIs will use this utility for consistent error responses.

5. **Centralized Configuration Management**
   - All configuration and environment variables will be loaded in a single module (`src/config.js`).
   - Config will be injected as part of the canonical dependency object.

6. **Documentation and Interface Contracts**
   - All interfaces between layers will be documented, including expected inputs/outputs and error handling.
   - The dependency object and API contracts will be versioned and reviewed at each phase checkpoint.

## Consequences

- **Improved Consistency:** All API modules will receive a well-documented, consistent set of dependencies, reducing confusion and onboarding time.
- **Testability:** Centralized dependency injection and middleware make it easier to mock and test API modules in isolation.
- **Scalability:** Declarative router registration and clear contracts support easier addition of new API endpoints and services.
- **Maintainability:** Centralized error handling and configuration reduce duplication and risk of drift.
- **Alignment:** This approach enforces the architectural boundaries and collaboration protocols defined in AGENT_COLLABORATION_PROTOCOL.md and REFACTOR_GENIUS_PLAN.md.

## Alternatives Considered

- **Status Quo:** Continue with ad-hoc dependency injection and router mounting. Rejected due to increasing technical debt and risk of architectural drift.
- **Framework Migration:** Move to a full-featured DI framework (e.g., InversifyJS). Rejected for now due to migration overhead and desire to keep the stack simple.
- **Partial Refactor:** Only address middleware or router registration. Rejected as insufficient to address the root causes of inconsistency.

## Implementation Plan

1. Define and document the canonical `AppDependencies` object.
2. Refactor all API modules to accept and use this object.
3. Move all middleware to `src/api/middleware/` and update imports.
4. Create a route manifest/registry and refactor router mounting.
5. Implement a shared error utility and update all error handling.
6. Centralize configuration loading and injection.
7. Update documentation and interface contracts.
8. Validate with Playwright/API tests and user review.

---

*This ADR was created in accordance with the AGENT_COLLABORATION_PROTOCOL.md. All changes will be demonstrated and reviewed before phase advancement.* 