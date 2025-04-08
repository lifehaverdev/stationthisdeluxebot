# stable-diffusion-bot
Telegram bot for Automatic1111/stable-diffusion-webui API

## SessionAdapter Examples

This project includes several comprehensive examples demonstrating how to use the SessionAdapter for different common use cases:

### 1. Command Handler Example
- Implements a command registration and processing system
- Tracks command usage in user sessions
- Handles built-in commands like `help` and `stats`
- Shows how to integrate with an event emitter

### 2. Webhook Handler Example
- Processes external webhook events (payments, subscriptions, etc.)
- Validates webhook signatures
- Updates user sessions based on external service data
- Includes handlers for common webhook scenarios

### 3. Rate Limiter Example
- Implements a flexible rate limiting system
- Tracks user requests across different action types
- Supports per-user rate limits with configurable windows
- Demonstrates limit resetting and analytics

### 4. Preferences Manager Example
- Manages user preferences with schema validation
- Supports default values and preference overrides
- Validates preference values against schemas
- Includes batch operations and events for preference changes

### 5. Feature Flags Example
- Implements conditional feature access based on user attributes
- Supports percentage-based gradual rollouts
- Includes rule-based feature flag evaluation
- Demonstrates user-specific feature overrides

## Running the Examples

You can run all examples using:

```bash
node src/examples/runAllExamples.js
```

Or run specific examples individually:

```bash
node src/examples/commandHandlerExample.js
node src/examples/webhookHandlerExample.js
node src/examples/rateLimiterExample.js
node src/examples/preferencesManagerExample.js
node src/examples/featureFlagsExample.js
```

Each example demonstrates a different use case for the SessionAdapter, showing how to track and manage user sessions in various scenarios.
