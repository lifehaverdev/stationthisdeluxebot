> Imported from docs/comfyui-deploy/API/API_TESTING_NOTES.md on 2025-08-21

# ComfyUI Deploy API Testing Notes

## API Exploration Findings

During integration, we conducted thorough testing to identify the correct API endpoints and patterns for ComfyUI Deploy. This document captures key findings from our exploration.

### API URL and Path Prefix

The ComfyUI Deploy API is available at:
```
https://api.comfydeploy.com
```

Important observation: Most endpoints require the `/api` prefix in paths, but endpoint behavior is inconsistent. We implemented automatic prefix handling in our services.

### Endpoint Patterns Tested

We tested multiple endpoint patterns to find working API paths:

| Prefix | Result | Notes |
|--------|--------|-------|
| No prefix | Mixed results | Some endpoints work, others require a prefix |
| `/api` | Most reliable | Most endpoints work with this prefix |
| `/v1` | Not found | API does not use this versioning pattern |
| `/v2` | Limited support | Only some endpoint support v2 path |
| `/api/v1` | Not found | API does not use this combined pattern |
| `/api/v2` | Limited support | Only specific endpoints support this pattern |

### Authentication Testing

All authentication is handled via Bearer token in the Authorization header:
```
Authorization: Bearer YOUR_API_KEY_HERE
```

Status code responses:
- 200: Success - Endpoint exists and request was authenticated
- 401: Unauthorized - Endpoint exists but authentication failed
- 404: Not Found - Endpoint does not exist

### Response Format Consistency

The API generally returns JSON responses, but we found some inconsistencies:

1. Error response formats vary by endpoint
2. Some endpoints include data wrapper objects, others return direct arrays
3. Pagination implementation varies between endpoints

### API Exploration Tool

We built an API exploration tool in `run-demo.js` to facilitate testing:

```powershell
node run-demo.js api --explore
```

This tool:
- Tests various endpoint patterns
- Reports HTTP status codes for each endpoint
- Identifies working API paths
- Tests the base URL connectivity

### Endpoint Status Summary

Based on our testing, these are the current endpoint statuses:

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/api/deployments` | ✅ Working | Returns list of deployments |
| `/api/deployment/{id}` | ✅ Working | Returns specific deployment |
| `/api/workflows` | ✅ Working | Returns list of workflows |
| `/api/workflow/{id}` | ✅ Working | Returns specific workflow |
| `/api/workflow-version/{id}` | ✅ Working | Returns specific workflow version |
| `/api/machines` | ✅ Working | Returns available machines |
| `/api/machine/{id}` | ✅ Working | Returns specific machine |
| `/api/run` | ✅ Working | Submits workflow execution requests |
| `/api/run?run_id={id}` | ✅ Working | Returns execution status |
| `/api/run/cancel` | ✅ Working | Cancels running execution |
| `/api/file` | ✅ Working | Handles file uploads |
| `/deployment` | ⚠️ Mixed | Legacy endpoint with inconsistent behavior |
| `/workflow` | ⚠️ Mixed | Legacy endpoint with inconsistent behavior |

### Performance Observations

During our testing, we observed:

1. Initial API requests typically respond in 200-500ms
2. Subsequent requests are faster, suggesting server-side caching
3. Webhook callbacks are received 100-300ms faster than polling status checks
4. Occasional rate limiting occurs under heavy load

### Implementation Recommendations

Based on our testing, we recommend:

1. Always include the `/api` prefix in endpoint paths
2. Implement automatic retry with exponential backoff
3. Use webhooks when available for faster status updates
4. Cache workflow data to reduce API load
5. Validate error responses carefully as formats vary

## Continuous Monitoring

We will continue to monitor API behavior and update this document as needed. The API exploration tool should be run periodically to detect any endpoint changes or behavioral shifts. 