# ADR-001: Cost Accounting System Deferral

## Context
Following the refactoring of `comfydeploy` services and the addition of `cost_per_second` data to machine information fetched in `workflowCacheManager.js`, the next logical step appeared to be implementing a system to track user-incurred costs based on machine usage time.

However, a robust cost accounting system requires accurate tracking of user sessions and activities across multiple platforms (Discord, Telegram, Web). These platforms and their user/session management integrations are not yet fully implemented or stabilized. Building the accounting system now would rely on unstable foundations and likely require significant refactoring as the platform integrations evolve.

## Decision
We will defer the implementation of a comprehensive cost accounting system until the core application features, particularly user authentication, session management, and basic workflow execution, are demonstrably functional and stable across all primary target platforms (Discord, Telegram, Web).

We acknowledge the requirement for this system in the future. It should:
*   Track compute costs incurred by users based on machine usage duration and type.
*   Manage user balances, credits, and potential payment integrations.
*   Interface seamlessly with user sessions and platform-specific interactions to ensure accurate attribution of costs.

The `cost_per_second` data added to `workflowCacheManager.js` serves as a necessary prerequisite input for this future system but does not activate any cost tracking functionality at this time.

## Consequences
*   No cost tracking or billing functionality is currently implemented.
*   Users can utilize resources without incurring tracked costs within the application's internal systems.
*   Development focus remains on stabilizing core platform functionality and user experience before tackling complex subsystems like accounting.
*   The `cost_per_second` data in the machine cache is available for potential future use or manual analysis but is not actively used by any accounting logic.

## Alternatives Considered
1.  **Build Basic Accounting System Now:**
    *   *Rejected because:* The underlying user/session management required for accurate cost attribution across platforms is incomplete and subject to change. This would likely lead to significant rework and potential inaccuracies.
2.  **Implement Platform-Specific Tracking:**
    *   *Rejected because:* This would create data silos, making it difficult to maintain a unified view of a user's balance and usage across different platforms. A centralized, platform-agnostic accounting core interacting with platform adapters is preferred for long-term maintainability. 