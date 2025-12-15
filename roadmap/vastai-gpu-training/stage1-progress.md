# Stage 1 Progress – VastAI Remote Training

## What Works Now
- VastAI client/service can search offers, rent instances, and recover instance IDs even when the API omits `new_contract` (fallback to label lookup).
- CLI helpers (`offers.js`, `select-offer.js`, `rent-instance.js`) let us explore the market, auto-pick the best GPU, and provision a server with Ostris env vars pre-filled.
- SSH key management is wired through env (`VASTAI_SSH_KEY_PATH`) and enforced before provisioning.

## New Tooling Added
- `DatasetPacker`: packages downloaded datasets (images + `dataset_info.json`) into a tarball with a manifest + SHA256.
- `SshTransport`: light wrapper around `ssh/scp` for file transfer and remote commands.
- `push-dataset.js`: packs a local dataset and ships it to `/opt/stationthis/jobs/<jobId>/dataset` on a remote host, ready for extraction.
- `launch-session.js`: one-shot helper that rents a 4090, uploads the dataset + rendered config, and finally drops you into an interactive SSH session pointed at the prepared job root.

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
