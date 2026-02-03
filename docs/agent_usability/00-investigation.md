# Agent Usability Initiative: Investigation Phase

**Status:** Investigation Complete - Ready for Phase 1
**Created:** 2026-02-02
**Mission:** Make NOEMA discoverable and usable by AI agents through three complementary pathways

---

## Executive Summary

NOEMA is a powerful AI generation infrastructure with multi-platform deployment, on-chain credits, and a comprehensive tool registry system. However, we lack the "open for business" signage that AI agents need to discover and use our services programmatically.

This document investigates three pathways for agent accessibility:
1. **Claude Skill** - Anthropic's Model Context Protocol for Claude-based agents
2. **x402 Payment Protocol** - HTTP-native micropayments for pay-per-request access
3. **ERC-8004 Profile** - Ethereum's trustless agent discovery and reputation standard

Each pathway serves a different dimension of agent usability. The investigation determines optimal implementation order so each phase builds upon accumulated knowledge.

---

## Pathway 1: Claude Skill (MCP Integration)

### What It Is

A Claude Skill is a structured capability definition that enables Claude-based AI agents to understand and interact with external services. Skills are implemented using Anthropic's **Model Context Protocol (MCP)**, which provides:

- **Tool definitions** - Structured schemas describing available operations
- **Resource discovery** - How to explore available capabilities
- **Execution patterns** - How to invoke tools and handle responses
- **Authentication flows** - How to obtain and use credentials

### Relevance to NOEMA

Our existing **ToolRegistry** system already defines tool schemas with:
- Input/output schemas with typed fields
- Cost information per operation
- Delivery modes (immediate/webhook/async)
- Platform hints for different interfaces

This is 80% of what a Claude Skill needs. The gap is:
- **MCP-formatted schema export** - Transform ToolDefinition to MCP format
- **Skill documentation** - Human-readable guidance for the agent
- **Authentication instructions** - How to obtain and use API keys
- **Error handling guidance** - Common failure modes and recovery

### Technical Requirements

```
Effort: Medium
Dependencies: None (builds on existing ToolRegistry)
Output Format: .claude-skill file or MCP server endpoint
```

**Key endpoints to expose via MCP:**
- `GET /api/v1/tools/registry` → Tool discovery
- `POST /api/v1/generation/cast` → Tool execution
- `GET /api/v1/generation/status/:id` → Async result polling
- `GET /api/v1/points` → Credit balance check
- `POST /api/v1/wallets/connect` → Wallet linking flow

### Knowledge Generated

Implementing a Claude Skill forces us to:
1. Document our API from an agent's perspective (not human's)
2. Identify gaps in our current tool schemas
3. Define authentication flows clearly
4. Establish error response conventions

This documentation effort benefits ALL subsequent pathways.

### Current State Assessment

| Requirement | Status | Notes |
|------------|--------|-------|
| Tool schemas exist | YES | ToolRegistry has comprehensive definitions |
| API endpoints documented | PARTIAL | Demo script exists, no OpenAPI spec |
| Auth flow documented | NO | Multiple auth methods, not clearly documented |
| Error codes standardized | NO | Inconsistent error responses |
| MCP format export | NO | Need to implement |

---

## Pathway 2: x402 Payment Protocol

### What It Is

[x402](https://www.x402.org/) is an open payment protocol by Coinbase that enables instant stablecoin micropayments over HTTP. It revives the HTTP 402 "Payment Required" status code for native payment flows.

**Key characteristics:**
- Pay-per-request without subscriptions or accounts
- Stablecoin payments (USDC/USDT) on fast chains (Base, Solana)
- Supports both human and AI agent payers
- Open standard with TypeScript/Go SDKs

### How It Works

```
1. Client → Request resource
2. Server → 402 Payment Required + PaymentRequirements header
3. Client → Signs payment, resends with PAYMENT-SIGNATURE header
4. Server → Verifies via facilitator, fulfills request
```

### Relevance to NOEMA

NOEMA already has sophisticated payment infrastructure:
- **On-chain credit system** - Ethereum deposits mint internal credits
- **Cost calculation** - Per-tool pricing with rate sources
- **Points/economy service** - Balance tracking and deductions

x402 would provide an **alternative payment rail** that:
- Enables anonymous/guest usage without account creation
- Supports AI agents with their own wallets
- Provides real-time micropayments vs. prepaid credits
- Opens access to agents that can't go through our onboarding

### Technical Requirements

```
Effort: High
Dependencies:
  - Understanding of our current payment flows
  - Decision on supported chains (Base? Solana? Both?)
  - Facilitator selection or self-hosting
Output: New middleware layer for 402 responses
```

**Integration points:**
- Middleware to intercept requests and check payment
- Price calculation endpoint for cost estimation
- Facilitator integration for payment verification
- Credit conversion (optional: x402 → internal credits)

### Knowledge Generated

Implementing x402 forces us to:
1. Document our cost model precisely
2. Map tools to specific price points
3. Handle edge cases (refunds, partial payments, failed generations)
4. Consider multi-chain wallet support

This payment documentation benefits the ERC-8004 profile (agents need to know costs).

### Current State Assessment

| Requirement | Status | Notes |
|------------|--------|-------|
| Pricing model exists | YES | CostingModel in ToolDefinition |
| Wallet support | PARTIAL | Ethereum only currently |
| Payment middleware | NO | Would need new implementation |
| Facilitator integration | NO | Need to evaluate options |
| Chain support decision | PENDING | Base is most active for x402 |

### Industry Context

From search results:
- Backed by Cloudflare, AWS, **Anthropic**, Circle, NEAR
- 15M+ transactions across projects
- Anthropic's involvement suggests MCP/Skill + x402 integration is expected

---

## Pathway 3: ERC-8004 Profile (Trustless Agents)

### What It Is

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) is an Ethereum standard that provides on-chain registries for AI agent discovery, reputation, and validation. Created August 2025, currently in draft status.

