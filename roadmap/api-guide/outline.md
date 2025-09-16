# API Guide — Outline

## Problem Statement
Developers need a single, authoritative example that demonstrates how to interact with StationThis Deluxe Bot’s external API. Lacking such guidance slows adoption and leads to integration errors.

## Vision
Provide a master demonstration script (`scripts/api-guide-demo.js`) that developers can run with command arguments to exercise core API endpoints. Complement this with updated documentation under `public/docs/content/api.md` containing copy-pasteable cURL examples and explanations for each operation.

## Acceptance Criteria
- Demo script supports commands: `connect-wallet`, `check-account`, `request-generation`.
- Script prints requests and formatted JSON responses.
- Documentation page lists each function with endpoint, parameters, example cURL, and expected response.
- Docs manifest already links id `api`; content updated without breaking other docs.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Script prototype | Minimal working script hitting staging API | 2025-09-16 |
| Documentation draft | Fill out `api.md` with examples | 2025-09-16 |
| ADR approved | Implementation approach recorded | 2025-09-16 |
| Merge & deploy | Docs site rebuilt with new page | 2025-09-17 |

## Dependencies
- External API endpoints must be stable and accessible from local dev.
