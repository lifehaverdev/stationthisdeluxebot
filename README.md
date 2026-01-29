# NOEMA (stationthisbot)

Self-hosted AI generation infrastructure with on-chain credit system. Deploy AI tools across Telegram, Discord, and Web from a single codebase.

---

## Features

- **Multi-platform deployment** – Telegram bot, Discord bot, and Web interface from one codebase
- **Tool Registry** – Add new AI workflows via JSON definitions, auto-generates commands and UI
- **On-chain credits** – Ethereum-based credit system with deposits, spending, and price feeds
- **ComfyUI integration** – Orchestrates ComfyUI workflows with sync, webhook, and polling strategies
- **Real-time updates** – WebSocket notifications for generation progress and completion
- **LoRA resolution** – Automatic trigger word detection and model loading
- **User training** – Fine-tune models on user-provided datasets via VastAI
- **Modular services** – Points, Media, Storage, Analytics, and more

---

## Privacy

NOEMA is in active development. Data is stored in MongoDB and cloud storage. End-to-end encryption is not yet implemented.

---

## Quick Start (Local Development)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment** – Copy `.env-example` to `.env` and fill in:
   ```env
   TELEGRAM_TOKEN=your_telegram_bot_token
   DISCORD_TOKEN=your_discord_bot_token
   INTERNAL_API_KEY_SYSTEM=your_secret_key
   ETHEREUM_RPC_URL=https://your-rpc-endpoint
   ETHEREUM_SIGNER_PRIVATE_KEY=0x...
   MONGO_PASS=mongodb+srv://user:pass@cluster/db
   ```

3. **Start development server**
   ```bash
   ./deploy.sh  # or use scripts/run-dev.sh for hot-reload
   ```

4. **Access the application**
   - Web UI: http://localhost:4000
   - Internal API: http://localhost:4000/internal/v1
   - External API: http://localhost:4000/api/v1

Telegram and Discord bots connect automatically when tokens are configured.

---

## Production Deployment

NOEMA runs on a single Docker container with Caddy as reverse proxy.

### Server Requirements

Tested on DigitalOcean Droplet:
- Ubuntu 22.04 with Docker
- 1 vCPU, 1 GB RAM, 25 GB SSD ($6/mo)
- Swap required for builds (see below)

### Deployment Steps

1. **SSH into server**
   ```bash
   ssh root@your-server-ip
   ```

2. **Clone and configure**
   ```bash
   git clone https://github.com/your-org/stationthisdeluxebot.git
   cd stationthisdeluxebot
   # Copy .env file with production credentials
   ```

3. **Deploy**
   ```bash
   ./deploy.sh
   ```

4. **Update**
   ```bash
   git pull && ./deploy.sh
   ```

### Swap Configuration (Required for 1GB RAM)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Caddy Reverse Proxy

Configure `/etc/caddy/Caddyfile`:

```
yourdomain.com {
    encode zstd gzip
    reverse_proxy hyperbot:4000
}
```

Reload after changes:
```bash
sudo systemctl reload caddy
```

### Firewall

Recommended inbound rules:

| Port | Source | Purpose |
|------|--------|---------|
| 22 | Your IP only | SSH |
| 80 | 0.0.0.0/0 | HTTP (Caddy redirect) |
| 443 | 0.0.0.0/0 | HTTPS |

---

## Adding Tools

1. Create a tool definition JSON in `src/core/tools/definitions/`
2. Restart the application
3. Tool appears in:
   - Telegram as `/command`
   - Discord as slash command
   - Web UI in tool sidebar
   - API at `/api/v1/tools/registry`

See existing definitions for schema examples.

---

## Contributing

We're open to contributions. Fork the repo, make changes, and submit a pull request with a clear description of what you've changed.

---

## License

NOEMA is released under the VPL License. See `LICENSE` for details.
