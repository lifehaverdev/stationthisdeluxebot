# API Guide

This guide shows practical cURL snippets and CLI examples for the StationThis Deluxe Bot REST API hosted at `https://noema.art/api/v1`.

## 1. Connect a Wallet (Magic-Amount Flow)

1. **Initiate linking** – request the magic amount you must deposit from the wallet you wish to connect.

```bash
curl -X POST "https://noema.art/api/v1/wallets/connect/initiate" \
  -H 'Content-Type: application/json' \
  -d '{"tokenAddress":"0x0000000000000000000000000000000000000000"}'
```

Typical response:
```json
{
  "requestId": "64f…",
  "magicAmount": "0.001337",
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "expiresAt": "2025-09-17T00:10:11.000Z",
  "depositToAddress": "0xABCD…"  // credit-vault contract
}
```
Deposit the exact `magicAmount` from your wallet to `depositToAddress`, then poll the status endpoint:

```bash
curl "https://noema.art/api/v1/wallets/connect/status/<requestId>"
```

On success you receive your **API key**:
```json
{
  "status": "COMPLETED",
  "apiKey": "sk_live_…",
  "message": "Wallet connected successfully. This is your API key. Store it securely, it will not be shown again."
}
```

---

## 2. Account Endpoints (require `x-api-key` header)

Assume you have exported your key:
```bash
export API_KEY="sk_live_…"
```

• **Profile**
```bash
curl -H "x-api-key: $API_KEY" \
     https://noema.art/api/v1/user/me
```

• **Dashboard summary**
```bash
curl -H "x-api-key: $API_KEY" \
     https://noema.art/api/v1/user/dashboard
```

• **Spending history (last month)**
```bash
curl -H "x-api-key: $API_KEY" \
     "https://noema.art/api/v1/user/history?timeUnit=month&offset=0"
```

---

## 3. Request a Generation (Kontext tool)

```bash
cat > kontext.json <<'EOF'
{
  "toolId": "kontext",
  "inputs": {
    "input_image": "https://miladymaker.net/milady/4985.png",
    "input_prompt": "turn the character so that she is facing the viewer and looking directly at them"
  }
}
EOF

curl -X POST https://noema.art/api/v1/generations/execute \
     -H "x-api-key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d @kontext.json
```

Sample response:
```json
{
  "generationId": "6541…",
  "status": "processing",
  "estimatedDurationSeconds": 45,
  "checkAfterMs": 45000,
  "message": "Your request has been accepted and is being processed."
}
```

Wait at least `checkAfterMs` and then poll for completion:
```bash
curl -H "x-api-key: $API_KEY" \
     https://noema.art/api/v1/generations/status/<generationId>
```
Completed example:
```json
{
  "generationId": "6541…",
  "status": "completed",
  "outputs": [ { "data": { "images": [ { "url": "https://…/output.png" } ] } } ]
}
```
