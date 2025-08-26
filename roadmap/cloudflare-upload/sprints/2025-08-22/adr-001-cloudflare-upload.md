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

### 2025-08-25 Troubleshooting R2 Upload Flow

* **14:00** Initial CLI (`scripts/cf-upload.js`) created; backend returned presigned URL but PUT → `401 Unauthorized` due to 
  `x-amz-sdk-checksum-algorithm=CRC32` + `x-amz-checksum-crc32` query params that R2 does not support for single-part uploads.
* **14:25** Removed `ChecksumAlgorithm: 'CRC32'` from `PutObjectCommand` – query params still appeared (SDK default).
* **15:10** Stripped all `x-amz-*checksum*` params after `getSignedUrl` → checksums gone, but URL contained
  `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD`; R2 now required matching header.
* **15:40** Client added `x-amz-content-sha256: UNSIGNED-PAYLOAD` header → signature mismatch (403) because header
  was not included in `X-Amz-SignedHeaders` list.
* **16:00** Tried `ChecksumSHA256` property – produced wrong header (`x-amz-checksum-sha256`).
* **16:30** Final fix:
  * Added `ContentSHA256: 'UNSIGNED-PAYLOAD'` on `PutObjectCommand` **and**
    `signableHeaders: new Set(['host','x-amz-content-sha256'])` when calling `getSignedUrl`.
  * Presigned URL now shows `X-Amz-SignedHeaders=host;x-amz-content-sha256`.
  * CLI mirrors header – upload succeeds (HTTP 200).  🎉

All previous failure modes and their resolutions are captured here to avoid regressions.

### 2025-08-26 Minimal v3 Flow & Creds Fix

* **11:30** Swapped to new R2 API credentials — ensured `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` env vars loaded.
* **11:45** Reverted to minimal AWS-SDK v3 presigner: Bucket/Key/ContentType only, no metadata, no extra headers.
* **12:10** Discovered duplicate `uploads/` prefix in object key caused signature mismatch; fixed key → `<userId>/<uuid>-<file>`.
* **12:20** Confirmed presigned URL with `X-Amz-SignedHeaders=host` and checksum params uploads successfully **without sending any extra headers**.
* **12:25** CLI `scripts/cf-upload.js` trimmed to send PUT body only; upload returns HTTP 200 and prints CDN link.
* **12:30** Added cleanup todos: frontend UploadModal, `/api/uploads/commit`, DB table.

Checksum query params (`x-amz-sdk-checksum-algorithm`, `x-amz-checksum-crc32`) are tolerated by R2 when using default v3 signer.

## Alternatives Considered
* **Continue using S3 public bucket** – Rejected: privacy & egress cost.
* **Back-end proxy upload** – Rejected: doubles bandwidth usage, higher latency.
* **Third-party image hosts (Imgur…)** – Rejected: loss of control, TOS risk.
