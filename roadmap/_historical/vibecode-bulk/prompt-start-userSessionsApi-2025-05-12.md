> Imported from vibecode/bulk/prompts/prompt-start-userSessionsApi-2025-05-12.md on 2025-08-21

# Prompt: Implement User Sessions API Service

**Objective**: Implement the Internal API service for User Sessions.

**Context**:
We have successfully implemented the User Core API service and refactored the DB service initialization to use proper logger injection, as detailed in `vibecode/handoffs/HANDOFF-2025-05-12.md`.
The overall architecture and goals are defined in:
*   `REFACTOR_GENIUS_PLAN.md`
*   `REFACTOR_NORTH_STAR.md`
*   `AGENT_COLLABORATION_PROTOCOL.md`

The API contract specifications are in `vibecode/decisions/ADR-003-InternalAPIForNoemaServices.md`.

**Instructions**:

1.  **Review Documents**: Familiarize yourself with the latest state by reviewing:
    *   `vibecode/handoffs/HANDOFF-2025-05-12.md` (Pay attention to "Next Tasks").
    *   `vibecode/decisions/ADR-003-InternalAPIForNoemaServices.md` (Focus on the "User Sessions" section for required endpoints and request/response formats).
    *   `AGENT_COLLABORATION_PROTOCOL.md` (Understand the expected workflow: build, test/demo, handoff).
2.  **Locate Files**: Identify the relevant files:
    *   API Service: `src/api/internal/userSessionsApi.js` (This might be a stub or non-existent; create/update as needed).
    *   DB Service: `src/core/services/db/userSessionsDb.js` (Verify its methods align with API needs).
    *   API Router Integration: `src/api/internal/index.js`.
3.  **Implement API Endpoints**: Implement the endpoints for the User Sessions service as defined in `ADR-003`. This likely includes:
    *   `POST /sessions` (Create Session)
    *   `GET /sessions/{sessionId}` (Get Session by ID)
    *   `PUT /sessions/{sessionId}/end` (End Session)
    *   `GET /users/{masterAccountId}/sessions/active` (Get active sessions for a user)
    *   *(Verify ADR-003 for the exact list and details)*
4.  **Utilize Dependencies**: Your API service implementation function will receive `logger` and `db` dependencies. Use `db.userSessions` (which is now an instance with an injected logger) to interact with the database.
5.  **Optional DB Service Cleanup**: While implementing the API, review `src/core/services/db/userSessionsDb.js`. If you encounter any `console.log`, `console.warn`, or `console.error` calls, please update them to use `this.logger.info`, `this.logger.warn`, or `this.logger.error` respectively, as decided in the latest handoff.
6.  **Integrate Router**: Ensure the router created in `userSessionsApi.js` is correctly imported and mounted within `src/api/internal/index.js` under the `/sessions` path (or `/users/:id/sessions` as appropriate based on ADR-003 routing).
7.  **Test**: Use `curl` commands (or similar) to test each implemented endpoint thoroughly, covering success cases, error cases (invalid input, not found), etc.
8.  **Follow Protocol**: Adhere to the `AGENT_COLLABORATION_PROTOCOL.md` regarding iterative development, user checkpoints (demonstrate working endpoints), and creating a handoff document upon completion or pause.

**Initial Action**: Start by creating or locating `src/api/internal/userSessionsApi.js` and setting up the basic Express router structure, accepting the `logger` and `db` dependencies. 