#!/usr/bin/env node
// API Guide Demonstration Script
// Usage: node api-guide-demo.js <command> [options]
// Commands: wallet-initiate, wallet-status, account-me, account-dashboard, account-history, generation-execute, generation-status

const fetch = require('node-fetch');

const API_BASE = process.env.API_BASE || 'http://noema.art/api/v1';
const API_KEY = process.env.API_KEY;

async function main() {
  const [,, cmd, ...rest] = process.argv;
  if (!cmd) return help();
  try {
    switch (cmd) {
      case 'wallet-initiate':
        return await walletInitiate(rest[0]);
      case 'wallet-status':
        return await walletStatus(rest[0]);
      case 'account-me':
        return await accountMe();
      case 'account-dashboard':
        return await accountDashboard();
      case 'account-history':
        return await accountHistory(rest[0], rest[1]);
      case 'generation-execute':
        return await generationExecute(rest[0] || 'kontext', rest[1]);
      case 'generation-status':
        return await generationStatus(rest[0]);
      default:
        return help();
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

function help() {
  console.log(`API Guide Demo
Usage: node api-guide-demo.js <command> [arg]
Commands:
  wallet-initiate <walletAddress>
  wallet-status <requestId>
  account-me
  account-dashboard
  account-history [timeUnit] [offset]
  generation-execute <toolId> [payloadFile.json]
  generation-status <generationId>
Environment:
  API_BASE  Base URL of API (default http://noema.art/api/v1)
  API_KEY   Your secret API key for authenticated endpoints
`);
  process.exit(0);
}

async function walletInitiate(address = '0xDEADBEEF') {
  const url = `${API_BASE}/wallets/connect/initiate`;
  const body = { tokenAddress: '0x0000000000000000000000000000000000000000', expiresInSeconds: 600, address };
  await perform('POST', url, body);
}

async function walletStatus(requestId) {
  if (!requestId) {
    console.error('requestId is required for wallet-status command');
    process.exit(1);
  }
  const url = `${API_BASE}/wallets/connect/status/${requestId}`;
  await perform('GET', url);
}

async function accountMe() {
  await ensureApiKey();
  const url = `${API_BASE}/user/me`;
  await perform('GET', url, null, true);
}

async function accountDashboard() {
  await ensureApiKey();
  const url = `${API_BASE}/user/dashboard`;
  await perform('GET', url, null, true);
}

async function accountHistory(timeUnit = 'month', offset = 0) {
  await ensureApiKey();
  const url = `${API_BASE}/user/history?timeUnit=${encodeURIComponent(timeUnit)}&offset=${offset}`;
  await perform('GET', url, null, true);
}

function ensureApiKey() {
  if (!API_KEY) {
    console.error('API_KEY env var required for this command');
    process.exit(1);
  }
}

async function generationExecute(toolId, payloadPath) {
  await ensureApiKey();
  const fs = require('fs');
  let inputs;
  if (payloadPath) {
    inputs = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  } else {
    // default kontext example
    inputs = {
      input_image: 'https://miladymaker.net/milady/4985.png',
      input_prompt: 'turn the character so that she is facing the viewer and looking directly at them'
    };
  }
  const url = `${API_BASE}/generations/execute`;
  const body = { toolId, inputs };
  await perform('POST', url, body, true);
}

async function generationStatus(generationId) {
  await ensureApiKey();
  if (!generationId) {
    console.error('generationId required');
    process.exit(1);
  }
  const url = `${API_BASE}/generations/status/${generationId}`;
  await perform('GET', url, null, true);
}

async function perform(method, url, body, withAuth = false) {
  console.log(`${method} ${url}`);
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(withAuth ? { 'x-api-key': API_KEY } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  console.log('Status:', res.status);
  console.log('Response:', parsed);
}

main();
