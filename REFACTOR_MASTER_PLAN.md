# Refactoring Master Plan

## 1. Summary of Key Components

### Core System Components
- **Server Entry Point** (`server.js`) - Express server initialization and webhook handling
- **Gatekeeping System** (`utils/bot/gatekeep.js`) - User session management and access control
- **Points System** - Complex economy with multiple point types (points, doints, boints, qoints, exp)
- **Database Layer** (`db/` folder) - MongoDB models, operations, and utilities
- **Response System** (`iResponse.js`) - Framework for conversational flows and multi-step interactions
- **Menu System** (`iMenu.js`) - UI generation and navigation for bot commands

### Handler Components
- **Message Handlers** (`iMessage.js`, etc) - Process incoming Telegram messages
- **Callback Handlers** (`iCallbaq.js`) - Process callback queries from inline keyboards
- **Command Handlers** (various `i*.js` files) - Process specific bot commands
- **Media Handlers** (`iMedia.js`) - Process media uploads and downloads
- **Account Management** (`iAccount.js`, `iWallet.js`) - Handle user account and wallet operations
- **Generation Workflows** (`iMake.js`, `iTrain.js`) - Handle image generation and training processes

### External Integrations
- **Telegram Bot API** - Primary user interface
- **MongoDB** - Data persistence
- **AI/Generation APIs** - Image generation services
- **Blockchain/Wallet Services** - User verification and token balance checking

## 2. Common Issues Identified

### Architecture Issues
1. **Global State Dependence**
   - Heavy reliance on shared mutable state (`lobby`, `workspace`, etc.)
   - Global arrays and objects accessed directly across modules

2. **Tight Coupling with Telegram**
   - Business logic directly references Telegram message format
   - UI rendering mixed with core functionality
   - Command handlers tightly bound to Telegram API

3. **No Clear Separation of Concerns**
   - Business logic mixed with presentation layer
   - Data access scattered throughout codebase
   - Command handling intertwined with state management

4. **Missing Abstraction Layers**
   - No internal API for cross-module communication
   - Direct database access from command handlers
   - No adapter layer for external services

### Technical Debt
1. **Callback Hell and Complex Control Flow**
   - Deep nesting of callbacks and conditionals
   - Implicit dependencies between functions
   - Complex state transitions with side effects

2. **Inconsistent Error Handling**
   - Mixed approach to error handling
   - Many unhandled error cases
   - No standardized error reporting

3. **Limited Testing Capability**
   - Few clear boundaries for unit testing
   - Entangled dependencies make testing difficult
   - No mocking points for external dependencies

4. **Configuration and Environment Issues**
   - Hard-coded values scattered throughout codebase
   - Implicit dependencies on environment variables
   - No centralized configuration management

## 3. Refactor Themes

### Clean Architecture Pattern
- **Core Domain Logic** - Platform-agnostic business rules
- **Application Services** - Use cases and workflows
- **Interface Adapters** - Controllers, presenters, gateways
- **Infrastructure** - Frameworks, drivers, external services

### Service-Oriented Design
- **Independent Services** - Each with clear responsibilities
- **Service Interfaces** - Well-defined boundaries and contracts
- **Dependency Injection** - Services receive dependencies explicitly
- **Event-Driven Communication** - Loose coupling via events

### State Management
- **Immutable State** - Predictable state transitions
- **Event Sourcing** - State derived from sequence of events
- **Command-Query Separation** - Clear distinction between state changes and reads
- **Repository Pattern** - Abstraction over data storage

### Platform-Agnostic Core
- **Adapter Pattern** - Telegram-specific code isolated in adapters
- **Strategy Pattern** - Pluggable implementations for external services
- **Facade Pattern** - Simplified interfaces to complex subsystems

## 4. Proposed Folder Structure

```
src/
├── core/                    # Platform-agnostic business logic
│   ├── user/                # User domain model and operations
│   │   ├── model.js         # User entity definitions
│   │   ├── service.js       # User operations (register, verify, etc.)
│   │   ├── repository.js    # User data access abstraction
│   │   └── events.js        # User-related events
│   │
│   ├── points/              # Points system
│   │   ├── model.js         # Points types and operations
│   │   ├── calculation.js   # Points calculation logic
│   │   ├── limit.js         # Limit enforcement
│   │   └── regeneration.js  # Points regeneration logic
│   │
│   ├── generation/          # Image generation
│   │   ├── model.js         # Generation request/response models
│   │   ├── pipeline.js      # Generation workflow orchestration
│   │   ├── prompts.js       # Prompt handling and processing
│   │   └── settings.js      # Generation parameters and validation
│   │
│   ├── workflow/            # Multi-step interactions
│   │   ├── state.js         # Workflow state management
│   │   ├── sequence.js      # Sequential workflow steps
│   │   ├── validation.js    # Input validation
│   │   └── conditions.js    # Preconditions and gates
│   │
│   └── queue/               # Task queuing and processing
│       ├── model.js         # Queue and task models
│       ├── processor.js     # Task processing engine
│       ├── priority.js      # Priority handling
│       └── retry.js         # Failure handling and retry logic
│
├── api/                     # Internal API layer
│   ├── user.js              # User operations API
│   ├── points.js            # Points management API
│   ├── generation.js        # Image generation API
│   ├── settings.js          # Settings management API
│   └── workflow.js          # Workflow management API
│
├── integrations/            # External service integrations
│   ├── telegram/            # Telegram bot integration
│   │   ├── bot.js           # Bot initialization
│   │   ├── commands/        # Command handlers
│   │   ├── callbacks/       # Callback query handlers
│   │   ├── messages/        # Message handlers
│   │   └── ui/              # UI components
│   │
│   ├── storage/             # Storage implementations
│   │   ├── mongodb/         # MongoDB implementation
│   │   └── fs/              # Filesystem storage
│   │
│   └── generation/          # Generation API integrations
│       ├── comfydeploy/     # ComfyDeploy integration
│       └── tripo/           # Tripo3D integration
│
├── services/                # Application services
│   ├── auth.js              # Authentication service
│   ├── session.js           # Session management
│   ├── media.js             # Media handling
│   ├── notifications.js     # User notifications
│   └── analytics.js         # Analytics and tracking
│
├── utils/                   # Shared utilities
│   ├── config.js            # Configuration management
│   ├── logger.js            # Logging utility
│   ├── errors.js            # Error handling
│   ├── events.js            # Event bus
│   └── validation.js        # Common validation
│
├── server.js                # Express server setup
└── index.js                 # Application entry point
```

