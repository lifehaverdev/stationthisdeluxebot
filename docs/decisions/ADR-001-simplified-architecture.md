# ADR-001: Simplified Layered Architecture

## Context
The existing codebase is tightly coupled to Telegram and lacks clear separation of concerns. Previous attempts at refactoring introduced excessive abstraction layers including complex repository patterns, UI abstractions, workflow systems, and platform adapters, making the system difficult to understand and maintain.

We need an architecture that:
1. Decouples the system from specific platforms (Telegram, Discord, Web)
2. Maintains all existing functionality
3. Is simple enough to understand and maintain
4. Can be implemented incrementally without disrupting service

## Decision
We will adopt a simplified 5-layer architecture:

1. **Core Services Layer** - Platform-agnostic business logic
2. **Platform-Agnostic Workflows** - Multi-step interaction flows
3. **Platform Adapters** - Platform-specific implementations
4. **API Layer** - Internal and external APIs
5. **Entry Points** - Application entry points

Key principles:
- Services will not depend on platforms
- Workflows will coordinate services but not contain business logic
- Platform adapters will handle UI but not contain business logic
- Each layer will have clear responsibilities and interfaces

## Consequences

### Positive
- Clearer separation of concerns
- Easier to add new platforms
- More maintainable codebase
- Simpler mental model for developers
- Incremental implementation possible

### Negative
- Some duplication may occur in platform adapters
- May require adapter patterns for legacy code integration
- Initial setup requires careful design of interfaces

## Alternatives Considered

### Option 1: Full Microservices Architecture
Splitting the system into independent microservices communicated via message queues.
- **Pros**: Complete decoupling, independent scaling
- **Cons**: Too complex for current needs, operational overhead, not suitable for incremental migration

### Option 2: MVC Pattern
Using a classic Model-View-Controller pattern.
- **Pros**: Well-understood pattern, clear separation
- **Cons**: Less flexibility for multiple platforms, harder to evolve independently

### Option 3: Previous Complex Architecture
Continue with the previously attempted complex architecture with repositories, UI abstractions, etc.
- **Pros**: Already designed, more "enterprise-grade"
- **Cons**: Unnecessary complexity, difficult to understand, slower development

We selected the simplified layered architecture because it provides the necessary decoupling while remaining understandable and practical to implement incrementally. 