# Dataset Training Suite — Outline

## Problem Statement
Current platform supports LoRA training only through legacy Telegram flows. There is no unified, platform-agnostic way for users to bundle media into a reusable dataset, nor to launch multiple trainings against the same dataset, track ownership & royalties, or surface training progress/status in the web sandbox. This limits scalability, discoverability, and revenue-sharing opportunities.

## Vision
1. Users can create **Datasets** (group of images + captions) via the web sandbox, Discord, or Telegram.
2. Datasets are stored in `storage://datasets/<datasetId>/` and indexed in `datasetDb`.
3. A **Training Offering Registry** exposes available training types (e.g., SD1.5-LoRA, SDXL-LoRA, Dreambooth, Hyper-LoRA) with cost, base-model compatibility, and expected output.
4. From Mods Menu → “Training” tab, users pick a dataset, choose an offering, pay with points/qoints, and submit a **Training Job**.
5. A training worker fleet discovers pending jobs, downloads dataset media, runs training, uploads resulting model artifacts, updates `trainingDb`, and notifies the user.
6. Resulting models are surfaced in Mods Menu, trigger words registered in LoRAResolutionService, and royalty tracking hooks into pointsApi for generation usage payouts.

## Acceptance Criteria
- Users can create, list, and delete datasets (REST + UI).
- Dataset schema records owner, media urls, tags, size, and access level.
- Training Offering config lives under `src/config/trainingOfferings.js` and drives UI.
- Users can submit a training job; balance check & debit implemented.
- Training worker can poll and claim jobs; status transitions persisted.
- Sandbox shows dataset list, job list, and model outputs with statuses.
- pointsApi accrues royalty counters per trainingId when generation uses resulting model.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| M1 | Schema & DB layer (`datasetDb`, `trainingDb`) | 2025-09-08 |
| M2 | Internal & External API endpoints | 2025-09-15 |
| M3 | Web sandbox Dataset Creator UI + upload pipeline | 2025-09-22 |
| M4 | Training Offering registry + job submission flow | 2025-09-29 |
| M5 | Worker MVP that trains SD1.5 LoRA | 2025-10-06 |
| M6 | Royalty accounting integration (pointsApi) | 2025-10-13 |

## Dependencies
- GridFS / S3 storage bucket `datasets/`
- Pricing & payment hooks (pointsApi)
- Worker environment with GPU & comfy-ui extensions
- Updated LoRAResolutionService cache invalidation after model publish
- CSRF & auth middleware for new endpoints
