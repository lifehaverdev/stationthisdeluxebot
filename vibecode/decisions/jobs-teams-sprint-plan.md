# Jobs and Teams Sprint Plan

This document outlines the plan for implementing Team-based infrastructure and a Job (multi-step toolchain) system, based on discovery from `ACCOUNT_TEAM_INFRASTRUCTURE.md` and `handoff-JOB_DISCOVERY.md`.

## 1. Core Components/Modules to be Updated or Created

### Team-Related Components (derived from `ACCOUNT_TEAM_INFRASTRUCTURE.md`):
*   **`TeamService` (or `TeamManager`):**
    *   Responsibilities: CRUD operations for `Team` entities (creation, updates, deletion), management of team members (adding, removing, updating roles), and handling team invitations.
*   **`TeamEconomyService`:**
    *   Responsibilities: Managing team financial aspects including `teams.usdCredit` (shared balance), `teams.lineOfCredit` (setup, tracking debt, limits), and processing direct funding or repayments for teams.
*   **`ContextResolutionService` (or similar middleware/logic):**
    *   Responsibilities: Determining whether an action is performed in a user's personal context or a team context. This will be crucial for API requests and bot commands to ensure correct resource allocation and debiting.
    *   To be integrated into API gateways and platform-specific handlers (Telegram, Web).

### Job-Related Components (derived from `handoff-JOB_DISCOVERY.md`):
*   **`JobDefinitionRegistry`:**
    *   Responsibilities: Loading, validating, and providing access to `JobDefinition` schemas. Analogous to the existing `ToolRegistry`.
*   **`JobOrchestrator` (or `JobRunner`, `ChainedToolExecutor`):**
    *   Responsibilities: Managing the lifecycle of a Job execution. This includes:
        *   Interpreting `JobDefinition.steps`.
        *   Executing individual tools in sequence or based on dependencies.
        *   Mapping outputs from one step to inputs of subsequent steps.
        *   Managing state across steps.
        *   Handling errors and retries as per job/step definitions.
*   **`JobService`:**
    *   Responsibilities: Providing an interface for submitting new jobs, tracking the status of ongoing and completed jobs (via `jobRecords`), and interacting with the `JobOrchestrator`.

### Shared/Updated Components:
*   **`ToolRegistry` / `ToolDefinition`:**
    *   Update: `ToolDefinition` needs a more explicit and structured `outputSchema` to facilitate reliable input/output mapping in Jobs (as highlighted in `handoff-JOB_DISCOVERY.md`).
*   **`WorkflowsService` (`src/core/services/comfydeploy/workflows.js`):**
    *   Update: May need to be aware of whether a request is for a single tool or a Job. If a Job, it might delegate execution to the `JobOrchestrator` or use it.
*   **`UserEconomyService` / Debit Logic (`src/api/internal/userEconomyApi.js`):**
    *   Update: The debiting endpoint and associated logic must be enhanced to check for a `teamId` in the context. If present, it should debit from the `TeamEconomyService` (team balance or line of credit) instead of the user's personal `userEconomy.usdCredit`.
*   **`NotificationDispatcher` (`src/core/services/notificationDispatcher.js`):**
    *   Update: Extend to handle notifications related to team activities (e.g., invitations, member changes, low team balance warnings) and job statuses (e.g., job completion, failure, step progress).
*   **API Routers (e.g., `src/platforms/web/routes/index.js`):**
    *   Update: Introduce new API endpoints for team management and job execution. Modify existing tool execution endpoints to accept context information.
*   **Webhook Processors (e.g., `src/core/services/comfydeploy/webhookProcessor.js`):**
    *   Update: Webhook handlers for tool completions need to be aware of Jobs. If a completed tool execution is part of a Job, the webhook should notify the `JobOrchestrator` to update the `jobRecord` and potentially trigger the next step.

## 2. Database Schema Additions or Changes

### Team-Related Schemas (from `ACCOUNT_TEAM_INFRASTRUCTURE.md`):
*   **New Collection: `teams`**
    *   Schema as proposed in `ACCOUNT_TEAM_INFRASTRUCTURE.md`, including fields like `_id`, `teamName`, `ownerMasterAccountId`, `adminMasterAccountIds`, `memberMasterAccountIds`, `usdCredit`, `lineOfCredit`, `usageLimits`, `userDefaultSettingsOverrides`, `invitations`.
