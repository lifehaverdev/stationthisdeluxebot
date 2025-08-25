> Imported from vibecode/bulk/decisions/adr/ADR-013-External-API-Strategy.md on 2025-08-21

# ADR-013: External API Strategy

## Context
The project currently has a comprehensive internal API that powers platform-specific integrations like Telegram. There is a need to expose a subset of this functionality to external developers and third-party applications through a public-facing, secure, and well-documented External API.

This will allow for broader integration with our services, such as tool execution, model training, settings management, and more, mirroring the capabilities available through our first-party applications.

The primary challenge is to create this external API without compromising security, stability, or the clean architecture of the existing system. We need a strategy to select, expose, and protect internal endpoints for public consumption.

## Decision
We will introduce a dedicated External API gateway. This gateway will be responsible for:
1.  **Authentication & Authorization:** All requests to the external API will require a valid API key. This key will be associated with a user account and will be used to enforce permissions.
2.  **Request Validation:** The gateway will validate all incoming requests against a strict schema.
3.  **Rate Limiting:** To protect the system from abuse, the gateway will enforce rate limits on a per-key basis.
4.  **Endpoint Mapping:** The gateway will map public-facing API routes to the corresponding internal API services. This provides a layer of abstraction and allows us to control which endpoints are exposed.

We will create a new directory `src/api/external` to house the external API implementation. This will keep the external-facing concerns separate from the internal ones.

The initial set of endpoints to be exposed will be determined through an audit of the internal API, starting with core functionalities like:
-   User management (e.g., getting user status)
-   Image generation (`makeImage` workflow)
-   Spell execution
-   Model management (listing and importing)

We will adopt a phased approach, starting with a minimal set of read-only endpoints and gradually expanding to more complex and write-heavy operations.

## Consequences
- A new `src/api/external` module will be created.
- The existing API key schema within `userCore` documents will be leveraged and enhanced as needed.
- The external API will have its own versioning scheme (e.g., `/api/v1/...`).
- Internal services will not be directly exposed to the public internet, enhancing security.
- This creates a clear separation of concerns between internal and external APIs.
- The project will require new documentation for the external API.

## Alternatives Considered
- **Directly exposing internal API endpoints:** This was rejected due to significant security risks and the tight coupling it would create between our internal architecture and public-facing contracts. Any internal refactor would risk breaking the public API.
- **Creating a separate service:** Building an entirely separate microservice for the external API was considered. This was deferred as it would introduce significant operational overhead. The gateway approach within the existing monolith is more pragmatic for the current stage of the project. 