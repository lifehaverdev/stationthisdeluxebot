# ADR-003: ComfyUI Deploy API as Source of Truth

## Context

StationThis bot previously relied on an internal database to store and manage workflow information, with ComfyUI Deploy serving as an execution engine. This approach led to synchronization issues, duplication of data, and maintenance overhead when workflows were updated in ComfyUI Deploy but not reflected in our database.

The refactoring initiative aims to simplify the architecture while maintaining or improving functionality. One key aspect of this is determining the authoritative source for workflow data.

## Decision

We will use the ComfyUI Deploy API as the primary and authoritative source of truth for all workflow-related data and operations, including:

1. Workflow definitions and metadata
2. Deployments and deployment status
3. Machine information
4. Execution runs and results

The internal database will no longer be used for storing workflow definitions or tracking workflow executions, except in limited cases for caching and performance optimization purposes. Any database usage must be clearly marked as a non-authoritative cache.

Specifically:

- All workflow listings will come directly from ComfyUI Deploy API
- All workflow execution will be managed through ComfyUI Deploy API
- All results retrieval will use ComfyUI Deploy API
- Caching may be used for performance but must be time-limited with clear expiration strategies

## Consequences

### Positive

- **Single Source of Truth**: Eliminates data duplication and synchronization issues
- **Simplified Architecture**: Removes need for complex synchronization logic
- **Real-time Data**: Always using the most up-to-date workflow information
- **Reduced Maintenance**: Changes to workflows in ComfyUI Deploy are immediately reflected in StationThis
- **Easier Debugging**: Issues can be traced to a single source
- **Consistent User Experience**: Users see the same workflows and behavior across platforms

### Negative

- **API Dependency**: Increased dependency on the ComfyUI Deploy API availability
- **Performance Considerations**: API calls may be slower than local database queries
- **Rate Limiting**: Potential API rate limiting concerns for high-volume operations
- **Caching Complexity**: Need to implement intelligent caching strategies

### Mitigations

- Implement smart caching strategies with appropriate TTL values
- Add graceful degradation for temporary API unavailability
- Optimize batch operations to minimize API calls
- Monitor API usage and performance

## Alternatives Considered

1. **Hybrid Approach**: Continue using database as primary source with periodic sync from API
   - Rejected due to complexity and potential for data inconsistency

2. **Database as Primary with API as Backup**: Use database as source of truth with API as fallback
   - Rejected due to continued maintenance burden and synchronization challenges

3. **Event-Driven Sync**: Use webhooks to keep database in sync with ComfyUI Deploy
   - Rejected as overly complex for the requirements and potential for missed events

## Implementation Strategy

The implementation will proceed in phases:

1. Refactor core services (`comfyui.js` and `workflows.js`) to use ComfyUI Deploy API directly
2. Remove database dependencies for workflow information
3. Implement intelligent caching strategies for performance optimization
4. Update dependent components to use the refactored services
5. Add monitoring for API performance and availability

## API Endpoints Used

The implementation will leverage the following ComfyUI Deploy API endpoints:

- `GET /deployment` - List all deployments
- `GET /deployment/:id` - Get deployment details
- `POST /deployment` - Create new deployments
- `GET /machine` - List available machines
- `POST /api/run` - Execute workflows
- `GET /api/run` - Get workflow execution status and results
- `POST /api/workflow` - Upload workflow definitions
- `GET /api/workflow-version/:id` - Get workflow version details 