> Imported from vibecode/maps/1-node-creation.md on 2025-08-21

## Kickoff Prompt

> You are entering the Node Creation, Deletion, and Drag project for the StationThis Sandbox Node Editor.
> 
> - **Purpose:** Support robust creation, deletion, and drag-and-drop placement of tool nodes in the sandbox editor.
> - **Start by:** Reviewing the codebase audit section below, reading the [Master Plan](./SANDBOX_NODE_EDITOR_MASTER_PLAN.md), and checking the latest handoff.
> - **Protocol:** Follow the [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) for all work, including documentation and demonstration requirements.
> 
> Please begin by auditing the current codebase for all relevant files, functions, and architectural constraints related to this feature.

# Node Creation, Deletion, and Drag Feature

## Purpose
Support robust creation, deletion, and drag-and-drop placement of tool nodes in the sandbox editor.

## Step 1: Codebase Audit

### Relevant Files & Functions

- **src/platforms/web/client/src/sandbox/node.js**
  - `createToolWindow(tool, position)`: Handles creation of tool windows (nodes).
  - `createWindowHeader(title)`: Adds a close button for deletion.
  - `setupDragging(windowData, handle)`: Implements drag-and-drop for nodes.

- **src/platforms/web/client/src/sandbox/state.js**
  - `addToolWindow(windowData)`: Adds a node to state.
  - `removeToolWindow(windowId)`: Removes a node from state and DOM.
  - `updateToolWindowPosition(windowId, x, y)`: Updates node position.

- **src/platforms/web/client/src/sandbox/toolSelection.js**
  - `renderSidebarTools()`: Renders tool buttons for node creation.
  - `showToolsForConnection()`, `showToolsForCategory()`: UI for creating nodes via connections or categories.

- **src/platforms/web/client/src/sandbox/index.js**
  - Initializes sandbox, state, and exposes workspace/screen coordinate transforms.
  - Handles click events for node creation.

- **src/platforms/web/client/src/sandbox/utils.js**
  - `calculateCenterPosition(toolWindows)`: Determines where new nodes appear.
  - `makeDraggable(element, handle)`: (Legacy) generic drag logic.

- **src/platforms/web/client/src/sandbox/connections.js**
  - Handles connection logic between nodes, which can trigger node creation.

### Node UI & State Management

- **State**: Nodes are tracked in an array (`activeToolWindows`) in state.js.
- **Creation**: Nodes are created via sidebar/tool selection or connection anchors, using `createToolWindow`.
- **Deletion**: Each node has a close button (×) in its header, which calls `removeToolWindow`.
- **Drag**: Nodes are draggable by their header, using `setupDragging` (with grid snapping on drop).
- **Positioning**: Node positions are managed in workspace coordinates and converted to screen coordinates for rendering.

### Blockers & Architectural Constraints

- **Grid Snapping**: Implemented in `setupDragging` (snaps to grid on drag end).
- **Connection Logic**: Node creation can be triggered by connecting outputs to new nodes.
- **UI/UX**: Modal and sidebar logic for tool selection; nodes are DOM elements, not React components.
- **Legacy Drag**: There’s a generic `makeDraggable` in utils.js, but main node drag uses `setupDragging` in node.js.

## Step 2: Design

### Current State
- The data structures for nodes and their positions are already implemented. Each node is represented by an object containing its id, tool, DOM element, and workspace coordinates (`workspaceX`, `workspaceY`).
- Node creation, deletion, and drag-and-drop (with grid snapping) are fully functional in the sandbox interface.
- The UI/UX for node lifecycle (creation via sidebar or anchor, deletion via close button, drag by header) is implemented and in active use.

### Next Steps: Error Handling
- Future improvements may focus on advanced error handling, such as:
  - Preventing node overlap
  - Preventing nodes from being dragged out-of-bounds
  - Providing visual feedback for invalid actions
  - Additional UX enhancements as needed

## Step 3: Implementation

- [ ] Implement node creation from tool registry and via anchor points.
- [ ] Implement node deletion (close button, context menu, etc.).
- [ ] Implement drag-and-drop with grid snapping.
- [ ] Update state management for node lifecycle.

## Step 4: Demo & Handoff

- [ ] Create a Playwright or screen recording demo.
- [ ] Update master plan and handoff doc.

## Links

- [Back to Master Plan](./SANDBOX_NODE_EDITOR_MASTER_PLAN.md)
- [AGENT_COLLABORATION_PROTOCOL.md](../../AGENT_COLLABORATION_PROTOCOL.md) 