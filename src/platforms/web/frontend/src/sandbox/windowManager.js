/**
 * ToolWindowManager — orchestrates tool window creation, restoration, and reload.
 *
 * Extracts the scattered window management logic from sandbox/index.js into
 * a single service. Delegates to the old vanilla ToolWindow/SpellWindow classes
 * via runtime import for actual DOM creation.
 *
 * Usage:
 *   const mgr = new ToolWindowManager();
 *   await mgr.init();           // load tools + restore windows
 *   await mgr.reloadState();    // full reload (workspace switch)
 */

export class ToolWindowManager {
  constructor() {
    this._state = null;
    this._node = null;
    this._windowModule = null;
    this._connections = null;
    this._io = null;
    this._reloading = false;
  }

  async init() {
    // Load all runtime sandbox modules in parallel
    const [state, node, windowMod, connections, io] = await Promise.all([
      import(/* @vite-ignore */ '/sandbox/' + 'state.js'),
      import(/* @vite-ignore */ '/sandbox/' + 'node/index.js'),
      import(/* @vite-ignore */ '/sandbox/' + 'window/index.js'),
      import(/* @vite-ignore */ '/sandbox/' + 'connections/index.js'),
      import(/* @vite-ignore */ '/sandbox/' + 'io.js'),
    ]);
    this._state = state;
    this._node = node;
    this._windowModule = windowMod;
    this._connections = connections;
    this._io = io;

    // Load tool registry (shared backing state is visible to both module graphs)
    await io.initializeTools();

    // Notify components that tools are available
    const { eventBus } = await import('@monygroupcorp/microact');
    eventBus.emit('sandbox:availableTools', state.getAvailableTools());

    // Restore persisted windows
    this._restoreWindows();
    connections.renderAllConnections();
  }

  /** Restore tool/spell windows from localStorage state */
  _restoreWindows() {
    const { getToolWindows, getAvailableTools } = this._state;
    const { createToolWindow, createSpellWindow } = this._node;

    getToolWindows().forEach(win => {
      if (win.isSpell && win.spell) {
        this._createSpellWindowSafe(win);
        return;
      }
      if (win.tool) {
        const tool = this._findTool(win.tool, getAvailableTools());
        if (tool) {
          createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
        }
      }
    });
  }

  _createSpellWindowSafe(win) {
    const { createSpellWindow } = this._node;
    try {
      createSpellWindow(
        win.spell,
        { x: win.workspaceX, y: win.workspaceY },
        win.id, win.output, win.parameterMappings,
        win.outputVersions, win.currentVersionIndex,
        win.totalCost, win.costVersions
      );
    } catch (e) {
      console.error(`[WindowManager] Failed to create spell window ${win.id}:`, e);
      this._createLockedPlaceholder(win);
    }
  }

  _createLockedPlaceholder(win) {
    const el = document.createElement('div');
    el.className = 'tool-window spell-window spell-locked';
    el.id = win.id;
    el.style.left = `${win.workspaceX}px`;
    el.style.top = `${win.workspaceY}px`;
    el.innerHTML = `
      <div class="tool-window-header"><span>Private Spell</span></div>
      <div class="tool-window-body" style="padding:24px;text-align:center;color:#999">
        <div style="font-size:32px;margin-bottom:12px;opacity:0.7">&#x1F512;</div>
        <div style="font-weight:bold;color:#666">Private Spell</div>
        <div style="font-size:14px;color:#888">Unable to load.</div>
      </div>`;
    document.querySelector('.sandbox-canvas')?.appendChild(el);
  }

  _findTool(winTool, availableTools) {
    if (winTool.toolId) {
      const match = availableTools.find(t => t.toolId === winTool.toolId);
      if (match) return match;
    }
    if (winTool.displayName) {
      return availableTools.find(t => t.displayName === winTool.displayName);
    }
    return null;
  }

  /**
   * Full state reload — used by workspace tab switching.
   * Clears DOM, reloads state from localStorage, recreates everything.
   */
  async reloadState() {
    if (this._reloading) return;
    this._reloading = true;

    try {
      // Clear DOM
      document.querySelectorAll('.tool-window, .connection-line').forEach(el => el.remove());

      // Reload state from localStorage
      this._state.initState();

      // Refresh tool registry
      await this._io.initializeTools();

      // Recreate windows
      const missing = { tools: [], spells: [] };
      const availableTools = this._state.getAvailableTools();

      this._state.getToolWindows().forEach(win => {
        if (win.isSpell && win.spell) {
          this._createSpellWindowSafe(win);
          return;
        }
        if (win.type === 'collection') return; // Not yet supported
        if (win.tool) {
          const tool = this._findTool(win.tool, availableTools);
          if (tool) {
            try {
              this._node.createToolWindow(tool, { x: win.workspaceX, y: win.workspaceY }, win.id, win.output);
            } catch (e) {
              console.error(`[WindowManager] Failed to recreate ${win.id}:`, e);
              missing.tools.push(win.tool.displayName || win.tool.toolId);
            }
          } else {
            missing.tools.push(win.tool.displayName || win.tool.toolId);
          }
        }
      });

      if (missing.tools.length) console.warn(`[WindowManager] Missing tools:`, missing.tools);
      if (missing.spells.length) console.warn(`[WindowManager] Missing spells:`, missing.spells);

      this._connections.renderAllConnections();
    } finally {
      this._reloading = false;
    }
  }

  /** Rerender all windows + connections (e.g. after undo/redo) */
  rerenderAll() {
    document.querySelectorAll('.tool-window').forEach(el => el.remove());
    this._restoreWindows();
    this._connections.renderAllConnections();
  }

  /** Create upload window at position */
  createUpload(position) {
    return this._windowModule.createUploadWindow({
      id: `upload-${Date.now()}`,
      position
    });
  }
}
