# Webhook System

This module provides a platform-agnostic webhook processing system for handling callbacks from external services like ComfyDeploy, payment processors, and other third-party integrations.

## Core Components

### WebhookRegistry

The registry maintains a collection of webhook handlers that can process incoming webhooks from various services. Handlers are registered with the registry and can be looked up based on service type or by examining the webhook payload.

```javascript
const { WebhookRegistry } = require('../core/webhook/registry');

// Create a registry
const registry = new WebhookRegistry();

// Register a handler
registry.registerHandler({
  service: 'comfydeploy',
  canHandle: (payload) => Boolean(payload.run_id),
  processWebhook: async (payload) => {
    // Process webhook
    return { success: true };
  }
});
```

### WebhookRouter

The router is responsible for determining which handlers should process a given webhook and for executing those handlers in priority order. It also manages platform-specific adapters that can parse webhooks from different platforms.

```javascript
const { WebhookRouter } = require('../core/webhook/router');

// Create a router
const router = new WebhookRouter({ registry });

// Register a platform adapter
router.registerAdapter({
  platform: 'web',
  parseWebhook: async (webhook) => {
    // Parse platform-specific webhook format
    return webhook;
  }
});

// Route a webhook to handlers
const result = await router.routeWebhook({
  platform: 'web',
  service: 'comfydeploy',
  payload: { run_id: '123', status: 'completed' }
});
```

### WebhookController

The controller provides a high-level API for processing webhooks and integrates with the registry and router. It also offers convenience methods for creating middleware and event forwarding.

```javascript
const { WebhookController } = require('../core/webhook/controller');

// Create a controller
const controller = new WebhookController({ registry, router });

// Process a webhook
const result = await controller.processWebhook({
  platform: 'web',
  service: 'comfydeploy',
  payload: { run_id: '123', status: 'completed' }
});

// Create Express middleware
const middleware = controller.createMiddleware({
  platform: 'web',
  getService: (req) => req.params.service
});
```

## Handlers

Webhook handlers process webhooks for specific services. They implement a standard interface and can be registered with the registry.

### ComfyDeploy Handler

The ComfyDeploy handler processes webhooks from the ComfyDeploy service and updates tasks and workflows accordingly.

```javascript
const { createComfyDeployWebhookHandler } = require('../core/webhook/handlers/comfyDeployHandler');

// Create a ComfyDeploy handler
const handler = createComfyDeployWebhookHandler({
  comfyDeployService,
  workflowManager,
  taskManager
});

// Register the handler
registry.registerHandler(handler);
```

## Platform Adapters

Platform adapters convert platform-specific webhook formats to a standard internal format. They can be registered with the router to support different platforms.

```javascript
const { createWebAdapter, createComfyDeployAdapter } = require('../core/webhook/adapter');

// Create a web adapter
const webAdapter = createWebAdapter();

// Create a ComfyDeploy-specific adapter
const comfyAdapter = createComfyDeployAdapter();

// Register adapters
router.registerAdapter(webAdapter);
router.registerAdapter(comfyAdapter);
```

## Integration with Web Framework

The webhook system can be integrated with web frameworks like Express to handle incoming webhook requests.

```javascript
const express = require('express');
const { initWebhookRoutes } = require('../integrations/web/webhookAdapter');

// Create Express app
const app = express();

// Initialize webhook routes
initWebhookRoutes(app, {
  webhookController: controller,
  basePath: '/api/webhooks'
});

// Start server
app.listen(3000, () => {
  console.log('Server listening on port 3000');
});
```

## Creating a Complete Webhook System

The `createWebhookSystem` function provides a convenient way to set up a complete webhook system with the necessary components.

```javascript
const { createWebhookSystem } = require('../core/webhook/index');
const { createComfyDeployWebhookHandler } = require('../core/webhook/handlers/comfyDeployHandler');

// Create handlers
const comfyHandler = createComfyDeployWebhookHandler({
  comfyDeployService,
  workflowManager,
  taskManager
});

// Create adapters
const webAdapter = createWebAdapter();

// Create webhook system
const webhookSystem = createWebhookSystem({
  handlers: [comfyHandler],
  adapters: [webAdapter]
});

// Use the system
app.post('/webhooks', async (req, res) => {
  try {
    const result = await webhookSystem.processWebhook({
      platform: 'web',
      payload: req.body
    });
    
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

## Event Handling

The webhook system emits events throughout the webhook processing lifecycle. You can listen for these events to perform additional actions or to gather metrics.

```javascript
webhookSystem.controller.on('webhook:received', (data) => {
  console.log('Webhook received:', data);
});

webhookSystem.controller.on('webhook:completed', (data) => {
  console.log('Webhook processed:', data);
});

webhookSystem.controller.on('webhook:error', (data) => {
  console.error('Webhook error:', data);
});
``` 