## 5. Migration Phases

### Phase 1: Service Extraction and Core Creation (2-3 weeks)
- Extract core business logic into domain modules
- Create initial service interfaces and implementations
- Setup internal API layer with basic endpoints
- Maintain backwards compatibility with existing code
- **Focus Areas**: User service, points system, generation model

**Key Tasks:**
1. Create core user domain model and service
2. Extract points calculation and regeneration logic
3. Define generation request/response models
4. Create basic repository interfaces
5. Set up event bus for cross-service communication

### Phase 2: State Management and Data Access (2-3 weeks)
- Replace global state with proper state management
- Implement repository pattern for data access
- Create adapters for existing data sources
- Introduce immutable state patterns
- **Focus Areas**: Session management, database access, queue system

**Key Tasks:**
1. Create session management service
2. Implement MongoDB repositories
3. Refactor task queue system
4. Create state containers for user sessions
5. Implement proper error handling

### Phase 3: Workflow and Interaction Refactoring (3-4 weeks)
- Refactor multi-step interactions into workflow system
- Create platform-agnostic command processing
- Implement proper validation for all inputs
- Extract UI rendering from business logic
- **Focus Areas**: Command handling, workflow system, input validation

**Key Tasks:**
1. Create workflow state machine
2. Implement sequential workflow steps
3. Extract validation logic from handlers
4. Create central command router
5. Implement input/output adapters

### Phase 4: Platform Adapter Creation (2-3 weeks)
- Create Telegram-specific adapters
- Extract platform-specific code from core
- Implement clean interfaces for external services
- Create UI component system
- **Focus Areas**: Telegram integration, UI rendering, external APIs

**Key Tasks:**
1. Create Telegram bot adapter
2. Implement message and callback handlers
3. Create UI component system
4. Extract platform-specific code
5. Implement clean API client interfaces

### Phase 5: Integration and Final Refactoring (2-3 weeks)
- Connect all components through internal API
- Implement configuration management
- Create comprehensive logging and monitoring
- Finalize error handling strategy
- Add integration tests
- **Focus Areas**: Configuration, logging, testing, documentation

**Key Tasks:**
1. Connect all services through internal API
2. Implement centralized configuration
3. Create comprehensive logging
4. Add integration tests
5. Create API documentation

## 6. Recommendations and Gaps

### Critical Areas for Deeper Analysis
1. **Points System Integration** - Requires detailed analysis of business rules
2. **User Session Management** - Needs clear lifecycle definition
3. **Task Queue Architecture** - Would benefit from formal architecture review
4. **Error Handling Strategy** - Needs comprehensive approach

### Suggested Proof-of-Concept Projects
1. **User Service Migration** - Test moving user management to core
2. **Points Calculation Engine** - Extract and test independently
3. **Telegram UI Adapter** - Create clean separation for UI components
4. **Internal API Endpoints** - Test communication between services

### Documentation Needs
1. **Domain Model Documentation** - Clear definitions of core entities
2. **API Surface Documentation** - Internal API contracts
3. **State Transition Diagrams** - For complex workflows
4. **Event Schema Definitions** - For event-driven communication

### Testing Strategy
1. **Unit Testing Core Domain Logic** - For business rules
2. **Integration Testing Service Interactions** - For service boundaries
3. **End-to-End Testing Key Workflows** - For critical user journeys
4. **Performance Testing Points System** - For resource-intensive operations

## 7. Risk Assessment

### High Risk Areas
1. **Global State Transitions** - Complex dependencies with side effects
2. **Telegram API Changes** - External dependency risks
3. **Database Migration** - Data integrity during transitions
4. **Performance Regressions** - Resource-intensive operations

### Migration Strategies
1. **Parallel Running** - Run old and new systems in parallel during transition
2. **Feature Flags** - Toggle between implementations for testing
3. **Database Shadowing** - Mirror operations to new structures
4. **Incremental Rollout** - Gradually shift traffic to new components 