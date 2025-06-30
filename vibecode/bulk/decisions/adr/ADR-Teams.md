# ADR-Teams: Foundational Team Infrastructure

**Status:** Proposed

**Date:** $(date +%Y-%m-%d)

## Context

The project requires a system for users to collaborate, share resources, manage collective billing, and control access within defined groups. This is essential for features like team-based job execution, shared asset libraries, and consolidated billing. The existing system primarily supports individual user accounts without a formal team structure.

This ADR addresses Milestone 1 of the Jobs & Teams Sprint Plan, focusing on establishing the core data structures and APIs for teams.

## Decision

We will implement a foundational team infrastructure consisting of:

1.  **Core Entities:**
    *   `Team`: Represents a group of users with a name, owner, members, administrators, and placeholders for future economic attributes (credit, line of credit) and settings.
    *   `TeamMembership`: Links a user (`masterAccountId`) to a `Team` with a specific role (e.g., owner, admin, member) and join date.

2.  **`TeamServiceDb`:**
    *   A new database service (`src/core/services/db/teamServiceDb.js`) will encapsulate the business logic for managing these entities.
    *   Responsibilities:
        *   Creating new teams (including adding the owner as the first member).
        *   Retrieving team details by ID.
        *   Adding new members to a team with a specified role.
        *   Retrieving all teams a specific user belongs to.
        *   Retrieving all members of a specific team.
    *   This service will interact directly with MongoDB collections `teams` and `teamMemberships`.

3.  **Initial API Endpoints:**
    *   A new API router (`src/api/internal/teamsApi.js`) will expose the initial team management functionalities.
    *   These endpoints will be integrated into the main internal API router (`src/api/internal/index.js`) under the `/v1/data/` prefix:
        *   `POST /v1/data/teams`: Create a new team. Requires `teamName` and `ownerMasterAccountId`.
        *   `GET /v1/data/teams/:teamId`: Retrieve details for a specific team.
        *   `POST /v1/data/teams/:teamId/members`: Add a user (`masterAccountId`) to a team with a specified `role`.
        *   `GET /v1/data/users/:masterAccountId/teams`: List all teams that the specified user is a member of.

## Schema Definitions

JSDoc type definitions for `Team` and `TeamMembership` have been created in:
*   `src/core/teams/Team.js`
*   `src/core/teams/TeamMembership.js`

Key fields include:
*   **Team:** `_id`, `teamName`, `ownerMasterAccountId`, `adminMasterAccountIds`, `memberMasterAccountIds`, `usdCredit`, `lineOfCredit`, `createdAt`, `updatedAt`.
*   **TeamMembership:** `_id`, `teamId`, `masterAccountId`, `role`, `joinedAt`, `createdAt`, `updatedAt`.

(Refer to the actual JSDoc files for complete schema details.)

## Testing Strategy

*   **Unit Tests (for `teamServiceDb.js`):**
    *   Test each method in `teamServiceDb` in isolation.
    *   Cover valid inputs, expected successful outcomes (e.g., team creation, member addition).
    *   Test edge cases (e.g., adding an existing member, querying for a non-existent team/user).
    *   Verify correct interaction with mock database collections.
    *   Ensure proper handling of invalid input (e.g., invalid ObjectIds).
*   **Integration Tests (for API endpoints in `teamsApi.js`):**
    *   Test each API endpoint (`/teams`, `/teams/:teamId`, etc.).
    *   Verify correct request parsing and validation (e.g., required fields, ObjectId formats).
    *   Ensure endpoints correctly call the underlying `teamServiceDb` methods.
    *   Validate HTTP status codes and response payloads for successful operations and error conditions (e.g., 201, 200, 400, 404, 500).
    *   Test the full flow from API request to database interaction (using a test database if possible).
*   **Focus for Milestone 1:** The primary focus is on the successful creation of teams, retrieval of team information, addition of members, and listing user-associated teams. Error handling for common scenarios should also be robust.

## Consequences

*   **Positive:**
    *   Establishes the core data model and service layer for team functionality.
    *   Provides essential APIs for managing basic team structures.
    *   Paves the way for subsequent milestones, including team economy (`TeamEconomyService`), contextual debiting, and team-based job execution.
    *   Allows for early integration and testing of team concepts in other parts of the application.
*   **Negative/Risks:**
    *   This is only the foundational layer. Advanced features like invitations, detailed roles/permissions, team settings overrides, and UI are not yet implemented.
    *   The current implementation relies on `masterAccountId` for user identification; ensure this aligns with the broader user management system.
    *   Error handling in the initial service and API layers will need to be comprehensive and may require refinement as more complex scenarios are addressed.
*   **Future Work (Post-Milestone 1):**
    *   Implement `TeamEconomyService` for managing team finances.
    *   Integrate team context into debiting logic.
    *   Develop team invitation system.
    *   Implement more granular roles and permissions within teams.
    *   Build UI components for team management.

## Alternatives Considered

*   **Embedding Memberships in Team Document:** Instead of a separate `teamMemberships` collection, member information could be embedded within the `Team` document. This was rejected to allow for more flexible querying of memberships (e.g., find all teams for a user without scanning all teams), to avoid large team documents if member-specific settings grow, and to better align with common practices for many-to-many relationships.
*   **Different API Structure:** Alternative API path structures were considered. The chosen structure (`/v1/data/teams` and `/v1/data/users/:masterAccountId/teams`) aims for consistency with existing internal data APIs while keeping team-centric operations grouped. 