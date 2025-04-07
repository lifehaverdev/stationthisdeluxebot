# Server Entry Point Analysis

## Startup Flow Summary

1. **Environment Setup**
   - Loads environment variables from .env file
   - Initializes Express application

2. **Middleware Configuration**
   - Configures bodyParser for JSON parsing
   - Sets up response timeout (5 minutes)
   - Mounts image API router at '/v1/images'

3. **Bot Initialization**
   - Calls initialize() from utils/bot/intitialize which:
     - Loads burns data from MongoDB
     - Loads rooms data from MongoDB
     - Loads workflows data from MongoDB

4. **Express Server Start**
   - Registers webhook routes (/api/webhook)
   - Starts server on configured port (default 3000)

5. **Background Processes**
   - In app.js (imported), sets up a global status refresh interval
   - Watches for messages and callback queries from Telegram

## Dependency Overview

| Import Path | Description | Coupling | Notes |
|------------|-------------|----------|-------|
| ./app.js | Initializes Telegram bot logic | High | Uses Telegram directly, exposes bot via getBot() |
| ./utils/bot/queue.js | Manages task queues and processing | High | Directly imports bot state, tightly coupled to Telegram |
| ./utils/bot/intitialize.js | Loads data from DB to global state | High | Populates global objects from bot.js |
| ./api/index.js | API routes for image generation | Medium | Uses bot state but has API abstraction |
| dotenv | Environment configuration | Low | Standard utility |
| express, body-parser | Web server framework | Low | Infrastructure components |
| path, fs | Filesystem operations | Low | Standard utilities |

## External Service Dependencies

1. **Telegram Bot API**
   - Initialized in app.js
   - Used for all user interactions
   - Provides message and callback query handling

2. **MongoDB**
   - Used by initialize() to load global state
   - Stores user data, burns, rooms, workflows

3. **External AI/Generation APIs**
   - Indirectly used via webhook callbacks
   - Processing status reported to /api/webhook endpoint

## Tightly Coupled Components

1. **Global State**
   - Burns, rooms, flows populated directly in global arrays
   - Shared between modules through imports

2. **Bot Integration**
   - Server and API components directly access bot functionality
   - Task queue directly tied to Telegram message format

3. **Webhook-Queue System**
   - Process flow depends on external callbacks to /api/webhook
   - Queue processing tightly coupled to webhook data format

## Refactor Plan

### 1. Clean Bootstrap Architecture

```javascript
// Proposed src/index.js structure
const { startServer } = require('./server');
const { initializeBot } = require('./bot');
const { connectDatabase } = require('./database');

async function bootstrap() {
  // Setup phase - connect services in order
  await connectDatabase();
  const bot = await initializeBot();
  const server = await startServer(bot);
  
  // Register shutdown handlers
  registerGracefulShutdown(server, bot);
  
  console.log('Application successfully started');
  return { server, bot };
}

// Allow both programmatic and direct execution
if (require.main === module) {
  bootstrap().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}

module.exports = { bootstrap };
```

### 2. Service Decoupling Strategy

1. **Create Clean Service Interfaces**

   - **Database Service**: Encapsulate all MongoDB operations
   - **Bot Service**: Abstract Telegram-specific operations
   - **Queue Service**: Generalize task processing without Telegram dependencies
   - **API Service**: Focus on request handling, delegating to core services

2. **Replace Global State**

   - Move global arrays (burns, rooms, flows) to proper services
   - Use dependency injection instead of direct imports
   - Create typed interfaces for all service communication

3. **Implement Event-Based Communication**

   - Use event emitters for cross-service communication
   - Decouple webhook processing from task handling
   - Standardize event payloads for consistent processing

### 3. New Directory Structure

```
src/
├── api/           # HTTP API routes and handlers
├── bot/           # Bot-specific logic (Telegram implementation)
├── core/          # Business logic independent of integrations
│   ├── queues/    # Task queue system
│   ├── models/    # Domain models and interfaces
│   └── services/  # Core business services
├── database/      # Database connection and models
├── config/        # Configuration management
├── utils/         # Shared utilities
├── server.js      # Express server setup
└── index.js       # Application entry point
```

### 4. Migration Path

1. **Phase 1: Service Extraction**
   - Move existing code into appropriate directories without changing behavior
   - Create proper interfaces between components
   - Document dependencies for future decoupling

2. **Phase 2: State Management Refactor**
   - Replace global state with service-based state
   - Implement proper dependency injection
   - Create adapters for existing components

3. **Phase 3: API Redesign**
   - Clean HTTP API design
   - Standardize webhooks and callbacks
   - Implement proper authentication and validation

4. **Phase 4: Telegram Decoupling**
   - Create Telegram-specific adapter
   - Allow multiple bot platforms
   - Separate bot logic from business logic

### 5. CLI vs. Server Startup

Create separate entry points that share the bootstrap logic:

```javascript
// src/cli.js
const { bootstrap } = require('./index');
const { parseArguments } = require('./utils/cli');

async function runCommand() {
  const { server, bot } = await bootstrap();
  const args = parseArguments();
  
  // Handle CLI commands here
  // ...
  
  // Gracefully shutdown after command completes
  await server.close();
  await bot.stop();
}

if (require.main === module) {
  runCommand().catch(console.error);
}
``` 