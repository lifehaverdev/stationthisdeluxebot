# ADR-2025-07-01: Refactor of API Endpoints from Web Platform to External API

## Context

The current `src/platforms/web/routes/index.js` file contains a mix of:
- Navigation and admin dashboard routes (for browser users)
- Internal and public API endpoints (for programmatic access, webhooks, tool registry, etc.)

This blending of concerns has led to confusion, poor separation of responsibilities, and difficulty in maintaining a clear, modern architecture. According to our collaboration protocol and layered architecture principles, **API endpoints intended for programmatic access (scripts, agents, integrations, webhooks) should be served from the external API layer** (`src/api/external/`), while the web platform should only serve navigation and admin UI.

## Decision

We will **move all truly external API endpoints** out of `src/platforms/web/routes/index.js` and into `src/api/external/index.js` (or appropriate submodules).  
The web platform router will be reserved for navigation, admin HTML, and static file serving.

### Endpoints to be Migrated to External API (`src/api/external/`):
- `/api/webhook/comfydeploy`
- `/api/webhook/alchemy`
- `/api/internal/registry` (tool registry APIs)
- `/api/internal/run/...` (dynamic workflow APIs)
- `/api/v1/me/status` (user status API)
- `/api/tools` (tools API)
- `/api/auth` (authentication endpoints)
- `/api/collections` (collection management)
- `/api/status` (application status)
- `/api/health` (health check)
- `/api/admin/stats/*` (admin stats APIs, if needed for programmatic access)

**Legacy/Deprecated (to be removed, not migrated):**
- `/api/share`
- `/api/workflows`
- `/api/points`
- `/api/pipelines`
- `/files`

**To Remain in Web Platform (`src/platforms/web/routes/index.js`):**
- `/` (main site)
- `/landing`
- `/admin` (admin dashboard HTML)
- `/docs`
- Static file serving

## Consequences

- **Clear separation** between public/external API and internal web platform.
- **Easier maintenance** and onboarding for new developers.
- **Improved security** by restricting internal/admin endpoints to the web platform.
- **Better alignment** with modern web architecture and our collaboration protocol.

## Alternatives Considered

- Keeping all routes in a single router (status quo): rejected due to confusion and poor separation.
- Splitting by technical function (e.g., all webhooks together): less clear than splitting by audience (external vs. internal).

## Next Steps

- Migrate the listed endpoints to the external API.
- Remove deprecated endpoints.
- Update documentation and internal references.
- Validate with Playwright/API tests and user review. 