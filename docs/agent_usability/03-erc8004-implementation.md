# ERC-8004 Profile Implementation

**Status:** Planning
**Phase:** 3 of 4
**Created:** 2026-02-02
**Depends On:**
- Phase 1 (Claude Skill) - MCP endpoint to advertise
- Phase 2 (x402) - Payment capability to declare

---

## Executive Summary

ERC-8004 ("Trustless Agents") is an Ethereum standard that enables AI agents to discover, authenticate, and interact across organizational boundaries. By registering NOEMA in the ERC-8004 Identity Registry, we make our service discoverable to any agent querying the registry.

This is the "Open for Business" sign - it aggregates our MCP endpoint (Phase 1) and x402 payment capability (Phase 2) into a discoverable on-chain profile.

---

## Protocol Overview

### The Three Registries

| Registry | Purpose | On-Chain Data |
|----------|---------|---------------|
| **Identity** | Agent discovery | ERC-721 token → URI pointing to agent-card.json |
| **Reputation** | Trust signals | Feedback scores, tags, client reviews |
| **Validation** | Work verification | Cryptographic/economic verification of outputs |

### How Discovery Works

```
Agent wants to find AI generation services
              ↓
Query Identity Registry for agents with tag "ai-generation"
              ↓
Get agentId → resolve tokenURI → fetch agent-card.json
              ↓
Read services array → find MCP endpoint
              ↓
Read x402Support → knows it can pay per-request
              ↓
Connect and use NOEMA
```

### Agent Card Schema

Hosted at `https://noema.art/.well-known/agent-card.json`:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "NOEMA",
  "description": "AI generation infrastructure platform. Generate images, videos, and media using state-of-the-art models with LoRA style customization.",
  "image": "https://noema.art/logo.png",
  "services": [
    {
      "name": "MCP",
      "endpoint": "https://noema.art/mcp",
      "version": "2025-06-18"
    },
    {
      "name": "A2A",
      "endpoint": "https://noema.art/a2a",
      "version": "1.0.0"
    },
    {
      "name": "web",
      "endpoint": "https://noema.art"
    }
  ],
  "x402Support": true,
  "active": true,
  "registrations": [
    {
      "agentId": 123,
      "agentRegistry": "eip155:1:0x..."
    }
  ],
  "supportedTrust": ["reputation"]
}
```

---

## What NOEMA Needs to Implement

### Phase 3.1: Agent Card File

Create and host the agent registration file.

**File:** `public/.well-known/agent-card.json`

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "NOEMA",
  "description": "AI generation infrastructure platform for images, videos, and media. Features 140+ LoRA models for style customization, trigger word system, and pay-per-request via x402. Tools include DALL-E 3, FLUX, SDXL, LTX Video, JoyCaption, and more.",
  "image": "https://noema.art/images/noema-agent-logo.png",
  "services": [
    {
      "name": "web",
      "endpoint": "https://noema.art",
      "version": "1.0.0"
    },
    {
      "name": "MCP",
      "endpoint": "https://noema.art/api/v1/mcp",
      "version": "2025-06-18"
    }
  ],
  "x402Support": true,
  "active": true,
  "registrations": [],
  "supportedTrust": ["reputation"],
  "capabilities": {
    "categories": ["text-to-image", "image-to-image", "text-to-video", "image-to-text", "upscaling"],
    "loraCount": 143,
    "toolCount": 26,
    "paymentMethods": ["x402", "credits"]
  }
}
```

**Route:** Add Express route to serve this file

```javascript
// In src/platforms/web/index.js
app.get('/.well-known/agent-card.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/.well-known/agent-card.json'));
});
```

---

### Phase 3.2: Identity Registry Registration

Register NOEMA in the ERC-8004 Identity Registry.

**Prerequisites:**
- Ethereum wallet with ETH for gas
- Agent card hosted and accessible

**Contract Interaction:**

