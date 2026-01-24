# Stage 0 – VastAI Research Spike

## Inputs We Already Have
- **API Collection**: `src/core/services/vastai/Vast.ai API.postman_collection.json`
  - Includes offer search, instance lifecycle, key management, and metrics endpoints from the official Postman workspace.
  - Import into Postman (or Insomnia) to iterate on requests without re-copying definitions.
- **SSH Sandbox Keypair**: `~/.ssh/stationthis/vastai_remote` (`.pub` uploaded to VastAI Keys dashboard)
  - Private key stays on the worker host; set `VASTAI_SSH_KEY_PATH=~/.ssh/stationthis/vastai_remote` for scripts.
  - Fingerprint should also be stored in secrets so we can validate it matches what the API reports.

## Questions to Answer Before Coding
1. **Endpoint coverage** – Which subset of the Postman collection do we need for MVP (offers, instances, keys, templates, accounts)?

For our flux training, there is an ostris/aitoolkit template we can work with. We need to get at least a 24GB gpu, and we wabt th market price best offer, while also making sure its a reliable machine. that probably involves hitting instance endpoint to get quotes for our search.

2. **Auth mechanics** – Confirm the exact header name (`Authorization: Bearer <API_KEY>` vs `Api-Key`) and rate limiting rules.
3. **Template strategy** – Identify template IDs (e.g., PyTorch 2.5 + CUDA 12) that meet our training recipes and note their disk requirements.

Each type of training will necessitate its own template. For now we focu on the ostris/aitoolkit 

4. **Disk sizing** – Document minimum disk/TMP requirements for our datasets so we can set safe defaults when creating rentals.

I believe we want to anticipate at least needing 32GB to fit all the models and also be able to hold our end result

5. **Stop vs Delete** – Clarify billing/timing trade-offs (is `stop` sufficient between steps or do we always `delete` after download?).

I think delete is best since we will probably connect to a NEW instance when we do it again

6. **Lifecycle timing** – Measure average provisioning + cache warmup time for chosen templates to set realistic SLAs / watchdog timers.

## Deliverables for Stage 0
- **API Coverage Matrix** (table listing each VastAI endpoint, purpose, request method, notes) → checked into this folder.
- **Env Spec** describing required vars (`VASTAI_API_KEY`, `VASTAI_PREFERRED_GPUS`, `VASTAI_MAX_BID_PER_HOUR`, `VASTAI_SSH_KEY_PATH`).
- **Template Catalog** summarizing at least three viable templates (GPU type, VRAM, disk, hourly rate, templateId).
- **Lifecycle Notes** capturing observations from actual trial rentals (time to start, log access, how SSH hostnames/ports are exposed).

## Suggested Workflow
1. Import the Postman collection and duplicate it into a personal workspace so we can tweak without editing the canonical export.
2. Create a `.env.local.vastai` that only contains non-production secrets for experimentation.
3. Run two manual experiments:
   - rent → ssh → stop → delete cycle
   - rent → transfer ~1 GB dummy dataset via `scp` → delete (records throughput + cost)
4. Document each experiment in `notes/experiment-YYYYMMDD.md` (include timestamps, commands, issues).

Once these bullet items are filled in we can promote Stage 0 to "complete" and start implementing `VastAIClient` (Stage 1).
