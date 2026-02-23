import { Component, h, eventBus } from '@monygroupcorp/microact';

/**
 * ParameterForm — renders parameter inputs from a tool's inputSchema.
 *
 * Handles text, number, select (enum), connected-from-upstream indicators,
 * conditional visibility (visibleIf), and required vs optional grouping.
 *
 * Props:
 *   schema         — tool.inputSchema object: { [key]: { name, type, required, enum, default, description, visibleIf, order } }
 *   mappings       — parameterMappings: { [key]: { type: 'static'|'nodeOutput', value?, nodeId?, outputKey? } }
 *   connections    — array of active connections to this window (for source node display names)
 *   onMappingChange — (key, value) => void — called when user changes a static input
 *   showOptional   — boolean, whether optional params are visible
 *   onToggleOptional — () => void — toggle optional param visibility
 */
export class ParameterForm extends Component {
  constructor(props) {
    super(props);
    this.state = { showOptional: false };
  }

  _handleChange(key, value) {
    this.props.onMappingChange?.(key, value);
  }

  _getSourceName(mapping) {
    if (!mapping || mapping.type !== 'nodeOutput') return null;
    // Try to find the source window's display name
    const conns = this.props.connections || [];
    const conn = conns.find(c => c.fromWindowId === mapping.nodeId);
    return conn?.fromDisplayName || mapping.nodeId;
  }

  _shouldShow(param, key) {
    if (!param.visibleIf) return true;
    const { field, values } = param.visibleIf;
    if (!field || !Array.isArray(values)) return true;
    const mapping = this.props.mappings?.[field];
    const currentValue = mapping?.value ?? '';
    return values.includes(currentValue);
  }

  _renderInput(key, param) {
    const mapping = this.props.mappings?.[key];

    // Connected from upstream — show indicator instead of input
    if (mapping && mapping.type === 'nodeOutput') {
      const sourceName = this._getSourceName(mapping);
      return h('div', { className: 'pf-param', key },
        h('label', { className: 'pf-label' }, param.name),
        h('div', { className: 'pf-connected' },
          h('span', { className: 'pf-connected-dot' }),
          h('span', null, `${sourceName || mapping.nodeId} / ${mapping.outputKey || 'output'}`)
        )
      );
    }

    const value = mapping?.value ?? param.default ?? '';
    const visible = this._shouldShow(param, key);

    // Enum → select dropdown
    if (Array.isArray(param.enum) && param.enum.length) {
      return h('div', { className: 'pf-param', key, style: visible ? '' : 'display:none' },
        h('label', { className: 'pf-label', title: param.description || '' }, param.name),
        h('select', {
          className: 'pf-select',
          name: key,
          value: value || param.enum[0],
          onchange: (e) => this._handleChange(key, e.target.value),
          title: param.description || '',
        },
          ...param.enum.map(opt =>
            h('option', { value: opt, key: opt }, opt)
          )
        )
      );
    }

    // Number input
    if (param.type === 'number' || param.type === 'integer') {
      return h('div', { className: 'pf-param', key, style: visible ? '' : 'display:none' },
        h('label', { className: 'pf-label', title: param.description || '' }, param.name),
        h('input', {
          className: 'pf-input',
          type: 'number',
          name: key,
          value: value,
          placeholder: param.description || param.name,
          oninput: (e) => this._handleChange(key, e.target.value),
          title: param.description || '',
        })
      );
    }

    // Default: text input — click opens full-screen overlay
    const strVal = value !== undefined && value !== null ? String(value) : '';
    return h('div', { className: 'pf-param', key, style: visible ? '' : 'display:none' },
      h('label', { className: 'pf-label', title: param.description || '' }, param.name),
      h('div', {
        className: `pf-input pf-input--text-preview${strVal ? '' : ' pf-input--empty'}`,
        title: param.description || 'Click to edit',
        onclick: (e) => {
          e.stopPropagation();
          eventBus.emit('sandbox:openTextEdit', {
            windowId: this.props.windowId,
            value: strVal,
            displayName: param.name,
            kind: 'param',
            paramKey: key,
          });
        },
      }, strVal || param.description || param.name)
    );
  }

