# Authentication Module

The Authentication module in ComfyUI Deploy handles user authentication, API key management, and authorization for various actions within the platform.

## Components

### User Authentication

User authentication is implemented using Clerk, a third-party authentication provider. This handles:

- User registration and login
- OAuth integrations
- Session management
- Organization/team support

The integration is primarily configured in the NextJS app through Clerk's middleware and components.

### API Key Management

API keys are used for programmatic access to the ComfyUI Deploy API. The key functionality includes:

- Generation of API keys with optional expiration dates
- Validation of API keys for API requests
- Revocation of API keys

Implementation is primarily found in:
- `web/src/server/curdApiKeys.ts` - Core API key CRUD operations
- `web/src/server/parseJWT.ts` - JWT token parsing and validation

### JWT Authentication

JWT (JSON Web Tokens) are used for authenticating API requests. Key aspects:

- Tokens are signed using a secret key (`JWT_SECRET` environment variable)
- Tokens can include expiration times
- Token validation occurs in API route middleware

## Authorization Flow

1. **Web UI Authentication**:
   - Users log in via Clerk authentication
   - Clerk provides session tokens for the web UI

2. **API Key Creation**:
   - Authenticated users create API keys in the dashboard
   - API keys are stored in the database
   - Keys can be scoped to specific permissions

3. **API Request Authentication**:
   - API requests include the API key in the Authorization header
   - The API middleware validates the token
   - If valid, the request proceeds with the authenticated user context

## Usage Example

```typescript
// API route middleware for checking auth
async function checkAuth(c: Context, next: Next, headers?: HeadersInit) {
  const token = c.req.raw.headers.get("Authorization")?.split(" ")?.[1];
  const userData = token ? parseJWT(token) : undefined;
  
  if (!userData || token === undefined) {
    return c.text("Invalid or expired token", {
      status: 401,
      headers: headers,
    });
  }

  // If the key has expiration, this is a temporary key and not in our db, so we can skip checking
  if (userData.exp === undefined) {
    const revokedKey = await isKeyRevoked(token);
    if (revokedKey)
      return c.text("Revoked token", {
        status: 401,
        headers: headers,
      });
  }

  c.set("apiKeyTokenData", userData);
  await next();
}
``` 