**Three core registries:**
1. **Identity Registry** - Agent metadata (name, image, capabilities)
2. **Reputation Registry** - Trust scores from interactions
3. **Validation Registry** - Attestation and verification

### What an ERC-8004 Profile Contains

```solidity
// Discoverable information
- Agent name and description
- Service capabilities list
- Communication endpoints (MCP, A2A)
- ENS name
- Wallet address(es)
- Trust model attestations
```

### Relevance to NOEMA

NOEMA could register as a **service provider agent** that:
- Advertises available AI generation tools
- Publishes MCP endpoint for capability discovery
- Accumulates reputation from successful generations
- Integrates with x402 for seamless payment

The profile would make NOEMA discoverable to any agent querying the registry.

### Technical Requirements

```
Effort: Medium-High
Dependencies:
  - MCP endpoint (from Pathway 1)
  - Payment information (from Pathway 2)
  - ENS name (optional but recommended)
  - Decision on chains (Ethereum mainnet? Base? L2?)
Output: Smart contract registration + metadata hosting
```

**Implementation components:**
- Register in Identity Registry with metadata
- Host metadata JSON (IPFS or traditional)
- Implement A2A or MCP endpoint for capability queries
- Optionally: Validation attestation from trusted parties

### Knowledge Generated

Implementing ERC-8004 forces us to:
1. Define our service's canonical identity
2. Choose what capabilities to advertise publicly
3. Decide on trust/reputation participation
4. Maintain on-chain presence

This is the "final" public-facing profile that aggregates Pathways 1 and 2.

### Current State Assessment

| Requirement | Status | Notes |
|------------|--------|-------|
| Ethereum wallet | YES | We have on-chain presence |
| Service metadata | PARTIAL | Need canonical definition |
| MCP/A2A endpoint | NO | Pathway 1 prerequisite |
| ENS name | UNKNOWN | Should check/register |
| Registry contracts | EXTERNAL | Use existing implementations |

### Industry Context

From search results:
- Co-authored by MetaMask, Ethereum Foundation, Google, Coinbase
- "Most popular discussion" for AI agent infrastructure on Ethereum
- Taiko L2 endorses it as core infrastructure
- Complements x402 (same ecosystem, same authors)

---

## Implementation Order Analysis

### Dependency Graph

```
                    ┌─────────────────┐
                    │   ERC-8004      │
                    │   Profile       │
                    └────────┬────────┘
                             │ requires
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │  Claude Skill   │           │    x402         │
    │  (MCP endpoint) │           │  (Payment info) │
    └─────────────────┘           └─────────────────┘
              │                             │
              └──────────────┬──────────────┘
                             │ both benefit from
                             ▼
                    ┌─────────────────┐
                    │  API/Schema     │
                    │  Documentation  │
                    └─────────────────┘
```

### Order Evaluation

**Option A: Skill → x402 → ERC-8004**

| Phase | Rationale |
|-------|-----------|
| 1. Skill | Forces complete API documentation; lowest external dependency; immediate value for Claude agents |
| 2. x402 | Builds on documented API; adds payment layer; requires pricing documentation |
| 3. ERC-8004 | Aggregates skill endpoint + payment info; publishes to chain for discovery |

**Pros:**
- Documentation-first approach reduces rework
- Each phase delivers standalone value
- Natural knowledge accumulation
- Anthropic backing means Skill + x402 likely designed to work together

**Cons:**
- x402 is technically more complex than Skill
- Could parallelize some work

---

**Option B: x402 → Skill → ERC-8004**

| Phase | Rationale |
|-------|-----------|
| 1. x402 | Enables payment immediately; forces pricing documentation |
| 2. Skill | Builds on payment model; combines capability + cost info |
| 3. ERC-8004 | Publishes complete profile |

**Pros:**
- Revenue potential earlier
- Payment-first aligns with "money on the table" framing

**Cons:**
- x402 requires more infrastructure decisions upfront
- Harder to test without clear API documentation
- Risk of building payment for undocumented endpoints

---

**Option C: ERC-8004 → Skill → x402**

