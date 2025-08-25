> Imported from docs/progress/comfyui-deploy-api-updates.md on 2025-08-21

# ComfyUI Deploy API Updates

## Summary of Updates (Based on Official OpenAPI Documentation)

This document tracks the changes made to our ComfyUI Deploy integration based on the official OpenAPI specification.

## Key API Changes

### Updated Endpoints

| Function | Old Endpoint | Updated Endpoint |
|----------|-------------|-----------------|
| Submit Request | `/run` | `/run/deployment/queue` |
| Check Status | `/run?run_id=<id>` | `/run/{run_id}` |
| Cancel Request | `/run/cancel` | `/run/{run_id}/cancel` |
| Get Deployments | `/deployment` | `/deployments` |
| Get Machines | `/machine` | `/machines` |
| Get Upload URL | `/upload-url?type=...` | `/file/upload` (POST) |

### Parameter Changes

- Request payload formats have been standardized
- Path parameters now used instead of query parameters in many cases
- Webhooks can be specified for runs 

## Implementation Status

The following components have been updated to use the correct API endpoints:

- [x] ComfyUIService - Core API client
- [x] Run submission and monitoring
- [x] Deployment management 
- [x] File uploading
- [x] Documentation updated

## Next Steps

1. Test the updated endpoints against the live API
2. Update any dependent services or components
3. Add error handling for any new error response formats
4. Implement additional endpoints as needed

## References

- [Official OpenAPI Endpoints List](../comfyui-deploy/API/OPENAPI_ENDPOINTS_LIST.md)
- [Updated Internal Documentation](../comfyui-deploy/API/ENDPOINTS_LIST.md)

## Recent Updates

### 2025-04-28: Workflow Naming Standardization and Machine Routing

**Status**: Completed

**Implementation Details**:
- Created workflow name mapping between API and database sources
- Implemented name standardization in WorkflowsService
- Added machine-specific routing based on workflow type
- Updated ComfyUIService to use the routing functionality
- Created comprehensive documentation and testing plan

**Key Files**:
- docs/comfyui-deploy/WORKFLOW_NAME_MAPPING.md
- docs/comfyui-deploy/WORKFLOWS_CATALOG.md
- config/workflow-machine-routing.js
- src/core/services/workflows.js (updated)
- src/core/services/comfyui.js (updated)
- demo-workflow-execution.js (updated)

**Next Steps**:
- Execute comprehensive testing plan
- Update platform adapters to use standardized workflow names
- Update user-facing documentation 