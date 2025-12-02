#!/usr/bin/env node

/**
 * Control the collection export worker via internal API.
 *
 * Usage:
 *   node scripts/export-worker-control.js status
 *   node scripts/export-worker-control.js pause [reason]
 *   node scripts/export-worker-control.js resume
 *
 * Environment variables:
 *   INTERNAL_API_BASE     Base URL for internal API (default http://localhost:4000/internal/v1/data)
 *   INTERNAL_API_KEY_ADMIN   Required internal client key for authentication
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fetch = require('node-fetch');

const INTERNAL_API_BASE = process.env.INTERNAL_API_BASE || 'http://localhost:4000/internal/v1/data';
const clientKey = process.env.INTERNAL_CLIENT_KEY || process.env.INTERNAL_API_KEY_ADMIN;

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || !['status', 'pause', 'resume'].includes(command)) {
    return help();
  }
  if (!clientKey) {
    console.error('INTERNAL_API_KEY_ADMIN env var is required.');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'status':
        return await getStatus();
      case 'pause':
        return await pauseWorker(rest[0]);
      case 'resume':
        return await resumeWorker();
      default:
        return help();
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

function help() {
  console.log(`Collection Export Worker Control
Usage:
  node scripts/export-worker-control.js status
  node scripts/export-worker-control.js pause [reason]
  node scripts/export-worker-control.js resume

Environment:
  INTERNAL_API_BASE    Base URL for internal API (default http://localhost:4000/internal/v1/data)
  INTERNAL_API_KEY_ADMIN  Internal API key (required)
`);
  process.exit(0);
}

async function getStatus() {
  const url = `${INTERNAL_API_BASE}/collections/export/worker/status`;
  const res = await perform('GET', url);
  printJson(res);
}

async function pauseWorker(reason = 'manual') {
  const url = `${INTERNAL_API_BASE}/collections/export/worker/pause`;
  const payload = { reason };
  const res = await perform('POST', url, payload);
  printJson(res);
}

async function resumeWorker() {
  const url = `${INTERNAL_API_BASE}/collections/export/worker/resume`;
  const res = await perform('POST', url);
  printJson(res);
}

async function perform(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Client-Key': clientKey
    },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    parsed = text;
  }

  if (!res.ok) {
    const message = parsed && parsed.error ? parsed.error : res.statusText;
    throw new Error(`Request failed (${res.status}): ${message}`);
  }
  return parsed;
}

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

main();
