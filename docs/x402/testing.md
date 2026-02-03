# x402 Testing

## Test Script

A comprehensive test script is available at `scripts/test-x402.js`.

### Prerequisites

1. **Foundry Keystore**: Create a keystore with your test wallet's private key:

```bash
# Create keystore (will prompt for private key and password)
cast wallet import MONY --interactive
```

2. **USDC Balance**: Ensure your test wallet has USDC on Base:
   - Minimum: $0.10 for basic testing
   - Check balance: https://basescan.org/address/YOUR_WALLET

3. **Server Running**: Start the local server:

```bash
./scripts/run-dev.sh
```

### Basic Usage

```bash
# Execute a tool with x402 payment
node scripts/test-x402.js --key MONY --tool chatgpt-free --input '{"prompt":"hello"}'
```

### Command Line Options

| Option | Description | Example |
|--------|-------------|---------|
| `--key NAME` | Foundry keystore name | `--key MONY` |
| `--tool ID` | Tool to execute | `--tool chatgpt-free` |
| `--input JSON` | Tool inputs | `--input '{"prompt":"hi"}'` |
| `--server URL` | Server URL | `--server http://localhost:4000` |
| `--list` | List available tools | `--list` |
| `--quote` | Get quote only (no execution) | `--quote` |
| `--status ID` | Check generation status | `--status 69821ce5...` |
| `--poll` | Poll until completion | `--poll` |
| `--webhook URL` | Use webhook delivery | `--webhook http://example.com/hook` |

### Examples

#### List Available Tools

```bash
node scripts/test-x402.js --key MONY --list
```

Output:
```
Available tools (27):
  chatgpt-free    ChatGPT               $0.012
  dalle-3         DALL-E 3              $0.048
  flux-dev        Flux Dev              $0.036
  ...
```

#### Get Quote Only

```bash
node scripts/test-x402.js --key MONY --tool dalle-3 --input '{"prompt":"a cat"}' --quote
```

Output:
```
Quote for dalle-3:
  Base cost: $0.04
  Total cost: $0.048 (includes 20% markup)
  USDC atomic: 48000
```

#### Execute with Polling

```bash
node scripts/test-x402.js --key MONY --tool flux-dev --input '{"prompt":"sunset"}' --poll
```

Output:
```
Generation started: 69821ce536d6148ae2b1a9cc
Polling for completion...
  Status: processing (attempt 1/60)
  Status: processing (attempt 2/60)
  Status: completed
Result: { images: [...] }
```

#### Check Existing Generation

```bash
node scripts/test-x402.js --status 69821ce536d6148ae2b1a9cc
```

### Test Flow

The script performs these steps:

1. **Load Wallet**: Prompts for keystore password, loads private key
2. **Get Quote**: Fetches cost estimate from `/api/v1/x402/quote`
3. **Test 402**: Sends request without payment, verifies 402 response
4. **Confirm**: Prompts user to confirm payment
5. **Sign Payment**: Creates EIP-3009 transferWithAuthorization signature
6. **Execute**: Sends request with X-PAYMENT header
7. **Display Result**: Shows generation output and settlement info

### Security Notes

- **Private Key Safety**: The script uses Foundry keystores which encrypt keys at rest
- **Password Entry**: Password is entered via TTY, not visible in logs
- **No Key Storage**: Private key is only held in memory during execution
- **Local Testing**: Default server is localhost - change for production testing

### Expected Output (Successful)

```
[x402-test] Loading keystore from: /Users/you/.foundry/keystores/MONY
Enter keystore password:
[x402-test] Loaded wallet: 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6

=== x402 Payment Test ===
Server: http://localhost:4000
Tool: chatgpt-free
Payer: 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6
Network: eip155:8453

1. Getting quote...
   Base cost: $0.01
   Total cost: $0.012
   Atomic amount: 12000 (0.012 USDC)
   Pay to: 0x428Bea9Fd786659c84b0bD62D372bb4a482aF653
   Network: eip155:8453

2. Testing without payment (expecting 402)...
   Status: 402
   ✓ Got expected 402 Payment Required
   ✓ X-PAYMENT-REQUIRED header present

3. Ready to make paid request...
   This will sign a USDC transferWithAuthorization for:
   Amount: $0.012 (0.012 USDC)
   To: 0x428Bea9Fd786659c84b0bD62D372bb4a482aF653

   Proceed with payment? (y/n): y

4. Creating payment signature...
   Getting payment requirements...
   Payment requirements received
   Accepts: 1 payment option(s)
   Signing payment authorization...
   ✓ Payment signed

5. Sending paid request...

=== Result ===
Status: 200

Payment Info:
  Settled: true
  Transaction: 0x73ca7f5ff04a7d32deb4f52c3b72cb7b7c130f1be35d70475173bb35684ddc0f
  View on BaseScan: https://basescan.org/tx/0x73ca7f5ff04a7d32...
  Cost: $0.012
  Payer: 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6

✓ Payment successful!

Generation result:
{
  "generationId": "69821ce536d6148ae2b1a9cc",
  "status": "completed",
  "response": "Hello! How can I assist you today?"
}
```

## Manual Testing with curl

### Step 1: Get Quote

```bash
curl -s http://localhost:4000/api/v1/x402/quote?toolId=chatgpt-free | jq
```

### Step 2: Test 402 Response

```bash
curl -s -w "\nHTTP Status: %{http_code}\n" \
  -X POST http://localhost:4000/api/v1/x402/generate \
  -H "Content-Type: application/json" \
  -d '{"toolId":"chatgpt-free","inputs":{"prompt":"hello"}}' | jq
```

### Step 3: Execute with Payment

Creating the payment header manually requires signing EIP-712 typed data. Use the test script or implement client-side signing with `@x402/evm`.

## Integration Testing

### Test Replay Protection

```bash
# First request - should succeed
node scripts/test-x402.js --key MONY --tool chatgpt-free --input '{"prompt":"test1"}'

# Save the X-PAYMENT header value, then try reusing it
# (This would require modifying the script to reuse headers)
# Should fail with PAYMENT_ALREADY_USED
```

### Test Insufficient Payment

Modify the payment amount in the signature to be less than required - the facilitator should reject it.

### Test Failed Execution

Use a tool configuration that will fail (e.g., invalid API key) to verify:
- Payment is marked as FAILED
- USDC is NOT transferred
- Error is returned to client

## Monitoring Test Results

### Check Database

```javascript
// In mongo shell
use noema

// Recent payments
db.x402_payment_log.find().sort({created_at:-1}).limit(5).pretty()

// Recent x402 generations
db.generationOutputs.find({"metadata.x402":true}).sort({requestTimestamp:-1}).limit(5).pretty()
```

### Check Server Logs

Look for these log messages:

```
[x402] Payment verified { payer, amount, network }
[x402] Executing generation { toolId, payer, costUsd }
[x402] Payment settled { transaction, payer }
```

### Verify On-Chain

Check the settlement transaction on BaseScan:
- From: CDP Facilitator contract
- To: Your receiver address
- Amount: Expected USDC amount
- Token: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
