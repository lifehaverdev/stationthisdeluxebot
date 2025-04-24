# Refactoring Master Plan

## 1. Summary of Key Components

### Core Domain Components
- **User & Account System** - User identity, preferences, verification, and account management
- **Session Management** - Platform-agnostic user session tracking with Telegram adapter
- **Points Economy** - Complex economy with multiple point types (points, doints, boints, qoints, exp)
- **Generation System** - Image generation request handling, settings, and result management
- **Workflow Engine** - Multi-step interactions with state management and platform adapters
- **Command System** - Platform-agnostic command processing with middleware and adapters
- **Queue System** - Task queuing, processing, and delivery with state tracking
- **UI Component System** - Platform-agnostic UI components with platform-specific renderers

### Application Services
- **Session Manager** - High-level session management with platform integration
- **Media Services** - Media processing, watermarking, and delivery
- **Generation Services** - Generation request handling via ComfyDeploy and other providers
- **Analytics Service** - User behavior and system event tracking

### External Integrations
- **Telegram Bot API** - Primary user interface via platform-specific adapters
- **Web Interface** - Alternative access via HTTP/WebSocket
- **MongoDB** - Data persistence with repository abstraction
- **AI/Generation APIs** - Integration with ComfyDeploy and other generation services

## 2. Current Architecture State

### Core Architecture
The codebase has successfully transitioned to a clean architecture approach with the following layers:

1. **Core Domain Layer (`src/core/`)**
   - Contains platform-agnostic business rules and domain models
   - Follows domain-driven design with proper encapsulation
   - Provides repository interfaces for data access abstraction
   - Implements immutable state management patterns

2. **Application Services Layer (`src/services/`)**
   - Implements use cases that orchestrate domain logic
   - Provides higher-level services for application needs
   - Handles cross-cutting concerns like logging and error handling

3. **Adapter Layer (`src/adapters/`, `src/integrations/`)**
   - Bridges between core logic and external platforms/libraries
   - Implements repository interfaces for specific datastores
   - Provides platform-specific adapters (Telegram, Web)

4. **External Interfaces (`src/api/`)**
   - Exposes system functionality through HTTP/REST
   - Provides programmatic access to core functionality

### Key Architectural Patterns

1. **Repository Pattern**
   - Abstracts data access through repository interfaces
   - Provides clean separation between domain logic and data storage
   - Implemented with MongoDB adapters

2. **Adapter Pattern**
   - Isolates platform-specific code from core business logic
   - Provides clean interfaces for platform integration
   - Enables support for multiple platforms (Telegram, Web)

3. **Immutable State Management**
   - Prevents unexpected state mutations with immutable state
   - Enables predictable state transitions and tracking
   - Supports debugging and state history

4. **Event-Driven Architecture**
   - Provides loose coupling between components through events
   - Enables extensibility through event subscriptions
   - Supports analytics and monitoring

5. **Workflow System**
   - Implements clean state machine for multi-step interactions
   - Supports branching and conditional flows
   - Provides session persistence for long-running interactions

6. **Command Pattern**
   - Centralizes command handling through command registry
   - Provides middleware pipeline for cross-cutting concerns
   - Supports platform-agnostic command definitions

7. **UI Component System**
   - Defines abstract UI components independent of platform
   - Provides platform-specific renderers
   - Enables consistent UI across platforms

## 3. Current Folder Structure

