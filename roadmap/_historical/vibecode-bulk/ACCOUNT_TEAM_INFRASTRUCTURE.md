> Imported from vibecode/bulk/audits/ACCOUNT_TEAM_INFRASTRUCTURE.md on 2025-08-21

# Account and Team Infrastructure Audit

## 1. Current Account and Balance Management

### 1.1. Account Storage

User accounts and financial data are primarily managed through a MongoDB setup.

*   **`userCore` Collection**: Likely stores core user profile information, with `_id` serving as the `masterAccountId`.
*   **`userEconomy` Collection**:
    *   Managed by `src/core/services/db/userEconomyDb.js` (`UserEconomyDB`).
    *   Stores user-specific economic data linked via `masterAccountId`.
    *   Key fields:
        *   `usdCredit`: Stores the user's main balance as a `Decimal128`. This is the canonical currency for services.
        *   `exp`: Stores user experience points as a `BigInt`.
    *   Methods exist for creating records, finding by `masterAccountId`, updating/setting `usdCredit` and `exp`.
*   **`transactions` Collection**:
    *   Managed by `src/core/services/db/transactionsDb.js` (`TransactionsDB`).
    *   Logs all financial transactions (debits, credits).
    *   Key fields: `masterAccountId`, `type` (e.g., `generation_debit`, `credit`), `description`, `amountUsd`, `balanceBeforeUsd`, `balanceAfterUsd`, `relatedItems` (e.g., `generationId`, `toolId`).
*   **In-memory `lobby` (Legacy/Bot-Specific)**: Files like `archive/deluxebot/utils/bot/gatekeep.js` reference an in-memory `lobby` object that appears to cache some user data, including balance. This seems to be part of an older system or specific to bot interactions and is not the primary source of truth for `usdCredit`.

### 1.2. Debit Process for Tool Usage

The primary mechanism for debiting users for tool usage (e.g., ComfyUI generations) is centralized and webhook-driven:

1.  **Cost Rate Definition**: A `costRate` (e.g., USD per second) is associated with tools/deployments, potentially stored in `generationRecord.metadata.costRate`. This rate is determined at the time of tool invocation.
2.  **Generation Record Creation**: When a job is initiated, a record is created in the `generationOutputs` collection, including the `masterAccountId` and metadata like `costRate` and `toolId`.
3.  **Webhook Processing**:
    *   `src/core/services/comfydeploy/webhookProcessor.js` handles webhook events from generation services (e.g., ComfyDeploy).
    *   Upon successful job completion, it calculates the final `costUsd` based on the job's duration and the stored `costRate`.
4.  **Debit Invocation**:
    *   The `webhookProcessor.js` calls the internal API endpoint: `POST /v1/data/users/:masterAccountId/economy/debit`.
    *   The payload for this debit request includes `amountUsd`, `description`, `transactionType` (e.g., `"generation_debit"`), and `relatedItems` (like `toolId`, `generationId`).
    *   This API call is handled by `src/api/internal/userEconomyApi.js`.
5.  **Balance Update & Transaction Logging**:
    *   The `userEconomyApi.js` service:
        *   Validates the request and checks for sufficient funds in `userEconomy.usdCredit`.
        *   Calls `db.userEconomy.updateUsdCredit()` to deduct the `amountUsd` (by passing a negative value).
        *   Calls `db.transactions.logTransaction()` to record the debit in the `transactions` collection.
6.  **Failure Handling**:
    *   If the debit operation fails (e.g., insufficient funds), the `webhookProcessor.js` updates the corresponding `generationRecord` status to `payment_failed`.
    *   The system is designed not to deliver results if payment fails.

This process is outlined in `ADR-005-DEBIT.md` and its implementation handoff.

### 1.3. Association of Generation Records with Users

Generation records are stored in the `generationOutputs` collection, managed by `src/core/services/db/generationOutputsDb.js` (`GenerationOutputsDB`).

*   Each record in `generationOutputs` contains a `masterAccountId` field.
*   This `masterAccountId` directly links the generation event to a user in the `userCore` collection.
*   The schema (detailed in `ADR-002-NoemaCoreDataSchemas.md`) specifies `masterAccountId` as a required field in `generationOutputs`.
*   An API endpoint `GET /users/:masterAccountId/generations` (defined in `src/api/internal/userCoreApi.js`) allows retrieval of all generation records for a specific user.

