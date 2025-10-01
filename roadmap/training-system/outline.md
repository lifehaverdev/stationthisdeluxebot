# LoraTrainingSystem — Outline

## Problem Statement
Users need a simple, one-button solution to train custom LoRA models from their image datasets. The current training system is "very delicate and difficult to modify" and requires a complete ground-up rebuild using modern best practices.

## Vision
A production-ready training system that can execute FLUX, WAN, and SDXL model training with a single button press. The system will be robust, containerized, and seamlessly integrated with the existing StationThis platform, handling everything from job queuing to model registration.

## Acceptance Criteria
- Single button training: User submits training job via existing UI, system handles everything automatically
- Multi-model support: FLUX, WAN, and SDXL training all work seamlessly
- Production ready: Robust error handling, logging, and monitoring
- Cost integration: Proper point deduction and crediting via existing pointsService
- Model registration: Trained models automatically available in ComfyUI service
- Scalable: Can handle multiple concurrent training jobs
- Containerized: Docker-based training with GPU acceleration support

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Foundation | Service architecture and job polling system | Sprint 1 |
| Core Services | Database, storage, and recipe services | Sprint 2 |
| Recipe Implementation | FLUX, WAN, and SDXL training recipes | Sprint 3 |
| Integration & Testing | Points integration and production testing | Sprint 4 |

## Dependencies
- Existing TrainingDB, DatasetDB, LoRAModelDB schemas
- StorageService for Cloudflare R2 integration
- pointsService for cost management
- ComfyUI service for model registration
- Docker with NVIDIA GPU support
