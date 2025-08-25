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
| `roadmap/`                            | **Source of truth for planning** – master outline, roadmap, feature folders, templates & guides |
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
3. **Start Dev Environment**  
   ```bash
   ./run-dev.sh
   ```  
   This helper script will:  
   • Export all variables from your `.env` into the current shell session  
   • Unlock the keystore’s private key using `KEYSTORE_PASSWORD` (or prompt you interactively)  
   • Launch the app with Nodemon so that code changes hot-reload during development

   • Web UI → http://localhost:4000  
   • Internal API → http://localhost:4000/internal  
   • External API → http://localhost:4000/api/v1  
   The bot signs-in to Telegram/Discord automatically.

---

## 🚢 Production Deployment (DigitalOcean)

We run a single-node instance on a **DigitalOcean Droplet** with the following spec:

| Image | Size (vCPU / RAM / Disk) | Region | Example Public IP |
|-------|--------------------------|--------|-------------------|
| Ubuntu Docker 22.04 | 1 vCPU, 1 GB, 25 GB SSD<br/>($6 / mo) | `NYC1` | _(assigned on creation)_

Steps to deploy a fresh droplet:

1. **Create Droplet** – choose the *Docker on Ubuntu 22.04* Marketplace image and the specs above. Enable IPv4 (mandatory), IPv6 / VPC networking if required.
2. **SSH in**
   ```bash
   ssh root@<DROPLET_IP>
   ```
3. **Install Git & clone repo**
   ```bash
   apt update && apt install -y git
   git clone https://github.com/<your-org>/stationthis.git
   cd stationthis
   ```
4. **Prepare secrets**
   • Copy your `.env` to the droplet (e.g. `scp .env root@<DROPLET_IP>:~/stationthis/`).  
   • Copy the `keystore.json` file referenced by `ETHEREUM_KEYSTORE_PATH`.  
   • Ensure `KEYSTORE_PASSWORD` is present in the `.env`.
5. **Deploy**
   ```bash
   ./deploy.sh
   ```
   The script builds a production Docker image, runs database migrations (if any) and starts the container in detached mode.
6. **Update / Redeploy**
   ```bash
   git pull
   ./deploy.sh
   ```
   The existing container is replaced with an updated image with zero downtime.

### Reverse Proxy & TLS with Caddy

The droplet runs an **edge Caddy server** (installed via the [official script](https://caddyserver.com/docs/install#debian-ubuntu) or Docker). Caddy automatically provisions free Let’s Encrypt certificates and forwards traffic to the app container.

1. Ensure DNS `A/AAAA` records for your domain point to the droplet IP.
2. Place a `Caddyfile` in `/etc/caddy/Caddyfile` (or the repo root if using Docker) similar to:

```Caddyfile
yourdomain.com, www.yourdomain.com {
    encode zstd gzip
    reverse_proxy hyperbot:4000
    log {
        output file /var/log/caddy/access.log
    }
}
```

3. Reload Caddy after any change:
```bash
sudo systemctl reload caddy
```

With Caddy in front, your app is served over HTTPS at `https://yourdomain.com`.

### Firewall Hardening (Recommended)

For defence-in-depth you should also restrict inbound traffic at the droplet or Cloud-Firewall layer so only the services you actually expose are reachable.

| Protocol | Port | Source | Purpose |
|----------|------|--------|---------|
| TCP | **22** | _Your workstation(s) only_ | SSH administration |
| TCP | **80** | `0.0.0.0/0`, `::/0` | HTTP → Caddy |
| TCP | **443** | `0.0.0.0/0`, `::/0` | HTTPS → Caddy |

DigitalOcean makes this easy via **Networking → Firewalls → Create**:

1. Add a new rule set with the table above.
2. Attach the firewall to your droplet.

Finding “your workstation IP”

```bash
curl -s https://ifconfig.me
# or
dig +short myip.opendns.com @resolver1.opendns.com
```

If you commonly connect from several places, create multiple rules (one per public IP). For a small office range you might use a CIDR like `203.0.113.0/28`.

This complements the container-level hardening already provided by `deploy.sh` (`--cap-drop ALL`, `--security-opt no-new-privileges`, private Docker network with no published ports).

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

We follow the collaborative rules in **`roadmap/_guides/AGENT_COLLABORATION_PROTOCOL_v3.md`**.

All pull-requests **must**:

1. Start the title with `[roadmap:<epic>/<module>]` (see PR template).
2. Update the relevant module row in `roadmap/master-outline.md`.
3. Append notes to the Implementation Log of any affected ADR (or create a new ADR using the template).
4. Create a Handoff file in the current sprint folder summarising work.

Refer to `roadmap/_guides/WORKFLOW_DECISION_TREE.md` for a quick decision flow (small fix vs large feature).

---

## vpl License

StationThis is released under the vpl License – see `LICENSE` for details.
