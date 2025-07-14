## Kickoff Prompt (2024-07-14, Refocused)

> You are continuing the Persistent Node Connection project for the StationThis Sandbox Node Editor.
> 
> **Current Focus:**
> - Node and connection persistence, restoration, and output state are now implemented and unified in the UI.
> - The next phase is to add connection editing (delete/reroute), connection cleanup on node deletion, visual feedback for valid/invalid targets, undo/redo, and cycle prevention.
> 
> **Protocol:**
> - Continue following the [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) for all work, including documentation and demonstration requirements.
> - Update this document as progress is made.
> 
> **Start by:** Reviewing the progress update and next actionable items below.

---

## Progress Update (as of 2024-07-14, revised)

**Completed:**
- Persistent node and connection state (localStorage)
- Automatic restoration of nodes and connections on reload
- Node deletion updates state and localStorage
- Output/result persistence for tool windows (with on-demand loading)
- Consistent output rendering for both live and restored nodes
- Basic type compatibility for connections
- **[NEW]** Connection cleanup on node deletion (removes all related connections)
- **[NEW]** Connection editing (delete/reroute) via UI (click/right-click connection line)
- **[NEW]** Visual feedback for valid/invalid connection targets during drag/reroute (highlight anchors)
- **[NEW]** Undo/redo for node and connection state (Ctrl+Z, Ctrl+Y/Ctrl+Shift+Z)
- **[NEW]** Cycle prevention in the connection graph (blocks connections that would create cycles)
- **[NEW]** Advanced type compatibility and error handling (checks inputSchema, tool metadata, alerts on invalid)

**Next Steps:**
- UI/UX polish for error messages and anchor highlights
- (Optional) Tooltips or inline error display instead of alert popups
- (Optional) Backend sync for multi-user persistence
- (Optional) Playwright/screen recording demo

---

## Node Connection Feature

## Purpose
Enable persistent, visual connections between node outputs and inputs in the sandbox editor.

## Step 1: Codebase Audit

- [x] List all files and functions related to node creation, anchor points, and connection logic.
- [x] Document current state of connection UI and state management.
- [x] Identify any blockers or architectural constraints.

## Step 1a: Function Map & Audit Notes

### Function Map (Current Node Connection System)

```mermaid
flowchart TD
  subgraph Node_Creation
    A1[createToolWindow]
    A2[createAnchorPoint]
    A3[createInputAnchors]
    A1 --> A2
    A1 --> A3
  end
  subgraph Connection_Logic
    B1[startConnection]
    B2[createPermanentConnection]
    B3[updatePermanentConnection]
    B1 --> B2
    B2 --> B3
  end
  subgraph State_Management
    C1[connections_array]
    C2[addConnection]
    C3[setActiveConnection]
    C4[getConnections]
    C2 --> C1
    C3 --> C1
    C4 --> C1
  end
  subgraph UI_UX
    D1[anchor_css]
    D2[anchor-point_input-anchor_connection-line]
    D1 --> D2
  end
  subgraph Tool_Selection
    E1[showToolsForConnection]
    E1 --> B2
  end
  A2 --mousedown/touchstart--> B1
  A3 --drop/target--> B2
  B3 --on_node_move--> B3
  B2 --addConnection--> C2
  C1 --used_by--> B3
  B1 --on_drop_on_empty--> E1
  A1 --appends--> D2
  D2 --visualizes--> B2
```

### Audit Notes

**Relevant Files & Functions:**
- `src/platforms/web/client/src/sandbox/node.js`: Node creation, anchor points, input anchors.
- `src/platforms/web/client/src/sandbox/connections.js`: Connection drag logic, permanent connection creation, updating connection lines.
- `src/platforms/web/client/src/sandbox/state.js`: State for connections, tool windows, and connection management.
- `src/platforms/web/client/src/sandbox/canvas.js`: Utility for drawing/updating connection lines.
- `src/platforms/web/client/src/sandbox/style/components/anchor.css`: Styles for anchors and connection lines.
- `src/platforms/web/client/src/sandbox/toolSelection.js`: Modal for tool selection when connecting to empty space.

**Current State:**
- Connections are visualized as absolutely positioned divs styled as lines.
- State is managed in-memory (not persisted).
- No cycle prevention or connection validation.
- No logic for removing connections when a node is deleted.
- Connections are tracked as DOM references, not serializable data.