```
src/
├── adapters/                # Adapters bridging legacy and new code
│   └── sessionAdapter.js    # Session adapter for backward compatibility
│
├── api/                     # HTTP/REST API layer
│   ├── index.js             # API entry point and routing
│   └── test.js              # API testing utilities
│
├── bootstrap.js             # New architecture initialization
│
├── commands/                # User-facing command implementations
│   ├── accountCommands.js   # Account management commands
│   ├── makeCommand.js       # Image generation commands
│   ├── mediaCommand.js      # Media handling commands
│   └── statusCommand.js     # Status and system info commands
│
├── config/                  # Application configuration
│   └── featureFlags.js      # Feature flags for gradual rollout
│
├── core/                    # Core domain logic (platform-agnostic)
│   ├── account/             # Account management domain
│   ├── analytics/           # Analytics tracking and reporting
│   ├── command/             # Command processing framework
│   ├── generation/          # Image generation domain
│   ├── points/              # Points economy system
│   ├── queue/               # Task queue management
│   ├── session/             # Session management domain
│   ├── shared/              # Shared utilities and interfaces
│   ├── tasks/               # Task definitions and processing
│   ├── ui/                  # UI component architecture
│   ├── user/                # User identity and data
│   ├── validation/          # Input validation framework
│   └── workflow/            # Multi-step interaction engine
│
├── db/                      # Database access
│   └── models/              # Database models
│
├── examples/                # Example code and usage patterns
│
├── integrations/            # Platform integrations
│   ├── telegram/            # Telegram Bot integration
│   └── web/                 # Web interface integration
│
├── mony/                    # Assets and resources
│
├── services/                # Application services
│   ├── assist.js            # AI assistance service
│   ├── comfydeploy/         # ComfyDeploy integration
│   ├── fry.js               # Image processing service
│   ├── make.js              # Image generation service
│   ├── sessionManager.js    # Session management service
│   ├── speak.js             # Text generation service
│   ├── tripo.js             # 3D generation service
│   └── waterMark.js         # Image watermarking service
│
├── tests/                   # Automated tests
│
├── utils/                   # Shared utilities
│   ├── errors.js            # Error handling utilities
│   ├── formatters.js        # Data formatting utilities
│   ├── helpers.js           # General helper functions
│   └── logger.js            # Logging utilities
│
├── simplebot.js             # Simplified bot entry point
└── stationthisbot.js        # Main application entry point
```

## 4. Migration Progress and Phases

### Phase 1: Service Extraction and Core Creation ✅ COMPLETED
- Extracted core business logic into domain modules
- Created initial service interfaces and implementations
- Set up internal API layer with basic endpoints
- Maintained backwards compatibility with existing code

**Completed Deliverables:**
- User domain model and service
- Points calculation and regeneration logic
- Generation request/response models
- Basic repository interfaces
- Event bus for cross-service communication

### Phase 2: State Management and Data Access ✅ COMPLETED
- Replaced global state with proper state management
- Implemented repository pattern for data access
- Created adapters for existing data sources
- Introduced immutable state patterns

**Completed Deliverables:**
- Session management service with platform adapters
- MongoDB repositories with abstract interfaces
- Task queue system with immutable state
- State containers for user sessions
- Standardized error handling with AppError class

### Phase 3: Workflow and Interaction Refactoring 🔄 IN PROGRESS
- Refactored multi-step interactions into workflow system
- Created platform-agnostic command processing
- Implemented comprehensive input validation
- Extracted UI rendering from business logic

**Completed Deliverables:**
- Workflow state machine with immutable transitions
- Sequential workflow steps with validation
- Command router with middleware pipeline
- Validation framework with schema registry
- Platform-agnostic UI component system

**Remaining Tasks:**
- Continue migrating legacy commands to new architecture
- Complete workflow implementation for complex interactions
- Finalize UI component integration with workflows
- Implement consistent error handling across commands

### Phase 4: Legacy Command Migration (NEW) 🔄 IN PROGRESS
- Migrate remaining legacy commands to new architecture
- Implement workflow-based implementations of complex interactions
- Create comprehensive integration tests for command flows
- Deploy with feature flags for gradual rollout

**Completed Tasks:**
1. ✅ Created migration plan for high-value legacy commands
2. ✅ Implemented account workflow with platform-agnostic core
3. ✅ Created comprehensive test suite for core commands
4. ✅ Implemented parameter normalization for ComfyDeploy integration
5. ✅ Added detailed parameter tracing for debugging and API validation

**Key Tasks:**
1. Continue migrating complex workflows to new architecture
2. Create platform-specific adapters for all commands
3. Add comprehensive test coverage for remaining commands
4. Deploy with feature flags for controlled rollout

### Phase 5: Platform Adapter Completion 🔄 PLANNED
- Complete Telegram-specific adapters
- Expand web interface integration
- Implement clean interfaces for all external services
- Formalize UI component system documentation

**Key Tasks:**
1. Finalize Telegram bot adapter
2. Complete message and callback handlers
3. Formalize UI component system documentation
4. Extract all platform-specific code
5. Implement clean API client interfaces

### Phase 6: Integration and Final Refactoring 🔄 PLANNED
- Connect all components through internal API
- Implement configuration management
- Create comprehensive logging and monitoring
- Finalize error handling strategy
- Add integration tests

**Key Tasks:**
1. Connect all services through internal API
2. Implement centralized configuration
3. Create comprehensive logging
4. Add integration tests
5. Create API documentation

## 5. Legacy Migration Inventory

The following components from the legacy codebase require migration to the new architecture:

