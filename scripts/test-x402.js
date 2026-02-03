#!/usr/bin/env node
/**
 * x402 Payment Test Script
 *
 * Tests the x402 payment flow using Foundry keystores.
 *
 * Usage:
 *   node scripts/test-x402.js --key KEYNAME --tool dalle-image
 *   node scripts/test-x402.js --list
 *
 * The --key argument looks in ~/.foundry/keystores/ by default.
 * You can also provide a full path.
 */

const { Wallet } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// x402 packages
const { x402Client, x402HTTPClient } = require('@x402/core/client');
const { ExactEvmScheme } = require('@x402/evm');

const DEFAULT_SERVER = process.env.X402_TEST_SERVER || 'http://localhost:4000';
const DEFAULT_TOOL = 'dalle-image';
const DEFAULT_KEYSTORE_DIR = path.join(os.homedir(), '.foundry', 'keystores');

// Base network ID
const BASE_MAINNET = 'eip155:8453';
const BASE_SEPOLIA = 'eip155:84532';

/**
 * Ask a question on the command line.
 * Prompts go to stderr so stdout can be captured if needed.
 */
function ask(query, isPassword = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      if (isPassword) {
        process.stderr.write('\n');
      }
      resolve(answer);
    });

    // Mask password input
    if (isPassword) {
      rl.stdoutMuted = true;
      rl._writeToOutput = function _writeToOutput() {
        rl.output.write(`\r\x1B[2K\x1B[200D` + query);
      };
    }
  });
}

/**
 * Resolve keystore path - handles:
 * - Just a name (looks in ~/.foundry/keystores/)
 * - Full path
 * - Directory (picks newest file)
 */
function resolveKeystorePath(inputPath) {
  let resolvedPath;

  // Expand ~
  if (inputPath.startsWith('~')) {
    inputPath = path.join(os.homedir(), inputPath.slice(1));
  }

  // Check if it's just a name (no path separators)
  if (!inputPath.includes('/') && !inputPath.includes('\\')) {
    // Look in default foundry keystores directory
    resolvedPath = path.join(DEFAULT_KEYSTORE_DIR, inputPath);
  } else {
    resolvedPath = path.resolve(inputPath);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Keystore not found: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    // Pick the newest keystore file in the directory
    const entries = fs.readdirSync(resolvedPath)
      .filter(name => !name.startsWith('.'))
      .filter(name => name.toLowerCase().endsWith('.json') || name.startsWith('UTC') || !name.includes('.'));

    if (!entries.length) {
      throw new Error(`No keystore files found in: ${resolvedPath}`);
    }

    const enriched = entries.map(name => {
      const fullPath = path.join(resolvedPath, name);
      const stats = fs.statSync(fullPath);
      return { name, fullPath, mtime: stats.mtimeMs };
    });
    enriched.sort((a, b) => b.mtime - a.mtime);
    const selected = enriched[0];
    console.error(`[x402-test] Using keystore: ${selected.name}`);
    resolvedPath = selected.fullPath;
  }

  return resolvedPath;
}

/**
 * Load wallet from keystore with password prompt
 */
async function loadWallet(keystoreInput) {
  const keystorePath = resolveKeystorePath(keystoreInput);
  console.error(`[x402-test] Loading keystore from: ${keystorePath}`);

  const password = await ask('Enter keystore password: ', true);

  if (!password) {
    throw new Error('No password provided');
  }

  try {
    const encryptedJson = fs.readFileSync(keystorePath, 'utf8');
    const wallet = Wallet.fromEncryptedJsonSync(encryptedJson, password);
    console.error(`[x402-test] Loaded wallet: ${wallet.address}`);
    return wallet;
  } catch (error) {
    if (error.message.includes('invalid password')) {
      throw new Error('Invalid keystore password');
    }
    throw error;
  }
}

/**
 * Create an x402-compatible signer from an ethers Wallet
 *
 * The @x402/evm library passes an object { domain, types, primaryType, message }
 * but ethers expects positional arguments (domain, types, message)
 */