**Blockers/Constraints:**
- Need to design a serializable/persistent data structure for connections.
- Need to handle node deletion and connection cleanup.
- Need to add cycle prevention and error handling for invalid connections.

## Behavior & Requirements Clarification

**Current Behavior:**
- Dragging from an anchor point on a tool window shows a line following the mouse.
- On release, a tool selection menu appears; selecting a tool creates a new node at that spot.
- There is currently no persistent connection (visual or in state), and the new node does not actually use the output of the previous node as its input.

**Requirements for Improved Node Connections:**
1. **Data Flow:**
   - The output of the source node should be automatically wired as the input to the new node when created via drag-connect.
   - For images, this should populate fields like `input_image`, `input_control_image`, `input_style_image`, etc., with the ability to adjust after creation.
2. **Multiple Inputs/Outputs:**
   - Nodes can have multiple outputs and multiple inputs.
   - Outputs can connect to multiple inputs and vice versa.
3. **Connection Editing:**
   - Users should be able to reroute, disconnect, or delete connections after creation.
   - Connections should be draggable, not just created via anchor drag.
4. **Persistence & Undo/Redo:**
   - Connections must persist across page reloads (localStorage or backend).
   - Undo/redo functionality for connections is required.
5. **Validation & Constraints:**
   - Cycles must be prevented (e.g., A → B → A is not allowed; user must create a new A node).
   - Type compatibility between outputs and inputs is required; only valid connections are allowed.
6. **Node Deletion:**
   - Deleting a node should automatically remove all related connections.
7. **UI/UX:**
   - Visual feedback for valid/invalid connection targets while dragging.
   - If a connection is invalid, prevent it and inform the user why.
   - Tool selection menu should filter and show only compatible tools based on the output type of the source node.

---

## Step 2: Design

- [x] Define data structures for connections.
- [x] UI/UX sketches for connection creation, deletion, and visualization.
- [x] Error handling (cycles, invalid connections).

## Step 2a: Design Details

### 1. Data Structures for Connections
- **Connection Object Example:**
  ```js
  {
    id: 'connection-uuid',
    from: { nodeId: 'nodeA', output: 'output_image' },
    to: { nodeId: 'nodeB', input: 'input_image' },
    type: 'image', // or 'text', 'audio', etc.
    createdAt: 1234567890
  }
  ```
- **Connections State:**
  - Array of connection objects, serializable for persistence.
  - Each node has a unique `nodeId`.
  - Inputs/outputs are referenced by name for flexibility (multiple per node).

### 2. Persistence Strategy
- **LocalStorage (MVP):**
  - Serialize the array of connections and node positions to localStorage on change.
  - On page load, restore nodes and connections from localStorage.
- **Backend Sync (Future):**
  - Optionally sync to backend for multi-user or cloud persistence.
- **Undo/Redo:**
  - Maintain a history stack of connection and node state changes for undo/redo.

### 3. UI/UX for Connections
- **Creation:**
  - Drag from an output anchor to an input anchor or empty space.
  - If dropped on a compatible input, create a persistent connection (visual line and state).
  - If dropped on empty space, show filtered tool menu; new node is auto-wired as input.
- **Editing:**
  - Click or right-click a connection line to show options: delete, reroute, inspect.
  - Drag connection ends to reroute to a different node/input/output.
- **Deletion:**
  - Deleting a node removes all its connections.
- **Visualization:**
  - Persistent lines between anchors, styled for clarity.
  - Visual feedback (color, glow, tooltip) for valid/invalid targets during drag.

### 4. Error Handling & Validation
- **Cycle Prevention:**
  - Before creating a connection, check for cycles in the graph; block and inform user if detected.
- **Type Compatibility:**
  - Only allow connections between compatible output/input types; show error if not compatible.
- **Invalid Actions:**
  - Prevent connecting a node to itself.
  - Show clear error messages for invalid connection attempts.

---

## Step 2b: Implementation Planning

### 1. Mapping Current Code to New Data Structures
- [x] Refactor connection creation logic to generate and store connection objects (with node IDs, input/output names, type).
- [x] Assign unique IDs to all nodes/tool windows if not already present.
- [x] Update connection logic to reference nodes by ID, not DOM element.

