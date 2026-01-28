# Roadmap Exploration Document

## Overview
This document tracks exploratory investigation of major architectural improvements.

---

## 1. Frontend Migration to Vite-based React-esque Framework

**Status:** Not Started

**Vision:** Migrate frontend to a minimal, Vite-based library with web3 extension that you've built.

**Motivations:**
- Make frontend more approachable to work with
- Improve styling capabilities
- Leverage existing custom library with web3 support

**Open Questions:**
- [ ] What is the current frontend stack?
- [ ] What does the custom library provide vs current setup?
- [ ] Migration path - incremental or full rewrite?
- [ ] Web3 extension capabilities needed?

**Investigation Notes:**

### Current State (Explored 2026-01-28)

**Frontend Architecture:**
- Custom vanilla JS with modular component system in `/src/platforms/web/client/`
- Main app: `/sandbox/` (~47KB index.js + component files)
- Public pages: `/public/` (landing.html, pricing.html, docs.html, etc.)
- No build process - files served directly via Express
- Explicit anti-React stance documented in `WEB_FRONTEND_NORTH_STAR.md`

**Serving Infrastructure (Already Compatible):**
- Express looks for `/client/dist` first (production SPA)
- Falls back to `/sandbox/*` for ESM modules
- SPA fallback routing exists for unmatched routes → `client/dist/index.html`

**Proposed Migration Path:**
```
/src/platforms/web/client/
├── src/                    ← microact source files
├── vite.config.js          ← Vite configuration
├── package.json            ← microact + micro-web3 deps
└── dist/                   ← build output (gitignored)
```

**Build Integration Options:**
1. Dockerfile: `RUN npm run build:frontend` before `npm install --omit=dev`
2. CI/CD: Build frontend artifact, copy into Docker context
3. Deploy script: Call build before `docker build`

**Decisions Made:**
- [x] Scope: Full migration (landing, admin, sandbox)
- [x] Build step: Multi-stage Dockerfile (best practice)
- [ ] Migration strategy: TBD

**Implementation Plan:**

### 1. Frontend Package Setup
Create `src/platforms/web/client/` as a standalone microact project:
```
src/platforms/web/client/
├── package.json          ← @monygroupcorp/microact, @monygroupcorp/micro-web3
├── vite.config.js        ← Vite config
├── index.html            ← SPA entry point
├── src/
│   ├── main.js           ← microact app bootstrap
│   ├── pages/
│   │   ├── Landing.jsx   ← from /public/landing.html
│   │   ├── Pricing.jsx   ← from /public/pricing.html
│   │   ├── Docs.jsx      ← from /public/docs.html
│   │   ├── Admin.jsx     ← from /public/admin.html
│   │   └── Sandbox.jsx   ← from /sandbox/*
│   └── components/       ← shared components
└── dist/                 ← build output (gitignored)
```

### 2. Dockerfile Changes
Add multi-stage build:
```dockerfile
# Stage 1: Build frontend
FROM node:20 AS frontend-builder
WORKDIR /app
COPY src/platforms/web/client/package*.json ./
RUN npm ci
COPY src/platforms/web/client ./
RUN npm run build

# Stage 2: Production app
FROM node:20
WORKDIR /usr/src/app
# ... existing Dockerfile content ...
COPY --from=frontend-builder /app/dist ./src/platforms/web/client/dist
```

### 3. Express Routing Updates
Minimal changes - already looks for `/client/dist`:
- Ensure SPA fallback routes all pages to index.html
- Remove old `/public/*.html` static serving
- API routes remain unchanged

### 4. Migration Order (Suggested)
1. Scaffold microact project structure
2. Port Landing page first (simplest, validates setup)
3. Port Pricing, Docs pages
4. Port Admin page
5. Port Sandbox (largest, most complex - last)
6. Remove old /public and /sandbox directories
7. Update Dockerfile with multi-stage build

### 5. What Carries Over
- All API routes unchanged
- WebSocket service unchanged
- Authentication (JWT cookies) unchanged
- Web3 integration via @monygroupcorp/micro-web3

### 6. Risk Areas
- Sandbox is ~47KB+ of custom JS with complex state management
- Canvas-based UI with water animation may need careful porting
- Component lifecycle differences between vanilla JS and microact

---

## 2. Replace ComfyUI with Self-Hosted Compute via VastAI