```javascript
const { ethers } = require('ethers');

// Identity Registry on Ethereum mainnet (or Base)
const IDENTITY_REGISTRY_ADDRESS = '0x...'; // Get from official deployment
const IDENTITY_REGISTRY_ABI = [...]; // From ERC-8004 spec

async function registerNOEMA() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_REGISTRY_PRIVATE_KEY, provider);

  const registry = new ethers.Contract(
    IDENTITY_REGISTRY_ADDRESS,
    IDENTITY_REGISTRY_ABI,
    wallet
  );

  // Register with URI pointing to our agent card
  const agentURI = 'https://noema.art/.well-known/agent-card.json';

  const tx = await registry.register(agentURI);
  const receipt = await tx.wait();

  // Extract agentId from Registered event
  const event = receipt.logs.find(log => log.fragment?.name === 'Registered');
  const agentId = event.args.agentId;

  console.log(`NOEMA registered with agentId: ${agentId}`);
  return agentId;
}
```

**Metadata to Set:**

```javascript
// Set additional metadata after registration
await registry.setMetadata(agentId, 'category', ethers.toUtf8Bytes('ai-generation'));
await registry.setMetadata(agentId, 'x402Network', ethers.toUtf8Bytes('base'));
await registry.setMetadata(agentId, 'loraCount', ethers.toUtf8Bytes('143'));
```

---

### Phase 3.3: Update Agent Card with Registration

After registration, update agent-card.json with the agentId:

```json
{
  "registrations": [
    {
      "agentId": 123,
      "agentRegistry": "eip155:1:0xIdentityRegistryAddress"
    }
  ]
}
```

This creates a bidirectional link:
- On-chain: agentId → tokenURI → agent-card.json
- Off-chain: agent-card.json → registrations → agentId

---

### Phase 3.4: Dynamic Agent Card Generation

For real-time accuracy, generate agent-card.json dynamically:

**File:** `src/api/external/agentCardApi.js`

```javascript
const express = require('express');

function createAgentCardRouter(dependencies) {
  const { toolRegistry, loraDb } = dependencies;
  const router = express.Router();

  router.get('/.well-known/agent-card.json', async (req, res) => {
    // Get live counts
    const tools = await toolRegistry.getAllTools();
    const loraCount = await loraDb.countPublicLoras();

    const agentCard = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'NOEMA',
      description: `AI generation infrastructure platform. ${tools.length} tools, ${loraCount} LoRA models available.`,
      image: 'https://noema.art/images/noema-agent-logo.png',
      services: [
        {
          name: 'web',
          endpoint: 'https://noema.art',
          version: '1.0.0'
        },
        {
          name: 'MCP',
          endpoint: 'https://noema.art/api/v1/mcp',
          version: '2025-06-18'
        }
      ],
      x402Support: true,
      active: true,
      registrations: [
        {
          agentId: parseInt(process.env.ERC8004_AGENT_ID),
          agentRegistry: `eip155:1:${process.env.ERC8004_IDENTITY_REGISTRY}`
        }
      ],
      supportedTrust: ['reputation'],
      capabilities: {
        categories: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-text', 'upscaling'],
        loraCount,
        toolCount: tools.length,
        tools: tools.map(t => ({
          id: t.toolId,
          name: t.displayName,
          category: t.category
        }))
      }
    };

    res.json(agentCard);
  });

  return router;
}

module.exports = { createAgentCardRouter };
```

---

### Phase 3.5: Reputation Integration (Optional)

Allow clients to leave feedback on NOEMA's service quality.

**Receiving Feedback:**

Clients call the Reputation Registry:
```solidity
reputationRegistry.giveFeedback(
  noemaAgentId,
  85,              // score (0-100)
  0,               // decimals
  "ai-generation", // tag1
  "fast",          // tag2
  "text-to-image", // endpoint used
  "ipfs://...",    // detailed feedback URI
  feedbackHash     // hash of feedback content
);
```

**Displaying Reputation:**

Add reputation to agent card:

```javascript
// Fetch reputation summary from chain
const summary = await reputationRegistry.getSummary(
  agentId,
  [],           // all clients
  '',           // all tag1
  ''            // all tag2
);

agentCard.reputation = {
  feedbackCount: summary.count.toNumber(),
  averageScore: summary.summaryValue.toNumber() / (10 ** summary.summaryValueDecimals),
  lastUpdated: new Date().toISOString()
};
```

---

## Integration with Phase 1 & 2

### MCP Endpoint (Phase 1)

The agent card's `services` array advertises our MCP endpoint:

```json
{
  "name": "MCP",
  "endpoint": "https://noema.art/api/v1/mcp",
  "version": "2025-06-18"
}
```

