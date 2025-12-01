# Deployment & Worker Strategy Plan

## Goals
- Add dedicated export worker so long-running jobs aren’t killed by API redeploys
- Improve deploy.sh with health/awareness checks so containers aren’t restarted mid-job
- Allow API and worker containers to communicate (local network)

## Concepts

### Blue/Green Deploy (for reference)
- Maintain two identical environments (Blue & Green)
- Deploy new version to idle environment, run health checks
- Switch traffic when healthy; previous stays on standby
- Requires load balancer/traffic switching layer; heavier for our single droplet

### Proposed Approach
1. **Split Services**
   - `api` container (existing app) and `worker` container (export jobs)
   - Both run on same droplet via docker-compose or multi-container deploy

2. **Health & Awareness**
   - Each container exposes health endpoint (`/health` or worker status)
   - Deploy script queries worker before restart; if job active, wait/gracefully stop
   - Optionally use Docker labels or state file to record active job IDs

3. **Inter-Container Communication**
   - Define internal Docker network
   - API and worker share the same Mongo + storage service
   - API enqueues export jobs (existing Mongo collection); worker polls

4. **Resource Allocation**
   - Tune container CPU/memory limits to avoid contention
   - Optionally throttle worker (e.g., process N jobs max) to reduce load

## Next Steps
- Update deploy.sh to manage two containers (build/stop/start worker separately)
- Add health endpoints and job status query to worker
- Implement worker entry point that can run independently (0. run queue loop)
- After worker infrastructure in place, add job pause/resume logic (future)
