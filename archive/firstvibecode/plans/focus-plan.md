# Focus Plan for Interface-Agnostic Overhaul

## Core Structure - 3 Key Components

1. **Core Business Logic (src/core/)**
   - Users & Accounts
     - User profiles, preferences
     - Credit/points management
     - Authentication/verification
   - Services Integration
     - Service configuration
     - Request handling
     - Response processing
   - Internal API
     - Command routing
     - Session management
     - Task execution

2. **Service Adapters (src/services/)**
   - Black-box service wrappers
   - Standardized request/response formats
   - Error handling & retry logic
   - Cost tracking

3. **Interface Adapters (src/integrations/)**
   - Telegram Bot interface
   - Web interface
   - UI component architecture
   - Platform-specific renderers

## Implementation Focus

### Phase 1: Core API Completion (Week 1)
- Complete the Internal API endpoints
- Standardize all service wrappers
- Implement unified session management
- Finalize command processing pipeline

### Phase 2: Telegram Integration (Week 2)
- Connect Telegram commands to internal API
- Implement UI rendering system
- Complete workflow engine
- Migrate all legacy commands

### Phase 3: Web Interface (Week 3)
- Build responsive web UI
- Implement WebSocket for real-time updates
- Create shared components
- Standardize authentication flow

## Success Criteria
1. All commands work through internal API layer
2. Both Telegram and Web interfaces use the same business logic
3. Adding new services requires zero interface code changes
4. Code is testable without platform dependencies

## Next Steps
1. Complete internal API implementation
2. Connect all existing Telegram commands
3. Implement web interface components
4. Add comprehensive testing 