*   **New Collection: `teamMemberships`**
    *   Schema as proposed in `ACCOUNT_TEAM_INFRASTRUCTURE.md`, linking users to teams with roles and specific settings: `_id`, `teamId`, `masterAccountId`, `role`, `joinedAt`, `settings` (e.g., `individualSpendingCapUsd`).
*   **Modify `generationOutputs` Collection:**
    *   Add: `teamId: { bsonType: "objectId", nullable: true }` - To associate generation records with a team if the job was run in a team context.
*   **Modify `transactions` Collection:**
    *   Add: `teamId: { bsonType: "objectId", nullable: true }` - To link financial transactions to a team when team funds are used.
    *   Consider: `contextType: { bsonType: "string", enum: ["user", "team"] }` for clarity.

### Job-Related Schemas (from `handoff-JOB_DISCOVERY.md`):
*   **New Collection: `jobDefinitions`**
    *   Purpose: To store the definitions of multi-step jobs/toolchains.
    *   Schema based on the `JobDefinition` proposal in `handoff-JOB_DISCOVERY.md`, including `jobId`, `displayName`, `description`, `inputSchema`, `outputSchema`, and `steps` (with `stepId`, `toolId`, `inputMappings`, `dependencies`).
*   **New Collection: `jobRecords`**
    *   Purpose: To track the execution status and results of individual job instances.
    *   Schema based on the `jobRecord` proposal in `handoff-JOB_DISCOVERY.md`, including `_id` (unique job run ID), `jobDefinitionId` (FK to `jobDefinitions`), `masterAccountId` (initiator), `teamId` (if run in team context), `status`, `jobInputs`, `stepStatuses` (tracking individual `generationId` for each step), `finalOutputs`, and timestamps.
*   **Modify `toolDefinitions` (or equivalent storage for `ToolDefinition`):**
    *   Enhance: Add a structured `outputSchema` field to `ToolDefinition` as recommended in `handoff-JOB_DISCOVERY.md` (Section 4.2) to specify named outputs and their types. This is critical for reliable `inputMappings` in `JobDefinition.steps`.

## 3. Plan for Command Handler Integration (Telegram, API)

A key change across all handlers will be the introduction of **Execution Context**.
*   **API:** This could be an HTTP header (e.g., `X-Execution-Context: team/{team_id}` or `X-Execution-Context: user/{user_id_or_default}`) or part of the request payload (e.g., `context: { type: "team", id: "teamObjectId" }` as suggested in `ACCOUNT_TEAM_INFRASTRUCTURE.md`).
*   **Telegram:** This might involve:
    *   A command to set the active context (e.g., `/setcontext team <team_name>`).
    *   The bot remembering the user's last active context.
    *   Passing context implicitly if a command is used in a group chat linked to a team (though explicit is safer for costing).

