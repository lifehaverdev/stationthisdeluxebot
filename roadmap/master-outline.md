# Master Outline

This document captures StationThis’s enduring architecture, principles, and cross-feature interactions.

## Architecture Principles

vanilla javascript, minimal usage of libraries, no-react, no-tailwind css

noema (powered by stationthis) is a crypto-bootstrapped independent ai lab. This application is the interface for the world to interact with and support our project by using it and sharing it.

simplicity, open sourced, privacy, anonymoty, cypherpunk, milady: these are our ideals.

## Feature Map

---

### stationthisbot
##### Status
Planned
#### Description
Telegram and Discord interface for the application; must achieve full feature parity with the web platform.

---

### noema.art web platform
##### Status
Planned
#### Description
Infinite canvas workspace to combine tools, mint spells, create NFT collections, share creations, and orchestrate workflows.

---

### toolRegistry
##### Status
Planned
#### Description
Modular integration layer for 3rd-party AI services, enabling rapid onboarding of new tools for users.

---

### api
##### Status
Planned
#### Description
Public and internal API exposing all functionality available via web platform and bots so agents and external developers can automate StationThis.

---

### comfyuideployservice
##### Status
Operational
#### Description
Service wrapper for ComfyUI providing API-based image generation using custom-trained models; cornerstone of our generation stack.

---

### loraModelsystem
##### Status
Operational
#### Description
User-facing system for stacking Low Rank Adaptation (LoRA) models to customize outputs and share presets.

---

### LoraTrainingSystem
##### Status
Planned
#### Description
Pipeline that accepts ~20 user images, trains a new LoRA model, and registers it in the ComfyUI service.

## Epic & Module Breakdown

### Sandbox Node Editor (Epic)
| Module | Status | Source Docs |
|--------|--------|------------|
| Node Creation | Completed | maps/1-node-creation.md |
| Node Connection | Completed | maps/2-node-connection.md |
| Parameter Mapping | In Progress | maps/3-parameter-mapping.md |
| Subgraph Minting | Planned | maps/4-subgraph-minting.md |
| Workspace Save/Load | In Progress | maps/5-workspace-save-load.md |
| Execution Cost Estimation | Planned | maps/6-execution-cost.md |
| Visual Cues & UX | In Progress | maps/7-visual-cues.md, HANDOFF-2025-07-11-sandbox-ui-ux-improvements.md |
| Undo / Redo | Planned | maps/8-undo-redo.md |

---

### Authentication & Account Experience (Epic)
| Module | Status | Source Docs |
|--------|--------|------------|
| HTTP-Only Cookie Auth | Completed | ADR-2025-07-02-http-only-cookie-auth.md |
| Referral Link Handling | Completed | ADR-2024-07-18-referral-link-handling.md |
| Account Dropdown UI | Completed | HANDOFF-2025-07-01-SANDBOX-UI.md, HANDOFF-2025-07-03-account-dropdown.md |
| Buy Points Modal | Completed | HANDOFF-2025-07-03-buy-points-modal.md |
| Points Crediting Fixes | Completed | HANDOFF-2025-07-09-* |

---

### Generation Execution System (Epic)
| Module | Status | Source Docs |
|--------|--------|------------|
| Centralized Execution Refactor | Completed | ADR-2025-07-03-centralized-generation-execution.md |
| Spell Execution Page | Completed | ADR-2025-07-30-spell-execution-page.md |
| Mods Menu & Model Browser | Completed | ADR-2025-08-01-mods-menu-model-browser.md |
| Collection Cook Mode Redesign | In Progress | ADR-2025-08-05-collection-cook-mode-redesign.md |
|| Generation Output DB Audit & Refactor | Planned | generation-output-db-audit/outline.md |

---

### API & Route Management (Epic)
| Module | Status | Source Docs |
|--------|--------|------------|
| API Dependency Injection | Completed | ADR-2024-07-20-api-dependency-injection-refactor.md |
| Route Refactor v2 | Completed | ADR-2025-07-01-api-route-refactor.md |
| API Refactor v3 | Planned | ADR-2025-08-05-api-refactor |

---

### Real-Time & WebSocket Services (Epic)
| Module | Status | Source Docs |
|--------|--------|------------|
| WebSocket Realtime Updates | Completed | HANDOFF-2025-07-10-websocket-realtime.md |
| Salt Mining Fix | Completed | HANDOFF-2025-07-16-fix-salt-mining.md |

---

### NFT Collection Creation (Epic)
| Module | Status | Source Docs |
|--------|--------|------------|
| Canvas Minting Workflow | Planned | (to be defined) |
| Telegram Cook Command | Planned | ADR TBD |
| Discord Cook Workflow | Planned | ADR TBD |

