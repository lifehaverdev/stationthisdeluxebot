/**
 * SandboxStore — reactive wrapper around state.js.
 *
 * Provides subscribe(key, fn) and dispatch(action, payload) so microact
 * components can react to state changes without polling.
 *
 * state.js is now Vite-bundled (no more dual module graph).
 * The window.__sandboxState__ backing store remains for any legacy
 * vanilla code that hasn't been ported yet.
 */

import { eventBus } from '@monygroupcorp/microact';
import * as stateModuleImport from './state.js';

let stateModule = stateModuleImport;
const subscribers = new Map(); // key -> Set<callback>

/**
 * Initialize the store. Now synchronous since state.js is Vite-bundled.
 * Kept async for backwards compatibility with callers that await it.
 */
export async function initStore() {
  // state.js is already imported — nothing to do
}

// ── Subscription System ──────────────────────────────────────────────

/**
 * Subscribe to changes on a state key.
 * Returns an unsubscribe function.
 */
export function subscribe(key, callback) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(callback);
  return () => subscribers.get(key).delete(callback);
}

function notify(key, data) {
  const subs = subscribers.get(key);
  if (subs) subs.forEach(fn => { try { fn(data); } catch (e) { console.error('[SandboxStore]', e); } });
  eventBus.emit(`sandbox:${key}`, data);
}

// ── Dispatch — action-based state mutations ──────────────────────────

/**
 * Dispatch a state mutation. Delegates to state.js functions and notifies subscribers.
 */
export function dispatch(action, payload) {
  if (!stateModule) { console.warn('[SandboxStore] dispatch before init:', action); return; }

  switch (action) {
    // ── Tool Windows ──
    case 'ADD_WINDOW': {
      const model = stateModule.addToolWindow(payload);
      stateModule.persistState();
      notify('toolWindows', stateModule.getToolWindows());
      return model;
    }
    case 'REMOVE_WINDOW': {
      stateModule.removeToolWindow(payload);
      notify('toolWindows', stateModule.getToolWindows());
      notify('connections', stateModule.getConnections());
      return;
    }
    case 'MOVE_WINDOW': {
      const { id, x, y } = payload;
      stateModule.updateToolWindowPosition(id, x, y);
      stateModule.persistState();
      return;
    }
    case 'SET_OUTPUT': {
      const { id, output } = payload;
      stateModule.setToolWindowOutput(id, output);
      notify('toolWindows', stateModule.getToolWindows());
      return;
    }

    // ── Connections ──
    case 'ADD_CONNECTION': {
      stateModule.addConnection(payload);
      stateModule.persistState();
      notify('connections', stateModule.getConnections());
      return;
    }
    case 'REMOVE_CONNECTION': {
      stateModule.removeConnection(payload);
      stateModule.persistState();
      notify('connections', stateModule.getConnections());
      return;
    }

    // ── Selection ──
    case 'SELECT_NODE': {
      const { id, additive } = payload;
      stateModule.selectNode(id, additive);
      notify('selection', stateModule.getSelectedNodeIds());
      return;
    }
    case 'DESELECT_NODE': {
      stateModule.deselectNode(payload);
      notify('selection', stateModule.getSelectedNodeIds());
      return;
    }
    case 'CLEAR_SELECTION': {
      stateModule.clearSelection();
      notify('selection', stateModule.getSelectedNodeIds());
      return;
    }

    // ── Tools ──
    case 'SET_TOOLS': {
      stateModule.setAvailableTools(payload);
      notify('availableTools', payload);
      return;
    }

    // ── Costs ──
    case 'ADD_COST': {
      const { windowId, costData } = payload;
      stateModule.addWindowCost(windowId, costData);
      notify('costs', stateModule.getTotalWorkspaceCost());
      return;
    }
    case 'RESET_COST': {
      stateModule.resetWindowCost(payload);
      notify('costs', stateModule.getTotalWorkspaceCost());
      window.dispatchEvent(new CustomEvent('costReset', { detail: { windowId: payload } }));
      return;
    }
    case 'RESET_ALL_COSTS': {
      stateModule.resetAllCosts();
      notify('costs', stateModule.getTotalWorkspaceCost());
      window.dispatchEvent(new CustomEvent('costReset'));
      return;
    }

    // ── Pending Generations ──
    case 'TRACK_GENERATION': {
      const { generationId, windowId, metadata } = payload;
      stateModule.trackPendingGeneration(generationId, windowId, metadata);
      notify('pendingGenerations', stateModule.getPendingGenerations());
      return;
    }
    case 'UNTRACK_GENERATION': {
      stateModule.untrackPendingGeneration(payload);
      notify('pendingGenerations', stateModule.getPendingGenerations());
      return;
    }

    // ── UI State ──
    case 'SET_MODAL': {
      stateModule.setModalState(payload);
      notify('modal', payload);
      return;
    }
    case 'SET_LAST_CLICK': {
      stateModule.setLastClickPosition(payload);
      return;
    }

    default:
      console.warn(`[SandboxStore] Unknown action: ${action}`);
  }
}

// ── Read-only getters (safe defaults when store not yet initialized) ──

const EMPTY_COST = { usd: 0, points: 0, ms2: 0, cult: 0 };

export function getToolWindows()       { return stateModule?.getToolWindows() ?? []; }
export function getToolWindow(id)      { return stateModule?.getToolWindow(id) ?? null; }
export function getConnections()       { return stateModule?.getConnections() ?? []; }
export function getSelectedNodeIds()   { return stateModule?.getSelectedNodeIds() ?? new Set(); }
export function isNodeSelected(id)     { return stateModule?.isNodeSelected(id) ?? false; }
export function getAvailableTools()    { return stateModule?.getAvailableTools() ?? []; }
export function getTotalWorkspaceCost(){ return stateModule?.getTotalWorkspaceCost() ?? EMPTY_COST; }
export function getWindowCost(id)      { return stateModule?.getWindowCost(id) ?? null; }
export function getPendingGenerations(){ return stateModule?.getPendingGenerations() ?? {}; }
export function getLastClickPosition() { return stateModule?.getLastClickPosition() ?? null; }
export function getModalState()        { return stateModule?.getModalState() ?? false; }

export function getOutputTypeMapping()  { return stateModule?.OUTPUT_TYPE_MAPPING ?? {}; }
export function getCreationTypeMap()    { return stateModule?.CREATION_TYPE_TO_CATEGORY ?? {}; }

// ── Lifecycle ────────────────────────────────────────────────────────

// Direct cost notification — used by SandboxCanvas which manages its own window Map
// and cannot go through state.js's activeToolWindows.
export function emitCosts(totals) { notify('costs', totals); }

export function initState() { return stateModule?.initState(); }
export function persistState() { return stateModule?.persistState(); }
export async function checkPendingGenerations() { return stateModule?.checkPendingGenerations(); }
