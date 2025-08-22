# ADR-001: Cloudflare R2 Browser Uploads with Privacy Markup

## Context
Users currently lack a secure, private way to upload reference images or other assets from the web platform.  Telegram and Discord rely on their native upload flows, but the browser client has no equivalent.  Previous attempts stalled on:
1. Missing Cloudflare R2 signed-URL flow & SDK wiring
2. UI for optional privacy markup (masking faces, redacting EXIF, simple blur)

Without this capability users must expose raw images via third-party hosts or skip uploads entirely, hindering use-cases like ControlNet or LoRA training.

## Decision
We will implement a two-step signed-URL upload pipeline backed by Cloudflare R2:

1. **Signed URL API**  
   * `POST /api/uploads/sign` – body `{ mimeType, fileName, privacy: 'public'|'private' }`  
   * Returns `{ uploadUrl, cdnUrl, expiresAt }`
2. **Client Upload Flow**  
   * Frontend opens an *Upload Modal* containing:  
     * File picker (accepts images)  
     * Canvas preview with simple annotation tools:  
       * Rectangle + freehand mask (eraser)  
       * Blur / pixelate selected region  
       * EXIF strip toggle  
   * On “Save & Upload” the canvas generates a Blob; JS `fetch(PUT uploadUrl, blob)` streams file to R2.  
   * After success, backend `POST /api/uploads/commit` records metadata row `{ userId, cdnUrl, privacy }`.
3. **CDN Delivery**  
   * Public objects served at `https://cdn.noema.art/u/<hash>`  
   * Private objects require tokenised query param `?token=…` returned by `/api/uploads/token` (JWT signed, 15-min TTL, single-file scope).
4. **Worker Script for CLI/Server**  
   * `scripts/cf-upload.js <file>` – obtains signed URL via internal auth token and uploads via node-fetch for batch migrations.

### Tech Choices
* Cloudflare R2 → native S3-compatible PUT URL
* `@cloudflare/utilities` edge-compatible signing helper in backend
* Annotation uses [rough-notation] canvas ops, no heavy libs
* EXIF stripping via `piexifjs` on client

## Consequences
+ **Privacy** – Users can redact before bytes leave the browser; private objects gated by signed download tokens.
+ **Cost** – R2 egress free to Cloudflare CDN; minimal per-GB storage cost.
+ **Complexity** – Adds JS canvas tooling and token service; however avoids maintaining our own image processing backend.
+ **Scalability** – Signed-URL upload offloads transfer to Cloudflare; backend sees only metadata.

## Implementation Log
[Chronological notes taken while implementing this ADR.  Use timestamps or bullet points.]

## Alternatives Considered
* **Continue using S3 public bucket** – Rejected: privacy & egress cost.
* **Back-end proxy upload** – Rejected: doubles bandwidth usage, higher latency.
* **Third-party image hosts (Imgur…)** – Rejected: loss of control, TOS risk.
