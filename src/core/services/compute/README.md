# Remote Compute Providers

This module introduces a provider-agnostic interface that encapsulates all lifecycle actions we need when renting external GPU hardware (VastAI today, additional vendors later). Providers extend `ComputeProvider` and implement the following responsibilities:

1. **Offer Discovery** – expose `searchOffers(criteria)` so orchestrators can rank GPUs by VRAM, price, or templates.
2. **Provisioning** – `provisionInstance(jobContext)` rents/boots a machine and returns SSH connection info + provider metadata.
3. **Status & Metrics** – `getInstanceStatus(instanceId)` surfaces heartbeat data for watchdogs and UI progress.
4. **Termination** – `terminateInstance(instanceId, options)` tears down or stops the instance and cleans up billing.

Upcoming work will add a provider registry plus VastAI implementation, but the base class lives here so workers/tests can share the same contract immediately.
