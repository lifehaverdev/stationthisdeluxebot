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

### Revised Strategy: Demand-Anticipation Model

**Key insight:** VastAI volumes are machine-tied - can't reliably get the same machine. Persistent instances are too expensive for low-traffic periods.

**Model sourcing strategy (Final):**
```
Visibility    Source              Access Method
────────────────────────────────────────────────────────────────
Public        HuggingFace         Direct download (public URL)
Public        Civitai             Direct download (public URL)
Public        User-trained → HF   Direct download (public repo)
Private       User-trained → R2   Signed URL (time-limited, secure)
────────────────────────────────────────────────────────────────
Instance      Local cache         Persists during session
```

**Private model flow:**
```
User trains private lora
    ↓
Upload to R2 bucket (not HuggingFace)
    ↓
Store R2 key in loraModel record
    ↓
On inference request:
    ↓
Generate presigned URL (e.g., 15 min expiry)
    ↓
Send signed URL to VastAI instance
    ↓
Instance downloads securely, caches locally
```

**Why this works:**
- No credentials on instances
- Time-limited access (signed URLs expire)
- Private models stay private
- Public models use free CDN bandwidth (HF/Civitai)
- Simple routing: check visibility → pick source
```

**Demand-anticipation scaling:**
```
Activity Patterns:
  - Monitor historical request patterns
  - Predict busy windows (time of day, day of week)
  - Pre-warm instances before anticipated demand
  - Scale down aggressively during quiet periods

Cost Optimization:
  - Instance up only when needed (~$0.30/hr only during use)
  - S3 storage always available (~$7-15/month)
  - First request may be slow (cold start + model download)
  - Subsequent requests fast (instance warm, models cached)
```

**This pathway enables:**
1. Replace ComfyUI Deploy ($100/mo + compute savings)
2. Expand to new services not possible on ComfyUI Deploy
3. Full control over instance configuration
4. Custom Docker images with any software stack

### Estimated Build Order

1. **InferencePoolDB** + basic schema
2. **ModelStorageService** - S3/R2 upload/download for all models
3. **Docker image** with ComfyUI + startup script to pull models
4. **InstancePoolManager** - provision/terminate (adapt VastAIService)
5. **ModelCacheService** - track what's cached where, pull on-demand
6. **InferenceRunner** - execute workflow via SSH/API
7. **Request routing** - queue + instance selection
8. **DemandPredictor** - analyze patterns, pre-warm instances
9. **InferenceSweeper** - health checks, idle timeout, cleanup
10. **Cost tracking** - per-request attribution

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

### Current UI Architecture (Explored 2026-01-28)

**What exists:**
- Node-based visual workflow builder (canvas + draggable tool windows)
- Sidebar with tools grouped by category
- Tool registry with full schema (inputs, outputs, costs)
- Spell system for saved multi-step workflows
- WebSocket-based execution with progress tracking
- Result rendering for images, video, audio, text
- Vanilla JS, no framework (easy to integrate)

**Key files:**
```
sandbox/
├── state.js              ← Global state
├── node/toolWindow.js    ← Execution logic
├── io.js                 ← API calls, tool registry cache
└── components/           ← Modals (SpellsMenu, ModsMenu, etc.)
```

**What's missing for chat:**
- No conversational UI
- No intent parsing
- No tool recommendation engine
- No context memory across turns
- ChatGPT exists as a tool, not as the interface

### Agent Architecture (Proposed)

**Core Components:**

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Layer                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│  │ Intent      │   │ Tool        │   │ Workflow    │       │
│  │ Parser      │   │ Recommender │   │ Composer    │       │
│  │             │   │             │   │             │       │
│  │ NL → intent │   │ intent →    │   │ tools →     │       │
│  │             │   │ tool list   │   │ execution   │       │
│  └─────────────┘   └─────────────┘   └─────────────┘       │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           ▼                                  │
│                  ┌─────────────────┐                        │
│                  │ Conversation    │                        │
│                  │ Manager         │                        │
│                  │                 │                        │
│                  │ - Turn history  │                        │
│                  │ - Context state │                        │
│                  │ - Prior outputs │                        │
│                  └─────────────────┘                        │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            ▼
              ┌─────────────────────────┐
              │ Existing Execution API  │
              │ /api/v1/generations/    │
              └─────────────────────────┘
```

**Intent Types:**
- Discovery: "What can I do with an image?"
- Creation: "Generate a cyberpunk cityscape"
- Transformation: "Make this look like anime"
- Iteration: "More vibrant" / "Less saturated"
- Chaining: "Then upscale it 4x"
- Query: "How much will this cost?"

**Tool Recommendation Approaches:**

| Approach | Pros | Cons |
|----------|------|------|
| Keyword matching | Simple, fast | Brittle, misses synonyms |
| Embedding search | Semantic, flexible | Needs vector DB |
| LLM-based | Most flexible, handles edge cases | Cost per request |
| Hybrid | Best of both | More complexity |

**Conversation Memory:**
```javascript
{
  sessionId: "uuid",
  turns: [
    {
      role: "user",
      content: "make an anime girl",
      timestamp: Date
    },
    {
      role: "agent",
      content: "I'll use flux with anime style...",
      toolsUsed: ["comfy-flux-img-gen"],
      generationIds: ["gen-123"],
      timestamp: Date
    }
  ],
  context: {
    lastGenerationId: "gen-123",
    lastOutputUrl: "https://...",
    activeWorkflow: { ... }
  }
}
```

### UI Integration Options

**Option A: Replace Sandbox**
- Full chat interface, no node graph
- Simpler for new users
- Loses power-user flexibility

**Option B: Chat Overlay on Sandbox**
- Chat panel alongside canvas
- Agent can create/modify nodes
- Best of both worlds
- More complex

**Option C: Separate Chat Page**
- New route: /chat or /agent
- Completely separate from sandbox
- Users choose their interface
- Easiest to build incrementally

### LLM Backend Options

| Option | Latency | Cost | Flexibility |
|--------|---------|------|-------------|
| OpenAI GPT-4 | Medium | High | Excellent |
| Claude | Medium | Medium | Excellent |
| Local LLM (Ollama) | Low | Free | Limited |
| Fine-tuned model | Low | Medium | Task-specific |

**Recommendation:** Start with GPT-4/Claude API for prototyping, optimize later.

### UI Decision: Separate Page (Option C)

- Route: `/chat` or `/agent`
- Node sandbox remains at `/` for power users
- Chat interface for guided experience
- No need to modify existing sandbox code

### Build Order (Suggested)