_Add new epics/modules below as they are formalized._

### Telegram Bot Platform (Epic)
| Module | Status | Source Path |
|--------|--------|-------------|
| Command Framework | Operational | src/platforms/telegram/commands/ |
| Menu Managers (Dashboard / Mods / Settings / Spell / Training) | Operational | src/platforms/telegram/components/ |
| Delivery Menu Workflow | Operational | src/platforms/telegram/components/deliveryMenu/ |
| Dynamic Commands Loader | Operational | src/platforms/telegram/dynamicCommands.js |
| Media Adapter | Operational | src/platforms/telegram/mediaAdapter.js |
| Admin Utilities | Operational | src/platforms/telegram/components/adminManager.js |
| Notifier / Messaging Utils | Operational | src/platforms/telegram/telegramNotifier.js, utils/ |

---

### Discord Bot Platform (Epic)
| Module | Status | Source Path |
|--------|--------|-------------|
| Command Framework | Operational | src/platforms/discord/commands/ |
| Media Adapter | Operational | src/platforms/discord/mediaAdapter.js |
| Notifier | Planned | (TBD) |

---

### Web Frontend Components (Epic)
| Module | Status | Source Path |
|--------|--------|-------------|
| Account Dropdown | Completed | src/platforms/web/client/src/sandbox/components/accountDropdown.js |
| Buy Points Modal | Completed | sandbox/components/BuyPointsModal/ |
| Mods Menu Modal | Completed | sandbox/components/ModsMenuModal.js |
| Cook Menu Modal | In Progress | sandbox/components/CookMenuModal.js |
| Referral Vault Dashboard | In Progress | sandbox/components/ReferralVaultDashboardModal/ |
| Onboarding Tour | Completed | sandbox/onboarding/ |
| Trait Tree Editor | Planned | sandbox/components/TraitTreeEditor.js |

---

### Middleware & Security (Epic)
| Module | Status | Source Path |
|--------|--------|-------------|
| Auth Middleware | Completed | src/platforms/web/middleware/auth.js |
| CSRF Protection | Completed | src/platforms/web/middleware/csrf.js |
| Referral Link Handler | Completed | src/platforms/web/middleware/referralHandler.js |

---

### Core Utils & Services (Epic)
| Module | Status | Source Path |
|--------|--------|-------------|
| Execution Client | Operational | sandbox/executionClient.js |
| WebSocket Handlers | Operational | sandbox/node/websocketHandlers.js |
| State Management | Operational | sandbox/state.js |
| Tool Selection Logic | Operational | sandbox/toolSelection.js |
| API Config & Server Entry | Operational | src/index.js, src/config.js |

---

### Database & Persistence (Epic)
| Module | Status | Source Path |
|--------|--------|-------------|
| DB Models | Operational | src/db/ (various) |
| Workflow Save/Load | In Progress | maps/5-workspace-save-load.md, sandbox/subgraph.js |

---

### Payment & Credits (Epic)
| Module | Status | Source Docs / Path |
|--------|--------|--------------------|
| Points Purchase Flow | Completed | Buy Points Modal, HANDOFF-2025-07-03-buy-points-modal.md |
| Chain-Aware Modal & Token Config | Completed | HANDOFF-2025-08-26-chain-aware-modal.md |
| Credit Checking Pre-execution | Completed | HANDOFF-2024-07-10-pre-execution-credit-check.md |
| Referral Vault System | Operational | sandbox/components/ReferralVault* |

---

### Model Training & Registry (Epic)
| Module | Status | Source Docs / Path |
|--------|--------|--------------------|
| LoRA Training Pipeline | Planned | LoraTrainingSystem (backend) |
| Model Registry Interface | Operational | toolRegistry via ADR TBD |
| Upscale & Train Commands (Discord) | Operational | discord/commands/upscaleCommand.js, trainModelCommand.js |

---

### dedicated-spell-page
##### Status
In Progress
#### Description
Public spell execution page with payment & share features.

---

### collection-cook-mode
##### Status
In Progress
#### Description
Event-sourced NFT collection generator with cross-platform UI.

---

### cloudflare-upload
##### Status
Planned
#### Description
Secure, private file uploads & CDN delivery via Cloudflare R2.

### Onboarding Experience (Epic)
| Module | Status | Source Docs |
|--------|--------|------------|
| Web Onboarding Redesign | In Progress | onboarding-experience/adr/ADR-2025-08-26-onboarding-redesign.md |

