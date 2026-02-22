import { Component, h } from '@monygroupcorp/microact';

/**
 * ConnectionDropPicker — contextual tool picker that appears when an output
 * anchor is dragged and dropped onto empty canvas (Spec 3).
 *
 * Shows only tools that have at least one input parameter accepting the
 * dragged output type. Selecting a tool:
 *   1. Creates a new window at the drop position
 *   2. Auto-connects the source output to the first matching input param
 *
 * Props:
 *   outputType   — 'image' | 'text' | 'video' | 'audio'
 *   screenX, screenY — fixed screen position for the picker
 *   onSelect     — (tool, matchingParamKey) => void
 *   onDismiss    — () => void
 */

// Maps our output types to the schema types that can receive them
const COMPATIBLE_TYPES = {
  image: ['image'],
  text:  ['text', 'string', 'textany'],
  video: ['video'],
  audio: ['audio'],
};

function normalizeType(t) {
  if (!t) return '';
  if (Array.isArray(t)) return normalizeType(t[0]);
  const s = String(t).toLowerCase();
  if (s === 'string' || s === 'textany') return 'text';
  return s;
}

export function filterCompatibleTools(tools, outputType) {
  const accepted = COMPATIBLE_TYPES[outputType] || [outputType];
  return tools
    .map(tool => {
      const schema = tool.inputSchema || {};
      // Find first input param that can receive this output type
      const matchingParam = Object.entries(schema).find(([, param]) =>
        accepted.includes(normalizeType(param.type))
      );
      return matchingParam ? { tool, paramKey: matchingParam[0] } : null;
    })
    .filter(Boolean);
}

export class ConnectionDropPicker extends Component {
  constructor(props) {
    super(props);
    this.state = { query: '' };
    this._rootEl = null;
  }

  didMount() {
    // Dismiss on outside click
    this._outsideClick = (e) => {
      if (this._rootEl && !this._rootEl.contains(e.target)) {
        this.props.onDismiss?.();
      }
    };
    // Use setTimeout so the same click that opened this doesn't immediately close it
    setTimeout(() => document.addEventListener('click', this._outsideClick), 0);

    // Dismiss on Escape
    this._onKeyDown = (e) => {
      if (e.key === 'Escape') this.props.onDismiss?.();
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  willUnmount() {
    document.removeEventListener('click', this._outsideClick);
    document.removeEventListener('keydown', this._onKeyDown);
  }

  static get styles() {
    return `
      .cdp-root {
        position: fixed;
        z-index: 600;
        background: rgba(10,10,10,0.95);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 10px;
        padding: 8px;
        min-width: 200px;
        max-width: 260px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        animation: cdp-fadein 0.12s ease;
      }
      @keyframes cdp-fadein {
        from { opacity: 0; transform: scale(0.94) translateY(4px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      .cdp-label {
        font-size: 10px;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 6px 6px;
        font-family: monospace;
      }
      .cdp-search {
        width: 100%;
        box-sizing: border-box;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 5px;
        color: #ddd;
        font-size: 12px;
        padding: 5px 8px;
        margin-bottom: 6px;
        font-family: inherit;
        outline: none;
      }
      .cdp-search:focus { border-color: rgba(144,202,249,0.5); }
      .cdp-list {
        max-height: 240px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .cdp-tool {
        background: rgba(255,255,255,0.05);
        border: 1px solid transparent;
        border-radius: 5px;
        color: #ccc;
        padding: 7px 10px;
        cursor: pointer;
        font-size: 12px;
        font-family: monospace;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
      }
      .cdp-tool:hover {
        background: rgba(255,255,255,0.1);
        color: #fff;
        border-color: rgba(255,255,255,0.1);
      }
      .cdp-empty {
        color: #555;
        font-size: 12px;
        padding: 10px 8px;
        text-align: center;
      }
    `;
  }

  render() {
    const { outputType, screenX, screenY, onSelect, onDismiss } = this.props;
    const { query } = this.state;

    const tools = window.__sandboxState__?.availableTools || [];
    const compatible = filterCompatibleTools(tools, outputType);

    const filtered = query
      ? compatible.filter(({ tool }) =>
          tool.displayName.toLowerCase().includes(query.toLowerCase()) ||
          (tool.description || '').toLowerCase().includes(query.toLowerCase())
        )
      : compatible;

    // Keep picker on screen
    const pickerW = 260;
    const pickerH = Math.min(320, filtered.length * 31 + 90);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(screenX, vw - pickerW - 8));
    const top  = Math.max(8, Math.min(screenY, vh - pickerH - 8));
    const style = `left:${left}px;top:${top}px`;

    const TYPE_LABELS = { image: 'image output', text: 'text output', video: 'video output', audio: 'audio output' };

    return h('div', {
      className: 'cdp-root',
      style,
      ref: (el) => { this._rootEl = el; },
      onclick: (e) => e.stopPropagation(),
    },
      h('div', { className: 'cdp-label' }, `connect ${TYPE_LABELS[outputType] || outputType} to…`),
      h('input', {
        className: 'cdp-search',
        placeholder: 'filter tools…',
        value: query,
        oninput: (e) => this.setState({ query: e.target.value }),
        autofocus: true,
      }),
      h('div', { className: 'cdp-list' },
        filtered.length === 0
          ? h('div', { className: 'cdp-empty' }, 'No compatible tools.')
          : filtered.map(({ tool, paramKey }) =>
              h('button', {
                key: tool.toolId || tool.displayName,
                className: 'cdp-tool',
                title: tool.description || tool.displayName,
                onclick: () => onSelect?.(tool, paramKey),
              }, tool.displayName)
            )
      )
    );
  }
}
