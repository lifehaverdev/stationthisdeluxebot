#!/usr/bin/env node
// cf-upload.js – CLI helper to upload a local file to Cloudflare R2 via the internal storage API.
// Usage:  ./run-with-env.sh node scripts/cf-upload.js <path-to-file> [--user <userId>]
// Requires the following environment variables (loaded via run-with-env.sh):
//   BACKEND_BASE_URL            – e.g. http://localhost:4000
//   INTERNAL_API_KEY_SYSTEM     – privileged key for internal requests
//   R2_*                        – bucket credentials are handled server-side
//
// The script: 1) hits /internal/v1/data/storage/upload-url to obtain a signed URL
//             2) performs PUT upload to Cloudflare R2
//             3) prints the resulting permanent CDN URL on stdout.

'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

function getContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

// Lightweight CRC32 implementation (no external deps)
function crc32(buffer) {
  const table = crc32.table || (crc32.table = (() => {
    let c, table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[n] = c >>> 0; // ensure unsigned
    }
    return table;
  })());

  let crc = 0 ^ (-1);
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xFF];
  }
  crc = (crc ^ (-1)) >>> 0; // unsigned 32-bit
  return crc;
}

(async () => {
  try {
    const args = process.argv.slice(2);
    if (args.length < 1) {
      console.error('Usage: node scripts/cf-upload.js <file> [--user <userId>]');
      process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    const userIdFlagIndex = args.indexOf('--user');
    const userId = userIdFlagIndex !== -1 ? args[userIdFlagIndex + 1] : 'system-upload-script';

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const contentType = getContentType(fileName);
    const fileBuffer = fs.readFileSync(filePath);

    const baseUrl = process.env.BACKEND_BASE_URL || 'http://localhost:4000';
    console.error(`[cf-upload] Using backend: ${baseUrl}`);
    const internalKey = process.env.INTERNAL_API_KEY_SYSTEM;

    if (!internalKey) {
      throw new Error('Missing INTERNAL_API_KEY_SYSTEM in environment.');
    }

    // Step 1: request signed URL
    const signRes = await fetch(`${baseUrl}/internal/v1/data/storage/upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Client-Key': internalKey,
      },
      body: JSON.stringify({ fileName, contentType, userId }),
    });

    if (!signRes.ok) {
      const t = await signRes.text();
      throw new Error(`Failed to obtain signed URL – ${signRes.status}: ${t}`);
    }

    const { signedUrl, permanentUrl } = await signRes.json();

    if (!signedUrl || !permanentUrl) {
      throw new Error('Malformed response: missing signedUrl/permanentUrl');
    }

    console.error('[cf-upload] Signed URL:', signedUrl);
    const urlObj = new URL(signedUrl);
    console.error('[cf-upload] SignedHeaders param:', urlObj.searchParams.get('X-Amz-SignedHeaders'));
    console.error('[cf-upload] URL query params:', Object.fromEntries(urlObj.searchParams.entries()));

    // Step 2: PUT upload
    const putHeaders = {};

    // If presigned URL expects x-amz-content-sha256, include UNSIGNED-PAYLOAD
    const signedHeaders = (urlObj.searchParams.get('X-Amz-SignedHeaders') || '')
      .split(';')
      .map((h) => h.trim().toLowerCase());

    // Do NOT add Content-Type header unless it is explicitly listed in SignedHeaders (it isn't for R2 presigned URLs)

    if (signedHeaders.includes('x-amz-content-sha256')) {
      putHeaders['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD';
    }

    // Do not include x-amz-meta-* headers; signer already covers them via query params.

    // NOTE: We intentionally ignore any x-amz-*checksum* params; backend strips them.
    console.error('[cf-upload] PUT headers:', putHeaders);

    const putRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: putHeaders,
      body: fileBuffer,
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      console.error('[cf-upload] PUT response status:', putRes.status);
      console.error('[cf-upload] PUT response headers:', Object.fromEntries(putRes.headers.entries()));
      throw new Error(`Upload failed – ${putRes.status}: ${t}`);
    }

    console.error('[cf-upload] Upload succeeded – HTTP', putRes.status);
    console.log(permanentUrl);
  } catch (err) {
    console.error('[cf-upload] Error:', err && (err.message || err));
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
})();