1. **Chat UI component** - Basic input/output, message history
2. **Conversation API** - Backend endpoint for chat turns
3. **Tool registry embedding** - Semantic search over tools
4. **Intent parser** - LLM-based intent extraction
5. **Workflow composer** - Map intent → tool chain
6. **Execution bridge** - Connect to existing generation API
7. **Result renderer** - Inline images/media in chat
8. **Iteration handling** - "Make it more X" refinements
9. **Context persistence** - Save/resume conversations
10. **Feedback tracking** - Log success/failure for learning

### Learning Flywheel

```
User Request
    ↓
Agent attempts workflow
    ↓
┌─────────────────────────────────────────┐
│           Outcome Tracking               │
├─────────────────────────────────────────┤
│ Log:                                     │
│ - Intent parsed                          │
│ - Tools selected                         │
│ - Parameters used                        │
│ - Execution success/failure              │
│ - User feedback (thumbs up/down, retry)  │
│ - Refinement requests                    │
└─────────────────────────────────────────┘
    ↓
Feedback Dataset
    ↓
Fine-tune / Improve:
- Intent parsing accuracy
- Tool selection relevance
- Parameter defaults
- Error recovery strategies
```

**Data to Capture:**

```javascript
{
  sessionId: "uuid",

  // Input
  userMessage: "make an anime portrait from this photo",
  parsedIntent: { action: "transform", style: "anime", input: "image" },

  // Decision
  toolsSelected: ["comfy-flux-img2img"],
  parametersUsed: { style_preset: "anime", strength: 0.75 },

  // Outcome
  executionSuccess: true,
  generationId: "gen-123",

  // Feedback
  userFeedback: "thumbs_up" | "thumbs_down" | "retry" | null,
  refinementRequested: "make it more vibrant",

  // Meta
  latencyMs: 4500,
  costPoints: 50,
  timestamp: Date
}
```

**Uses:**
- Identify common failure patterns → improve prompts/logic
- Find popular intent→tool mappings → optimize recommendations
- Tune parameter defaults based on success rates
- Build fine-tuning dataset for custom model

---

---

## 5. Refactor for Best Practices & Efficiency

**Status:** Not Started

**Vision:** Audit the codebase for architectural patterns established during migration that prioritized "working" over "optimal". Identify if the internal API conduit pattern is best practice or leaving performance on the table.

**Key Questions:**
- [ ] Is the internal API pattern causing unnecessary overhead?
- [ ] Are there N+1 query patterns or redundant calls?
- [ ] Is service-to-service communication efficient?
- [ ] Are we over-abstracting or under-abstracting?
- [ ] Database query patterns - indexed properly?
- [ ] Memory/CPU profiling - any obvious bottlenecks?

**Investigation Notes:**

### Assessment: Is the App "Slop"? (Explored 2026-01-28)

**Verdict: Honest and functional, not optimal.** The HTTP-everywhere pattern was the correct migration strategy - it worked. Now it's technical debt to optimize.

**The Core Issue:**
```
363+ internal HTTP calls across codebase
Every service → HTTP → Router → DB → HTTP response
Even when services run in the same process
```

**Cost Breakdown:**
- Network round-trips: 70% of added latency
- Serialization overhead: 15%
- Re-validation: 10%
- Query inefficiency: 5%
- **Total: ~100-150ms added latency on complex operations**

**Specific Anti-Patterns Found:**

1. **Fetch-Check-Fetch:**
   ```javascript
   // userEconomyApi.js
   const deposits = await db.findDepositsForUser(id);
   if (!deposits.length) {
     const userCore = await db.findUserCoreById(id); // Re-fetch
   }
   // Should be single compound query
   ```

2. **Triple PUT on State Change:**
   ```javascript
   // webhookProcessor.js
   GET /generations?run_id=...
   PUT /generations/{id}
   GET /generations/{id}  // REDUNDANT - trust your update
   ```

3. **N+1 Patterns:**
   ```javascript
   // analyticsApi.js
   datasets.forEach(d => d.tags.forEach(tag => ...)); // Nested loops
   ```

4. **Lost Batch Opportunities:**
   - BaseDB has batch operations framework
   - Never used from route handlers

**What's Working Well (Don't Change):**
- Platform independence (Telegram/Discord/Web share API)
- Audit trail via HTTP logging
- Horizontal scalability ready
- Rate limiting at boundary
- Retry logic with exponential backoff
- Clear request flow

### Optimization Strategy

**Phase 1: Direct DB for Internal Services (Quick Win)**
```javascript
// BEFORE
await internalApiClient.get(`/internal/v1/data/ledger/entries/${hash}`)

// AFTER
const ledgerDb = dependencies.db.creditLedger;
await ledgerDb.findByTransactionHash(hash);
```
Target services: `CreditService`, `DepositConfirmationService`, `ComfyUIService`

**Phase 2: Query Consolidation**
- Compound queries instead of fetch-check-fetch
- Batch wallet lookups
- Eliminate redundant GETs after PUTs

**Phase 3: Caching Layer**
| Data | TTL | Impact |
|------|-----|--------|
| User economy | 30s | High-frequency, consistency-sensitive |
| Spell metadata | 15min | Read-heavy, rarely changes |
| API key validation | 5min | Every authenticated request |
| LoRA permissions | 5min | Already done for triggers! |

**Effort vs Impact:**
```
Direct DB calls      ████████████████████  High impact, low effort
Query consolidation  ████████████░░░░░░░░  Medium impact, medium effort
Caching layer        ██████████░░░░░░░░░░  Medium impact, medium effort
Batch operations     ██████░░░░░░░░░░░░░░  Lower impact, higher effort
```

---

## 6. Worker Process Architecture / Zero-Downtime Deploys

**Status:** Not Started

**Vision:** Split application into persistent worker processes that survive deploys. Only restart components that actually changed. Minimize/eliminate downtime during `./deploy.sh`.

**Key Questions:**
- [ ] What processes currently restart on every deploy?
- [ ] Which could be long-lived workers?
- [ ] How to coordinate graceful handoffs?
- [ ] How to detect "what changed" and only restart that?
- [ ] Bots (Telegram/Discord) - can they persist through app restarts?

**Investigation Notes:**

### Current Process Architecture (Explored 2026-01-28)

**Running Containers:**
| Container | Process | Restart on Deploy? |
|-----------|---------|-------------------|
| `hyperbotcontained` | Main app (Express, platforms, APIs) | Always |
| `hyperbotworker` | Export worker | Optional (`DEPLOY_WORKER=1`) |
| `hyperbottraining` | VastAI training worker | Optional (`DEPLOY_TRAINING_WORKER=1`) |
| `hyperbotsweeper` | Instance cleanup (every 15min) | Optional |
| `caddy_proxy` | Reverse proxy | Always |