function createX402Signer(ethersWallet) {
  return {
    address: ethersWallet.address,
    signTypedData: async (params) => {
      // @x402/evm passes { domain, types, primaryType, message }
      const { domain, types, primaryType, message } = params;
      // ethers.signTypedData expects (domain, types, message)
      // where types includes the primaryType definition
      return ethersWallet.signTypedData(domain, types, message);
    }
  };
}

async function testX402Flow(options) {
  const { server, toolId, wallet, inputs = {}, network = BASE_MAINNET, delivery } = options;

  console.log('\n=== x402 Payment Test ===');
  console.log(`Server: ${server}`);
  console.log(`Tool: ${toolId}`);
  console.log(`Payer: ${wallet.address}`);
  console.log(`Network: ${network}`);
  if (delivery) {
    console.log(`Delivery: ${delivery.mode}${delivery.url ? ` → ${delivery.url}` : ''}`);
  }

  // Step 1: Get quote
  console.log('\n1. Getting quote...');
  const quoteUrl = `${server}/api/v1/x402/quote?toolId=${toolId}`;
  const quoteRes = await fetch(quoteUrl);
  const quote = await quoteRes.json();

  if (quote.error) {
    console.error('Quote error:', quote);
    return;
  }

  console.log(`   Base cost: $${quote.baseCostUsd}`);
  console.log(`   Total cost: $${quote.totalCostUsd}`);
  console.log(`   Atomic amount: ${quote.totalCostAtomic} (${quote.totalCostAtomic / 1e6} USDC)`);
  console.log(`   Pay to: ${quote.payTo}`);
  console.log(`   Network: ${quote.network}`);

  // Step 2: Try without payment (should get 402)
  console.log('\n2. Testing without payment (expecting 402)...');
  const generateUrl = `${server}/api/v1/x402/generate`;
  const requestBody = { toolId, inputs, ...(delivery && { delivery }) };
  const noPayRes = await fetch(generateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  console.log(`   Status: ${noPayRes.status}`);
  if (noPayRes.status === 402) {
    console.log('   ✓ Got expected 402 Payment Required');
    const paymentRequired = noPayRes.headers.get('x-payment-required');
    if (paymentRequired) {
      console.log('   ✓ X-PAYMENT-REQUIRED header present');
    }
  } else {
    console.log('   ✗ Did not get 402 - check server configuration');
    const body = await noPayRes.json();
    console.log('   Response:', JSON.stringify(body, null, 2));
    return;
  }

  // Step 3: Confirm payment
  console.log('\n3. Ready to make paid request...');
  console.log('   This will sign a USDC transferWithAuthorization for:');
  console.log(`   Amount: $${quote.totalCostUsd} (${quote.totalCostAtomic / 1e6} USDC)`);
  console.log(`   To: ${quote.payTo}`);

  const proceed = await ask(`\n   Proceed with payment? (y/n): `);

  if (proceed.toLowerCase() !== 'y') {
    console.log('   Cancelled.');
    return;
  }

  // Step 4: Create x402 client and make paid request
  console.log('\n4. Creating payment signature...');

  try {
    // Create signer compatible with x402
    const signer = createX402Signer(wallet);

    // Create x402 client with EVM scheme
    const client = new x402Client();
    const evmScheme = new ExactEvmScheme(signer);
    client.register(network, evmScheme);

    // Make the request - first get the 402 response to extract payment requirements
    console.log('   Getting payment requirements...');
    const initialRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (initialRes.status !== 402) {
      console.error('   Expected 402, got:', initialRes.status);
      return;
    }

    // Decode payment requirements from header
    const { decodePaymentRequiredHeader } = require('@x402/core/http');
    const paymentRequiredHeader = initialRes.headers.get('x-payment-required');
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);

    console.log('   Payment requirements received');
    console.log(`   Accepts: ${paymentRequired.accepts.length} payment option(s)`);

    // Create payment payload
    console.log('   Signing payment authorization...');
    const paymentPayload = await client.createPaymentPayload(paymentRequired);

    // Encode as header
    const { encodePaymentSignatureHeader } = require('@x402/core/http');
    const paymentHeader = encodePaymentSignatureHeader(paymentPayload);

    console.log('   ✓ Payment signed');

    // Make the paid request
    console.log('\n5. Sending paid request...');
    const paidRes = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentHeader
      },
      body: JSON.stringify(requestBody)
    });

    const result = await paidRes.json();

    console.log('\n=== Result ===');
    console.log(`Status: ${paidRes.status}`);

    if (result.x402) {
      console.log(`\nPayment Info:`);
      console.log(`  Settled: ${result.x402.settled}`);
      if (result.x402.transaction) {
        console.log(`  Transaction: ${result.x402.transaction}`);
        console.log(`  View on BaseScan: https://basescan.org/tx/${result.x402.transaction}`);
      }
      console.log(`  Cost: $${result.x402.costUsd}`);
      console.log(`  Payer: ${result.x402.payer}`);
    }

    if (result.error) {
      console.log(`\nError: ${result.error}`);
      console.log(`Message: ${result.message}`);
      if (result.details) {
        console.log(`Details:`, result.details);
      }
    } else if (paidRes.status === 200 || paidRes.status === 202) {
      const isAsync = result.status === 'processing';
      console.log(isAsync ? '\n✓ Generation submitted (async)!' : '\n✓ Payment successful!');

      // Show truncated result
      const resultStr = JSON.stringify(result, null, 2);
      if (resultStr.length > 1000) {
        console.log('\nGeneration result (truncated):');
        console.log(resultStr.slice(0, 1000) + '\n... (truncated)');
      } else {
        console.log('\nGeneration result:');
        console.log(resultStr);
      }

      // Return result for potential polling
      return result;
    }

  } catch (err) {
    console.error('\nPayment error:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
  }

  return null;
}

