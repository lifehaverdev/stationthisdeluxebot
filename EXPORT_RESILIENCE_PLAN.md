# Export Resilience Plan

## Background Worker & Deployment
- Current deploy.sh replaces the running container, killing long exports
- Options: separate worker process (PM2) or separate container; needs plan to keep worker alive across deploys

## Resumability Strategies
1. **Temporary R2 staging (rejected)** – redundant, no disk storage desired
2. **Internal chunking as backup**
   - Primary: keep streaming ZIP
   - Backup: simultaneously write numbered chunks (e.g., 500 pieces each)
   - If main ZIP stops, resume using chunked data
   - Chunk archives must support resume/merge only upon failure
3. **Retry/Skip** (short-term win) – per-asset retries, skip with report

## Next Steps
- Design deployment update to support dedicated worker
- Prototype chunked backup approach (how to resume/merge)
- Implement retry/skip now
