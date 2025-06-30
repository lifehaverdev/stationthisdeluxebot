# ADR-009: Tool Definition and Tool Registry Architecture

## Status
Accepted

## Context

StationThis integrates multiple AI services, with `comfyui-deploy` as its flagship engine for executing custom workflows. These workflows, as well as operations from external providers like Vidu and Tripo, can be abstracted into callable units we refer to as **tools**.

Each tool represents a distinct, user-triggerable operation: image generation, inpainting, background removal, text-to-video synthesis, etc.

Thus far, integrations have been developed directly and specifically. The goal now is to **generalize and formalize** a pattern for describing tools and managing them across all services and platforms.

## Decision

We will adopt a unified `ToolDefinition` format and create a centralized `ToolRegistry` to serve all layers of the application—internal API, platform adapters, user preferences, billing, agentic interaction, and documentation.

---

## ✅ ToolDefinition

Each tool is a structured object describing:
- What the tool does
- How it should be invoked
- What inputs it requires
- How much it costs
- How platforms should interface with it

### 📦 Full Schema (Initial Spec)

```ts
type ToolDefinition = {
  toolId: string             // system-unique, e.g., 'fluxgeneral'
  service: string            // source of tool, e.g., 'comfyui', 'vidu'
  displayName: string        // user-facing name
  description?: string       // a full agent-readable description of purpose, use, and behavior
  commandName?: string       // e.g., '/fluxgeneral' for Telegram
  apiPath?: string           // internal or external route, e.g., '/api/internal/run/fluxgeneral'

  inputSchema: Record<string, InputField>
  outputSchema?: Record<string, OutputField>

  costingModel?: CostingModel
  webhookStrategy?: WebhookConfig

  platformHints?: PlatformHints

  metadata?: Record<string, any>
}
```

```ts
type InputField = {
  name: string
  type: 'string' | 'number' | 'image' | 'video' | 'audio' | 'file' | 'boolean'
  required: boolean
  default?: any
  description?: string
  advanced?: boolean         // used to group parameters in UI
}
```
```ts
type CostingModel = {
  rate: number               // e.g., 0.000337 USD per unit
  unit: 'second' | 'token' | 'request'
  rateSource: 'static' | 'machine' | 'api'
}
```
```
type CostingModel = {
  rate: number               // e.g., 0.000337 USD per unit
  unit: 'second' | 'token' | 'request'
  rateSource: 'static' | 'machine' | 'api'
}
```
```ts
type WebhookConfig = {
  expectedStatusField: string
  successValue: string
  durationTracking: boolean
  resultPath?: string[]      // JSON path to output artifact (e.g., image URL)
}
```
```ts
type PlatformHints = {
  primaryInput: 'text' | 'image' | 'video' | 'audio' | 'file'
  supportsFileCaption: boolean   // e.g., Telegram: attach file, type in caption
  supportsReplyWithCommand: boolean
}
```

###✅ ToolRegistry
A singleton service that:

Loads ToolDefinitions from all integrated services

Provides lookup methods for command routing, UI building, and API endpoint exposure

Will eventually support hot reloading or static flash write

API:
```ts
ToolRegistry.getAll(): ToolDefinition[]
ToolRegistry.getById(toolId): ToolDefinition
ToolRegistry.findByCommand(command): ToolDefinition
```
It acts as the source of truth for platform commands, available endpoints, pricing interfaces, and preferences UI scaffolding.

###✨ Features & Enhancements
##1. 🔍 Auto-parsed Descriptions (Agent-Readable)
ComfyUI workflows can be parsed for their embedded Note nodes. These will be used to populate the description field in a natural-language style that explains:

The purpose of the workflow

What inputs are expected

Common use cases

This empowers:

Agent-assisted tool selection

Better platform help menus

Accurate LLM guidance and completion
##2. 🧠 Preference Mapping
Each tool has well-defined input parameters (text, cfg, width, etc.), which will be used:

To generate per-user persistent preferences

To build /settings interfaces that are specific to that tool

To define UI hints like "advanced" vs "basic" inputs

This schema enables LLMs or frontend agents to dynamically render input menus and offer smart defaults or suggestions.
##🗂 Flash Writable
We will provide a dev utility (tools/flashToolRegistry.js) that writes the current dynamic registry to a static file (tool_registry.generated.json or tool_defs/fluxgeneral.json) during deploy.

This:

Documents the active system state for tooling and inspection

Enables offline development and pre-rendered docs

Can be embedded into website generation, chatbot memory, etc.
##4. 🧩 Dynamic Command & Input UX Support
By specifying primaryInput and platformHints, the system can:

Choose correct Telegram UX (e.g., caption vs reply mode)

Configure Discord or Web forms appropriately

Auto-generate command handler stubs or autocomplete


###Consequences

✅ Benefits
One consistent interface for tool exposure

Simplifies onboarding of new services

Standardizes cost tracking and billing flow

Enables adaptive interfaces and agent collaboration

Reduces risk of coupling or duplication across platforms

❗ Tradeoffs
Needs frequent sync between registry and source services (e.g., if workflows change)

Agent and UI code must tolerate incomplete definitions during bootstrapping

Webhook formats will need ongoing mapping as service APIs evolve

Open Questions
Should ToolDefinition include versioning or change tracking?

How do we signal deprecated or unavailable tools?

Do we want internal-only vs public tools distinction in the schema?

Next Steps
Add ToolRegistry class and draft comfyui-deploy loader

Refactor Telegram/Web adapters to pull from ToolRegistry

Create a tools/flashToolRegistry.js utility

Explore Note node parsing and dynamic description hydration

Implement /settings menus that query a tool’s inputSchema