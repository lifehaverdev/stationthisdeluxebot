# README: Noema Database Service (`src/core/services/db`)

## Overview

This directory will house the new database access layer specifically designed to interact with the `noema` MongoDB database. The `noema` database implements a new, multi-platform user model centered around a `masterAccountId`.

This initiative follows the architectural decision outlined in `vibecode/decisions/ADR-001-MasterUserAccountAndNoemaDB.md`.

## Goals

1.  **Clean Separation:** Provide a distinct set of database classes and functions for `noema`, separate from the legacy database operations used for `stationthisbot`.
2.  **`masterAccountId`-Centric:** All user-related data operations must revolve around the `masterAccountId`.
3.  **Schema Adherence:** Strictly adhere to the defined schemas for `noema` collections (`userCore`, `userEconomy`, `userPreferences`, `transactions`, `workflowExecutions`).
4.  **Robust & Maintainable:** Create a well-structured, testable, and maintainable database access layer.
5.  **Support for Core Services:** Provide the necessary data access functions for all other core services, including analytics, session management, and platform adapters.

## Proposed Class Structure

New classes will be developed, potentially reusing or adapting concepts from the existing `BaseDB.js` where appropriate (e.g., connection management, batching, monitoring if generic enough).

1.  **`NoemaBaseDB` (or similar utility class/module):**
    *   Manages connections to the `noema` database.
    *   Provides core, low-level CRUD utilities.
    *   Handles consistent error logging and potentially monitoring.

2.  **`NoemaUserCoreDB`:**
    *   Manages the `userCore` collection (PK: `_id` as `masterAccountId`).
    *   Handles creation of master accounts.
    *   Manages linking/unlinking of platform identities (Telegram, Discord, etc.).
    *   Manages user wallets (ETH, SOL, etc.) including primary status.
    *   Manages API keys (generation, hashing, revocation, lookup).
    *   Provides methods to find `masterAccountId` via various identifiers.

3.  **`NoemaUserEconomyDB`:**
    *   Manages the `userEconomy` collection (FK: `masterAccountId`).
    *   Handles user `usdCredit` and `exp`.
    *   Operations to update `usdCredit` will trigger logging in `NoemaTransactionDB`.

4.  **`NoemaUserPreferencesDB`:**
    *   Manages the `userPreferences` collection (FK: `masterAccountId`).
    *   Handles CRUD for user-specific settings, organized by workflow/tool ID and global settings.

5.  **`NoemaTransactionDB`:**
    *   Manages the `transactions` collection (FK: `masterAccountId`).
    *   Logs all changes to `usdCredit` (debits, credits, bonuses, refunds).
    *   Provides methods to retrieve transaction history.

6.  **`NoemaWorkflowExecutionDB`:**
    *   Manages the `workflowExecutions` collection (FK: `masterAccountId`).
    *   Tracks the lifecycle (start, completion, failure) of paid workflow/tool executions.
    *   Stores input parameters, output results (e.g., image URLs), costs, and links to financial transactions.

## Key Design Considerations

*   **Atomicity:** Ensuring atomicity or proper compensation logic for operations spanning multiple collections (e.g., deducting credit and logging a transaction).
*   **Query Patterns & Indexing:** Designing methods and database indexes to support efficient querying based on anticipated needs (e.g., lookups by platform ID, wallet address, API key, date ranges for transactions/executions).
*   **Data Validation:** Implementing input validation for all data modification methods to maintain data integrity against the defined schemas.
*   **Asynchronous Operations:** All database interactions will be asynchronous (Promise-based).
*   **Configuration:** Database connection details (URI, DB name "noema") will be managed appropriately (e.g., via environment variables for URI, hardcoded "noema" for DB name as per initial decision).

## Development Approach

Development will be iterative. Initial focus will be on establishing `NoemaBaseDB` (or adapting the existing one) and then implementing `NoemaUserCoreDB` and `NoemaUserEconomyDB` as they are fundamental for the new user model and session management.

This service will be developed in parallel with the MVP analytics dashboard (which initially uses `stationthisbot` data) to ensure its design effectively supports future analytics needs once `noema` is the primary data source. 