### 2. Migration Strategy for State
- [x] Introduce a new `connections` array in state, using the designed data structure.
- [x] On every connection creation/deletion, update this array and persist to localStorage.
- [x] On page load, restore nodes and connections from localStorage, reconstructing the UI.

### 3. Incremental UI/UX Upgrades
- [x] Make connection lines persistent and tied to state.
- [x] Show persistent lines between nodes after reload.
- [x] Enable connection editing (delete, reroute) via UI.
- [x] Add visual feedback for valid/invalid targets during drag.
- [x] Implement undo/redo for connections.
- [x] Add cycle prevention and type compatibility validation.

### 4. Testing and Validation Plan
- [x] Manual test: create, reload, and verify persistent connections.
- [x] Manual test: delete node, verify connections are removed.
- [x] Manual test: undo/redo, verify state is restored.
- [x] Manual test: attempt to create cycles, verify blocked.
- [x] Manual test: attempt invalid type connections, verify blocked.

### 5. Rollout & Documentation
- [x] Document all new APIs, state changes, and UI behaviors in the codebase and user docs.
- [ ] Demo: Prepare a screen recording or Playwright test for the new connection system.

---

## Step 3: Implementation

- [x] Update state management to store connections.
- [x] Implement drag-to-connect and persistent lines.
- [x] Update node deletion to remove related connections.
- [x] Add cycle prevention logic.
- [x] Add undo/redo logic and keyboard integration.
- [x] Add advanced type compatibility checks.

## Phase 1: Persistent Connections - Coding Tasks

1. **Node & Connection ID System**
   - [x] Ensure every tool window/node has a unique, stable `nodeId` (generate if missing).
   - [x] Refactor node creation logic to assign and track `nodeId`.

2. **Connection Data Structure**
   - [x] Define a `Connection` object (with `id`, `from`, `to`, `type`, etc.) in state management.
   - [x] Create a `connections` array in the sandbox state to hold all connection objects.

3. **Connection Creation Refactor**
   - [x] Update drag-to-connect logic to create a `Connection` object (not just a visual line).
   - [x] Store new connections in the `connections` array.
   - [x] Update UI to render persistent connection lines based on the `connections` array.

4. **Persistence**
   - [x] Serialize and save the `connections` array (and node positions) to localStorage on every change.
   - [x] On page load, restore nodes and connections from localStorage, reconstructing the UI.

5. **Connection Deletion**
   - [x] Implement logic to remove a connection (from state and UI) when requested.
   - [x] Ensure deleting a node removes all its related connections.

6. **Basic & Advanced Type Compatibility**
   - [x] Prevent connections between incompatible output/input types (basic and advanced check).

7. **Cycle Prevention**
   - [x] Prevent connections that would create cycles in the graph.

8. **Undo/Redo**
   - [x] Implement undo/redo for node and connection state (keyboard integration).

9. **Testing**
   - [x] Manual test: create, reload, and verify persistent connections.
   - [x] Manual test: delete node, verify connections are removed.
   - [x] Manual test: undo/redo, verify state is restored.
   - [x] Manual test: cycle and type errors are blocked and user is notified.

---

## Step 4: Demo & Handoff

- [ ] Create a Playwright or screen recording demo.
- [x] Update master plan and handoff doc.

## Implementation Summary (2024-07-14)

- **Connection cleanup on node deletion:** All connections referencing a deleted node are now removed from state and UI.
- **Connection editing:** Users can delete or reroute connections by clicking/right-clicking a connection line.
- **Visual feedback:** Valid input anchors are highlighted during drag/reroute; invalid targets are dimmed.
- **Undo/redo:** All node and connection changes are tracked and can be undone/redone with keyboard shortcuts.
- **Cycle prevention:** The system blocks any connection that would introduce a cycle in the graph.
- **Advanced type compatibility:** Connections are only allowed if the output type is compatible with the input, using tool schemas and metadata.
- **Error handling:** User-friendly alerts are shown for invalid actions (cycle, type mismatch, etc.).

---

## Links

- [Back to Master Plan](./SANDBOX_NODE_EDITOR_MASTER_PLAN.md)
- [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) 