Agents discovering NOEMA via ERC-8004 can then connect via MCP to:
- Discover available tools
- Execute generations
- Query LoRA catalog

### x402 Support (Phase 2)

The `x402Support: true` flag tells agents they can pay per-request:

```json
{
  "x402Support": true
}
```

Combined with MCP service discovery, an agent can:
1. Find NOEMA via ERC-8004
2. Connect via MCP to discover tools
3. Pay via x402 for one-off executions

---

## Deployment Options

### Option A: Ethereum Mainnet

- Maximum discoverability (most agents query mainnet)
- Higher gas costs for registration
- Use canonical Identity Registry

### Option B: Base

- Lower gas costs
- Growing agent ecosystem (x402 is Base-native)
- May need to register on both chains

### Recommendation: Both

Register on Ethereum mainnet for discoverability, but list Base as primary x402 network in agent card.

---

## Environment Variables

```bash
# ERC-8004 Configuration
ERC8004_AGENT_ID=123                           # After registration
ERC8004_IDENTITY_REGISTRY=0x...                # Mainnet registry address
ERC8004_REPUTATION_REGISTRY=0x...              # Optional
ERC8004_AGENT_WALLET_ADDRESS=0x...             # Wallet that owns registration
ERC8004_AGENT_WALLET_PRIVATE_KEY=0x...         # For updates (secure this!)
```

---

## Implementation Timeline

| Step | Description | Dependencies |
|------|-------------|--------------|
| 3.1 | Create static agent-card.json | None |
| 3.2 | Register in Identity Registry | 3.1, wallet with ETH |
| 3.3 | Update agent card with agentId | 3.2 |
| 3.4 | Dynamic agent card endpoint | 3.1, tool registry |
| 3.5 | (Optional) Reputation integration | 3.2 |

**Estimated effort:** Low-Medium
**Risk:** Low (read-mostly, no complex state)

---

## Deployment Checklist

### Pre-Production

- [ ] Agent card JSON created
- [ ] Route serving /.well-known/agent-card.json
- [ ] Agent logo image uploaded
- [ ] Wallet funded with ETH for registration
- [ ] Test registration on Sepolia

### Production Launch

- [ ] Register on Ethereum mainnet
- [ ] Update agent card with agentId
- [ ] Verify agent card accessible
- [ ] Test discovery via registry query
- [ ] Update Claude Skill docs with ERC-8004 info
- [ ] Announce ERC-8004 registration

### Optional Enhancements

- [ ] Register on Base (for x402 ecosystem)
- [ ] Enable reputation feedback
- [ ] ENS name (noema.eth)
- [ ] Add A2A endpoint

---

## Solidity Interfaces Reference

### Identity Registry

```solidity
interface IIdentityRegistry {
  function register(string calldata agentURI) external returns (uint256 agentId);
  function register(string calldata agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);

  function setAgentURI(uint256 agentId, string calldata newURI) external;
  function tokenURI(uint256 agentId) external view returns (string memory);

  function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external;
  function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory);

  function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
  function getAgentWallet(uint256 agentId) external view returns (address);

  event Registered(uint256 indexed agentId, address indexed owner, string agentURI);
}

struct MetadataEntry {
  string key;
  bytes value;
}
```

### Reputation Registry

```solidity
interface IReputationRegistry {
  function giveFeedback(
    uint256 agentId,
    int128 value,
    uint8 valueDecimals,
    string calldata tag1,
    string calldata tag2,
    string calldata endpoint,
    string calldata feedbackURI,
    bytes32 feedbackHash
  ) external;

  function getSummary(
    uint256 agentId,
    address[] calldata clientAddresses,
    string calldata tag1,
    string calldata tag2
  ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);

  function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;
}
```

---

## References

### Official Resources
- [EIP-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [8004.org Community Site](https://8004.org/)
- [Ethereum Magicians Discussion](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098)

### Implementation Resources
- [Awesome ERC-8004](https://github.com/sudeepb02/awesome-erc8004)
- [Reference Implementation](https://github.com/vistara-apps/erc-8004-example)
- [Composable Security Explainer](https://composable-security.com/blog/erc-8004-a-practical-explainer-for-trustless-agents/)

### Testnet Deployments
- Ethereum Sepolia
- Base Sepolia
- Linea Sepolia
- Hedera Testnet

Mainnet deployment expected: End of October 2025