async function listTools(server) {
  console.log(`\nFetching tools from ${server}...`);
  const res = await fetch(`${server}/api/v1/x402/tools`);
  const data = await res.json();

  if (data.tools) {
    console.log(`\nAvailable tools (${data.tools.length}):\n`);
    for (const tool of data.tools) {
      const cost = tool.totalCostUsd ? `$${tool.totalCostUsd}` : 'N/A';
      console.log(`  ${tool.toolId.padEnd(30)} ${cost.padStart(10)}  ${tool.displayName || ''}`);
    }
    console.log(`\nNetwork: ${data.network}`);
    console.log(`Pay to: ${data.payTo}`);
  } else {
    console.log('Response:', data);
  }
}

async function checkStatus(server, generationId) {
  console.log(`\nChecking status for generation: ${generationId}`);
  const res = await fetch(`${server}/api/v1/x402/status/${generationId}`);
  const data = await res.json();

  console.log(`\nStatus: ${res.status}`);
  console.log(JSON.stringify(data, null, 2));

  return data;
}

async function pollUntilComplete(server, generationId, maxAttempts = 60, intervalMs = 5000) {
  console.log(`\nPolling for completion (max ${maxAttempts} attempts, ${intervalMs / 1000}s interval)...`);

  for (let i = 0; i < maxAttempts; i++) {
    const data = await checkStatus(server, generationId);

    if (data.status === 'completed') {
      console.log('\n✓ Generation completed!');
      return data;
    }

    if (data.status === 'failed') {
      console.log('\n✗ Generation failed');
      return data;
    }

    console.log(`  Attempt ${i + 1}/${maxAttempts}: status=${data.status}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }

  console.log('\n✗ Polling timeout - generation still processing');
  return null;
}

function listKeystores() {
  console.log(`\nFoundry keystores in ${DEFAULT_KEYSTORE_DIR}:\n`);

  if (!fs.existsSync(DEFAULT_KEYSTORE_DIR)) {
    console.log('  (directory not found)');
    return;
  }

  const entries = fs.readdirSync(DEFAULT_KEYSTORE_DIR)
    .filter(name => !name.startsWith('.'));

  if (!entries.length) {
    console.log('  (no keystores found)');
    return;
  }

  for (const name of entries) {
    console.log(`  ${name}`);
  }
  console.log(`\nUsage: node scripts/test-x402.js --key <name> --tool <toolId>`);
}

async function main() {
  const args = process.argv.slice(2);

  // Parse args
  let keyName = null;
  let toolId = DEFAULT_TOOL;
  let server = DEFAULT_SERVER;
  let listToolsOnly = false;
  let listKeysOnly = false;
  let statusGenerationId = null;
  let webhookUrl = null;
  let pollAfterSubmit = false;
  let network = process.env.X402_NETWORK || BASE_MAINNET;
  let inputs = {};

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--key' || args[i] === '-k') && args[i + 1]) {
      keyName = args[++i];
    } else if ((args[i] === '--tool' || args[i] === '-t') && args[i + 1]) {
      toolId = args[++i];
    } else if (args[i] === '--server' && args[i + 1]) {
      server = args[++i];
    } else if (args[i] === '--network' && args[i + 1]) {
      network = args[++i];
    } else if (args[i] === '--input' && args[i + 1]) {
      // Parse JSON input
      try {
        inputs = JSON.parse(args[++i]);
      } catch (e) {
        console.error('Invalid --input JSON:', e.message);
        process.exit(1);
      }
    } else if (args[i] === '--list' || args[i] === '-l') {
      listToolsOnly = true;
    } else if (args[i] === '--keys') {
      listKeysOnly = true;
    } else if (args[i] === '--testnet') {
      network = BASE_SEPOLIA;
    } else if (args[i] === '--status' && args[i + 1]) {
      statusGenerationId = args[++i];
    } else if (args[i] === '--webhook' && args[i + 1]) {
      webhookUrl = args[++i];
    } else if (args[i] === '--poll') {
      pollAfterSubmit = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
x402 Payment Test Script

Usage:
  node scripts/test-x402.js --key <name> --tool <toolId> [options]
  node scripts/test-x402.js --list [--server <url>]
  node scripts/test-x402.js --keys
  node scripts/test-x402.js --status <generationId> [--server <url>]

Options:
  --key, -k    Keystore name (looks in ~/.foundry/keystores/) or full path
  --tool, -t   Tool ID to test (default: dalle-image)
  --server     Server URL (default: http://localhost:4000)
  --network    Network ID (default: eip155:8453 for Base mainnet)
  --testnet    Use Base Sepolia testnet (eip155:84532)
  --input      JSON string of tool inputs (e.g. '{"prompt":"test"}')
  --list, -l   List available tools and exit
  --keys       List available keystores and exit
  --status     Check status of a generation by ID
  --webhook    URL to receive webhook callback when generation completes
  --poll       Auto-poll for completion after submitting async generation

Examples:
  node scripts/test-x402.js --keys
  node scripts/test-x402.js --list
  node scripts/test-x402.js --key MYKEY --tool dalle-image
  node scripts/test-x402.js --key MYKEY --tool dalle-image --input '{"prompt":"a cat"}'
  node scripts/test-x402.js --key MYKEY --tool comfyui-tool --poll
  node scripts/test-x402.js --key MYKEY --tool comfyui-tool --webhook https://webhook.site/xxx
  node scripts/test-x402.js --status 507f1f77bcf86cd799439011
`);
      return;
    }
  }

  // List keystores mode
  if (listKeysOnly) {
    listKeystores();
    return;
  }

  // List tools mode
  if (listToolsOnly) {
    await listTools(server);
    return;
  }

  // Status check mode
  if (statusGenerationId) {
    await checkStatus(server, statusGenerationId);
    return;
  }

  // Require --key for payment flow
  if (!keyName) {
    console.error('Error: --key <name> required');
    console.error('Run --keys to list available keystores, or --help for usage');
    process.exit(1);
  }

  try {
    const wallet = await loadWallet(keyName);

    // Build delivery options
    let delivery = undefined;
    if (webhookUrl) {
      delivery = { mode: 'webhook', url: webhookUrl };
    }

    const result = await testX402Flow({ server, toolId, wallet, network, inputs, delivery });

    // Auto-poll if requested and result is processing
    if (pollAfterSubmit && result?.generationId && result?.status === 'processing') {
      await pollUntilComplete(server, result.generationId);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