**Status:** Not Started

**Vision:** Now that VastAI training is proven, extend to inference by replacing ComfyUI as a provider with self-managed instances.

**Motivations:**
- Truly limitless compute scaling
- Direct control over infrastructure
- Consistent architecture between training and inference

**Key Challenge:** LoraResolutionService is built around ComfyUI's shared model folder paradigm. Self-hosted would supply models directly to instances.

**Open Questions:**
- [ ] Current LoraResolutionService architecture and dependencies?
- [ ] How does ComfyUI shared model folder work today?
- [ ] Model distribution strategy for self-hosted instances?
- [ ] What inference workflows currently go through ComfyUI?

**Investigation Notes:**

### Current Architecture (Explored 2026-01-28)

**LoraResolutionService Flow:**
```
User prompt: "portrait in style of disney"
    ↓
loraResolutionService.resolveLoraTriggers()
    ↓
Fetches trigger map from /internal/v1/data/lora/trigger-map-data
    ↓
Matches "disney" → finds disney-v3 lora (filtered by baseModel compatibility)
    ↓
Modified prompt: "portrait <lora:disney-v3:1.0> in style of disney"
    ↓
ComfyUI parses <lora:slug:weight> and loads /models/loras/disney-v3.safetensors
```

**ComfyUI Deploy Integration:**
- `src/core/services/comfydeploy/comfyui.js` - Main service
- `src/core/services/comfydeploy/runManager.js` - Job submission/tracking
- `src/core/services/comfydeploy/workflows.js` - Payload preparation

**Model Deployment (Current):**
```
Admin approves LoRA
    ↓
POST https://api.comfydeploy.com/api/volume/model
    {
      source: "civitai" | "link",
      folderPath: "loras",
      filename: "disney-v3.safetensors",
      civitai: { url: "..." } | download_link: "..."
    }
    ↓
ComfyUI Deploy downloads → stages in shared volume
    ↓
All instances can load /models/loras/disney-v3.safetensors
```

**Job Execution (Current):**
```
POST https://api.comfydeploy.com/api/run_queue
    {
      deployment_id: "flux-prod-01",
      inputs: { input_prompt: "..." },
      webhook: "https://ourapi/webhook/comfydeploy"
    }
    ↓
Returns runId → poll or wait for webhook
```

### Self-Hosted Replacement Analysis

**What ComfyUI Deploy Provides:**
1. Shared volume with all models pre-staged
2. Instance pool management (Modal GPUs)
3. Job queue and routing
4. Webhook infrastructure
5. Cost metering per GPU-second

**Replacement Components Needed:**

