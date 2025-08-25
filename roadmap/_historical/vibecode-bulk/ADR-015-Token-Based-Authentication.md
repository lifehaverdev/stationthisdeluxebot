> Imported from vibecode/bulk/decisions/adr/ADR-015-Token-Based-Authentication.md on 2025-08-21

# ADR-015: Token-Based Authentication

## Context
We need a secure, elegant, and modern way to manage user sessions as they transition from the public-facing landing page to the interactive web application. The system must support multiple login methods (Wallet, Username/Password, API Key) and provide a seamless experience for returning users without compromising security. Putting session information in the URL is not a viable or secure option.

## Decision
We will implement a token-based authentication system using secure, `HttpOnly` cookies.

1.  **Login Flow:**
    -   The user initiates a login via one of the approved methods on the frontend.
    -   The frontend sends the user's credentials (or signed message from a wallet) to a dedicated endpoint in our **External API** (e.g., `/api/v1/auth/login`).
    -   The backend server verifies the credentials.
    -   Upon successful verification, the server generates a signed JSON Web Token (JWT). This token will contain the user's ID and an expiration date.

2.  **Session Management:**
    -   The server will set this JWT inside a cookie with the `HttpOnly` and `Secure` flags.
    -   `HttpOnly` prevents the token from being accessed by client-side JavaScript, mitigating XSS attacks.
    -   `Secure` ensures the cookie is only transmitted over HTTPS.

3.  **Authenticated Requests:**
    -   For all subsequent requests to our API, the browser will automatically include this cookie. A server-side middleware will validate the token on every incoming request to protected routes.

4.  **Returning User Experience:**
    -   When a user with a valid session cookie visits the site, our server-side routing logic will detect the valid session.
    -   Instead of serving the public `landing.html`, the server will immediately redirect the user to the main application interface (e.g., `/app`). This provides a seamless "auto-login" experience.

## Consequences

### Pros:
-   **High Security:** Conforms to modern security standards, protecting against common vulnerabilities like XSS and CSRF (with proper middleware).
-   **Excellent User Experience:** Enables seamless auto-login for returning users and keeps URLs clean.
-   **Stateless Backend:** The server doesn't need to store session state, making our API more scalable.
-   **Flexible:** The same token-based system can be used to authenticate third-party API clients.

### Cons:
-   **Initial Implementation Complexity:** Requires careful setup of token generation, validation middleware, and secure cookie handling.
-   **Token Management:** We must have a clear strategy for token expiry and revocation (logout).

## Alternatives Considered
-   **URL-Based Sessions:** Rejected due to major security vulnerabilities and poor user experience.
-   **Server-Side Sessions:** A valid approach, but requires stateful storage on the backend, which is less scalable than the stateless JWT approach. 