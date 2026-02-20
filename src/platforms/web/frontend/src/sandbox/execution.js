/**
 * ExecutionService — manages WebSocket connection, tool execution, and
 * generation tracking for the sandbox.
 *
 * Wraps the old executionClient.js and websocketHandlers.js. The old vanilla
 * code still handles DOM updates (progress indicators, result rendering);
 * this service owns the connection lifecycle and provides a clean API.
 *
 * Usage:
 *   const exec = new ExecutionService();
 *   await exec.init();
 *   // execution is triggered by old ToolWindow code via /sandbox/executionClient.js
 *   exec.destroy();
 */

import { websocketClient } from './ws.js';
import { dispatch } from './store.js';

export class ExecutionService {
  constructor() {
    this._wsHandlersModule = null;
    this._executionModule = null;
    this._cleanups = [];
  }

  async init() {
    // Connect WebSocket
    if (websocketClient?.connect) {
      websocketClient.connect();
    }

    // Load and register the old WebSocket handlers (they manage
    // generationProgress, generationUpdate, tool-response events)
    try {
      this._wsHandlersModule = await import(/* @vite-ignore */ '/sandbox/' + 'node/websocketHandlers.js');
      // The module self-registers handlers on import via registerWebSocketHandlers()
    } catch (e) {
      console.warn('[ExecutionService] Failed to load WS handlers:', e);
    }

    // Load execution client for API access
    try {
      this._executionModule = await import(/* @vite-ignore */ '/sandbox/' + 'executionClient.js');
    } catch (e) {
      console.warn('[ExecutionService] Failed to load execution client:', e);
    }

    // Route WebSocket cost events through store
    const onCostUpdate = (detail) => {
      if (detail?.windowId) {
        dispatch('ADD_COST', { windowId: detail.windowId, costData: detail.costData });
      }
    };
    window.addEventListener('costUpdate', (e) => onCostUpdate(e.detail));
    this._cleanups.push(() => window.removeEventListener('costUpdate', onCostUpdate));
  }

  /** Execute a tool directly (for programmatic use) */
  async execute(payload) {
    if (!this._executionModule) throw new Error('Execution client not loaded');
    return this._executionModule.execute(payload);
  }

  /** Cast a spell */
  async castSpell(slug, context = {}) {
    if (!this._executionModule) throw new Error('Execution client not loaded');
    return this._executionModule.castSpell({ slug, context });
  }

  /** Check for pending generations (recovery after disconnect) */
  async recoverPendingGenerations() {
    try {
      const state = await import(/* @vite-ignore */ '/sandbox/' + 'state.js');
      await state.checkPendingGenerations();
    } catch (e) {
      console.warn('[ExecutionService] Pending generation recovery failed:', e);
    }
  }

  destroy() {
    this._cleanups.forEach(fn => fn());
    this._cleanups = [];
  }
}