Not recommended. ERC-8004 profile is meaningless without:
- An endpoint to discover (MCP/A2A)
- Payment information

---

### Recommendation: Option A (Skill → x402 → ERC-8004)

**Rationale:**

1. **Claude Skill is the foundation** - Forces us to document the API completely, which benefits everything else. Our ToolRegistry is already 80% there.

2. **x402 builds on documentation** - With clear API docs and schemas, implementing payment middleware is cleaner. We know exactly what endpoints to gate.

3. **ERC-8004 is the aggregation layer** - It references the MCP endpoint and advertises payment capabilities. It's the public listing that says "we exist and here's how to interact."

4. **Anthropic alignment** - Anthropic backs both MCP and x402. The protocols are designed to complement each other.

5. **Risk mitigation** - If we discover gaps in our schema during Skill implementation, we fix them before building payment infrastructure on top.

---

## Recommended Implementation Sequence

### Phase 1: Claude Skill (Part 2 of 4-part plan)

**Deliverables:**
- MCP-formatted tool registry export
- Skill documentation with examples
- Authentication flow documentation
- Error code standardization
- Test skill against Claude Code / Claude agents

**Success criteria:**
- A Claude agent can discover our tools via MCP
- A Claude agent can execute a generation with correct auth
- A Claude agent can poll for async results
- A Claude agent can check credit balance

---

### Phase 2: x402 Payment Protocol (Part 3 of 4-part plan)

**Deliverables:**
- x402 middleware for protected endpoints
- Price calculation and PaymentRequirements generation
- Facilitator integration (likely Coinbase's)
- Chain support (recommend Base initially)
- Payment verification and fulfillment flow

**Success criteria:**
- Anonymous agent can pay-per-request via USDC
- Payment failures return appropriate 402 response
- Successful payments execute the tool and return results
- Cost model accurately reflected in PaymentRequirements

---

### Phase 3: ERC-8004 Profile (Part 4 of 4-part plan)

**Deliverables:**
- Identity registration on chosen network(s)
- Metadata JSON with MCP endpoint and payment info
- Optional: ENS name registration
- Documentation for agents querying the registry

**Success criteria:**
- NOEMA is discoverable in ERC-8004 registry
- Profile includes MCP endpoint URL
- Profile includes payment capabilities
- Any ERC-8004-aware agent can discover us

---

## Open Questions to Resolve Before Implementation

### Claude Skill
1. Do we expose all tools or a curated subset?
2. How do we handle tool versioning in MCP?
3. Should we require auth for discovery or just execution?

### x402
1. Which chain(s) to support initially? (Recommend: Base)
2. Self-host facilitator or use Coinbase's?
3. Do x402 payments convert to internal credits or stay separate?
4. How to handle refunds for failed generations?

### ERC-8004
1. Which network to register on? (Mainnet vs L2)
2. Do we want ENS name? (stationthis.eth, noema.eth?)
3. What reputation/validation attestations to pursue?

---

## Decisions Made (2026-02-02)

### Claude Skill
- **Scope:** All tools exposed. Existing `/api/v1/tools` endpoint already serves this publicly with rate limits.
- **Auth model:** Discovery is public (no auth required), execution requires API key.
- **Versioning:** TBD during implementation.

### x402
- **Chain:** Currently on Ethereum mainnet. Willing to deploy credit ledger to Base if x402 ecosystem requires it.
- **Facilitator:** TBD.
- **Credit conversion:** TBD.

### ERC-8004
- **Network:** TBD (will follow x402 chain decision).
- **ENS:** TBD.
- **Attestations:** TBD.

---

## Next Steps

1. **Review this investigation** - Validate assumptions and order recommendation
2. **Resolve open questions** - Make decisions on chains, scope, naming
3. **Begin Phase 1** - Create detailed implementation plan for Claude Skill
4. **Execute sequentially** - Complete each phase before starting next

---

## References

### x402 Protocol
- [x402.org - Official Site](https://www.x402.org/)
- [Coinbase Developer Docs](https://docs.cdp.coinbase.com/x402/welcome)
- [GitHub - coinbase/x402](https://github.com/coinbase/x402)
- [x402 Whitepaper](https://www.x402.org/x402-whitepaper.pdf)
- [Coinbase Introduction](https://www.coinbase.com/developer-platform/discover/launches/x402)

### ERC-8004
- [EIP-8004 Official Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [8004.org - Community Site](https://8004.org/)
- [BuildBear Explainer](https://www.buildbear.io/blog/erc-8004)
- [QuillAudits Analysis](https://www.quillaudits.com/blog/ai-agents/erc-8004)
- [Awesome ERC-8004 Resources](https://github.com/sudeepb02/awesome-erc8004)

### NOEMA Existing Infrastructure
- ToolRegistry: `src/core/tools/ToolRegistry.js`
- Tool Definitions: `src/core/tools/definitions/`
- External API: `src/api/external/`
- Points/Economy: `src/core/services/points/`
- API Demo: `scripts/api-guide-demo.js`
