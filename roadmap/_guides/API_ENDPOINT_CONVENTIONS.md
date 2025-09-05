# External API Endpoint Conventions

_Follows AGENT_COLLABORATION_PROTOCOL_v3 section 2 guidelines._

## 1  Namespace Rules
1. **Browser-facing endpoints** must be rooted at `/api/v1/<module>`.
2. **Server-to-server (internal) endpoints** live under `/internal/v1/data/<resource>`.
3. Never expose `/internal` routes to the public proxy.

## 2  File Location
| Layer | Path pattern | Example |
|-------|--------------|---------|
| External Router | `src/api/external/<module>Api.js` (or `<module>/index.js`) | `datasetsApi.js` → `/api/v1/datasets` |
| Internal Router | `src/api/internal/<module>sApi.js` | `datasetsApi.js` → `/internal/v1/data/datasets` |
| DB Service | `src/core/services/db/<resource>Db.js` | `datasetDb.js` |

## 3  Adding a New Module
1. **DB** – create `<Resource>Db.js`.
2. **Internal API** – create `<module>sApi.js`, mount in `src/api/internal/index.js`:
   ```js
   const createFoosApi = require('./foosApi');
   app.use('/internal/v1/data/foos', createFoosApi({ logger, db }));
   ```
3. **External API** – create `src/api/external/<module>Api.js`.
4. Register in `external/v1/index.js`:
   ```js
   foos: { path: './foosApi', auth: 'userOrApiKey' },
   ```
   The router mounts automatically at `/api/v1/foos`.
5. **Frontend** – fetch via `/api/v1/<module>`.

## 4  Auth
* Use `dualAuth` (API-key _or_ JWT) for modules that need user context.
* Use `apiKeyAuth` for admin/back-office modules.
* Public modules (no auth) still inherit rate-limit middleware.

## 5  Versioning
* Only bump the `/api/<version>` prefix when you introduce breaking response-shape changes across multiple modules.

---
_Last updated 2025-09-04_