**Current Downtime Window:**
- Minimum: ~10-20 seconds (stop → health check start)
- Typical: 60-120 seconds (health check waits)
- Maximum: 400 seconds (80 retries × 5s)

### What's Already Good

**Export Worker** - Already has persistence infrastructure:
```javascript
// Pause/Resume via internal API
POST /collections/export/worker/pause   // Graceful pause
POST /collections/export/worker/resume  // Resume processing
GET  /collections/export/worker/status  // Check if busy/idle

// State persisted to systemStateDb every 5 seconds
// Heartbeat every 30 seconds
// Current job completes before pausing
```

**Training Worker** - Already persistent:
- `restart: unless-stopped` policy
- Survives app restarts
- Just needs explicit exclusion from app deploys

**Platform Bots** - Reconnection built-in:
- Telegram: Long-polling, auto-resumes
- Discord: WebSocket with exponential backoff
- Messages queue on platform side during downtime

### Zero-Downtime Strategy

**Phase 1: Formalize Export Worker Persistence (trivial)**
- Always use `DEPLOY_WORKER=1`
- Export worker stays running through app deploy
- Already works, just needs to be standard practice

**Phase 2: Notification Worker Extraction (medium)**
```
BEFORE:
User → Telegram → Bot → App (DOWN) → Notification lost

AFTER:
User → Telegram → Bot (persistent) → NotificationQueue (MongoDB)
                                            ↓
App (new) → NotificationDispatcher → Platform Notifiers
```

New components:
- `NotifierWorker` container (polls queue, delivers notifications)
- `PendingNotificationsDb` collection (queue persistence)
- Notifiers stay connected through app restarts

**Phase 3: Training Worker Isolation (trivial)**
- Add `DEPLOY_TRAINING_WORKER` flag
- Default: training worker NOT touched during app deploy
- Jobs continue uninterrupted

**Phase 4: Blue/Green (optional, complex)**
```
1. Start GREEN instance (new code)
2. Health check GREEN
3. Caddy switches: BLUE → GREEN
4. Stop BLUE
5. Zero dropped requests
```

### Implementation Effort

| Phase | Effort | Downtime After |
|-------|--------|----------------|
| Current state | - | 60-120s |
| Phase 1 (Export persistence) | ~1 hour | 60-120s (but no export interruption) |
| Phase 2 (Notification worker) | ~4-6 hours | 30-60s (notifications persist) |
| Phase 3 (Training isolation) | ~1 hour | Same, but training never interrupted |
| Phase 4 (Blue/Green) | ~1 day | <5s (near-zero) |

### Architecture After Phase 2

```
┌──────────────────────────────────────────────────────────────┐
│                    PERSISTENT LAYER                          │
│  (survives app deploys)                                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ Export      │  │ Training    │  │ Notifier    │          │
│  │ Worker      │  │ Worker      │  │ Worker      │          │
│  │             │  │             │  │             │          │
│  │ Polls DB    │  │ Polls DB    │  │ Polls queue │          │
│  │ for exports │  │ for jobs    │  │ sends to    │          │
│  │             │  │             │  │ platforms   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│        │                │                │                   │
│        └────────────────┼────────────────┘                   │
│                         │                                    │
│                    MongoDB                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    APP LAYER                                 │
│  (restarts on deploy, ~30-60s downtime)                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ Web         │  │ Internal    │  │ External    │          │
│  │ Platform    │  │ API         │  │ API         │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                              │
│  Platform bots (Telegram/Discord) reconnect automatically   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Privacy Architecture for Self-Hosted Compute

**Status:** Not Started

**Vision:** Ensure user privacy when moving to self-hosted VastAI compute. Users may generate sensitive content - protect them from exposure, logging, and identification. Privacy is the grail.

**Key Questions:**
- [ ] What data flows through VastAI instances?
- [ ] What gets logged and where?
- [ ] Can prompts be tied back to users?
- [ ] How to minimize data exposure?
- [ ] What's our legal/compliance position?
- [ ] How do we handle content moderation vs privacy?

**Investigation Notes:**

### Current Privacy Exposure (Explored 2026-01-28)

**Data Stored (MongoDB):**
| Collection | What's Stored | Privacy Impact |
|------------|---------------|----------------|
| `generationOutputs` | Full prompts, outputs, user IDs | HIGH - prompts tied to users |
| `userCore` | Platform IDs → wallet addresses | HIGH - identity chain |
| `training` | Dataset info, model outputs | MEDIUM |
| Logs | Run IDs, wallet addresses | MEDIUM - correlatable |

**Identity Chain Problem:**
```
Discord/Telegram User ID
         ↓
    userCore.platformIdentities
         ↓
    Wallet Address (userCore.wallets)
         ↓
    Blockchain (immutable, public)
```

**Current exposure points:**
1. **ComfyUI Deploy** - sees all prompts, all outputs
2. **Your MongoDB** - stores prompts indefinitely, linked to users
3. **Your logs** - run IDs correlate to users
4. **Blockchain** - wallet activity is permanent and public

### Self-Hosted Privacy Improvements

**What gets better:**
- ✅ Prompts don't go to ComfyUI Deploy
- ✅ Outputs stay on your infrastructure
- ✅ Full control over instance cleanup
- ✅ Can implement encryption

**What's still exposed:**
- ❌ VastAI instance host can see data (they have root)
- ❌ SSH commands visible to host
- ❌ Instance filesystem accessible to host
- ❌ User→wallet→blockchain chain unchanged

### Privacy Architecture (Proposed)

**Layer 1: Data Minimization**
```
Don't store what you don't need:
- Prompts: Hash or delete after N days
- Outputs: User-controlled retention
- Logs: Rotate aggressively, no PII
```

**Layer 2: Identity Decoupling**
```
Break the chain:
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ User Session    │     │ Generation ID   │     │ Wallet          │
│ (ephemeral)     │────▶│ (anonymous)     │     │ (separate)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                    No direct link to user
                    unless user chooses to save
```

Options:
- **Anonymous mode**: Generate without account, pay with fresh wallet
- **Session-only**: Don't persist generation history by default
- **User-controlled**: Let users delete their history

**Layer 3: Instance Privacy**
```
VastAI Instance
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Encrypted payload arrives                                   │
│       ↓                                                      │
│  Decrypt in memory only                                      │
│       ↓                                                      │
│  Process (prompt never touches disk)                         │
│       ↓                                                      │
│  Encrypt output                                              │
│       ↓                                                      │
│  Send back, wipe memory                                      │
│                                                              │
│  On termination: Instance destroyed, data gone               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Layer 4: Webhook Security**
```
Instance → Your Server
- HTTPS only
- Signed payloads (HMAC)
- Short-lived URLs
- Output encrypted in transit
```

