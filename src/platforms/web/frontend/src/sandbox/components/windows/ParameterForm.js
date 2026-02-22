import { Component, h } from '@monygroupcorp/microact';

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
      return h('div', { className: 'pf-param pf-param--connected', key },
        h('label', { className: 'pf-label' }, param.name),
        h('div', { className: 'pf-connected' },
          h('span', { className: 'pf-connected-icon' }, '\u26A1'),
          h('span', null, `from ${sourceName || mapping.nodeId}.${mapping.outputKey || 'output'}`)
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

    // Default: text input
    return h('div', { className: 'pf-param', key, style: visible ? '' : 'display:none' },
      h('label', { className: 'pf-label', title: param.description || '' }, param.name),
      h('input', {
        className: 'pf-input',
        type: 'text',
        name: key,
        value: value,
        placeholder: param.description || param.name,
        oninput: (e) => this._handleChange(key, e.target.value),
        title: param.description || '',
      })
    );
  }

  static get styles() {
    return `
      .pf-section { display: flex; flex-direction: column; gap: 8px; }
      .pf-param { display: flex; flex-direction: column; gap: 4px; }
      .pf-param--connected { opacity: 0.7; }
      .pf-label { font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
      .pf-input { width: 100%; padding: 6px 10px; background: #222; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; font-size: 13px; box-sizing: border-box; }
      .pf-input:focus { border-color: #90caf9; outline: none; }
      .pf-select { width: 100%; padding: 6px 10px; background: #222; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; font-size: 13px; }
      .pf-connected { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #90caf9; font-style: italic; padding: 4px 0; }
      .pf-connected-icon { font-size: 14px; }
      .pf-toggle { background: none; border: 1px solid #444; color: #888; padding: 4px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-top: 4px; align-self: flex-start; }
      .pf-toggle:hover { border-color: #666; color: #ccc; }
      .pf-toggle--active { color: #90caf9; border-color: #90caf9; }
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

    return h('div', { className: 'pf-section' },
      // Required params
      ...required.map(([key, param]) => this._renderInput(key, param)),

      // Optional toggle
      optional.length > 0
        ? h('button', {
          className: `pf-toggle${showOptional ? ' pf-toggle--active' : ''}`,
          onclick: () => this.setState({ showOptional: !showOptional }),
        }, showOptional ? 'show less' : 'show more')
        : null,

      // Optional params (hidden by default)
      showOptional
        ? optional.map(([key, param]) => this._renderInput(key, param))
        : null
    );
  }
}
