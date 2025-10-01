# Training System Implementation Prompt

## Agent Collaboration Protocol Compliance

**CRITICAL**: Follow the AGENT_COLLABORATION_PROTOCOL_v3.md exactly:

1. **First 5 Minutes**: Read `roadmap/README.md`, `roadmap/master-outline.md`, `roadmap/master-roadmap.md`
2. **Focus Area**: This task is for the **LoraTrainingSystem** module (Status: Planned → In Progress)
3. **Documentation**: All work goes in `roadmap/training-system/` folder structure
4. **Updates**: Update `master-outline.md` status column as you progress

## Mission Statement

Build a complete, production-ready training system that can execute FLUX, WAN, and SDXL model training with a single button press. The system must be robust, containerized, and integrated with the existing StationThis platform.

## Current State Analysis

**Existing Infrastructure** (DO NOT MODIFY - use as reference):
- Database schemas: `TrainingDB`, `DatasetDB`, `LoRAModelDB` in `src/core/services/db/`
- Storage service: `StorageService` for Cloudflare R2 integration
- Worker pattern: `CookWorker` in `scripts/workers/` as reference
- API layer: Internal/external APIs already exist
- Training workflows: `trainModel.js` workflow (legacy - don't modify)

**Key Constraint**: The existing training system is "very delicate and difficult to modify" - we're building a completely new system from scratch using best practices.

## Architecture Requirements

### 1. Master Entry Point Script
**Location**: `scripts/workers/trainingWorker.js`

**Requirements**:
- Runs continuously until manually stopped
- Polls `TrainingDB` for `status: 'QUEUED'` jobs
- Claims jobs atomically to prevent race conditions
- Orchestrates the complete training pipeline
- Handles job status transitions: QUEUED → RUNNING → COMPLETED/FAILED
- Integrates with existing `pointsService` for cost deduction
- Updates `LoRAModelDB` with trained model metadata
- Credits trainer and dataset creator via `pointsService`

### 2. Training Services Architecture
**Location**: `src/core/services/training/`

Create a dependency injection system similar to existing services:

```
src/core/services/training/
├── index.js                    # Service registry & dependency injection
├── TrainingOrchestrator.js     # Main coordination service
├── DockerService.js            # Container lifecycle management
├── CloudflareService.js        # Model upload/download to R2
├── MongoService.js             # Database operations
├── TrainingRecipeService.js    # Recipe registry & execution
└── recipes/
    ├── FLUXRecipe.js
    ├── WANRecipe.js
    └── SDXLRecipe.js
```

### 3. Docker Recipe System
**Location**: `src/core/services/training/recipes/`

Each recipe must:
- Define Docker container configuration
- Specify base images and dependencies
- Handle model-specific training parameters
- Manage input/output file paths
- Support GPU acceleration
- Include health checks and monitoring

**Required Recipes**:
- **FLUX**: Latest FLUX model training
- **WAN**: WAN (Wild and Natural) training
- **SDXL**: Stable Diffusion XL LoRA training

## Implementation Phases

### Phase 1: Foundation (Sprint 1)
1. Create `roadmap/training-system/outline.md` using template
2. Set up service architecture in `src/core/services/training/`
3. Implement `TrainingOrchestrator.js` with job polling
4. Create basic `DockerService.js` for container management
5. Update `master-outline.md` status to "In Progress"

### Phase 2: Core Services (Sprint 2)
1. Implement `CloudflareService.js` using existing `StorageService` patterns
2. Create `MongoService.js` for database operations
3. Build `TrainingRecipeService.js` with recipe registry
4. Create first recipe: `SDXLRecipe.js` (simplest to start)

### Phase 3: Recipe Implementation (Sprint 3)
1. Implement `FLUXRecipe.js` and `WANRecipe.js`
2. Create Dockerfiles for each training type
3. Test end-to-end training pipeline
4. Add comprehensive error handling and logging

### Phase 4: Integration & Testing (Sprint 4)
1. Integrate with existing `pointsService` for cost management
2. Add model registration to `LoRAModelDB`
3. Implement trainer/dataset creator crediting
4. Create comprehensive test suite
5. Update `master-outline.md` status to "Operational"

## Technical Specifications

### Database Integration
- Use existing `TrainingDB` schema (don't modify)
- Integrate with `DatasetDB` for image retrieval
- Update `LoRAModelDB` with trained model metadata
- Maintain foreign key relationships

### Storage Integration
- Use existing `StorageService` for Cloudflare R2
- Store training datasets in `datasets/` bucket
- Store trained models in `models/` bucket
- Generate CDN URLs for model access

### Docker Requirements
- Support NVIDIA GPU acceleration
- Use multi-stage builds for efficiency
- Include training dependencies (PyTorch, diffusers, etc.)
- Support volume mounting for data persistence
- Implement proper cleanup on completion

### Error Handling
- Comprehensive logging at each step
- Graceful failure recovery
- Job status rollback on errors
- Point refunds for failed trainings
- Detailed error reporting to users

## Success Criteria

1. **Single Button Training**: User can submit training job via existing UI, system handles everything automatically
2. **Multi-Model Support**: FLUX, WAN, and SDXL training all work seamlessly
3. **Production Ready**: Robust error handling, logging, and monitoring
4. **Cost Integration**: Proper point deduction and crediting
5. **Model Registration**: Trained models automatically available in ComfyUI service
6. **Scalable**: Can handle multiple concurrent training jobs

## Development Guidelines

- Follow existing code patterns in `src/core/services/`
- Use dependency injection like other services
- Maintain consistency with existing error handling
- Follow vanilla JavaScript principles (no frameworks)
- Implement comprehensive logging
- Write self-documenting code
- Create ADRs for architectural decisions

## Deliverables

1. Complete training system implementation
2. Updated `roadmap/training-system/` documentation
3. Updated `master-outline.md` with progress
4. Working demo of all three training types
5. Integration tests and documentation

## Getting Started

1. Read the protocol files as specified
2. Create the roadmap folder structure
3. Start with Phase 1 implementation
4. Update documentation as you progress
5. Ask questions if anything is unclear

**Remember**: This is a ground-up implementation using best practices. Don't modify existing training code - build something new and robust that integrates seamlessly with the existing platform.