  static get styles() {
    return `
      .pf-root {
        padding: 0;
        font-family: var(--ff-sans);
      }

      .pf-section {
        border-bottom: var(--border-width) solid var(--border);
      }

      .pf-section-header {
        padding: 6px 10px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        color: var(--text-label);
        background: var(--surface-1);
        cursor: default;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .pf-param {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 10px;
        border-bottom: var(--border-width) solid var(--border);
      }

      .pf-param:last-child { border-bottom: none; }

      .pf-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
      }

      .pf-label.required { color: var(--text-secondary); }

      .pf-input {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        padding: 5px 8px;
        width: 100%;
        outline: none;
        transition: border-color var(--dur-micro) var(--ease);
        resize: vertical;
        min-height: 28px;
      }

      .pf-input:focus {
        border-color: var(--accent-border);
        background: var(--surface-1);
      }

      .pf-input::placeholder { color: var(--text-label); }

      /* Text preview — click to open overlay */
      .pf-input--text-preview {
        cursor: text;
        min-height: 28px;
        max-height: 56px;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .pf-input--text-preview:hover {
        border-color: var(--accent-border);
        background: var(--surface-1);
      }
      .pf-input--empty {
        color: var(--text-label);
        font-style: italic;
      }

      .pf-select {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        padding: 5px 8px;
        width: 100%;
        outline: none;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(221,223,224,0.33)'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
        padding-right: 24px;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .pf-select:focus { border-color: var(--accent-border); }

      .pf-connected {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        background: var(--accent-dim);
        border: var(--border-width) solid var(--accent-border);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--accent);
        letter-spacing: var(--ls-wide);
      }

      .pf-connected-dot {
        width: 4px; height: 4px;
        background: var(--accent);
        flex-shrink: 0;
      }

      .pf-toggle {
        background: none;
        border: none;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        cursor: pointer;
        padding: 6px 10px;
        width: 100%;
        text-align: left;
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        border-top: var(--border-width) solid var(--border);
        transition: color var(--dur-micro) var(--ease);
      }
      .pf-toggle:hover { color: var(--text-secondary); }
      .pf-toggle--active { color: var(--accent); }
    `;
  }

  render() {
    const { schema, mappings } = this.props;
    if (!schema) return h('div', { style: 'display:none' });

    const entries = Object.entries(schema);

    // Split into required/optional and sort with prompt fields first
    const orderPriority = (k) => (k === 'input_prompt' ? 0 : k === 'input_negative_prompt' ? 1 : 2);
    const required = entries.filter(([, p]) => p.required).sort((a, b) => {
      const oa = a[1].order ?? Infinity, ob = b[1].order ?? Infinity;
      if (oa !== ob) return oa - ob;
      return orderPriority(a[0]) - orderPriority(b[0]);
    });
    const optional = entries.filter(([, p]) => !p.required).sort((a, b) => {
      const oa = a[1].order ?? Infinity, ob = b[1].order ?? Infinity;
      if (oa !== ob) return oa - ob;
      return orderPriority(a[0]) - orderPriority(b[0]);
    });

    const { showOptional } = this.state;

    return h('div', { className: 'pf-root' },
      // Required params
      ...required.map(([key, param]) => this._renderInput(key, param)),

      // Optional toggle
      optional.length > 0
        ? h('button', {
          className: `pf-toggle${showOptional ? ' pf-toggle--active' : ''}`,
          onclick: () => this.setState({ showOptional: !showOptional }),
        }, showOptional ? '− fewer options' : '+ more options')
        : null,

      // Optional params (hidden by default)
      showOptional
        ? optional.map(([key, param]) => this._renderInput(key, param))
        : null
    );
  }
}