| Component | Self-Hosted Solution |
|-----------|---------------------|
| Shared volume | S3/R2 + instance-local cache OR network volume |
| Instance pool | VastAI API + our orchestration (see #3) |
| Job queue | Direct ComfyUI API + our queue |
| Model staging | Download on instance startup OR on-demand |
| Webhooks | ComfyUI has native websocket, or we poll |

### Model Distribution Strategies

**Option A: Pre-baked Docker Image**
- Build Docker image with all public loras baked in
- Pros: Fast startup, no download delay
- Cons: Huge image, slow to update, can't add user loras dynamically

**Option B: S3/R2 + Instance Cache**
- Models stored in object storage
- Instance downloads needed models on first use
- Cache persists for instance lifetime
- Pros: Flexible, supports user loras
- Cons: First-use latency, needs cache management

**Option C: Network-Attached Storage**
- VastAI supports attaching volumes
- Mount shared storage across instances
- Pros: Closest to current model, fast access
- Cons: VastAI volume complexity, region constraints

**Option D: Hybrid - Base Models Baked, Loras On-Demand**
- Checkpoint models (FLUX, SDXL) in Docker image
- Loras downloaded on-demand from S3
- Pros: Balance of speed and flexibility
- Cons: Moderate complexity

### Key Files to Modify

1. **New:** `src/core/services/vastai/comfyRunner.js` - Submit jobs to VastAI ComfyUI
2. **New:** `src/core/services/vastai/modelDistribution.js` - Stage models to instances
3. **Modify:** `src/core/services/comfydeploy/` - Abstract behind interface, swap implementation
4. **Modify:** `src/api/internal/loras/lorasApi.js` - Change deployment target
5. **Keep:** `loraResolutionService.js` - Unchanged (outputs same `<lora:slug:weight>` syntax)

### Migration Path

1. Create abstraction layer over current ComfyUI Deploy integration
2. Implement VastAI-based runner behind same interface
3. Build model distribution service (likely Option B or D)
4. Feature flag to route traffic: ComfyUI Deploy vs Self-Hosted
5. Gradually shift traffic
6. Deprecate ComfyUI Deploy integration

### Cost Comparison (Rough)

| Provider | GPU | $/hr | Notes |
|----------|-----|------|-------|
| ComfyUI Deploy (Modal) | A10G | ~$1.21/hr | + $100/mo platform fee |
| VastAI | RTX 4090 | ~$0.30/hr | Direct rental, we manage |
| VastAI | A100 | ~$1.50/hr | For heavy workloads |

**Break-even:** With ~80+ GPU-hours/month, self-hosting saves money even before counting the $100 platform fee.

---

## 3. Persistent Instance Pool / Swarm Architecture

**Status:** Not Started

**Vision:** Keep GPU instances running persistently rather than spinning up per-task. A master instance that scales with demand.

**Motivations:**
- Avoid cold-start latency for every task
- Cost efficiency through sustained usage
- Foundation for swarm scaling

**Key Concepts:**
- Master instance always up
- Configurable scaling (grow/shrink with demand)
- Potential swarm expansion

**Open Questions:**
- [ ] Current instance lifecycle management?
- [ ] Metrics for scaling decisions?
- [ ] Session affinity / user-to-instance routing?
- [ ] Cost model for persistent vs on-demand?
- [ ] Swarm coordination mechanism?

**Investigation Notes:**

### Existing VastAI Infrastructure (Explored 2026-01-28)

**Already Built (reusable for inference):**
```
src/core/services/vastai/
├── VastAIService.js      ← Offer search, provisioning, termination
├── VastAIClient.js       ← HTTP client with retry logic
├── InstanceSweeper.js    ← Orphan detection & cleanup
├── TrainingRunner.js     ← Remote execution patterns
└── TrainingMonitor.js    ← Health/progress monitoring

src/core/services/remote/
└── SshTransport.js       ← SSH/SCP wrapper (works for any instance)

src/core/services/compute/
└── ComputeProvider.js    ← Abstract base class (extensible)
```

**Key Patterns from Training:**
- Atomic job claiming (prevents race conditions)
- Instance lifecycle state machine (QUEUED → PROVISIONING → ... → DONE)
- Sweeper runs every 5 min, catches orphans, enforces 4hr max runtime
- SSH routing through VastAI proxy hosts (`ssh2.vast.ai:12345`)
- Instance ID quirks handled (checks .new_contract, .instance_id, .id)

### Inference Pool Architecture (Proposed)

**Training (current) vs Inference (proposed):**
```
Training (ephemeral):          Inference (persistent):
─────────────────────          ────────────────────────
Provision → Train → Terminate  Provision → Stay alive → Route requests
1 job per instance             Many requests per instance
Fixed duration                 Demand-driven scaling
Cost = GPU-hours               Cost = GPU-hours (amortized)
```

**Pool State Machine:**
```
Instance States:
  PROVISIONING → INITIALIZING → IDLE ⟷ BUSY → DRAINING → TERMINATED
                     ↓
               UNHEALTHY → TERMINATED

Pool Scaling:
  Queue depth > threshold → Spin up instance
  All instances idle > timeout → Terminate one
  Min instances always maintained
```

### Database Schema: InferencePoolDB (Proposed)

```javascript
// Pool configuration
{
  _id: ObjectId,
  name: "flux-inference-pool",

  // Scaling
  minInstances: 1,
  maxInstances: 5,
  scaleUpThreshold: 10,     // queue depth to trigger scale up
  scaleDownIdleMinutes: 30, // idle time before scale down

  // GPU requirements
  gpuType: ["RTX 4090", "A100"],
  minVram: 24,
  maxHourlyRate: 0.50,

  // Docker image
  dockerImage: "our-comfyui-image:latest",
  startupScript: "...",

  // Model pre-loading (popular models)
  preloadModels: ["flux-dev", "sdxl-base"],

  createdAt, updatedAt
}

// Instance tracking
{
  _id: ObjectId,
  poolId: ObjectId,
  vastaiInstanceId: "12345",

  status: "IDLE" | "BUSY" | "DRAINING" | "UNHEALTHY",
  sshHost: "ssh2.vast.ai",
  sshPort: 12345,

  // Health
  lastHealthCheck: Date,
  healthCheckFailures: 0,

  // Model cache (what's downloaded on this instance)
  cachedModels: ["flux-dev", "sdxl-base", "disney-v3"],

  // Metrics
  requestsHandled: 0,
  totalGpuSeconds: 0,
  avgLatencyMs: 0,

  provisionedAt: Date,
  lastRequestAt: Date
}

// Request routing
{
  _id: ObjectId,
  poolId: ObjectId,
  instanceId: ObjectId,

  requestId: "uuid",
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED",

  // What models needed
  requiredModels: ["flux-dev", "disney-v3"],

  // Timing
  queuedAt: Date,
  startedAt: Date,
  completedAt: Date,

  // Result
  outputUrl: "...",
  error: "..."
}
```

### Request Routing Logic

```
New inference request arrives
    ↓
Check required models (from loraResolutionService output)
    ↓
Find instance with:
  1. Status = IDLE
  2. Has models cached (preferred) OR can download them
  3. Lowest current load
    ↓
If no idle instance + queue depth > threshold + instances < max:
  → Provision new instance
    ↓
Route request to selected instance
    ↓
Instance downloads missing models (cached for future)
    ↓
Execute ComfyUI workflow
    ↓
Return result
```

### Model Caching Strategy

With persistent instances, model caching becomes simple:

```
Instance Startup:
  1. Provision with ComfyUI Docker image
  2. Download preloadModels from S3/R2 (popular base models)
  3. Mark instance IDLE

Request Handling:
  1. Check if required loras exist on instance
  2. If not: download from S3/R2 to /models/loras/
  3. Execute workflow
  4. Update cachedModels in DB

Cache Management:
  - LRU eviction if disk fills (track lastUsed per model)
  - Popular models naturally stay cached
  - Cold models evicted but re-downloadable
```

### Components to Build

| Component | Purpose | Base to Extend |
|-----------|---------|----------------|
| `InferencePoolDB` | Track pools & instances | BaseDB pattern |
| `InstancePoolManager` | Scaling, health, routing | VastAIService patterns |
| `InferenceRunner` | Execute ComfyUI on instance | TrainingRunner |
| `ModelCacheService` | Track/download models | New |
| `InferenceSweeper` | Cleanup unhealthy instances | InstanceSweeper |

### Integration with #2 (ComfyUI Replacement)

```
Current:
  loraResolutionService → ComfyUI Deploy API → Their shared volume

Self-hosted:
  loraResolutionService → InstancePoolManager → Route to instance
                                ↓
                         ModelCacheService checks/downloads models
                                ↓
                         InferenceRunner executes via SSH
                                ↓
                         ComfyUI on instance loads from local /models/
```

**Key insight:** Persistent instances SOLVE the model distribution problem. Each instance builds up a local cache. Popular models stay warm. No shared volume needed.

### Estimated Build Order

1. **InferencePoolDB** + basic schema
2. **Docker image** with ComfyUI + base models baked in
3. **InstancePoolManager** - provision/terminate (adapt VastAIService)
4. **ModelCacheService** - S3/R2 ↔ instance sync
5. **InferenceRunner** - execute workflow via SSH/API
6. **Request routing** - queue + instance selection
7. **InferenceSweeper** - health checks, cleanup
8. **Scaling logic** - up/down based on demand
9. **Cost tracking** - amortize GPU-hours across requests

---

## 4. Chat/Avatar Agent Interface

**Status:** Not Started

**Vision:** Simplify UI to a conversational interface where users interact with an agent to discover and orchestrate tools collaboratively.

**Motivations:**
- Lower barrier to entry
- Guided discovery of capabilities
- Natural language task composition

**Key Concepts:**
- Chat-based primary interface
- Avatar/agent persona
- Collaborative tool selection
- User describes goals, agent helps find path

**Open Questions:**
- [ ] Current UI architecture and user flows?
- [ ] Agent orchestration layer needed?
- [ ] Tool discovery and recommendation logic?
- [ ] Conversation persistence and context?

**Investigation Notes:**
_(To be filled during exploration)_

---

## Investigation Log

| Date | Item | Summary |
|------|------|---------|
| _(to be updated)_ | | |

