# Gaps and TODOs

This document lists identified gaps, missing documentation, and areas for future improvement in the ComfyUI Deploy codebase.

## Documentation Gaps

1. **API Documentation**:
   - Missing detailed documentation for several API endpoints
   - Need sample request/response examples for all endpoints
   - Missing authentication flow diagrams

2. **Database Schema**:
   - Relationships between entities not fully documented
   - Missing explanation of some database fields and their purpose

3. **Machine Management**:
   - Limited documentation on the different machine types (classic, runpod-serverless, modal-serverless, comfy-deploy-serverless)
   - Missing setup guide for serverless machine configurations

## Code TODOs

Based on reviewing the codebase, several TODOs or improvements could be made:

1. **Error Handling**:
   - More consistent error responses across all API endpoints
   - Better validation and error reporting for client requests

2. **Security**:
   - Review and enhance JWT token handling
   - Implement more granular access controls for API keys

3. **Testing**:
   - Add unit and integration tests for core components
   - Create API testing suite

## Missing Features

Features mentioned in documentation but not fully implemented or documented:

1. **Load Balancing**:
   - Documentation mentions load balancing across machines, but implementation details are unclear

2. **Workflow Dependencies**:
   - Checking for custom node dependencies is mentioned but not fully documented

3. **Real-time WebSocket Image Generation**:
   - LCM real-time WebSocket image generation is mentioned in the README but not documented in detail

## Next Steps

Priority areas to improve the documentation:

1. Complete API endpoint documentation with examples
2. Create detailed setup guides for different machine types
3. Document the workflow execution lifecycle in detail
4. Create architecture diagrams showing component relationships 

## API Endpoints Scraping Results

The endpoint scraper found 6 endpoints, 16 manually added endpoints, and 5 suspicious endpoints that may need manual verification.

Suspicious endpoints are usually:
- Routes registered programmatically
- Routes with dynamic paths
- Routes that use complex registration patterns

Check the full results in [AUTOMATED_ENDPOINTS_SCRAPE.md](/docs/comfyui-deploy/API/AUTOMATED_ENDPOINTS_SCRAPE.md).

## API Endpoints Requiring Manual Verification

After comprehensive endpoint scanning and analysis, the following endpoints need further verification:

### Dynamically Registered Routes

These routes are registered through import functions and should be manually verified with authentication:

1. **Workflow Management Routes**:
   - `/api/workflow-version/*` routes - Need to test with actual workflow version IDs
   - CRUD operations registered through dedicated functions in `registerWorkflowUploadRoute`

2. **Auth Response Handler**:
   - `/api/auth-response/:request_id` - Needs verification with valid request IDs
   - This endpoint appears to create temporary API keys, which requires special testing

### Hidden API Endpoints

Several API endpoints may exist that weren't detected through static analysis:

1. **Internal API**:
   - The `/internal` endpoint and potentially other internal API endpoints
   - These may require special access or authentication to test

2. **Update Endpoints**:
   - `/api/update-run` - Dynamic route handler that should be tested with valid run IDs
   - Confirm the exact request/response format for updating workflow run status

### Testing Plan

To properly verify these endpoints:

1. Create a valid JWT authentication token through the UI
2. Test the endpoints with appropriate request bodies
3. Document the complete request/response cycle for each endpoint
4. Add any discovered endpoints to the main API documentation

The runtime test showed all endpoints returning 401 Unauthorized, confirming they exist but require proper authentication to test functionality.