### API Handlers (e.g., `src/platforms/web/routes/index.js`):
*   **New Endpoints for Team Management:**
    *   `POST /teams` (Create team)
    *   `GET /teams/{teamId}` (Get team details)
    *   `PUT /teams/{teamId}` (Update team)
    *   `POST /teams/{teamId}/members` (Add/invite member)
    *   `PUT /teams/{teamId}/members/{memberMasterAccountId}` (Update member role/settings)
    *   `DELETE /teams/{teamId}/members/{memberMasterAccountId}` (Remove member)
    *   `POST /teams/invitations/{inviteCode}/accept` (Accept invitation)
    *   `GET /users/{masterAccountId}/teams` (List user's teams)
    *   `POST /teams/{teamId}/economy/credit` (Fund team)
    *   (As outlined in `ACCOUNT_TEAM_INFRASTRUCTURE.md` Section 3)
*   **New Endpoints for Job Execution:**
    *   `POST /jobs/run/{jobId}` (Submit a job for execution, payload includes `jobInputs` and `context`).
    *   `GET /jobs/status/{jobRunId}` (Get the status and results of a specific job run).
    *   `GET /users/{masterAccountId}/jobs` (List jobs initiated by a user).
    *   `GET /teams/{teamId}/jobs` (List jobs run under a team's context).
*   **Modify Existing Tool Run Endpoints (e.g., `/api/internal/run/:toolId`, `/api/internal/comfy/run/:deployment_id`):**
    *   These endpoints must be updated to accept and process the `context` (user or team).
    *   The context will be passed to the debiting logic.
*   **Modify Debit Endpoint (`POST /v1/data/users/:masterAccountId/economy/debit`):**
    *   As per `ACCOUNT_TEAM_INFRASTRUCTURE.md` (Section 2.5), this endpoint needs to:
        *   Accept an optional `teamId` (or full context object) in its payload.
        *   If `teamId` is provided, it should call the `TeamEconomyService` to debit the team's balance or line of credit.
        *   The `masterAccountId` in the path will still identify the initiating user for audit purposes.

### Telegram Command Handlers (e.g., `src/platforms/telegram/dynamicCommands.js`):
*   **Context Management Commands:**
    *   e.g., `/mycontext` (show current context), `/setcontext personal`, `/setcontext team <team_name_or_id>`.
*   **Team Management Commands:**
    *   e.g., `/createteam <team_name>`, `/invitemember <user> to <team_name>`, `/leaveteam <team_name>`, `/teaminfo <team_name>`.
*   **Job Execution Commands:**
    *   Similar to dynamic tool commands, jobs from `JobDefinitionRegistry` could be exposed as commands (e.g., `/<job_display_name> <job_inputs>`).
    *   The handler will parse inputs, retrieve the active `context` (user or team), and make an internal API call to the new `/jobs/run/{jobId}` endpoint, including the context.
*   **Existing Tool Commands:**
    *   When a user runs a regular tool command, the handler should retrieve the active `context` and pass it along with the internal API call to the tool execution endpoint.

## 4. Milestone Plan (with Estimated Agent Tasks)

### Milestone 1: Foundational Team Infrastructure
*Goal: Establish core Team entity, membership, and basic management APIs.*
*   **Task 1.1: DB Schema Implementation (Teams)**
    *   Action: Implement MongoDB schemas for `teams` and `teamMemberships` as defined in `ACCOUNT_TEAM_INFRASTRUCTURE.md`.
    *   Agent Task: Prototype building (generate schema files, validation rules).
*   **Task 1.2: `TeamService` - Core Logic**
    *   Action: Develop `TeamService` with methods for creating teams, adding/removing members, and retrieving team/member data.
    *   Agent Task: Prototype building (service class structure, core CRUD methods).
*   **Task 1.3: Basic Team Management API Endpoints**
    *   Action: Create initial API endpoints for: `POST /teams`, `GET /teams/{teamId}`, `POST /teams/{teamId}/members`, `GET /users/{masterAccountId}/teams`.
    *   Agent Task: Prototype building (scaffold API routes, controllers).
*   **Task 1.4: ADR - Team Entity & Basic Management**
    *   Action: Draft and propose an ADR for the Team entity, `teamMemberships`, and basic management functionality.
    *   Agent Task: ADR proposal (generate ADR document from schema and service design).
*   **Task 1.5: Initial Test Coverage**
    *   Action: Write unit and integration tests for `TeamService` and the basic API endpoints.
    *   Agent Task: Test coverage (generate test stubs, basic test cases).

### Milestone 2: Team Economy and Contextual Debiting
*Goal: Enable teams to have balances/credit and integrate team-based debiting into the existing payment flow.*
*   **Task 2.1: `TeamEconomyService` Implementation**
    *   Action: Develop `TeamEconomyService` to manage `teams.usdCredit` and `teams.lineOfCredit` (funding, debt tracking, limit enforcement).
    *   Agent Task: Prototype building (service methods for financial operations).
*   **Task 2.2: Update Debit Logic & API**
    *   Action: Modify `userEconomyApi.js` (debit endpoint) and related services (e.g., `webhookProcessor.js`) to handle `teamId` in the debit request and route to `TeamEconomyService` or user's personal balance as appropriate.
    *   Agent Task: Code scraping (analyze existing debit flow), prototype building (modify services).
*   **Task 2.3: DB Schema Updates (Financial)**
    *   Action: Add `teamId` to `generationOutputs` and `transactions` collections.
    *   Agent Task: Prototype building (update schema files).
*   **Task 2.4: Context Propagation in APIs**
    *   Action: Implement the chosen mechanism for passing execution context (user vs. team) in API requests for tool/job runs.
    *   Agent Task: Prototype building (modify API request handling, middleware).
*   **Task 2.5: Test Coverage (Team Economy)**
    *   Action: Test team funding, debiting from team balance, line of credit usage, and correct transaction logging.
    *   Agent Task: Test coverage.
*   **Task 2.6: ADR - Team Economy & Contextual Debiting**
    *   Action: Draft and propose an ADR for the team economy model and changes to the debiting process.
    *   Agent Task: ADR proposal.

### Milestone 3: Job Definition and Basic Orchestration
*Goal: Establish the ability to define multi-step jobs and a basic orchestrator to run them linearly.*
*   **Task 3.1: DB Schema Implementation (Jobs)**
    *   Action: Implement MongoDB schemas for `jobDefinitions` and `jobRecords` as per `handoff-JOB_DISCOVERY.md`.
    *   Agent Task: Prototype building.
*   **Task 3.2: `ToolDefinition.outputSchema` Enhancement**
    *   Action: Formalize and implement the `outputSchema` in `ToolDefinition`. Update `ToolRegistry` and any dynamic `ToolDefinition` creation logic (e.g., `workflowCacheManager.js`).
    *   Agent Task: Code scraping (identify where ToolDefinitions are managed/created), prototype building.
*   **Task 3.3: `JobDefinitionRegistry` and `JobService`**
    *   Action: Create `JobDefinitionRegistry` for loading/managing `JobDefinition`s. Create `JobService` for submitting jobs and managing `jobRecords`.
    *   Agent Task: Prototype building.
*   **Task 3.4: Basic `JobOrchestrator` (Linear Execution)**
    *   Action: Implement an initial `JobOrchestrator` capable of executing a linear sequence of tool steps (e.g., ComfyUI tools only initially). Focus on invoking tools via existing services and basic state management for outputs->inputs.
    *   Agent Task: Prototype building.
*   **Task 3.5: Test Coverage (Basic Jobs)**
    *   Action: Test defining a simple job, submitting it, and basic linear execution.
    *   Agent Task: Test coverage.
*   **Task 3.6: ADR - Job Definition & Orchestration**
    *   Action: Draft and propose an ADR for `JobDefinition`, `jobRecord`, and the initial `JobOrchestrator` design.
    *   Agent Task: ADR proposal.

### Milestone 4: Full Integration, Advanced Features & Platform Support
*Goal: Integrate jobs with command handlers, enable team-context job execution, and implement advanced team/job features.*
*   **Task 4.1: API and Webhook Integration for Jobs**
    *   Action: Create API endpoints for job submission and status. Update webhook processing to notify `JobOrchestrator` about step completions, update `jobRecords`, and trigger subsequent steps.
    *   Agent Task: Prototype building, code scraping (webhook logic).
*   **Task 4.2: Telegram Handler Integration for Jobs & Teams**
    *   Action: Implement Telegram commands for context switching, basic team management, and running jobs. Ensure context is passed to internal APIs.
    *   Agent Task: Prototype building.
*   **Task 4.3: Advanced `JobOrchestrator` Features**
    *   Action: Enhance `JobOrchestrator` to fully support `inputMappings` (from job inputs, previous steps, static values) and step dependencies.
    *   Agent Task: Prototype building.
*   **Task 4.4: Team-Context Job Execution**
    *   Action: Ensure jobs can be run within a team context, with costs correctly debited from the team's economy. Associate `jobRecords` with `teamId`.
    *   Agent Task: Integration testing, minor refactoring if needed.
*   **Task 4.5: Advanced Team Management Features**
    *   Action: Implement remaining team features from `ACCOUNT_TEAM_INFRASTRUCTURE.md` (invitations, detailed roles, usage limits, default settings overrides).
    *   Agent Task: Prototype building.
*   **Task 4.6: Extended Test Coverage**
    *   Action: Comprehensive tests for job execution (including error handling, different step types), team-context jobs, and all team management functionalities.
    *   Agent Task: Test coverage.
*   **Task 4.7: Notification System Enhancements**
    *   Action: Extend `NotificationDispatcher` to send notifications for relevant team events and job status updates.
    *   Agent Task: Prototype building.

### Cross-Cutting Concerns (Ongoing throughout milestones)
*   **Documentation:** Update existing developer documentation and create user-facing guides for new Team and Job functionalities. (Agent Task: Documentation generation)
*   **UI/UX (Parallel Track):** While APIs are being built, a separate track should focus on designing and implementing UI elements for team management, context switching, and job interaction in web platforms. API development should support these UI needs.
*   **Refactoring:** Iteratively refactor existing services (e.g., `WorkflowsService`, `ComfyUIService`) to cleanly integrate with the new Job and Team systems. (Agent Task: Code scraping, refactoring proposals) 