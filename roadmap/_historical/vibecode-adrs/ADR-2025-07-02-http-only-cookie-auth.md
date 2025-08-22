> Imported from vibecode/decisions/adr/ADR-2025-07-02-http-only-cookie-auth.md on 2025-08-21

# ADR-2025-07-02: Switch to HTTP-only Cookie Authentication for Web Login

## Context

Previously, the StationThis web platform stored JWT tokens in `localStorage` on the client and sent them in API requests for authentication. This approach is common in SPAs but has significant security and architectural drawbacks:
- **Security:** JWTs in localStorage are vulnerable to XSS attacks, allowing attackers to steal tokens and impersonate users.
- **SSR/Server-side Rendering:** The server cannot access localStorage, making it impossible to protect SSR routes or perform server-side authentication checks.
- **Manual Token Management:** The frontend must manually attach the JWT to every request, increasing complexity and risk of mistakes.
- **Industry Best Practice:** Modern web apps (Next.js, Rails, Django, etc.) recommend using HTTP-only cookies for authentication tokens.

## Decision

We will switch from storing JWTs in localStorage to using HTTP-only, Secure cookies for authentication. This involves:
- On successful login (Web3, password, or API key), the backend will set a `Set-Cookie` header with the JWT as an HTTP-only, Secure cookie (e.g., `jwt=...; HttpOnly; Secure; SameSite=Lax`).
- The frontend will no longer store JWTs in localStorage or send them in headers.
- The `authenticateUser` middleware will read the JWT from the cookie and validate it on every request.
- The logout endpoint will clear the cookie.

## Consequences

- **Security:** JWTs are no longer accessible to JavaScript, mitigating XSS token theft.
- **SSR/Server Auth:** The server can always check authentication, enabling SSR and server-side route protection.
- **Simpler Frontend:** No need to manage JWTs in localStorage or attach them to requests.
- **CSRF:** Using cookies introduces CSRF risk, but this can be mitigated with `SameSite=Lax` or `Strict` and/or CSRF tokens for state-changing requests.
- **User Experience:** Auth state is preserved across tabs and browser reloads, as cookies are sent automatically.

## Alternatives Considered

- **Continue with localStorage:** Rejected due to XSS risk and lack of SSR support.
- **Session cookies (server-side sessions):** More secure but less scalable for stateless APIs; not chosen for this phase.
- **Hybrid (cookie + header):** Adds complexity without clear benefit for our use case.

## Migration Checklist (2025-07-02)

- [x] Update all login endpoints to set the JWT as an HTTP-only cookie
- [x] Update `authenticateUser` middleware to read JWT from the cookie
- [x] Remove all localStorage JWT logic from the frontend
- [x] Update logout to clear the cookie
- [x] (Optional, future) Add CSRF protection for state-changing requests

**Status:** ✅ Migration complete. Ready for frontend and end-to-end testing.

---

## CSRF Protection Plan (2025-07-02)

### Why
- Now that authentication uses cookies, CSRF (Cross-Site Request Forgery) is a potential risk for state-changing requests (POST/PUT/DELETE).
- Protecting against CSRF is vital for user security, especially when real money or sensitive actions are involved.

### How
- Use the `csurf` middleware in Express to generate and validate CSRF tokens.
- Expose a `/api/v1/csrf-token` endpoint to provide the token to the frontend.
- Require the frontend to include the CSRF token in a header (e.g., `X-CSRF-Token`) for all state-changing requests.
- The backend will validate the token on every such request.

### Implementation Checklist
- [x] Install and configure `csurf` middleware in the Express app
- [x] Add `/api/v1/csrf-token` endpoint to serve the token to the frontend
- [x] Update frontend to fetch the CSRF token and include it in all POST/PUT/DELETE requests
- [x] Test that requests without a valid CSRF token are rejected
- [x] Document the CSRF flow for future contributors

**Status:** ✅ CSRF protection complete. All state-changing requests are now protected on both frontend and backend.

---

**Date:** 2025-07-02
**Author:** StationThis Engineering 