### 1.4. Existing Grouping or Shared Context

The codebase contains evidence of a group chat management system, primarily in archived/legacy sections:

*   **`archive/firstvibecode/plans/iGroup.plan.md`** and **`archive/deluxebot/utils/bot/handlers/iGroup.js`**: These files describe functionality for managing Telegram group chats.
*   **Functionality**: Includes group initialization, administration by chat admins, group-specific settings (e.g., command availability, prompt behavior), and gatekeeping for chat access.
*   **Storage**: Group configurations appear to have been stored using `FloorplanDB`.
*   **Scope**: This "group" concept seems primarily focused on controlling bot behavior and command scopes within a specific chat platform (like Telegram, identified by `chatId < 0`). It allows for settings to be applied at a group level, which can then override or supplement individual user settings within that chat.
*   **No Shared Balances/Resources**: There is no indication that these legacy groups owned resources, shared balances (`usdCredit`), or functioned as "Teams" or "Organizations" in an economic sense. The `iMake.js` file shows group settings could influence user settings, but not that the group itself had a balance.

**Conclusion on Current State**: The current system has a robust individual account and debit model based on `usdCredit`. Grouping exists but is legacy and tied to chat platform features, not to shared economic entities.

## 2. Proposed Team-Layer Abstraction

To support team-based usage, shared resources, and billing, a new `Team` layer should be introduced. This layer will act as an umbrella for users, allowing collective ownership of balances, generation jobs, and usage limits.

### 2.1. Team Entity Definition

A new `Team` entity should be created, likely as a new collection in the database (e.g., `teams`).

**`teams` Collection Schema Proposal:**

```json
{
  "_id": { "bsonType": "objectId", "description": "Unique ID for the team." },
  "teamName": { "bsonType": "string", "description": "Display name of the team." },
  "ownerMasterAccountId": { "bsonType": "objectId", "description": "FK to userCore._id of the user who owns/created the team." },
  "adminMasterAccountIds": {
    "bsonType": "array",
    "description": "Array of masterAccountIds for users with admin privileges over the team.",
    "items": { "bsonType": "objectId" }
  },
  "memberMasterAccountIds": {
    "bsonType": "array",
    "description": "Array of masterAccountIds for users who are members of the team.",
    "items": { "bsonType": "objectId" }
  },
  "usdCredit": { "bsonType": "decimal", "description": "Team's available funds in USD. Can be funded directly or via lines of credit.", "default": "0.00" },
  "lineOfCredit": {
    "bsonType": "object",
    "description": "Details for the team's line of credit.",
    "properties": {
      "limitUsd": { "bsonType": "decimal", "description": "Maximum line of credit available in USD." },
      "currentDebtUsd": { "bsonType": "decimal", "description": "Current outstanding debt against the line of credit.", "default": "0.00" },
      "isEnabled": { "bsonType": "bool", "default": false }
    }
  },
  "usageLimits": {
    "bsonType": "object",
    "description": "Team-wide usage limits (e.g., monthly generation cap, specific tool access). Structure TBD.",
    "properties": {
        "monthlySpendCapUsd": { "bsonType": ["decimal", "null"], "description": "Optional monthly spending cap for the team." },
        "maxGenerationsPerMonth": { "bsonType": ["int", "null"], "description": "Optional cap on total generations per month for the team." }
    }
  },
  "userDefaultSettingsOverrides": {
      "bsonType": "object",
      "description": "Settings that can be enforced on team members when they operate under the team context.",
      "properties": {
          "defaultToolAccess": { "bsonType": "string", "enum": ["allow_all", "deny_all", "specific_list"], "default": "allow_all"},
          "allowedToolIds": { "bsonType": "array", "items": {"bsonType": "string"} },
          "deniedToolIds": { "bsonType": "array", "items": {"bsonType": "string"} }
      }
  },
  "invitations": {
      "bsonType": "array",
      "description": "Pending invitations to join the team.",
      "items": {
          "bsonType": "object",
          "properties": {
              "inviteCode": {"bsonType": "string", "description": "Unique code for the invitation."},
              "email": {"bsonType": "string", "description": "Email address invited (optional)."},
              "invitedByMasterAccountId": {"bsonType": "objectId"},
              "expiresAt": {"bsonType": "date"},
              "createdAt": {"bsonType": "date"}
          }
      }
  },
  "createdAt": { "bsonType": "date" },
  "updatedAt": { "bsonType": "date" }
}
```

