# StationThis ⛵ – Real-Time Cross-Platform AI Studio

> Next-gen creative tooling that lets users generate, remix & monetise media across **Telegram**, **Discord** and a rich **Web Canvas** – all powered by ComfyUI Deploy, on-chain credits and an extensible Tool Registry.

---

## ✨ Key Features

• One codebase → three front-ends (Telegram Bot, Discord Bot, Web Sandbox).  
• Unified **Internal / External REST API** exposing core capabilities.  
• Pluggable **ToolDefinition & ToolRegistry** system – add new AI workflows with JSON only.  
• **WorkflowExecutionService** orchestrates sync, webhook & poll execution strategies.  
• On-chain **CreditService** (Ethereum) with price feeds, NFT valuation & risk engine.  
• Real-time notifications via WebSockets & platform notifiers.  
• Modular **Core Services** layer: ComfyUI, Points, Media, Sessions, Storage, OpenAI, Analytics, …  
• Resilient startup sequence – continues even if optional services are offline.

---

## 🏆 Unique Selling Points

• **Crypto-centric AI Service Aggregator** – unify cutting-edge AI models with on-chain credit accounts, token-gated access and immutable blockchain audit trails in a single pipeline.

• **Referral Vault & Incentivised Innovation** – earn Credits for inviting new users; build custom workflows, contribute training data or fine-tune models and get rewarded automatically. The result is a powerful community-driven flywheel for new tools, datasets and revenue streams.

• **NFT Creation Flywheel / Independent AI Lab** – one-click minting pipelines transform generated media into ERC-721 collections, letting any user spin-up an independent AI studio that monetises art without leaving the platform.

• **Uncensored by Default** – StationThis does not impose upstream model moderation. We champion creative freedom while respecting legal boundaries in your jurisdiction.

---

## ⚠️ Privacy & Security Disclaimer

StationThis is currently in public beta. While HTTPS, credential encryption and strict access controls are in place, data is **not yet end-to-end encrypted** and some storage components run in shared cloud infrastructure. Private prompts, models or media you upload could theoretically be accessed by platform operators or cloud providers.

Delivering zero-knowledge storage and client-side encryption is our **next top engineering priority**. Until this ships, please avoid storing highly-sensitive or regulated data on StationThis.

---

## 🏗️ High-Level Architecture

```mermaid
flowchart TD
    subgraph Client Platforms
        TG["Telegram Bot"]
        DC["Discord Bot"]
        WEB["Web Canvas / SPA"]
    end

    TG ---|REST / WebSocket| API
    DC ---|REST / WebSocket| API
    WEB ---|REST / WebSocket| API

    subgraph API Layer
        INT["Internal API (auth required)"]
        EXT["External API (public endpoints)"]
    end

    INT <---> SVC["Core Services"]
    EXT --> SVC

    subgraph Core Services
        COMFY(ComfyUIService)
        WF(WorkflowsService)
        EXEC(WorkflowExecutionService)
        POINTS(PointsService)
        MEDIA(MediaService)
        OPENAI(OpenAIService)
        STORAGE(StorageService)
        CREDIT(CreditService)
        UTILS(ToolRegistry\nUserSettingsService)
    end

    SVC --> DB[(Mongo / R2)]
    CREDIT <---> ETH[(Ethereum)]
```

---

## 📂 Repository Layout

| Path                                   | Purpose |
|----------------------------------------|---------|
| `app.js`                               | Application entry – initialises DB, Core Services, Platforms & WebSocket server |
| `src/core/`                             | Platform-agnostic services, init logic & dependency injection |
| `src/platforms/`                        | Adapters for Telegram, Discord & Web (Express) |
| `src/api/`                              | Internal & External API routers (mounted by `app.js`) |
| `src/workflows/`                        | Platform-agnostic business workflows |
| `public/`                               | Web frontend assets (static HTML/CSS/JS) |
| `docs/`, `vibecode/`, `reports/`        | ADRs, hand-offs, audits & project planning artifacts |
| `archive/`                              | Legacy implementation kept for reference |

---

## 🚀 Quick Start (Local Dev)

1. **Install deps**
   ```bash
   npm install
   ```
2. **Create `.env`** – copy `.env-example` and fill required keys:
   ```env
   TELEGRAM_TOKEN=xxxx
   DISCORD_TOKEN=xxxx
   INTERNAL_API_KEY_SYSTEM=super-secret
   ETHEREUM_RPC_URL=https://...
   ETHEREUM_SIGNER_PRIVATE_KEY=0x...
   MONGO_PASS=mongodb+srv://user:pass@cluster/db
   ```
3. **Run**
   ```bash
   node app.js
   ```
   • Web UI → http://localhost:4000  
   • Internal API → http://localhost:4000/internal  
   • External API → http://localhost:4000/api/v1  
   The bot signs-in to Telegram/Discord automatically.


## 🛠  Adding a New Tool

1. Create a `ToolDefinition` JSON describing inputs, outputs, cost & executionStrategy.  
2. Drop it into `src/core/tools/definitions/` (or register dynamically).  
3. Restart the app → ToolRegistry auto-loads and:
   • Generates Telegram `/command`  
   • Appears in Web Canvas sidebar  
   • Exposed via `/api/v1/tools/registry` endpoint.

See `ADR-004-ToolRegistry` for full schema.

---

## 🧪 Testing & QA



coming...

---

## 🤝 Contributing

We follow the collaborative rules in **`AGENT_COLLABORATION_PROTOCOL.md`**. All changes must include:


• Updated docs / ADR where architecture changes occur.  
• A handoff entry in `vibecode/handoffs/` summarising work.  

---

## vpl License

StationThis is released under the vpl License – see `LICENSE` for details.
