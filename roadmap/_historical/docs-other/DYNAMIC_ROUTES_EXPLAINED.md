> Imported from docs/comfyui-deploy/API/DYNAMIC_ROUTES_EXPLAINED.md on 2025-08-21

# Dynamic Routes in ComfyUI Deploy

This document explains how ComfyUI Deploy registers and handles API routes dynamically, which enhances flexibility and maintainability of the API surface.

## Overview

ComfyUI Deploy uses a hybrid approach for API route registration, combining:

1. **NextJS App Router**: Base structure providing the catchall route pattern
2. **Hono Framework**: API route definition and handling
3. **OpenAPI Integration**: API documentation and type safety

## Dynamic Route Registration Mechanism

The core of the dynamic route system is in `web/src/app/(app)/api/[[...routes]]/route.ts`, which serves as a central dispatch for all API endpoints.

### Key Components

#### 1. Catchall Route Pattern

NextJS App Router supports a catchall route pattern with `[[...routes]]` syntax, which enables a single file to handle multiple dynamic routes. This file exposes generic handler methods:

```typescript
// Generic HTTP method handlers
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
```

#### 2. Route Registration

Each route module follows a registration pattern where:

1. A route is defined using `createRoute` from `@hono/zod-openapi`
2. The route is registered via a dedicated registration function
3. These functions are imported and called in the main route file

Registration example:

```typescript
// Define a registration function in a dedicated file
export const registerCreateRunRoute = (app: App) => {
  app.openapi(createRunRoute, async (c) => {
    // Route handler logic
  });
};

// Use it in the main route file
registerCreateRunRoute(app);
```

#### 3. Authentication Middleware

Authentication is applied at the router level using middleware:

```typescript
async function checkAuth(c: Context, next: Next, headers?: HeadersInit) {
  const token = c.req.raw.headers.get("Authorization")?.split(" ")?.[1];
  const userData = token ? parseJWT(token) : undefined;
  
  // Validation logic
  
  c.set("apiKeyTokenData", userData);
  await next();
}

// Apply auth to specific routes
app.use("/run", checkAuth);
app.use("/upload-url", checkAuth);
```

## Route Registration Functions

The following registration functions are used to dynamically add routes:

| Function | Purpose | Endpoints |
|---------|----------|----------|
| `registerCreateRunRoute` | Workflow execution | POST /api/run |
| `registerGetOutputRoute` | Retrieve workflow results | GET /api/run |
| `registerUploadRoute` | File upload URLs | GET /api/upload-url |
| `registerWorkflowUploadRoute` | Workflow definition upload | POST /api/workflow |
| `registerGetWorkflowRoute` | Workflow retrieval | GET /api/workflow-version/:id |
| `registerGetAuthResponse` | Authentication | GET /api/auth-response/:request_id |

## OpenAPI Integration

The system automatically generates OpenAPI documentation:

```typescript
// The OpenAPI documentation will be available at /doc
app.doc("/doc", {
  openapi: "3.0.0",
  servers: [{ url: "/api" }],
  security: [{ bearerAuth: [] }],
  info: {
    version: "0.0.1",
    title: "Comfy Deploy API",
    description:
      "Interact with Comfy Deploy programmatically to trigger run and retrieve output",
  },
});
```

## Benefits of this Approach

1. **Modular Development**: Each route can be defined and maintained separately
2. **Centralized Authentication**: Auth logic is applied consistently
3. **Automatic Documentation**: OpenAPI specs are generated from the route definitions
4. **Type Safety**: Using Zod for request/response validation

## Hidden or Special Routes

Some routes have special handling:

1. **CORS Support**: All endpoints have CORS handlers attached automatically
   ```typescript
   const corsHandler = cors({
     origin: "*",
     allowHeaders: ["Authorization", "Content-Type"],
     allowMethods: ["POST", "GET", "OPTIONS"],
     exposeHeaders: ["Content-Length"],
     maxAge: 600,
     credentials: true,
   });
   ```

2. **Different Auth for Different Routes**: Some routes use specialized auth patterns
   ```typescript
   app.use("/workflow", corsHandler, checkAuth);
   app.use("/workflow-version/*", corsHandler, checkAuth);
   ``` 