### Privacy Threat Model

| Threat | Likelihood | Impact | Mitigation |
|--------|------------|--------|------------|
| VastAI host reads instance data | Medium | High | Memory-only processing, encryption |
| Database breach | Low | Critical | Encrypt at rest, minimize stored data |
| Log exposure | Medium | Medium | No PII in logs, rotate aggressively |
| Wallet correlation | High | High | Offer anonymous mode, fresh wallets |
| Subpoena/legal | Low | Critical | Can't produce what you don't store |

### Implementation Strategy

**Phase 1: Minimize (Quick)**
- [ ] Add retention policy to `generationOutputs` (delete after 30 days)
- [ ] Remove prompts from logs
- [ ] Hash prompts in DB (keep hash for dedup, not content)

**Phase 2: Decouple (Medium)**
- [ ] Anonymous generation mode (no account required)
- [ ] Session-only mode (don't persist by default)
- [ ] User-controlled history deletion

**Phase 3: Encrypt (Complex)**
- [ ] Encrypt prompts at rest in DB
- [ ] Memory-only processing on VastAI instances
- [ ] End-to-end encryption for outputs

**Phase 4: Legal Shield (Ongoing)**
- [ ] Privacy policy that's honest
- [ ] Terms of service that protect you
- [ ] Data retention that minimizes liability
- [ ] "We can't see what we don't store"

### VastAI-Specific Considerations

**Instance Host Visibility:**
VastAI hosts are third parties. Even with encryption:
- They can snapshot the instance
- They can monitor network traffic
- They can read process memory (with effort)

**Mitigations:**
1. **Verified hosts only** - use `verified=true` filter
2. **Short instance lifetime** - terminate after each batch
3. **No persistent storage** - process in memory, stream back
4. **Rotate SSH keys** - fresh keys per session
5. **Audit trail** - log which host processed what (for accountability)

**Can't fully solve:**
- Determined host can still intercept
- This is true of ANY cloud provider (AWS, GCP, etc.)
- True privacy requires own hardware

### Comparison: Privacy Models

| Model | Privacy | Cost | Complexity |
|-------|---------|------|------------|
| ComfyUI Deploy | Low (they see all) | $$$ | Low |
| VastAI (naive) | Medium (host sees) | $$ | Medium |
| VastAI (encrypted) | Medium-High | $$ | High |
| Own hardware | High | $$$$ | Very High |
| TEE/Confidential compute | Very High | $$$ | Very High |

**Recommendation:** VastAI with encryption + data minimization is the pragmatic sweet spot. Accept that determined hosts can theoretically access data, but make it hard and minimize what's exposed.

### Two-Tier Privacy Model (Decided)

**Rationale:** Training data is valuable. Offer privacy as a premium option.

| Tier | Data Handling | Value to You | Pricing |
|------|---------------|--------------|---------|
| **Standard** | Prompts + outputs stored, used for fine-tuning | Training corpus | Base price |
| **Incognito** | Ephemeral processing, minimal records | Privacy premium | +20-50% markup |

### Output Routing Architecture

**Dual-bucket system:**
```
R2 Storage
├── permanent-outputs/              ← Standard users
│   ├── user-{id}/
│   │   ├── gen-abc.png
│   │   └── gen-def.png
│   └── ...
│
│   Properties:
│   - Stored permanently
│   - Linked to user ID
│   - Full DB record (prompt, output, metadata)
│   - Used for training corpus
│   - User can access history
│
└── ephemeral-outputs/              ← Incognito users
    ├── session-{uuid}/
    │   └── output.png
    └── (auto-deleted after 1hr)

    Properties:
    - R2 lifecycle rule: delete after 1hr
    - No user linkage (session UUID only)
    - Signed URLs with 1hr expiry
    - Minimal/no DB record
    - NOT used for training
    - No history access
```

**Standard User Flow:**
```javascript
// 1. Generate on VastAI
const output = await vastaiRunner.execute(prompt, params);

// 2. Upload to permanent bucket
const outputPath = `permanent-outputs/${userId}/${generationId}.png`;
await r2.upload(outputPath, output);

// 3. Full database record (for training + history)
await db.generationOutputs.create({
  userId,
  prompt,           // Stored for training
  outputUrl,        // Permanent URL
  metadata,         // Full context
  usedForTraining: false  // Flag for training pipeline
});

// 4. Return permanent URL
return { url: outputUrl, expiresAt: null, canRevisit: true };
```

**Incognito User Flow:**
```javascript
// 1. Generate on VastAI (same as standard)
const output = await vastaiRunner.execute(prompt, params);

// 2. Upload to ephemeral bucket
const sessionId = crypto.randomUUID();  // No user linkage
const outputPath = `ephemeral-outputs/${sessionId}/${generationId}.png`;
await r2.upload(outputPath, output);

// 3. Generate signed URL (1hr expiry)
const signedUrl = await r2.getSignedUrl(outputPath, { expiresIn: 3600 });

// 4. Minimal record for abuse prevention only
await db.incognitoSessions.create({
  sessionHash: hash(sessionId + salt),  // Can't reverse
  ipHash: hash(ip + salt),              // Can't reverse
  timestamp: Date.now(),
  costPoints: 50,
  // NO prompt, NO output URL, NO user ID
});

// 5. Return ephemeral URL
return { url: signedUrl, expiresAt: Date.now() + 3600000, canRevisit: false };
```

**R2 Lifecycle Configuration:**
```json
{
  "rules": [{
    "id": "ephemeral-cleanup",
    "prefix": "ephemeral-outputs/",
    "expiration": { "days": 1 },
    "enabled": true
  }]
}
```

### Abuse Prevention (Incognito)

Even without storing identifiable data, track patterns:

```javascript
// Hashed, non-reversible tracking
{
  sessionHash: hash(sessionId + SERVER_SALT),
  ipHash: hash(clientIp + SERVER_SALT),
  fingerprintHash: hash(userAgent + screenRes + SERVER_SALT),
  timestamp: Date,
  costPoints: Number,
  // Rate limit key: ipHash
  // Abuse detection: same hashes generating excessive volume
}
```

**What this enables:**
- Rate limiting by IP hash
- Detecting abuse patterns (same fingerprint, 1000 gens)
- No way to reverse hashes to actual users
- Can ban hash patterns without knowing who

### VastAI Instance Visibility (Both Tiers)

| Data | Standard | Incognito |
|------|----------|-----------|
| Prompt | ✅ Sees it | ✅ Sees it (unavoidable) |
| Output | ✅ Generates it | ✅ Generates it |
| User ID | ✅ Passed for routing | ❌ Only session UUID |
| Upload destination | ✅ permanent-outputs/ | ✅ ephemeral-outputs/ |

**Key insight:** VastAI instance sees the same data either way - the privacy difference is in what YOUR system stores afterward.

### Pricing Model

**Why incognito costs more:**
- Opportunity cost (no training data)
- Ephemeral storage complexity
- Reduced abuse visibility
- Premium feature positioning

**Suggested pricing:**
- Standard: Base cost
- Incognito: +25-50% markup
- Or: Subscription tier feature (Pro users get incognito option)

### Implementation Phases

1. **With #2/#3:** Build dual-bucket output routing from the start
2. **Database schema:** Add `isIncognito` flag to generation flow
3. **UI:** Toggle for incognito mode (with pricing shown)
4. **R2 lifecycle:** Configure ephemeral bucket auto-delete
5. **Abuse tracking:** Implement hashed session logging

---

## 8. Codebase Cleanup & Documentation Hygiene

**Status:** Not Started

**Vision:** Clean, focused codebase with only documentation that helps developers navigate the system. Remove old artifacts, consolidate archives, delete cruft.

**The Problem:**
- 19 GB in `/temp/` (26,687 files - mostly garbage)
- 267 files in `/roadmap/_historical/` (old vibecode migration)
- 39 stale investigation docs in `/docs/` (Nov 2025)
- Old plan docs in root that are superseded
- `/archive/` with legacy code that's never referenced

### Cleanup Plan

**Phase 1: DELETE (Safe, Immediate) - ~19 GB savings**

| Target | Size | Reason |
|--------|------|--------|
| `/temp/execs_pre_injection_copy_donttouch/` | ~5 GB | Old export backup |
| `/temp/export_STB OFFICIAL COLLECTION TEST/` | ~5 GB | Old export |
| `/temp/polished_collection/` | ~6 GB | Old collection data |
| `/temp/shuffled_injection/` | ~1 GB | One-time script output |
| `DEPLOY_WORKER_PLAN.md` | 1.7 KB | Superseded by deploy.sh |
| `EXPORT_RESILIENCE_PLAN.md` | 836 B | Old infrastructure plan |
| `cookies.txt` (if exists) | - | Security risk |

**Phase 2: ARCHIVE (Consolidate History)**

Move to `/docs/_archived/`:
```
/docs/_archived/
├── investigations-nov-2025/     ← All 39 files from /docs/
├── vibecode-migration-2025/     ← All 267 files from /roadmap/_historical/
├── sandbox-audits-2025/         ← SANDBOX_*.md from root
├── collection-analysis/         ← Analysis summaries from /temp/
└── legacy-deluxebot/            ← /archive/deluxebot/ (mark deprecated)
```

**Files to archive:**
- `/docs/*.md` (39 files) → `investigations-nov-2025/`
- `/roadmap/_historical/*` (267 files) → `vibecode-migration-2025/`
- `SANDBOX_NODE_SYSTEM_AUDIT.md` → `sandbox-audits-2025/`
- `SANDBOX_IMPROVEMENTS_IMPLEMENTED.md` → `sandbox-audits-2025/`
- `/temp/MASTER_PROMPTS_SUMMARY.md` → `collection-analysis/`
- `/temp/COLLECTION_ANALYSIS_SUMMARY.md` → `collection-analysis/`
- `/archive/deluxebot/` → `legacy-deluxebot/`

**Phase 3: UPDATE (Refresh Stale Docs)**

| File | Issue | Action |
|------|-------|--------|
| `/roadmap/master-roadmap.md` | Dates from Aug-Sep 2025 | Update with current status |
| `/roadmap/master-outline.md` | Feature statuses stale | Verify and update |

**Phase 4: KEEP (Actively Useful)**

```
Root:
├── README.md                              ✓ Keep
├── CONTRIBUTING.md                        ✓ Keep
├── COLLECTION_REVIEW_OPTIMIZATION_PLAN.md ✓ Keep (active)
├── ROADMAP_EXPLORATION.md                 ✓ Keep (move to /roadmap/_logs/ when done)
└── Caddyfile, Dockerfile, etc.           ✓ Keep (operational)

/docs/plans/
├── 2026-01-15-cook-menu-redesign.md      ✓ Keep (current)
├── 2026-01-21-training-monitor-design.md ✓ Keep (current)
├── 2026-01-22-training-worker-design.md  ✓ Keep (current)
└── 2026-01-27-mods-train-wizard-redesign.md ✓ Keep (current)

/roadmap/
├── master-roadmap.md                     ✓ Keep (update)
├── master-outline.md                     ✓ Keep (update)
├── README.md                             ✓ Keep
├── _templates/                           ✓ Keep
├── _guides/                              ✓ Keep
├── _logs/                                ✓ Keep
└── [active feature directories]          ✓ Keep
```

**Phase 5: REORGANIZE (Final Structure)**

```
stationthisdeluxebot/
│
│  PUBLIC (in git repo)
│  ─────────────────────────────────────────
├── README.md                    ← Main entry point
├── CONTRIBUTING.md              ← How to contribute
├── src/                         ← All code
├── scripts/                     ← Operational scripts
├── public/                      ← Frontend assets
└── [operational files]          ← Dockerfile, Caddyfile, etc.

│
│  INTERNAL ONLY (gitignored)
│  ─────────────────────────────────────────
├── roadmap/                     ← Active planning (GITIGNORED)
│   ├── master-roadmap.md
│   ├── master-outline.md
│   ├── _templates/
│   ├── _guides/
│   ├── _logs/
│   └── [feature-name]/
├── docs/
│   ├── plans/                   ← Current design docs (GITIGNORED)
│   └── _archived/               ← Historical docs (GITIGNORED)
├── archive/                     ← Legacy code (GITIGNORED)
├── temp/                        ← Temporary files (GITIGNORED)
└── ROADMAP_EXPLORATION.md       ← This document (GITIGNORED)
```

### Policy: Plan Lifecycle

```
New Feature/Initiative
        │
        ▼
┌─────────────────────────────┐
│  docs/plans/                │  ← Active planning
│  YYYY-MM-DD-feature-name.md │
└─────────────────────────────┘
        │
        │ (feature shipped)
        ▼
┌─────────────────────────────┐
│  docs/_archived/            │  ← Completed plans
│  executed-plans/            │
│  YYYY-MM-DD-feature-name.md │
└─────────────────────────────┘
```

**Policy:**
1. New plans go in `docs/plans/` with date prefix
2. When a plan is fully executed → move to `docs/_archived/executed-plans/`
3. Roadmap features when complete → move to `docs/_archived/completed-features/`
4. None of this is in the public repo (all gitignored)
5. Public repo = code + operational docs only

### Execution Script

```bash
#!/bin/bash
# cleanup.sh - Run from repo root

set -e

echo "=== Phase 1: DELETE large temp directories ==="
rm -rf temp/execs_pre_injection_copy_donttouch/
rm -rf "temp/export_STB OFFICIAL COLLECTION TEST/"
rm -rf temp/polished_collection/
rm -rf temp/shuffled_injection/
rm -f DEPLOY_WORKER_PLAN.md
rm -f EXPORT_RESILIENCE_PLAN.md
rm -f cookies.txt 2>/dev/null || true

echo "=== Phase 2: Create archive structure ==="
mkdir -p docs/_archived/investigations-nov-2025
mkdir -p docs/_archived/vibecode-migration-2025
mkdir -p docs/_archived/sandbox-audits-2025
mkdir -p docs/_archived/collection-analysis
mkdir -p docs/_archived/executed-plans
mkdir -p docs/_archived/completed-features
mkdir -p docs/_archived/legacy-deluxebot

echo "=== Phase 2: Move stale docs ==="
# Move /docs/*.md to archive (except plans/)
find docs -maxdepth 1 -name "*.md" -exec mv {} docs/_archived/investigations-nov-2025/ \;

# Move roadmap historical
mv roadmap/_historical/* docs/_archived/vibecode-migration-2025/ 2>/dev/null || true
rmdir roadmap/_historical 2>/dev/null || true

# Move sandbox audits
mv SANDBOX_NODE_SYSTEM_AUDIT.md docs/_archived/sandbox-audits-2025/ 2>/dev/null || true
mv SANDBOX_IMPROVEMENTS_IMPLEMENTED.md docs/_archived/sandbox-audits-2025/ 2>/dev/null || true

# Move collection analysis
mv temp/MASTER_PROMPTS_SUMMARY.md docs/_archived/collection-analysis/ 2>/dev/null || true
mv temp/COLLECTION_ANALYSIS_SUMMARY.md docs/_archived/collection-analysis/ 2>/dev/null || true

# Move legacy archive
mv archive/deluxebot/* docs/_archived/legacy-deluxebot/ 2>/dev/null || true
rmdir archive/deluxebot 2>/dev/null || true

echo "=== Phase 2: Create archive README ==="
cat > docs/_archived/README.md << 'EOF'
# Archived Documentation

Historical documentation preserved for reference. **Not in public repo (gitignored).**

## Structure

- `investigations-nov-2025/` - Investigation reports from Discord/Telegram parity work
- `vibecode-migration-2025/` - Documents from the vibecode → stationthis migration
- `sandbox-audits-2025/` - Sandbox node system audits and improvements
- `collection-analysis/` - One-time collection analysis reports
- `executed-plans/` - Plans that have been fully implemented
- `completed-features/` - Roadmap features that shipped
- `legacy-deluxebot/` - Pre-refactor codebase (deprecated)

## Policy

When a plan in `/docs/plans/` is fully executed:
1. Move it here to `executed-plans/`
2. Keep the date prefix for chronology

When a roadmap feature is complete:
1. Move the feature directory to `completed-features/`
EOF

echo "=== Phase 3: Create temp README ==="
cat > temp/README.md << 'EOF'
# Temp Directory

**Gitignored. For temporary files only.**

- Do not store anything permanent here
- Clean up after yourself
- Large files here will not be committed
EOF

echo "=== Phase 4: Remove from git tracking (already gitignored) ==="
# These are now gitignored, remove from git cache if tracked
git rm -r --cached roadmap/ 2>/dev/null || true
git rm -r --cached docs/plans/ 2>/dev/null || true
git rm -r --cached docs/_archived/ 2>/dev/null || true
git rm -r --cached archive/ 2>/dev/null || true
git rm --cached ROADMAP_EXPLORATION.md 2>/dev/null || true

echo "=== Cleanup complete ==="
echo ""
echo "Internal docs are now gitignored:"
echo "  - roadmap/"
echo "  - docs/plans/"
echo "  - docs/_archived/"
echo "  - archive/"
echo "  - ROADMAP_EXPLORATION.md"
echo ""
echo "Next steps:"
echo "1. Review the changes"
echo "2. git add .gitignore"
echo "3. git commit -m 'chore: cleanup codebase, gitignore internal planning docs'"
```

### Metrics

| Before | After |
|--------|-------|
| `/temp/`: 19 GB, 26,687 files | `/temp/`: ~50 MB, ~20 files |
| `/docs/`: 39 stale investigation docs | `/docs/plans/`: 4 current design docs |
| `/roadmap/_historical/`: 267 files mixed in | Moved to `/docs/_archived/` |
| Root: 5 stale .md files | Root: 2 essential .md files |
| `/archive/`: Legacy code in limbo | Clearly marked as deprecated |

**Total savings:** ~19 GB disk, ~300 stale files consolidated

---

## Implementation Analysis

### Difficulty Scale

| Rating | Meaning |
|--------|---------|
| 🟢 Low | Well-understood, mostly mechanical work |
| 🟡 Medium | Some unknowns, requires design decisions |
| 🔴 High | Significant unknowns, new infrastructure |

---

### #1 Frontend Migration (Microact)

**Overall Difficulty:** 🟡 Medium

| Phase | Difficulty | Notes |
|-------|------------|-------|
| Scaffold microact project | 🟢 | You built the library, straightforward |
| Port Landing/Pricing/Docs | 🟢 | Mostly static, HTML→JSX conversion |
| Port Admin page | 🟡 | More interactive, state management |
| Port Sandbox | 🔴 | 47KB+ of custom JS, complex state, canvas |
| Dockerfile multi-stage | 🟢 | Standard pattern |

**Dependencies:**
- None external - self-contained initiative

**Blockers:**
- Sandbox port is the critical path - most complexity lives there
- Canvas rendering + drag/drop may need careful translation
- Component lifecycle differences (vanilla → microact)

**Risk Mitigation:**
- Port pages in order of complexity (landing → sandbox)
- Keep old sandbox running until new one is validated
- Feature flag to switch between old/new

**Effort Distribution:**
```
Landing/Pricing/Docs  ████░░░░░░░░░░░░░░░░  20%
Admin                 ████░░░░░░░░░░░░░░░░  20%
Sandbox               ████████████░░░░░░░░  60%
```

---

### #2 ComfyUI Replacement

**Overall Difficulty:** 🔴 High

| Phase | Difficulty | Notes |
|-------|------------|-------|
| Abstract current ComfyUI calls | 🟢 | Refactor, no new functionality |
| R2 bucket + signed URL service | 🟢 | Standard cloud pattern |
| Update training to upload private→R2 | 🟡 | Modify finalization flow |
| VastAI inference runner | 🟡 | Adapt from training runner |
| Direct ComfyUI API integration | 🟡 | New protocol, but documented |
| Model download orchestration | 🟡 | Track what's cached where |
| Webhook/polling for results | 🟢 | Pattern exists in training |
| End-to-end testing | 🔴 | Many moving parts |

**Dependencies:**
- Partially depends on #3 (instance management)
- Can share VastAI infrastructure with training

**Blockers:**
- ComfyUI API differences from ComfyUI Deploy API
- Cold start latency may affect UX (need demand prediction from #3)
- Model download reliability (HF/Civitai rate limits?)

**Risk Mitigation:**
- Run parallel: keep ComfyUI Deploy as fallback during rollout
- Feature flag to route % of traffic to self-hosted
- Gradual migration: start with one tool, expand

**Effort Distribution:**
```
Abstraction layer     ██░░░░░░░░░░░░░░░░░░  10%
R2 + signed URLs      ██░░░░░░░░░░░░░░░░░░  10%
VastAI runner         ██████░░░░░░░░░░░░░░  30%
Model orchestration   ████░░░░░░░░░░░░░░░░  20%
ComfyUI integration   ████░░░░░░░░░░░░░░░░  20%
Testing + migration   ██░░░░░░░░░░░░░░░░░░  10%
```

---

### #3 Instance Pool / Demand Scaling

**Overall Difficulty:** 🔴 High

| Phase | Difficulty | Notes |
|-------|------------|-------|
| InferencePoolDB schema | 🟢 | Follow TrainingDB pattern |
| InstancePoolManager basics | 🟡 | Adapt VastAIService |
| Request queue + routing | 🟡 | New component |
| Health checks + recovery | 🟡 | Adapt sweeper patterns |
| Demand prediction | 🔴 | Needs usage data, ML optional |
| Auto-scaling logic | 🔴 | Tuning, edge cases |
| Cost tracking + attribution | 🟡 | Per-request amortization |

**Dependencies:**
- Tightly coupled with #2 (same instances run inference)
- Needs usage patterns to tune scaling (chicken/egg)

**Blockers:**
- VastAI machine availability unpredictable
- Demand prediction requires historical data (start simple)
- Scaling too aggressive = cost overrun; too conservative = latency

**Risk Mitigation:**
- Start with simple scaling (min=0, spin up on first request)
- Add demand prediction later when you have data
- Set hard cost caps / instance limits
- Alert on anomalies

**Effort Distribution:**
```
DB + basic manager    ████░░░░░░░░░░░░░░░░  20%
Queue + routing       ████░░░░░░░░░░░░░░░░  20%
Health + recovery     ████░░░░░░░░░░░░░░░░  20%
Scaling logic         ██████░░░░░░░░░░░░░░  30%
Monitoring + tuning   ██░░░░░░░░░░░░░░░░░░  10%
```

---

### #4 Chat/Agent Interface

**Overall Difficulty:** 🟡 Medium (MVP) → 🔴 High (polished)

| Phase | Difficulty | Notes |
|-------|------------|-------|
| Chat UI component | 🟢 | Standard chat interface |
| Conversation API | 🟢 | CRUD + LLM call |
| Tool registry search | 🟢 | Keyword or embedding |
| Intent parser (LLM) | 🟡 | Prompt engineering |
| Workflow composer | 🟡 | Map intent → tools |
| Execution bridge | 🟢 | Existing API |
| Iteration handling | 🟡 | Context tracking |
| Feedback/learning loop | 🟡 | Data pipeline |
| Fine-tuning | 🔴 | Requires data, expertise |

**Dependencies:**
- Execution API must work (#2/#3 or existing ComfyUI Deploy)
- Tool registry (already exists)

**Blockers:**
- LLM cost per conversation (optimize prompts, cache)
- Intent parsing accuracy (iterate on prompts)
- Edge cases in natural language (fallback to clarification)

**Risk Mitigation:**
- MVP: Simple intent matching, limited tool set
- Expand coverage based on real user requests
- "I don't understand" is valid response
- Human handoff for complex cases

**Effort Distribution:**
```
Chat UI + API         ████░░░░░░░░░░░░░░░░  20%
Intent + tools        ██████░░░░░░░░░░░░░░  30%
Execution + results   ████░░░░░░░░░░░░░░░░  20%
Iteration + context   ████░░░░░░░░░░░░░░░░  20%
Feedback loop         ██░░░░░░░░░░░░░░░░░░  10%
```

---

### Dependency Graph

```
#8 Cleanup ──────────────────────────────── DO FIRST (feels good, clears head)
     │
     ▼
#1 Frontend ─────────────────────────────── Independent
#5 Refactor ─────────────────────────────── Independent
#6 Zero-Downtime (Ph 1-3) ───────────────── Independent

     ↑ These can be done anytime, in any order

─────────────────────────────────────────────────────────

              #7 Privacy
                  │
         (design together)
                  │
                  ▼
#2 ComfyUI ◄─────────────────► #3 Instance Pool
   Replacement
        │      (tightly coupled)
        │
        └──────────┬───────────────┘
                   │
                   ▼
              #4 Chat/Agent
              (uses execution layer)

─────────────────────────────────────────────────────────

#6 Zero-Downtime (Ph 4: Blue/Green) ─────── Benefits from #5
```

**Recommended Order:**

| Priority | Initiative | Rationale |
|----------|------------|-----------|
| 1 | #2 + #3 together | Core infrastructure, unlocks cost savings |
| 2 | #4 Chat MVP | Can use existing ComfyUI Deploy while building |
| 3 | #1 Frontend | Independent, polish when ready |

Or if you want a quick win first:
| Priority | Initiative | Rationale |
|----------|------------|-----------|
| 1 | #1 Frontend (landing only) | Fast, visible improvement |
| 2 | #2 + #3 | Core infra |
| 3 | #1 Frontend (sandbox) | Harder part |
| 4 | #4 Chat | Builds on stable infra |

---

---

### #5 Refactor for Best Practices

**Overall Difficulty:** 🟡 Medium

| Phase | Difficulty | Notes |
|-------|------------|-------|
| Direct DB for internal services | 🟢 | Mechanical refactor |
| Query consolidation | 🟡 | Requires understanding data flow |
| Caching layer | 🟡 | TTL tuning, invalidation logic |
| Batch operations | 🟡 | More invasive changes |

**Dependencies:**
- None - can be done incrementally alongside other work

**Blockers:**
- Need to identify high-traffic paths first (add metrics?)
- Cache invalidation correctness (stale data bugs)

**Risk Mitigation:**
- Start with read-heavy, rarely-changing data (spell metadata)
- Add metrics before optimizing (measure, don't guess)
- Feature flag new code paths

**Effort Distribution:**
```
Direct DB calls       ████████░░░░░░░░░░░░  40%
Query consolidation   ████░░░░░░░░░░░░░░░░  20%
Caching layer         ██████░░░░░░░░░░░░░░  30%
Batch operations      ██░░░░░░░░░░░░░░░░░░  10%
```

---

### #6 Zero-Downtime Deploys

**Overall Difficulty:** 🟢→🟡 (depending on phase)

| Phase | Difficulty | Notes |
|-------|------------|-------|
| Phase 1: Export worker persistence | 🟢 | Already works, just formalize |
| Phase 2: Notification worker | 🟡 | New container, queue logic |
| Phase 3: Training isolation | 🟢 | Just add flag to deploy.sh |
| Phase 4: Blue/Green | 🔴 | Load balancer, state sync |

**Dependencies:**
- None for Phases 1-3
- Phase 4 may benefit from #5 (caching/state management)

**Blockers:**
- Phase 2: Need to design notification queue schema
- Phase 4: Need to handle WebSocket client reconnection

**Risk Mitigation:**
- Phases 1-3 are low-risk, do them first
- Phase 4 is optional - 30-60s downtime may be acceptable

**Effort Distribution:**
```
Phase 1 (formalize)   ██░░░░░░░░░░░░░░░░░░  10%
Phase 2 (notifier)    ████████░░░░░░░░░░░░  40%
Phase 3 (training)    ██░░░░░░░░░░░░░░░░░░  10%
Phase 4 (blue/green)  ████████░░░░░░░░░░░░  40%
```

---

---

### #7 Privacy Architecture

**Overall Difficulty:** 🟡→🔴 (depending on depth)

| Phase | Difficulty | Notes |
|-------|------------|-------|
| Phase 1: Minimize (retention, logs) | 🟢 | Policy changes, config updates |
| Phase 2: Decouple (anonymous mode) | 🟡 | New user flows, DB changes |
| Phase 3: Encrypt (at rest, in transit) | 🔴 | Key management, performance |
| Phase 4: Legal (ToS, policy) | 🟢 | Documentation, not code |

**Dependencies:**
- Should be done alongside or before #2/#3 (privacy by design)

**Blockers:**
- Key management infrastructure for encryption
- Performance impact of encryption
- User experience for anonymous mode (how to pay?)

**Risk Mitigation:**
- Start with data minimization (don't store what you don't need)
- Anonymous mode can use temporary sessions + crypto payment
- Can't fully solve VastAI host visibility without own hardware

**Effort Distribution:**
```
Data minimization     ████░░░░░░░░░░░░░░░░  20%
Identity decoupling   ██████░░░░░░░░░░░░░░  30%
Encryption layer      ██████░░░░░░░░░░░░░░  30%
Legal/policy          ████░░░░░░░░░░░░░░░░  20%
```

---

### Summary Matrix

| # | Initiative | Difficulty | Blockers | Dependencies |
|---|------------|------------|----------|--------------|
| 1 | Frontend | 🟡 Medium | Sandbox complexity | None |
| 2 | ComfyUI | 🔴 High | Cold start, model download | #3, #7 |
| 3 | Instance Pool | 🔴 High | Scaling tuning, VastAI availability | #2, #7 |
| 4 | Chat/Agent | 🟡→🔴 | Intent accuracy, LLM cost | Execution layer |
| 5 | Refactor | 🟡 Medium | Metrics needed, cache invalidation | None |
| 6 | Zero-Downtime | 🟢→🔴 | Notification queue design | None (Ph 1-3) |
| 7 | Privacy | 🟡→🔴 | Key management, UX for anon mode | #2/#3 (design together) |
| 8 | Cleanup | 🟢 Low | None | None (do first!) |

---

## Investigation Log

| Date | Item | Summary |
|------|------|---------|
| 2026-01-28 | #1 Frontend | Current: vanilla JS, no build. Migration: microact + Vite, multi-stage Dockerfile. Full scope (landing, admin, sandbox). |
| 2026-01-28 | #2 ComfyUI Replacement | LoraResolutionService unchanged (outputs same syntax). Replace ComfyUI Deploy API with VastAI + direct ComfyUI. Models: public from HF/Civitai, private user-trained to R2 with signed URLs. |
| 2026-01-28 | #3 Instance Pool | VastAI volumes are machine-tied (limitation). Hybrid strategy: S3 as source of truth, volumes as opportunistic cache. Demand-anticipation scaling to balance cost/latency. Reuse existing VastAI infra from training. |
| 2026-01-28 | #4 Chat/Agent | Current: node-based visual builder. Proposed: conversational interface with intent parsing, tool recommendation, workflow composition. Can overlay on sandbox or be separate page. LLM-backed with conversation memory. |
| 2026-01-28 | #5 Refactor | 363+ internal HTTP calls - migration debt. Pattern was correct for getting it working. Fix: direct DB for internal services, query consolidation, caching layer. ~100-150ms latency improvement on complex ops. |
| 2026-01-28 | #6 Zero-Downtime | Already 70% there. Export worker has pause/resume, training worker persists. Add: notification worker for platform bots. Blue/green optional. Can get to 30-60s downtime with Phases 1-3. |
| 2026-01-28 | #7 Privacy | Two-tier model: Standard (data stored for training) vs Incognito (ephemeral, +25-50% markup). Dual R2 buckets: permanent-outputs/ and ephemeral-outputs/ (1hr lifecycle). Abuse prevention via hashed sessions. Build into #2/#3 from start. |
| 2026-01-29 | #8 Cleanup | 19 GB in /temp/ (delete), 267 files in _historical (archive), 39 stale docs (archive). **Policy: roadmap/, docs/plans/, docs/_archived/ all gitignored.** Public repo = code only. Executed plans → archived. |

