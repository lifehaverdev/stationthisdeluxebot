import { Component, h } from '@monygroupcorp/microact';
import { AsyncButton } from '../components/ModalKit.js';
import { Loader } from '../components/Modal.js';
import { ResultDisplay } from '../components/windows/ResultDisplay.js';

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function substituteTraits(paramOverrides, selections) {
  const result = {};
  for (const [key, val] of Object.entries(paramOverrides)) {
    if (typeof val === 'string') {
      result[key] = val.replace(/\[\[([^\]]+)\]\]/g, (_, cat) => selections[cat] ?? `[[${cat}]]`);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * CollectionTestWindowBody — body for ephemeral collection test windows.
 *
 * Shows per-category trait selectors (or "Random"), substitutes selections
 * into paramOverrides, then executes the collection's generator once.
 *
 * Props:
 *   win         — window state; win.collection holds the collection object
 *   compact     — boolean, compact mode (hides selectors + run button)
 *   onRunTest   — (windowId, substitutedParams) => void
 */
export class CollectionTestWindowBody extends Component {
  constructor(props) {
    super(props);
    const categories = props.win.collection?.config?.traitTree || [];
    const traitSelections = {};
    categories.forEach(cat => { traitSelections[cat.name] = null; }); // null = random
    this.state = { traitSelections };
  }

  shouldUpdate(oldProps, newProps, oldState, newState) {
    return oldProps.win !== newProps.win
        || oldProps.compact !== newProps.compact
        || oldState?.traitSelections !== newState?.traitSelections;
  }

  _randomizeAll() {
    const categories = this.props.win.collection?.config?.traitTree || [];
    const traitSelections = {};
    categories.forEach(cat => { traitSelections[cat.name] = null; });
    this.setState({ traitSelections });
  }

  _resolveSelections() {
    const categories = this.props.win.collection?.config?.traitTree || [];
    const resolved = {};
    categories.forEach(cat => {
      const sel = this.state.traitSelections[cat.name];
      if (sel) {
        resolved[cat.name] = sel;
      } else {
        const traits = cat.traits || [];
        if (traits.length > 0) resolved[cat.name] = pickRandom(traits).value || pickRandom(traits).name;
      }
    });
    return resolved;
  }

  _runTest() {
    const { win, onRunTest } = this.props;
    const paramOverrides = win.collection?.config?.paramOverrides || {};
    const resolved = this._resolveSelections();
    const substituted = substituteTraits(paramOverrides, resolved);
    onRunTest?.(win.id, substituted);
  }

  render() {
    const { win, compact } = this.props;
    const { traitSelections } = this.state;
    const categories = win.collection?.config?.traitTree || [];
    const content = [];

    if (!compact) {
      content.push(
        h('div', { key: 'traits', className: 'ctw-traits' },
          h('div', { className: 'ctw-traits-header' },
            h('span', { className: 'ctw-traits-label' }, 'Traits'),
            h('button', { className: 'ctw-randomize', onclick: this.bind(this._randomizeAll) }, 'Randomize All'),
          ),
          categories.length === 0
            ? h('div', { className: 'ctw-empty' }, 'No trait categories defined.')
            : categories.map(cat => {
                const sel = traitSelections[cat.name] ?? '';
                return h('div', { key: cat.name, className: 'ctw-trait-row' },
                  h('span', { className: 'ctw-trait-name' }, cat.name),
                  h('select', {
                    className: 'ctw-select',
                    value: sel,
                    onchange: (e) => this.setState({
                      traitSelections: { ...traitSelections, [cat.name]: e.target.value || null },
                    }),
                  },
                    h('option', { value: '' }, 'Random'),
                    (cat.traits || []).map(t =>
                      h('option', { value: t.value || t.name, key: t.name }, t.name)
                    )
                  )
                );
              })
        ),
        h('div', { key: 'actions', className: 'ctw-actions' },
          h(AsyncButton, {
            label: 'Run Test',
            loading: !!win.executing,
            onclick: this.bind(this._runTest),
          })
        )
      );
    }

    if (win.executing) {
      content.push(
        h('div', { key: 'progress', className: 'nwb-progress' },
          h(Loader, { message: win.progress || 'Running test...' })
        )
      );
    }

    if (win.output && win.outputLoaded !== false) {
      content.push(
        h('div', { key: 'output', className: 'nwb-output' },
          h(ResultDisplay, { output: win.output })
        )
      );
    }

    return h('div', { className: 'ctw-root' }, ...content);
  }

  static get styles() {
    return `
      .ctw-traits { padding: 8px 0; }
      .ctw-traits-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 8px;
      }
      .ctw-traits-label {
        font-size: 11px; color: var(--text-label);
        letter-spacing: var(--ls-wide); text-transform: uppercase;
        font-family: var(--ff-mono);
      }
      .ctw-randomize {
        background: none; border: var(--border-width) solid var(--border);
        color: var(--text-label); font-size: 11px; padding: 2px 8px;
        cursor: pointer; font-family: var(--ff-mono);
        letter-spacing: var(--ls-wide);
        transition: border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .ctw-randomize:hover { border-color: var(--border-hover); color: var(--text-secondary); }
      .ctw-trait-row {
        display: flex; align-items: center; gap: 8px;
        padding: 4px 0; border-bottom: var(--border-width) solid var(--border);
      }
      .ctw-trait-name {
        font-size: 12px; color: var(--text-label); min-width: 90px;
        font-family: var(--ff-mono);
      }
      .ctw-select {
        flex: 1; background: var(--surface-3); border: var(--border-width) solid var(--border);
        color: var(--text-secondary); font-size: 13px; padding: 3px 6px;
        font-family: var(--ff-mono);
      }
      .ctw-select:focus { outline: none; border-color: var(--accent-border); }
      .ctw-empty { font-size: 13px; color: var(--text-label); padding: 8px 0; }
      .ctw-actions { margin-top: 10px; }
    `;
  }
}
