## Kickoff Prompt

> You are entering the Parameter Mapping project for the StationThis Sandbox Node Editor.
> 
> - **Purpose:** Allow users to map node parameters to static values, spell inputs, or outputs from other nodes in the sandbox editor.
> - **Start by:** Reviewing the codebase audit section below, reading the [Master Plan](./SANDBOX_NODE_EDITOR_MASTER_PLAN.md), and checking the latest handoff.
> - **Protocol:** Follow the [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) for all work, including documentation and demonstration requirements.
> 
> Please begin by auditing the current codebase for all relevant files, functions, and architectural constraints related to this feature.

# Parameter Mapping Feature

## Purpose
Allow users to map node parameters to static values, spell inputs, or outputs from other nodes in the sandbox editor.

## Step 1: Codebase Audit

- [ ] List all files and functions related to parameter input, mapping UI, and state management.
- [ ] Document current state of parameter editing and mapping.
- [ ] Identify any blockers or architectural constraints.

### Codebase Audit Findings

#### Files & Functions Related to Parameter Input, Mapping UI, and State Management

- **Parameter Input & Editing (UI & Logic)**
  - `src/platforms/web/client/src/sandbox/node.js`
    - `createToolWindow(tool, position, id, output)`: Renders node/tool window, including parameter input fields.
    - `createParameterSection(params, className)`: Renders required/optional parameter sections.
    - `createParameterInput(param)`: Renders a single parameter input field (currently only static value input).

- **Node Connections (for mapping outputs between nodes)**
  - `src/platforms/web/client/src/sandbox/connections.js`
    - `startConnection(event, outputType, fromWindow)`: Handles drawing connections between node outputs and inputs.
    - `createPermanentConnection(fromWindow, toWindow, outputType)`: Persists a connection between nodes.
    - `renderAllConnections()`: Renders all visual connections.

- **State Management**
  - `src/platforms/web/client/src/sandbox/state.js`
    - `connections`: Array of connection objects (source, target, type, etc.).
    - `activeToolWindows`: Array of open node/tool windows and their state.
    - `persistState()`: Persists connections and tool window state to localStorage.

- **Parameter Type/Schema Utilities**
  - `src/platforms/web/client/src/sandbox/utils.js`
    - `getToolInputTypes(tool)`: Determines input types for a tool based on its schema.

- **Other Relevant Files**
  - `src/platforms/web/client/src/sandbox/toolSelection.js`: Tool selection and sidebar logic.
  - `src/platforms/web/client/src/sandbox/index.js`: Sandbox initialization, window/canvas management.
  - `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`: Spell management UI (may be relevant for mapping to spell inputs).

#### Current State of Parameter Editing & Mapping

- Parameters are rendered as input fields (text/number) in each node window.
- Only static values can be entered; there is no UI for mapping to spell inputs or outputs from other nodes.
- Node-to-node connections exist visually and in state, but these are for output-to-input data flow, not for mapping individual parameters.
- There is no UI or data structure for mapping a parameter to a spell input or another node’s output.

#### Blockers & Architectural Constraints

- No existing UI for selecting mapping type (static, spell input, node output) for parameters.
- No data structure in state for parameter mappings (only for node connections).
- Parameter input fields are not aware of or connected to the node connection system.
- Node windows and parameters are dynamically generated from tool schemas.
- Connections are managed globally in state.js and rendered visually, but not tied to parameter fields.
- Any mapping UI/logic must integrate with both the parameter input rendering and the connection system.

### Parameter Mapping Design

#### Philosophy & Rationale
Parameter mapping is about making the data flow between nodes explicit, flexible, and visual—while keeping the UI as simple as possible for the user. The goal is to:
- Make data flow explicit and visual through anchor connections.
- Let users override with static values when no connection is present.
- Keep the main window uncluttered; advanced/numeric params are in “Show More.”
- Reduce cognitive load—no unnecessary choices or dropdowns.

#### Supported Mapping Types (Revised)
- **Anchor-Based Mapping:** Major input types (text, image, video, sound) are mapped via visual anchor connections on the node window.
- **Static Value:** If no connection is present, the parameter defaults to a static value, editable directly.
- **Advanced/Numeric Parameters:** These are hidden under “Show More” and are always static values unless future needs arise.

#### Data Structure Proposal (Unchanged)
For each node/tool window, store parameter mappings as follows:

