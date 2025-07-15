## Kickoff Prompt

> You are entering the Subgraph Selection & Minting project for the StationThis Sandbox Node Editor.
> 
> - **Purpose:** Enable users to select a group of connected nodes (subgraph) and mint/save them as a reusable spell in the sandbox editor.
> - **Start by:** Reviewing the codebase audit section below, reading the [Master Plan](./SANDBOX_NODE_EDITOR_MASTER_PLAN.md), and checking the latest handoff.
> - **Protocol:** Follow the [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) for all work, including documentation and demonstration requirements.
> 
> Please begin by auditing the current codebase for all relevant files, functions, and architectural constraints related to this feature.

# Subgraph Selection & Minting Feature

## Purpose
Enable users to select a group of connected nodes (subgraph) and mint/save them as a reusable spell in the sandbox editor.

## Step 1: Codebase Audit

- [ ] List all files and functions related to node selection, subgraph logic, and spell minting.
- [ ] Document current state of selection and minting UI.
- [ ] Identify any blockers or architectural constraints.

## Step 2: Design

- [ ] Define data structures for subgraph selection and spell metadata.
- [ ] UI/UX sketches for selection, minting, and metadata entry.
- [ ] Error handling (invalid subgraphs, incomplete metadata).

## Step 3: Implementation

- [ ] Implement multi-select and subgraph selection logic.
- [ ] Implement "mint as spell" UI and backend integration.
- [ ] Update state management for spells.

## Step 4: Demo & Handoff

- [ ] Create a Playwright or screen recording demo.
- [ ] Update master plan and handoff doc.

## Links

- [Back to Master Plan](./SANDBOX_NODE_EDITOR_MASTER_PLAN.md)
- [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) 

---

## Codebase Audit Findings (2024-07-09)

### 1. Node Selection & Subgraph Logic
- **Node Representation & State:**
  - Nodes are represented as "tool windows" (`toolWindow.js`), each with a unique ID, position, tool definition, and parameter mappings.
  - Connections between nodes are managed via parameter mappings, where a parameter can be mapped to the output of another node.
- **Connection Management:**
  - Connection creation, validation, and management are handled in `connections/interaction.js`, `connections/manager.js`, and `connections/validation.js`.
  - The function `getNodeExecutionOrder` in `toolWindow.js` traverses dependencies, which is similar to subgraph traversal.
- **Selection UI:**
  - There is currently no explicit multi-select or subgraph selection UI. Node selection is implicit via interactions (e.g., clicking, dragging, connecting).

### 2. Spell Minting & Spells Menu
- **SpellsMenuModal (`components/SpellsMenuModal.js`):**
  - Handles the UI for creating, editing, and listing spells.
  - Spells have metadata (name, description) and a list of steps (nodes/tools).
  - Spell creation currently appears to be manual (form-based), not via subgraph selection.
- **Spell Saving:**
  - Spells are saved via API calls (`/api/v1/spells/`), with CSRF protection.
  - There is logic for checking duplicate names and updating spell metadata.

### 3. Architectural Constraints & Opportunities
- **State Management:**
  - All node and connection state is managed in a central state module (`state.js`), which is imported throughout the sandbox code.
- **Extensibility:**
  - The modular structure (nodes, connections, spells) is conducive to adding subgraph selection and minting.
- **Blockers:**
  - No existing multi-select or subgraph selection logic.
  - No direct way to "mint" a selected subgraph as a spell from the editor UI.

### Next Steps
1. **Design & Implement Subgraph Selection:**
   - Add UI for multi-selecting nodes (e.g., shift+click, lasso, or context menu).
   - Implement logic to extract the subgraph (selected nodes + their connections).
2. **Integrate with Spell Minting:**
   - Add a "Mint as Spell" action for the selected subgraph.
   - Pre-fill the spell creation modal with the subgraph's nodes and connections.
3. **Update State & API:**
   - Ensure the selected subgraph can be serialized and sent to the backend as a new spell.

--- 