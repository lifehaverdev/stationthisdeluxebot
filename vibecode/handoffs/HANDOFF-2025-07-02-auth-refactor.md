# HANDOFF: 2025-07-02 - Auth Refactor

## Work Completed
- **Phase 1 (Planning):** Completed initial planning and investigation.
- **Phase 2 (Execution):**
  - Implemented a multi-faceted authentication modal on the landing page.
  - Added client-side and server-side logic for three authentication methods:
    - **Web3:** Nonce generation, signature verification, and user creation/lookup.
    - **API Key:** Validation against the internal API.
    - **Username/Password:** Secure password verification using scrypt.
  - Implemented JWT generation upon successful authentication and storage in `localStorage`.
  - Created an `auth.js` script to automatically inject the JWT into all API requests.
- **Phase 3 (Post-Login Routing):**
  - Secured the main application entry point (`/`) to require a valid JWT.
  - Added a `/api/v1/user/me` endpoint to fetch authenticated user data.
- **Architectural Refactoring:**
  - Moved all direct database operations from the external-facing `authApi` and `userApi` to the internal API layer, adhering to the project's architectural principles.
  - Created new internal endpoints (`/auth/find-or-create-by-wallet`, `/auth/verify-password`) to support this delegation.

## Current State
The initial implementation of the authentication refactor is complete. All three login methods are wired up on the frontend and backend. The application now requires a valid JWT to access the main interface. A provisioning script for creating test users with passwords has been created.

## Next Tasks
The high-level objective is to refactor the authentication flow to support Web3, username/password, and API key logins.

### Phase 1: Planning
1.  **Inspect & Map Current Entry Flow**: Review `public/landing.html` and `public/js/landing-page.js` to understand the current "Begin" button functionality and navigation.
2.  **Design Modal Auth UI**: Create a new `AuthModal` component triggered by the "Begin" button, including UI for all three login methods.
3.  **Backend Integration Planning**: Define the required backend endpoints (`/auth/web3`, `/auth/password`, `/auth/apikey`) and the expected JWT response.
4.  **Session Handling**: Plan for secure JWT storage (e.g., localStorage) and injection into API request headers.

### Phase 2: Execution
5.  **Build AuthModal Component**: Implement the modal to block navigation until authentication is successful.
6.  **Implement Wallet Connect**: Use `ethers.js` for wallet signature verification against a backend nonce.
7.  **Implement Username/Password & API Key Logins**: Build forms and logic to submit credentials to the respective endpoints.
8.  **Store & Use JWT**: Save the JWT upon successful login and ensure it's used for subsequent API calls.

### Phase 3: Post-Login Routing
9.  **Redirect & Load Application**: Forward the user to the main application upon successful authentication.
10. **Show User Info in Header**: Fetch and display user-specific data in the application header.

11. - **Comprehensive Testing:**
  - Validate the "Connect Wallet" login flow.
  - Provision a test user using the `scripts/auth/provision-user.js` script and test the username/password login.
  - Test the API key login flow.
  - Verify that unauthenticated users are correctly redirected to the landing page.
  - Confirm that the `logout` functionality works as expected.
  - Test that user data is correctly fetched and available after login.

## Changes to Plan
- Added an intermediate refactoring step to align the new authentication endpoints with the established internal/external API architecture.

## Open Questions
- The user information is available via `/api/v1/user/me` but is not yet displayed in the UI after login. This can be a follow-up task. 