**`userCore` Collection Modification (or new linking collection `teamMemberships`):**

To link users to teams, we can either add a field to `userCore` or use a dedicated `teamMemberships` collection. A dedicated collection is more flexible for storing role-specific information.

**`teamMemberships` Collection Schema Proposal:**

```json
{
    "_id": { "bsonType": "objectId" },
    "teamId": { "bsonType": "objectId", "description": "FK to teams._id" },
    "masterAccountId": { "bsonType": "objectId", "description": "FK to userCore._id" },
    "role": { "bsonType": "string", "enum": ["owner", "admin", "member"], "default": "member" },
    "joinedAt": { "bsonType": "date" },
    "settings": {
        "bsonType": "object",
        "description": "User-specific settings within this team context (e.g., notification preferences for team activity).",
        "properties": {
            "individualSpendingCapUsd": { "bsonType": ["decimal", "null"], "description": "Optional individual spending cap within the team's budget."}
        }
    }
}
```
This structure allows a user to be part of multiple teams with different roles.

### 2.2. Team Ownership of Balances, Jobs, and Limits

*   **Balances**:
    *   The `teams.usdCredit` field will hold the primary balance for team activities.
    *   This balance can be funded directly (e.g., by a team owner/admin topping up).
*   **Jobs (Generations)**:
    *   The `generationOutputs` collection needs a new optional field: `teamId` (ObjectId, nullable).
    *   When a user performs an action within a team context, the resulting `generationRecord` should be associated with both the `masterAccountId` (who initiated it) and the `teamId` (which context it belongs to and whose balance might be used).
*   **Limits**:
    *   `teams.usageLimits` can define overall caps for the team (e.g., monthly spend, number of generations).
    *   `teamMemberships.settings.individualSpendingCapUsd` can allow admins to set per-member spending limits within the team context, drawing from the team's balance.

### 2.3. Modeling Lines of Credit for Teams

The `teams.lineOfCredit` sub-document provides a way to manage lines of credit:

*   `limitUsd`: The maximum amount the team can owe.
*   `currentDebtUsd`: The amount currently drawn against the line ofcredit.
*   `isEnabled`: A boolean to activate or deactivate the line of credit.

**Credit Logic with Line of Credit:**

When a team-contexted job needs to be debited:
1.  Attempt to debit from `teams.usdCredit`.
2.  If `teams.usdCredit` is insufficient (or zero) AND `lineOfCredit.isEnabled` is true:
    *   Check if `lineOfCredit.currentDebtUsd + costUsd <= lineOfCredit.limitUsd`.
    *   If yes, increment `lineOfCredit.currentDebtUsd` by `costUsd`. The job proceeds.
    *   If no, the transaction fails due to insufficient funds/credit.
3.  If `teams.usdCredit` is insufficient and line of credit is disabled or insufficient, the transaction fails.

Repayments towards the line of credit would decrease `currentDebtUsd`. Funding the team could first pay down debt before increasing `usdCredit`.

### 2.4. Overriding Individual Account Limits

Team membership can provide users with higher limits or different access levels than their individual accounts.

*   **Tool Access**: `teams.userDefaultSettingsOverrides` can define which tools are accessible or restricted for members acting under the team context. This can override a user's personal tool access settings.
*   **Spending Limits**: A user's personal spending limit (if any, on their `userEconomy` record – though this isn't explicitly defined in the current search results for individual users, it's a common concept) would be superseded by the team's balance/line of credit and any `individualSpendingCapUsd` set within their `teamMemberships` record when they are operating in the team context.

### 2.5. Determining Which Balance to Debit (User vs. Team)

The system needs a clear way for users to specify the context of their actions. This could be achieved through:

1.  **Active Context Switching**:
    *   UI elements (e.g., a dropdown in a web app, a command in a bot) allowing a user to switch their "active context" between their personal account and any teams they are a member of.
    *   The selected context (`personal` or a specific `teamId`) would be passed along with API requests that might incur costs.
