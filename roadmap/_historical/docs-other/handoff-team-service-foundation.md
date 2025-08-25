> Imported from docs/handoffs/handoff-team-service-foundation.md on 2025-08-21

# Handoff: Team Service Foundation (Milestone 1)

**Date:** $(date +%Y-%m-%d)
**From:** Prototype Agent
**To:** Development Team

## 1. Summary

This handoff covers the completion of Milestone 1 of the "Jobs and Teams Sprint Plan," which establishes the foundational infrastructure for Team entities and their basic management via an internal API.

The core components delivered include:
*   JSDoc schema definitions for `Team` and `TeamMembership`.
*   A `teamServiceDb.js` for handling business logic and database interactions related to teams.
*   Internal API endpoints for creating teams, retrieving team details, adding members, and listing a user's teams.
*   An ADR (`ADR-Teams.md`) documenting the design decisions and testing strategy.

## 2. Files Created

*   **Schema Definitions (JSDoc):**
    *   `src/core/teams/Team.js`: Defines the structure of a `Team` document.
    *   `src/core/teams/TeamMembership.js`: Defines the structure of a `TeamMembership` document linking users to teams.
*   **Service Layer:**
    *   `src/core/services/db/teamServiceDb.js`: Contains logic for CRUD operations on teams and management of team memberships (e.g., `createTeam`, `getTeamById`, `addMemberToTeam`, `getUserTeams`, `getTeamMembers`).
*   **API Layer:**
    *   `src/api/internal/teamsApi.js`: Defines an Express router with initial API endpoints for team management.
*   **Documentation:**
    *   `vibecode/decisions/adr/ADR-Teams.md`: Architectural Decision Record detailing the context, decision, schema, API, and testing strategy for the foundational team infrastructure.

## 3. Files Modified

*   `src/api/internal/index.js`: 
    *   Imported `createTeamServiceDb` and `createTeamsApi`.
    *   Instantiated `teamServiceDb` and added it to the shared `apiDependencies`.
    *   Initialized and mounted the `teamsApiRouter` to the main internal API router under the `/v1/data` path, enabling routes such as:
        *   `POST /internal/v1/data/teams`
        *   `GET /internal/v1/data/teams/:teamId`
        *   `POST /internal/v1/data/teams/:teamId/members`
        *   `GET /internal/v1/data/users/:masterAccountId/teams`

## 4. Key Functionalities Implemented

*   **Team Creation:** API endpoint and service logic to create a new team. The creating user is automatically added as the 'owner'.
*   **Team Retrieval:** API endpoint and service logic to fetch details of a specific team by its ID.
*   **Member Addition:** API endpoint and service logic to add a user to a team with a specified role ('member' or 'admin'). Includes a check to prevent adding duplicate members.
*   **User's Teams Retrieval:** API endpoint and service logic to list all teams a given user belongs to.
*   **Team Members Retrieval:** Service logic to list all members of a given team (though not yet exposed via a dedicated API endpoint in this milestone, the service method `getTeamMembers` exists).
*   **Database Collections:** The system is now prepared to use MongoDB collections named `teams` and `teamMemberships`.

## 5. Testing Strategy Outline

As detailed in `ADR-Teams.md`:
*   **Unit tests** for `teamServiceDb.js` methods focusing on logic, edge cases, and mock DB interactions.
*   **Integration tests** for `teamsApi.js` endpoints, verifying request/response cycles, status codes, and interaction with the service layer.

## 6. Next Steps (Milestone 2 Preview)

The immediate next steps will involve building upon this foundation, primarily focusing on:
*   Implementing the `TeamEconomyService` to manage team finances (`usdCredit`, `lineOfCredit`).
*   Updating the main debiting logic (`userEconomyApi.js`) to support contextual debiting from either user or team balances.
*   Adding `teamId` to relevant collections like `generationOutputs` and `transactions`.
*   Implementing context propagation in API requests.

Please review the created files and the ADR for detailed information. Ensure that the placeholder `$(date +%Y-%m-%d)` in this document and `ADR-Teams.md` is updated to the current date. 