### Command Handlers
| Legacy Component | Replacement Status | Migration Priority |
|------------------|-------------------|-------------------|
| `iAccount.js` | Partially Migrated | High |
| `iMake.js` | Partially Migrated | High |
| `iMedia.js` | Partially Migrated | Medium |
| `iTrain.js` | Not Started | High |
| `iWallet.js` | Not Started | Medium |
| `iRiff.js` | Not Started | Medium |
| `iLora.js` | Not Started | Medium |
| `iGroup.js` | Not Started | Low |
| `iCollection.js` | Not Started | Low |
| `iBrand.js` | Not Started | Low |

### Core Systems
| Legacy System | Replacement Status | Migration Priority |
|---------------|-------------------|-------------------|
| Points System | Completed | — |
| Session Management | Completed | — |
| Queue System | Completed | — |
| Command Routing | Completed | — |
| UI Generation | Partially Migrated | High |
| Workflow Management | Completed | — |
| Media Processing | Partially Migrated | Medium |
| User Authentication | Partially Migrated | High |
| API Key Management | Not Started | Medium |

## 6. Architecture Recommendations

### Module Consolidation
1. **Standardize Service Layer Organization**
   - Clarify distinction between application services (`src/services/`) and domain services (`src/core/*/service.js`)
   - Consider reorganizing service layer to improve consistency

2. **Consolidate Adapter Pattern Implementation**
   - Standardize adapter implementation across codebase
   - Address multiple adapter locations: `src/adapters/`, `src/core/*/adapters/`, and `src/integrations/*/adapters/`

3. **Formalize Core/UI as First-Class Citizen**
   - Document UI component system architecture
   - Standardize UI component interfaces and lifecycle
   - Create clear patterns for platform-specific renderers

4. **API Layer Formalization**
   - Formalize API structure and conventions
   - Document API endpoints and response formats
   - Implement consistent authentication and authorization

### Technical Debt Remediation
1. **MongoDB Abstraction Review**
   - Evaluate direct MongoDB dependency in core layer
   - Consider more abstract approach to database access

2. **Error Handling Standardization**
   - Ensure consistent error handling across all layers
   - Standardize error reporting and recovery strategies

3. **Asset Management**
   - Relocate assets from `src/mony/` to appropriate location
   - Create proper asset management strategy

4. **Comprehensive Documentation**
   - Create architectural documentation for each core module
   - Document cross-component interactions and dependencies
   - Update README files with current implementation details

## 7. Implementation Strategies

### Command Migration Strategy
1. **Workflow-Based Implementation**
   - Use workflow system for all multi-step interactions
   - Define clear step transitions and validation rules
   - Separate UI rendering from business logic

2. **Feature Flag Integration**
   - Implement feature flags for all new implementations
   - Allow gradual rollout and A/B testing
   - Enable fallback to legacy implementations

3. **Platform Adapter Pattern**
   - Create consistent adapter interface for all platforms
   - Implement platform-specific adapters for each command
   - Ensure clean separation between core logic and platform code

4. **Comprehensive Testing**
   - Create unit tests for core business logic
   - Implement integration tests for command flows
   - Add end-to-end tests for critical user journeys

### UI Component Strategy
1. **Component Interfaces**
   - Define clear interfaces for all UI components
   - Implement platform-specific renderers
   - Create component composition patterns

2. **Rendering Separation**
   - Separate business logic from UI rendering
   - Create clean interface between data and presentation
   - Support multiple output formats (Telegram, Web, API)

3. **State Management**
   - Use immutable state for UI components
   - Implement one-way data flow
   - Create clear update patterns

## 8. Risk Assessment

### High Risk Areas
1. **Legacy Command Migration**
   - Complex commands with many edge cases
   - Risk of regression during migration
   - Incomplete test coverage

2. **Cross-Platform Consistency**
   - Ensuring consistent behavior across platforms
   - Handling platform-specific limitations
   - Supporting all platforms equally

3. **Performance Considerations**
   - Immutable state overhead for high-frequency updates
   - Repository pattern performance impact
   - Workflow system overhead for simple interactions

### Mitigation Strategies
1. **Incremental Migration**
   - Migrate commands incrementally with feature flags
   - Run old and new implementations in parallel
   - Gradually shift traffic to new implementations

2. **Comprehensive Testing**
   - Create robust test suite for all components
   - Implement integration tests for cross-component interactions
   - Monitor performance metrics during migration

3. **Documentation and Knowledge Sharing**
   - Document architecture and design decisions
   - Create examples and patterns for developers
   - Establish code reviews and pair programming 