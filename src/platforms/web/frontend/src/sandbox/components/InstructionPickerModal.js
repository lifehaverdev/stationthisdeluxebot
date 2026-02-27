import { Component, h } from '@monygroupcorp/microact';
import { INSTRUCTION_PRESETS } from '../instructionPresets.js';

/**
 * InstructionPickerModal — two-column overlay for selecting and editing instruction presets.
 *
 * Props:
 *   displayName   — param label (shown in header)
 *   currentValue  — current instructions value
 *   onApply       — (text: string) => void
 *   onClose       — () => void
 */
export class InstructionPickerModal extends Component {
  constructor(props) {
    super(props);
    const initial = this._matchPreset(props.currentValue);
    this.state = {
      selectedId: initial.id,
      editedText: props.currentValue || '',
    };
    this._escHandler = null;
  }

  _matchPreset(value) {
    if (!value) return INSTRUCTION_PRESETS.find(p => p.id === 'custom');
    const match = INSTRUCTION_PRESETS.find(p => p.id !== 'custom' && p.text === value);
    return match || INSTRUCTION_PRESETS.find(p => p.id === 'custom');
  }

  didMount() {
    this._escHandler = (e) => { if (e.key === 'Escape') this.props.onClose?.(); };
    document.addEventListener('keydown', this._escHandler);
    requestAnimationFrame(() => document.querySelector('.ipm-textarea')?.focus());
  }

  willUnmount() {
    document.removeEventListener('keydown', this._escHandler);
  }

  _selectPreset(preset) {
    this.setState({
      selectedId: preset.id,
      editedText: preset.id === 'custom' ? '' : preset.text,
    });
    requestAnimationFrame(() => {
      const ta = document.querySelector('.ipm-textarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    });
  }

  static get styles() {
    return `
      .ipm-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--z-modal, 900);
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ipm-panel {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        width: min(780px, 94vw);
        max-height: 76vh;
        display: flex;
        flex-direction: column;
        animation: fadeUp var(--dur-trans) var(--ease);
      }
      .ipm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-3);
        flex-shrink: 0;
      }
      .ipm-title {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .ipm-close {
        background: none;
        border: none;
        color: var(--text-label);
        cursor: pointer;
        font-size: 19px;
        line-height: 1;
        padding: 0;
        transition: color var(--dur-micro) var(--ease);
      }
      .ipm-close:hover { color: var(--text-secondary); }
      .ipm-body {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      /* Left column — preset list */
      .ipm-list {
        width: 200px;
        flex-shrink: 0;
        border-right: var(--border-width) solid var(--border);
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .ipm-preset {
        padding: 10px 12px;
        cursor: pointer;
        border-bottom: var(--border-width) solid var(--border);
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        color: var(--text-secondary);
        transition: background var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ipm-preset:last-child { border-bottom: none; }
      .ipm-preset:hover { background: var(--surface-3); color: var(--text-primary); }
      .ipm-preset--active {
        background: var(--accent-dim);
        color: var(--accent);
        border-color: var(--accent-border);
      }
      .ipm-preset--active:hover { background: var(--accent-dim); color: var(--accent); }
      .ipm-preset-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--accent);
        flex-shrink: 0;
        opacity: 0;
      }
      .ipm-preset--active .ipm-preset-dot { opacity: 1; }
      .ipm-preset--custom {
        margin-top: auto;
        border-top: var(--border-width) solid var(--border);
        color: var(--text-label);
      }
      .ipm-preset--custom.ipm-preset--active { color: var(--accent); }
      /* Right column — editor */
      .ipm-editor {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .ipm-textarea {
        flex: 1;
        min-height: 280px;
        background: var(--surface-3);
        border: none;
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: 14px;
        line-height: 1.6;
        padding: 14px;
        resize: none;
        outline: none;
      }
      .ipm-textarea:focus { color: var(--text-primary); }
      .ipm-textarea::placeholder { color: var(--text-label); font-style: italic; }
      .ipm-footer {
        display: flex;
        justify-content: flex-end;
        padding: 8px 12px;
        border-top: var(--border-width) solid var(--border);
        background: var(--surface-3);
        flex-shrink: 0;
        gap: 8px;
      }
      .ipm-btn {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 6px 14px;
        border: var(--border-width) solid var(--border);
        cursor: pointer;
        transition: border-color var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease);
      }
      .ipm-btn-cancel { background: none; color: var(--text-label); }
      .ipm-btn-cancel:hover { color: var(--text-secondary); border-color: var(--border-hover); }
      .ipm-btn-apply {
        background: var(--accent-dim);
        color: var(--accent);
        border-color: var(--accent-border);
      }
      .ipm-btn-apply:hover { background: var(--accent); color: var(--canvas-bg); }
      .ipm-btn-apply:disabled { opacity: 0.4; cursor: not-allowed; }
    `;
  }

  render() {
    const { displayName, onClose, onApply } = this.props;
    const { selectedId, editedText } = this.state;

    const presets = INSTRUCTION_PRESETS.filter(p => p.id !== 'custom');
    const custom = INSTRUCTION_PRESETS.find(p => p.id === 'custom');

    return h('div', {
      className: 'ipm-backdrop',
      onmousedown: () => onClose?.(),
    },
      h('div', {
        className: 'ipm-panel',
        onmousedown: (e) => e.stopPropagation(),
      },
        h('div', { className: 'ipm-header' },
          h('span', { className: 'ipm-title' }, displayName || 'Choose Instructions'),
          h('button', { className: 'ipm-close', onclick: () => onClose?.() }, '\u00D7'),
        ),
        h('div', { className: 'ipm-body' },
          h('div', { className: 'ipm-list' },
            ...presets.map(preset =>
              h('div', {
                key: preset.id,
                className: `ipm-preset${selectedId === preset.id ? ' ipm-preset--active' : ''}`,
                onclick: () => this._selectPreset(preset),
              },
                h('span', { className: 'ipm-preset-dot' }),
                preset.title,
              )
            ),
            h('div', {
              className: `ipm-preset ipm-preset--custom${selectedId === 'custom' ? ' ipm-preset--active' : ''}`,
              onclick: () => this._selectPreset(custom),
            },
              h('span', { className: 'ipm-preset-dot' }),
              'Custom',
            ),
          ),
          h('div', { className: 'ipm-editor' },
            h('textarea', {
              className: 'ipm-textarea',
              value: editedText,
              placeholder: selectedId === 'custom'
                ? 'Write your own instructions...'
                : 'Select a preset to load its text, then edit freely.',
              oninput: (e) => this.setState({ editedText: e.target.value }),
            }),
            h('div', { className: 'ipm-footer' },
              h('button', { className: 'ipm-btn ipm-btn-cancel', onclick: () => onClose?.() }, 'Cancel'),
              h('button', {
                className: 'ipm-btn ipm-btn-apply',
                disabled: !editedText.trim(),
                onclick: () => { onApply?.(editedText.trim()); onClose?.(); },
              }, 'Apply'),
            ),
          ),
        ),
      )
    );
  }
}
