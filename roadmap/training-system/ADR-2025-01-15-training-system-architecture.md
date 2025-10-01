# ADR-2025-01-15: Training System Architecture

## Status
Accepted

## Context
The existing training system is "very delicate and difficult to modify" and requires a complete ground-up rebuild using modern best practices. Users need a simple, one-button solution to train custom LoRA models from their image datasets, supporting FLUX, WAN, and SDXL model types.

## Decision
We will implement a new, production-ready training system with the following architecture:

### Core Components

1. **Training Orchestrator** (`TrainingOrchestrator.js`)
   - Polls `TrainingDB` for `status: 'QUEUED'` jobs
   - Claims jobs atomically to prevent race conditions
   - Orchestrates the complete training pipeline
   - Handles job status transitions: QUEUED → RUNNING → COMPLETED/FAILED
   - Integrates with existing `pointsService` for cost deduction
   - Updates `LoRAModelDB` with trained model metadata

2. **Docker Service** (`DockerService.js`)
   - Manages Docker container lifecycle for training jobs
   - Supports GPU acceleration
   - Handles container cleanup and resource management
   - Provides isolation and reproducibility

3. **Cloudflare Service** (`CloudflareService.js`)
   - Downloads datasets from Cloudflare R2
   - Uploads trained models to R2
   - Generates CDN URLs for model access
   - Uses existing `StorageService` patterns

4. **Mongo Service** (`MongoService.js`)
   - Database operations using existing database services
   - Atomic job claiming to prevent race conditions
   - Integration with `TrainingDB`, `DatasetDB`, and `LoRAModelDB`

5. **Training Recipe Service** (`TrainingRecipeService.js`)
   - Registry for training recipes (FLUX, WAN, SDXL)
   - Recipe validation and configuration management
   - Support for different model types and training parameters

### Service Architecture

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

### Master Entry Point

- **Location**: `scripts/workers/trainingWorker.js`
- **Purpose**: Runs continuously until manually stopped
- **Features**: Graceful shutdown, status monitoring, error handling

## Implementation Phases

### Phase 1: Foundation ✅
- [x] Create roadmap folder structure
- [x] Set up service architecture
- [x] Implement `TrainingOrchestrator.js` with job polling
- [x] Create `DockerService.js` for container management
- [x] Update `master-outline.md` status to "In Progress"

### Phase 2: Core Services ✅
- [x] Implement `CloudflareService.js` using existing `StorageService` patterns
- [x] Create `MongoService.js` for database operations
- [x] Build `TrainingRecipeService.js` with recipe registry
- [x] Create first recipe: `SDXLRecipe.js` (simplest to start)

### Phase 3: Recipe Implementation (Next)
- [ ] Implement `FLUXRecipe.js` and `WANRecipe.js` fully
- [ ] Create Dockerfiles for each training type
- [ ] Test end-to-end training pipeline
- [ ] Add comprehensive error handling and logging

### Phase 4: Integration & Testing (Next)
- [ ] Integrate with existing `pointsService` for cost management
- [ ] Add model registration to `LoRAModelDB`
- [ ] Implement trainer/dataset creator crediting
- [ ] Create comprehensive test suite
- [ ] Update `master-outline.md` status to "Operational"

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

## Consequences

### Positive
- **Single Button Training**: Users can submit training jobs via existing UI, system handles everything automatically
- **Multi-Model Support**: FLUX, WAN, and SDXL training all work seamlessly
- **Production Ready**: Robust error handling, logging, and monitoring
- **Cost Integration**: Proper point deduction and crediting
- **Model Registration**: Trained models automatically available in ComfyUI service
- **Scalable**: Can handle multiple concurrent training jobs
- **Maintainable**: Clean architecture using existing patterns

### Negative
- **Complexity**: New service architecture adds complexity
- **Docker Dependency**: Requires Docker and NVIDIA GPU support
- **Resource Intensive**: Training jobs consume significant compute resources
- **Storage Costs**: Models and datasets stored in Cloudflare R2

### Risks
- **Docker Failures**: Container management can be complex
- **GPU Availability**: Training requires GPU resources
- **Storage Limits**: Large models and datasets may hit storage limits
- **Race Conditions**: Multiple workers could potentially conflict (mitigated by atomic job claiming)

## Monitoring & Observability

- Job status tracking in `TrainingDB`
- Comprehensive logging at each step
- Status endpoint for monitoring
- Error reporting and alerting
- Resource usage monitoring

## Success Criteria

1. **Single Button Training**: User can submit training job via existing UI, system handles everything automatically
2. **Multi-Model Support**: FLUX, WAN, and SDXL training all work seamlessly
3. **Production Ready**: Robust error handling, logging, and monitoring
4. **Cost Integration**: Proper point deduction and crediting
5. **Model Registration**: Trained models automatically available in ComfyUI service
6. **Scalable**: Can handle multiple concurrent training jobs

## Implementation Log

### 2025-01-15
- ✅ Created roadmap folder structure with outline.md
- ✅ Updated master-outline.md to change LoraTrainingSystem status to "In Progress"
- ✅ Implemented core service architecture in src/core/services/training/
- ✅ Created TrainingOrchestrator.js with job polling and atomic claiming
- ✅ Implemented DockerService.js for container lifecycle management
- ✅ Created CloudflareService.js for model upload/download using existing StorageService
- ✅ Implemented MongoService.js for database operations using existing DB services
- ✅ Built TrainingRecipeService.js with recipe registry system
- ✅ Created SDXLRecipe.js as the first complete training recipe
- ✅ Created placeholder FLUXRecipe.js and WANRecipe.js
- ✅ Implemented master entry point script scripts/workers/trainingWorker.js
- ✅ Updated core services index.js to include training services
- ✅ Created comprehensive ADR documenting the architecture

### Next Steps
- Complete FLUX and WAN recipe implementations
- Add comprehensive error handling and logging
- Create Dockerfiles for each training type
- Test end-to-end training pipeline
- Integrate with pointsService for cost management
- Add model registration to LoRAModelDB
- Create comprehensive test suite
