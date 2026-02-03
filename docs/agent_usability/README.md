# Agent Usability Documentation

This directory contains the documentation and implementation plans for making NOEMA discoverable and usable by AI agents.

## Mission

Enable AI agents to discover, authenticate, pay for, and use NOEMA's AI generation services without human intervention.

## Documents

| Document | Status | Description |
|----------|--------|-------------|
| [00-investigation.md](./00-investigation.md) | COMPLETE | Analysis of three pathways and implementation order |
| [01-documentation-improvements.md](./01-documentation-improvements.md) | TODO | Required tool/LoRA documentation updates |
| [REMEDIATION-TRACKER.md](./REMEDIATION-TRACKER.md) | ACTIVE | Track progress on documentation remediation |
| [claude-skill/](./claude-skill/) | DRAFT | Phase 1: Claude Skill files |
| [02-x402-implementation.md](./02-x402-implementation.md) | PLANNED | Phase 2: x402 payment protocol integration |
| [03-erc8004-implementation.md](./03-erc8004-implementation.md) | PLANNED | Phase 3: ERC-8004 registry profile |

## Agent Prompts

Located in `prompts/` directory - copy/paste into dedicated conversations:

| Prompt | Purpose |
|--------|---------|
| [x402-implementation-officer.md](./prompts/x402-implementation-officer.md) | Deep dive x402 implementation |
| [erc8004-implementation-officer.md](./prompts/erc8004-implementation-officer.md) | Deep dive ERC-8004 registration |

---

## Claude Skill (Phase 1)

Located in `claude-skill/` directory:

| File | Purpose |
|------|---------|
| `Skill.md` | Main skill file with metadata and instructions |
| `API-REFERENCE.md` | Complete endpoint documentation |
| `TRIGGER-WORDS.md` | Guide to LoRA trigger word system |
| `TOOLS.md` | Tool capabilities and selection guide |

## Implementation Order

```
Phase 1: Claude Skill    → Documents API, creates MCP endpoint
Phase 2: x402 Payment    → Adds payment rail, enables pay-per-request
Phase 3: ERC-8004        → Publishes discoverable profile to chain
```

## Key Decision

**Order: Skill → x402 → ERC-8004**

Rationale: Each phase builds on accumulated documentation and infrastructure from the previous phase. Claude Skill forces API documentation, x402 builds on documented endpoints, ERC-8004 aggregates both into a discoverable profile.
