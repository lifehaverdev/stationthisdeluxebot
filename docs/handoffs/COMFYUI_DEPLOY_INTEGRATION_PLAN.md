# ComfyUI Deploy Integration Plan

## Overview

This document outlines the plan to integrate StationThis directly with the ComfyUI Deploy platform, using its documented API endpoints as the primary source of truth. The integration will deprecate reliance on the local database for workflow information and task tracking.

## Current Analysis

Based on the code review, StationThis already has partial integration with ComfyUI Deploy through:
1. `src/core/services/comfyui.js` - Handles interactions with ComfyUI Deploy for image generation
2. `src/core/services/workflows.js` - Manages workflow templates and configurations

However, these implementations are not fully utilizing the ComfyUI Deploy API as the source of truth and may still rely on local database for certain operations.

## API Endpoints Available

The ComfyUI Deploy API provides the following key endpoints:

1. **Run Operations**
   - `GET /api/run` - Get workflow run output
   - `POST /api/run` - Run a workflow via deployment_id

2. **Workflow Management**
   - `POST /api/workflow` - Upload a workflow definition
   - `GET /api/workflow-version/:id` - Get workflow version by ID

3. **Deployment Management**
   - `GET /api/deployment` - List deployments
   - `POST /api/deployment` - Create a deployment
   - `DELETE /api/deployment/:id` - Delete a deployment
   - `PUT /api/deployment/:id` - Update a deployment

4. **File Management**
   - `GET /api/upload-url` - Generate a pre-signed URL for file uploads
   - `POST /api/file` - File upload endpoint

5. **Machine Management**
   - `GET /api/machine` - List registered machines
   - `POST /api/machine` - Register a new machine
   - `DELETE /api/machine/:id` - Delete a machine
   - `PUT /api/machine/:id` - Update a machine

## Integration Tasks

### Phase 1: Update Core Services

1. **Enhance ComfyUI Service (src/core/services/comfyui.js)**
   - Expand API client capabilities to handle all relevant ComfyUI Deploy endpoints
   - Add support for webhook integrations for run status updates
   - Improve error handling and retry logic

2. **Refactor Workflows Service (src/core/services/workflows.js)**
   - Modify to use ComfyUI Deploy API as the source of truth
   - Remove database dependencies for workflow information
   - Implement efficient caching mechanism with proper invalidation

3. **Update Media Service (src/core/services/media.js)**
   - Integrate with ComfyUI Deploy file upload endpoints
   - Support pre-signed URLs for file uploads
   - Handle image downloads from ComfyUI Deploy

### Phase 2: Update Workflow Implementation

1. **Modify makeImage Workflow (src/workflows/makeImage.js)**
   - Update to use enhanced ComfyUI service
   - Implement proper error handling and fallbacks
   - Add progress tracking using ComfyUI Deploy status endpoints

2. **Update trainModel Workflow (src/workflows/trainModel.js)**
   - Connect to ComfyUI Deploy for model training operations
   - Implement async status checking
   - Track training progress through API

3. **Refactor collections.js (src/workflows/collections.js)**
   - Store collection data with references to ComfyUI Deploy entities
   - Add validation against ComfyUI Deploy workflows

### Phase 3: Platform Adapters Updates

1. **Update Telegram Commands**
   - Modify command handlers to use updated services
   - Update rendering for ComfyUI Deploy-specific outputs
   - Add new commands for ComfyUI Deploy features

2. **Update Discord Commands**
   - Similar updates for Discord platform

3. **Web Interface Enhancements**
   - Create direct integration with ComfyUI Deploy UI (if applicable)
   - Implement shared session management

## Implementation Priorities

1. **First Priority: Core Run Integration**
   - Focus on run creation and monitoring via ComfyUI Deploy API
   - Ensure backward compatibility during transition

2. **Second Priority: Workflow & Deployment Management**
   - Implement endpoints for managing workflows and deployments
   - Transition from database to API for workflow information

3. **Third Priority: File & Media Management**
   - Update file upload/download mechanics
   - Integrate with pre-signed URLs

4. **Fourth Priority: UI & Platform Integration**
   - Update platform-specific renderers
   - Add new ComfyUI Deploy-specific features to UI

## Compatibility Considerations

- Maintain backward compatibility where possible during transition
- Add feature flags to enable/disable ComfyUI Deploy integration
- Implement fallback mechanisms for unavailable API endpoints

## Success Metrics

1. All workflow operations sourced from ComfyUI Deploy API
2. No direct database dependencies for workflow data
3. Improved performance and reliability of image generation
4. Simplified architecture with reduced code complexity

## Timeline

1. Phase 1: 1-2 weeks
2. Phase 2: 1-2 weeks
3. Phase 3: 1-2 weeks

Total estimated time: 3-6 weeks depending on complexity and testing requirements. 