2.  **Implicit Context (Less Ideal for Costing)**: For certain scenarios, context might be inferred (e.g., a bot command issued in a chat linked to a team). However, for debiting, explicit context is safer.

**Debit Logic Flow:**

When a cost-incurring action is performed:

1.  **Identify Context**: Determine if the action is under `personal` context or a `teamId`.
    *   This should be an explicit part of the request payload (e.g., `context: { type: 'team', id: 'teamObjectId' }` or `context: { type: 'user' }`).
2.  **If `teamId` is present and valid**:
    *   Retrieve the team from the `teams` collection.
    *   Retrieve the user's membership details from `teamMemberships` to check for roles and individual caps.
    *   **Attempt Debit from Team Balance**:
        *   Check `team.usdCredit`. If sufficient, debit from here.
        *   Log the transaction in `transactionsDb`, including both `masterAccountId` (initiator) and `teamId`.
    *   **Attempt Debit from Team Line of Credit (if applicable)**:
        *   If `team.usdCredit` is insufficient and `team.lineOfCredit.isEnabled` and sufficient credit remains (`limitUsd - currentDebtUsd >= costUsd`).
        *   Increment `team.lineOfCredit.currentDebtUsd`.
        *   Log the transaction, noting it was covered by LOC. Indicate `teamId` and `masterAccountId`.
    *   If both team balance and LOC are insufficient, the action fails.
3.  **If context is `personal` (or no team context provided/valid)**:
    *   Debit from the user's `userEconomy.usdCredit` as per the current system.
    *   Log the transaction in `transactionsDb` with `masterAccountId`.
4.  **Generation Record Tagging**:
    *   If a debit is associated with a team, the `generationRecord.teamId` should be populated.

**API Modifications:**

*   Endpoints initiating generations (e.g., `POST /generations`) will need to accept an optional `context` object (e.g., `{ "teamId": "the_team_id_if_applicable" }`).
*   The `webhookProcessor.js` and subsequently the `/debit` API will need to be aware of this `teamId`.
*   The `/debit` endpoint in `userEconomyApi.js` will need to be enhanced:
    *   If `teamId` is provided in the debit request (alongside `masterAccountId` for auditing who performed the action):
        *   It should fetch team details.
        *   Apply the debit to `teams.usdCredit` or `teams.lineOfCredit.currentDebtUsd`.
        *   The transaction log should capture both `masterAccountId` and `teamId`.
    *   If no `teamId` is provided, it defaults to debiting the individual `masterAccountId`'s `userEconomy.usdCredit`.

## 3. Further Considerations & API Changes

*   **Team Management API Endpoints**:
    *   `POST /teams` (Create a new team, makes creator owner)
    *   `GET /teams/{teamId}` (Get team details)
    *   `PUT /teams/{teamId}` (Update team settings, name - owner/admin only)
    *   `DELETE /teams/{teamId}` (Delete team - owner only)
    *   `POST /teams/{teamId}/members` (Invite/add member - owner/admin)
    *   `PUT /teams/{teamId}/members/{memberMasterAccountId}` (Change member role/settings - owner/admin)
    *   `DELETE /teams/{teamId}/members/{memberMasterAccountId}` (Remove member - owner/admin; or user leaves)
    *   `POST /teams/{teamId}/invitations` (Create an invite link/email invite)
    *   `POST /teams/invitations/{inviteCode}/accept` (User accepts an invitation)
    *   `GET /users/{masterAccountId}/teams` (List teams a user is part of)
*   **Funding Endpoints**:
    *   `POST /teams/{teamId}/economy/credit` (Add funds to team balance)
    *   `POST /teams/{teamId}/economy/loc/repay` (Repay line of credit debt)
*   **Permissions and Roles**: A clear role-based access control (RBAC) system for team management actions (owner, admin, member).
*   **Notification System**: Users should be notified of team activities, invites, low balance warnings for teams, etc.
*   **UI/UX**: Clear UI for users to manage their teams, switch contexts, view team balances, and for admins to manage members and settings.
*   **Data Migration**: If any existing group structures need to be migrated or mapped to this new Team concept (unlikely given the current findings, but good to keep in mind).

This audit provides an initial framework. Detailed schema design for `usageLimits` and `userDefaultSettingsOverrides`, along with precise API contracts, would be the next step. 