```js
parameterMappings: {
  input_prompt: {
    type: "static" | "nodeOutput",
    value: "A static prompt",        // if type === "static"
    nodeId: "windowId2",            // if type === "nodeOutput"
    outputKey: "response"           // (optional) which output from the node
  },
  input_image: {
    type: "nodeOutput",
    nodeId: "windowId3",
    outputKey: "output_image"
  },
  // ...etc for each parameter
}
```

#### UI/UX Considerations (Anchor-Based)
- **Anchor Inputs:**
  - Each node window displays anchor points for each major input type (text, image, video, sound).
  - Users connect outputs to these anchors directly—no dropdown needed.
- **Granular/Numeric Parameters:**
  - Numeric and less-frequently-mapped parameters are tucked into “Show More.”
  - These default to static values, editable in a simple form.
- **No Mapping Type Dropdown:**
  - If an anchor is connected, the parameter is mapped to that node’s output.
  - If not, it’s static (user input).
  - This removes confusion and streamlines the UI.
- **Visual Indicators:**
  - Use icons or color tags to indicate mapping type (e.g., anchor = dynamic, input box = static).

#### Integration Points
- **State Management:** Store `parameterMappings` in each tool window’s state (in `activeToolWindows` in `state.js`).
- **Node Execution:** When executing a node, resolve each parameter’s value based on its mapping (static or node output).
- **Connections:** Visual connections reflect parameter mappings (anchor-to-anchor for major types).

#### Error Handling
- If a mapped node output is missing or invalid, show an error.
- If a required parameter is unmapped, highlight the row.
- Prevent circular dependencies in mappings.

#### Example Mapping Table

| Parameter      | Mapping Mechanism | Value/Source         |
|---------------|-------------------|----------------------|
| input_prompt  | anchor/static     | "A cat in a hat"     |
| input_image   | anchor            | Node: "ImageGen1"    |
| input_seed    | static            | 12345                |

## Step 2: Design

- [ ] Define data structures for parameter mappings.
- [ ] UI/UX sketches for mapping parameters (dropdowns, modals, etc.).
- [ ] Error handling (invalid mappings, missing sources).

## Step 3: Implementation

### Implementation Plan

#### 1. Data Model & State Management
- Extend each tool window's state (in `activeToolWindows` in `state.js`) to include a `parameterMappings` object.
- Each parameter’s mapping is either:
  - `{ type: "static", value: ... }`
  - `{ type: "nodeOutput", nodeId: ..., outputKey: ... }`
- Update state logic to reflect anchor connections/disconnections, and persist mappings in localStorage.

#### 2. UI/UX Changes
- For each major parameter (text, image, video, sound), display a visible anchor on the tool window using the existing `anchorPoint` implementation.
- Users drag connections from outputs to these anchors; anchors are associated with parameters via `anchorType`.
- Numeric/advanced parameters are moved to a collapsible “Show More” section as static value inputs.
- Remove mapping type dropdown; mapping is determined by presence/absence of a connection.
- Provide visual feedback for filled anchors and error/warning states.

#### 3. Connection Logic
- Update connection logic to associate each anchor with a specific parameter using `anchorType`.
- When a connection is made, update the corresponding entry in `parameterMappings`.
- Prevent multiple connections to the same anchor (unless multi-input is supported).
- On disconnect, revert to static value for that parameter.
- Check for and prevent circular dependencies.

#### 4. Node Execution Logic
- When executing a node, resolve each parameter:
  - If mapped to a node output, fetch the value from the source node’s output.
  - If static, use the user-provided value.
- Show errors and prevent execution if required parameters are unmapped or sources are missing.

#### 5. Persistence
- Persist `parameterMappings` as part of the tool window state in localStorage.
- On reload, restore all mappings and connections visually and in state.

#### 6. Testing & Demo
- Test anchor-based mapping, connection/disconnection, parameter resolution, persistence, and error handling.
- Create a screen recording or Playwright test showing parameter mapping in action.

**Note:** The current implementation already uses `anchorPoint` and `anchorType` in the node and connection logic. This plan builds on and extends those mechanisms for parameter mapping.

## Step 4: Demo & Handoff

- [ ] Create a Playwright or screen recording demo.
- [ ] Update master plan and handoff doc.

## Links

- [Back to Master Plan](./SANDBOX_NODE_EDITOR_MASTER_PLAN.md)
- [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) 