# Stage 1 Progress – VastAI Remote Training

**Last Updated:** 2026-01-21

## What Works Now
- VastAI client/service can search offers, rent instances, and recover instance IDs even when the API omits `new_contract` (fallback to label lookup).
- CLI helpers (`offers.js`, `select-offer.js`, `rent-instance.js`) let us explore the market, auto-pick the best GPU, and provision a server with Ostris env vars pre-filled.
- SSH key management is wired through env (`VASTAI_SSH_KEY_PATH`) and enforced before provisioning.
- **`launch-session.js` now works end-to-end** (as of 2026-01-21): provisions GPU, waits for SSH, uploads dataset, extracts, uploads config, and can drop into interactive shell.

## New Tooling Added
- `DatasetPacker`: packages downloaded datasets (images + `dataset_info.json`) into a tarball with a manifest + SHA256.
- `SshTransport`: light wrapper around `ssh/scp` for file transfer and remote commands.
- `push-dataset.js`: packs a local dataset and ships it to `/opt/stationthis/jobs/<jobId>/dataset` on a remote host, ready for extraction.
- `launch-session.js`: one-shot helper that rents a 4090, uploads the dataset + rendered config, and finally drops you into an interactive SSH session pointed at the prepared job root.
- `list-regions.js`: helper to see GPU availability by region (useful for avoiding slow/expensive regions).

## Critical Learnings from Debugging (2026-01-21)

### VastAI API Response Quirks
The VastAI API is inconsistent about field names and response structures. We discovered these through trial and error:

| What | Expected | Actual | Fix |
|------|----------|--------|-----|
| Instance ID on provision | `response.instance_id` | Sometimes `new_contract`, sometimes `instances.id`, sometimes neither | Check multiple fields, fallback to label lookup |
| getInstance response | Direct instance object | Wrapped in `response.instances` | Unwrap with `response?.instances \|\| response` |
| IP address field | `public_ip` | Actually `public_ipaddr` | Check both, prefer `public_ipaddr` |
| Status field | `status` | Actually `cur_state` or `actual_status` | Check all three: `cur_state \|\| actual_status \|\| status` |
| SSH endpoint | Instance's `publicIp` | Use `sshHost` proxy (e.g., `ssh2.vast.ai`) | VastAI routes SSH through proxy hosts |

### SSH Connection Timing
VastAI instances have a multi-stage readiness process:
1. **Instance "running"** - Status says running but nothing is ready yet
2. **SSH port open** - TCP port accepts connections, but auth not ready
3. **SSH auth ready** - Keys propagated, can actually authenticate
4. **Full readiness** - Services like Docker are available

We must wait at each stage:
- Poll instance status until `running` + `publicIp` assigned
- TCP connect test until SSH port accepts (can take 30-60 seconds)
- Additional 15-second delay after port opens for auth propagation
- First SSH command should retry with backoff (auth can still fail initially)

### SSH Key Registration
- The SSH public key is sent with the provision request (`ssh_key` field)
- The key must ALSO be registered in the VastAI dashboard beforehand
- If using a different key than your default, ensure `VASTAI_SSH_KEY_PATH` points to the correct private key AND the matching public key is in VastAI dashboard
- Key mismatch results in "Permission denied (publickey)" errors

### Offer Snatching
Popular GPU offers (especially cheap 4090s) get rented between search and provision:
- `searchOffers` returns available offers
- By the time `createInstance` runs, offer may be gone (404 "no_such_ask")
- Solution: try multiple offers in sequence until one succeeds

### SCP vs SSH Port Flag
- SSH uses lowercase `-p` for port
- SCP uses uppercase `-P` for port
- Using wrong flag causes SCP to interpret port number as filename

### Region Matters
- Chinese region machines can have high latency from US
- Use `--region US` (or other region codes) to filter offers
- Region codes come from `geolocation` field in offer data

## Gaps Before Remote Training Works
- **Dataset readiness**: many datasets lack captions or consistent structure. The packer simply tars whatever is on disk; we need validation (e.g., ensure captions exist or auto-generate) before shipping.
- **Job config hand-off**: we can generate `job.json` via `FLUXRecipe`, but there’s no script yet that uploads it alongside the dataset and invokes `python run.py <config>` on the VastAI box.
- **Long-running monitoring**: once the remote command starts, we need log streaming + heartbeat tracking to handle failures and eventually download checkpoints.

## Immediate Next Steps
1. **Dataset QA pipeline**
   - Define “ready” criteria (min images, captions present, tags) and add a CLI to validate/repair a dataset before packing.
   - Optionally add an auto-caption pass (reuse caption services) when missing.
2. **Remote job runner**
   - Extend `push-dataset.js` (or a new `launch-training.js`) to also upload `job.json` and execute `python /workspace/flux-training/run.py <config>` over SSH.
   - Capture stdout/stderr into a log file on the remote machine and stream/tail it locally for progress.
3. **Artifact sync**
   - Prototype pulling `/workspace/output/*.safetensors` + previews back via scp and uploading to R2 using `CloudflareService.uploadModel`.
4. **Worker integration**
   - Move these scripts into a `RemoteTrainingWorker` loop so queue processing can: rent → transfer dataset/config → launch command → monitor → upload results → terminate instance.

## Open Questions
- Do we pause jobs if dataset validation fails, or auto-fix (e.g., run captioner) inside the worker?
- How do we surface remote logs to the Mods Menu—polling endpoint vs WebSocket fan-out?
- For Ostris provisioning delays, do we wait for some readiness file before copying data, or rely on a retry loop?
