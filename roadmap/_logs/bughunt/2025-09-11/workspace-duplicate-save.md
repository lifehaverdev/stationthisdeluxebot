# Bug Hunt: Workspace Duplicate Save Issue

## Issue
When saving a workspace that you own, the system was creating duplicate workspaces instead of updating the existing one.

## Root Cause
1. API silently fell through to workspace creation when update failed
2. Frontend URL update used wrong slug variable

## Fix
1. Modified `src/api/internal/workspacesApi.js` to properly handle workspace update errors:
   - Return 403 for unauthorized updates
   - Return 404 for non-existent workspaces
   - Return 500 for other errors
   
2. Fixed `src/platforms/web/client/src/sandbox/workspaces.js` to use correct slug variable when updating URL:
   ```diff
   - url.searchParams.set('workspace', slug);
   + url.searchParams.set('workspace', savedSlug);
   ```

## Verification
1. Save new workspace -> URL updates correctly
2. Update existing workspace -> Updates in place, URL unchanged
3. Try to update someone else's workspace -> Gets 403 error
4. Try to update non-existent workspace -> Gets 404 error

## Follow-up Tasks
- Add integration tests for workspace save/update flows
- Add frontend error handling for specific error codes
- Consider adding workspace ownership validation on frontend to prevent unnecessary API calls
