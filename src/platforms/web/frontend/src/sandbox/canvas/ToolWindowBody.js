import { Component, h, eventBus } from '@monygroupcorp/microact';
import { uploadToStorage } from '../io.js';
import { ParameterForm } from '../components/windows/ParameterForm.js';
import { ResultDisplay } from '../components/windows/ResultDisplay.js';
import { AsyncButton } from '../components/ModalKit.js';
import { Loader } from '../components/Modal.js';

/**
 * ErrorBlock — clickable error message that copies its text to the clipboard.
 */
class ErrorBlock extends Component {
  constructor(props) {
    super(props);
    this.state = { copied: false };
  }

  _copy() {
    navigator.clipboard.writeText(this.props.message || '').catch(() => {});
    this.setState({ copied: true });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.setState({ copied: false }), 1500);
  }

  render() {
    const { copied } = this.state;
    return h('div', {
      className: `nwb-error${copied ? ' nwb-error--copied' : ''}`,
      onclick: () => this._copy(),
      title: 'Click to copy',
    },
      h('span', { className: 'nwb-error-msg' }, this.props.message),
      h('span', { className: 'nwb-error-copy-hint' }, copied ? 'Copied \u2713' : '\u238b'),
    );
  }
}

/**
 * ToolWindowBody — body content for tool execution windows.
 *
 * Renders parameter form, execute button, progress indicator, and result.
 * All data comes from props — no internal state.
 *
 * Props:
 *   win           — window state { parameterMappings, output, executing, progress, error, tool, ... }
 *   connections   — connections to this window (for connected indicators)
 *   onParamChange — (windowId, key, value) => void
 *   onExecute     — (windowId) => void
 *   onLoadOutput  — (windowId) => void  (lazy-load persisted output)
 */
export class ToolWindowBody extends Component {
  shouldUpdate(oldProps, newProps) {
    return oldProps.win !== newProps.win || oldProps.compact !== newProps.compact;
  }

  render() {
    const { win, connections, onParamChange, onExecute, onLoadOutput, compact } = this.props;
    const content = [];

    // Error
    if (win.error) {
      content.push(h(ErrorBlock, { key: 'error', message: win.error }));
    }

    if (!compact) {
      // Parameter form
      content.push(h(ParameterForm, {
        key: 'params',
        windowId: win.id,
        schema: win.tool?.inputSchema,
        mappings: win.parameterMappings,
        connections: connections || [],
        onMappingChange: (key, value) => onParamChange?.(win.id, key, value),
      }));
    }

    // Progress
    if (win.executing) {
      content.push(h('div', { className: 'nwb-progress', key: 'progress' },
        h(Loader, { message: win.progress || 'Executing...' })
      ));
    }

    if (!compact) {
      // Execute button
      content.push(h('div', { className: 'nwb-actions', key: 'actions' },
        h(AsyncButton, {
          label: 'Execute',
          loading: win.executing,
          onclick: () => onExecute?.(win.id),
        }),
      ));
    }

    // Output
    if (win.output && !win.outputLoaded) {
      const loadLabel = win.output.type === 'image' ? 'Load Image' : win.output.type === 'text' ? 'Load Text' : 'Load Output';
      content.push(h('button', {
        className: 'nwb-load',
        key: 'load',
        onclick: () => onLoadOutput?.(win.id),
      }, loadLabel));
    }
    if (win.output && win.outputLoaded !== false) {
      content.push(h('div', { className: 'nwb-output', key: 'output' },
        h(ResultDisplay, { output: win.output, displayName: win.tool?.displayName })
      ));
    }

    return h('div', { className: 'nwb-root' }, ...content);
  }

  static get styles() {
    return `
      .nwb-error {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        color: #f44;
        font-size: 16px;
        padding: 8px;
        background: rgba(255,68,68,0.08);
        border-radius: 6px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background var(--dur-micro, 80ms) ease;
      }
      .nwb-error:hover { background: rgba(255,68,68,0.14); }
      .nwb-error--copied { background: rgba(255,68,68,0.05); }
      .nwb-error-msg { flex: 1; }
      .nwb-error-copy-hint {
        flex-shrink: 0;
        font-size: 13px;
        opacity: 0.55;
        font-family: var(--ff-mono);
        letter-spacing: var(--ls-wide);
      }
      .nwb-error--copied .nwb-error-copy-hint { opacity: 0.8; color: var(--accent); }
      .nwb-progress { padding: 8px 0; }
      .nwb-actions { margin-top: 8px; }
      .nwb-output { margin-top: 8px; }
      .nwb-load { background: #222; border: 1px solid #444; color: #90caf9; padding: 6px 14px; border-radius: 4px; font-size: 14px; cursor: pointer; margin-top: 8px; width: 100%; }
      .nwb-load:hover { border-color: #90caf9; }
    `;
  }
}

/**
 * UploadWindowBody — body content for upload/image-source nodes.
 *
 * When empty (no URL yet): renders an interactive drop zone — drag-drop or
 * click to pick a file, uploads via uploadToStorage, then calls
 * window.sandboxCanvas.updateWindowOutput() to push the result downstream.
 *
 * When populated: shows the uploaded image.
 *
 * Props:
 *   win — window state { output: { type: 'image', url } | null }
 */
export class UploadWindowBody extends Component {
  constructor(props) {
    super(props);
    this.state = { uploading: false, uploadError: null, dragOver: false };
    this._fileInput = null;
  }

  shouldUpdate(oldProps, newProps) {
    return oldProps.win !== newProps.win;
  }

  async _handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.setState({ uploadError: 'Images only.' });
      return;
    }
    this.setState({ uploading: true, uploadError: null });
    try {
      const url = await uploadToStorage(file);
      window.sandboxCanvas?.updateWindowOutput(this.props.win.id, { type: 'image', url });
    } catch (err) {
      this.setState({ uploading: false, uploadError: err.message });
    }
  }

  render() {
    const { win } = this.props;
    const { uploading, uploadError, dragOver } = this.state;
    const url = win.output?.url;

    if (url) {
      return h('div', { className: 'nwb-root nwb-upload' },
        h('img', { src: url, className: 'nwb-upload-img', alt: 'Uploaded image' }),
        h('div', { className: 'nwb-upload-url', title: url }, url.split('/').pop())
      );
    }

    if (uploading) {
      return h('div', { className: 'nwb-root nwb-upload-zone' },
        h('div', { className: 'nwb-upload-zone-label' }, 'uploading...')
      );
    }

    return h('div', {
      className: `nwb-root nwb-upload-zone${dragOver ? ' nwb-upload-zone--over' : ''}`,
      onclick: (e) => { e.stopPropagation(); this._fileInput?.click(); },
      ondragover: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ dragOver: true }); },
      ondragleave: () => this.setState({ dragOver: false }),
      ondrop: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ dragOver: false }); this._handleFile(e.dataTransfer.files[0]); },
    },
      h('input', {
        type: 'file', accept: 'image/*', style: 'display:none',
        ref: (el) => { this._fileInput = el; },
        onchange: (e) => this._handleFile(e.target.files[0]),
      }),
      h('div', { className: 'nwb-upload-zone-label' }, dragOver ? 'drop image' : 'drop or click'),
      uploadError ? h('div', { className: 'nwb-upload-zone-error' }, uploadError) : null,
    );
  }

  static get styles() {
    return `
      .nwb-upload { padding: 0; }
      .nwb-upload-img { display: block; width: 100%; max-height: 280px; object-fit: contain; background: #111; }
      .nwb-upload-url { font-size: 12px; color: #555; padding: 4px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nwb-upload-zone {
        padding: 24px 16px;
        text-align: center;
        border: var(--border-width) dashed var(--border);
        cursor: pointer;
        transition: border-color var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease);
        margin: 8px;
      }
      .nwb-upload-zone:hover,
      .nwb-upload-zone--over { border-color: var(--accent-border); }
      .nwb-upload-zone--over { background: var(--accent-dim); }
      .nwb-upload-zone-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        color: var(--text-label);
        pointer-events: none;
      }
      .nwb-upload-zone--over .nwb-upload-zone-label { color: var(--accent); }
      .nwb-upload-zone-error {
        color: var(--danger);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        margin-top: 6px;
      }
    `;
  }
}

/**
 * PrimitiveWindowBody — body content for primitive/passthrough value nodes.
 *
 * Renders a simple input control (textarea for text, number input for int/float,
 * URL input for image). Output is set immediately on every keystroke — no
 * execution step. The output flows into downstream connected nodes.
 *
 * Props:
 *   win            — window state { tool.metadata.outputType, output }
 *   onOutputChange — (windowId, output) => void
 */
export class PrimitiveWindowBody extends Component {
  shouldUpdate(oldProps, newProps) {
    return oldProps.win !== newProps.win;
  }

  _getVal() {
    const out = this.props.win.output;
    return out
      ? (out.text ?? out.url ?? (out.value !== undefined ? String(out.value) : ''))
      : '';
  }

  _onInlineChange(e) {
    const { win, onOutputChange } = this.props;
    const raw = e.target.value;
    const outputType = win.tool?.metadata?.outputType || 'text';
    let output;
    if (outputType === 'int')        output = { type: 'int',   value: parseInt(raw, 10) || 0 };
    else if (outputType === 'float') output = { type: 'float', value: parseFloat(raw)   || 0 };
    else if (outputType === 'image') output = { type: 'image', url: raw };
    else                             output = { type: 'text',  text: raw };
    onOutputChange?.(win.id, output);
  }

  _openOverlay(e) {
    e.stopPropagation();
    const { win } = this.props;
    eventBus.emit('sandbox:openTextEdit', {
      windowId: win.id,
      value: this._getVal(),
      displayName: win.tool?.displayName || 'Text Input',
    });
  }

  render() {
    const { win } = this.props;
    const outputType = win.tool?.metadata?.outputType || 'text';
    const val = this._getVal();

    // Text: compact preview that opens the full-screen overlay on click
    if (outputType === 'text') {
      return h('div', { className: 'nwb-root nwb-primitive' },
        h('div', {
          className: `nwb-primitive-preview${val ? '' : ' nwb-primitive-preview--empty'}`,
          onclick: this.bind(this._openOverlay),
          title: 'Click to edit',
        }, val || 'click to edit...')
      );
    }

    // Number inputs — compact enough inline
    if (outputType === 'int' || outputType === 'float') {
      return h('div', { className: 'nwb-root nwb-primitive' },
        h('input', {
          type: 'number',
          className: 'nwb-primitive-number',
          value: val,
          step: outputType === 'float' ? 'any' : '1',
          placeholder: outputType === 'float' ? '0.0' : '0',
          oninput: this.bind(this._onInlineChange),
        })
      );
    }

    // Image URL — inline input
    if (outputType === 'image') {
      return h('div', { className: 'nwb-root nwb-primitive' },
        h('input', {
          type: 'url',
          className: 'nwb-primitive-url',
          value: val,
          placeholder: 'https://...',
          oninput: this.bind(this._onInlineChange),
        })
      );
    }

    // Fallback: preview
    return h('div', { className: 'nwb-root nwb-primitive' },
      h('div', {
        className: `nwb-primitive-preview${val ? '' : ' nwb-primitive-preview--empty'}`,
        onclick: this.bind(this._openOverlay),
        title: 'Click to edit',
      }, val || 'click to edit...')
    );
  }

  static get styles() {
    return `
      .nwb-primitive { padding: 6px; }

      /* Compact text preview — click to open full overlay */
      .nwb-primitive-preview {
        min-height: 48px;
        max-height: 72px;
        overflow: hidden;
        background: var(--surface-3);
        border: var(--border-width) solid var(--border);
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        line-height: 1.5;
        padding: 6px 8px;
        cursor: text;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        transition: border-color var(--dur-micro) var(--ease);
        box-sizing: border-box;
      }
      .nwb-primitive-preview:hover { border-color: var(--accent-border); }
      .nwb-primitive-preview--empty {
        color: var(--text-label);
        font-style: italic;
      }

      .nwb-primitive-number,
      .nwb-primitive-url {
        width: 100%;
        background: var(--surface-3);
        border: var(--border-width) solid var(--border);
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        padding: 6px 8px;
        outline: none;
        transition: border-color var(--dur-micro) var(--ease);
        box-sizing: border-box;
      }
      .nwb-primitive-number:focus,
      .nwb-primitive-url:focus { border-color: var(--accent-border); }
    `;
  }
}

/**
 * SpellWindowBody — body content for spell execution windows.
 *
 * Similar to ToolWindowBody but renders exposed inputs instead of full schema,
 * handles locked/error states, and shows "Cast Spell" instead of "Execute".
 *
 * Props: same as ToolWindowBody
 */
export class SpellWindowBody extends Component {
  shouldUpdate(oldProps, newProps) {
    return oldProps.win !== newProps.win || oldProps.compact !== newProps.compact;
  }

  _getExposedSchema(win) {
    if (!win.spell?.exposedInputs) return {};
    const schema = {};
    win.spell.exposedInputs.forEach(inp => {
      schema[`${inp.nodeId}_${inp.paramKey}`] = {
        name: inp.paramKey,
        type: 'string',
        required: true,
      };
    });
    return schema;
  }

  render() {
    const { win, onParamChange, onExecute, compact } = this.props;

    // Locked state
    if (win.isAccessible === false) {
      const isPermission = win.accessError?.includes('permission');
      return h('div', { className: 'nwb-locked' },
        h('div', { className: 'nwb-locked-icon' }, isPermission ? '\uD83D\uDD12' : '\u26A0\uFE0F'),
        h('div', { className: 'nwb-locked-title' }, isPermission ? 'Private Spell' : 'Failed to Load'),
        h('div', { className: 'nwb-locked-msg' }, win.accessError || 'Unable to load spell.'),
      );
    }

    // Loading metadata
    if (win.metadataLoading) {
      return h('div', null, h(Loader, { message: 'Loading spell...' }));
    }

    const content = [];

    if (win.error) {
      content.push(h(ErrorBlock, { key: 'error', message: win.error }));
    }

    if (!compact) {
      // Exposed inputs form
      const schema = this._getExposedSchema(win);
      content.push(h(ParameterForm, {
        key: 'params',
        windowId: win.id,
        schema,
        mappings: win.parameterMappings,
        connections: [],
        onMappingChange: (key, value) => onParamChange?.(win.id, key, value),
      }));
    }

    if (win.executing) {
      content.push(h('div', { className: 'nwb-progress', key: 'progress' },
        h(Loader, { message: win.progress || 'Casting...' })
      ));
    }

    if (!compact) {
      content.push(h('div', { className: 'nwb-actions', key: 'actions' },
        h(AsyncButton, {
          label: 'Cast Spell',
          loading: win.executing,
          disabled: win.isAccessible === false,
          onclick: () => onExecute?.(win.id),
        }),
      ));
    }

    if (win.output && win.outputLoaded !== false) {
      content.push(h('div', { className: 'nwb-output', key: 'output' },
        h(ResultDisplay, { output: win.output, displayName: win.spell?.name || win.tool?.displayName })
      ));
    }

    return h('div', { className: 'nwb-root' }, ...content);
  }

  static get styles() {
    return `
      .nwb-locked { text-align: center; padding: 24px; color: #999; display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .nwb-locked-icon { font-size: 38px; opacity: 0.7; }
      .nwb-locked-title { font-weight: 600; color: #666; font-size: 19px; }
      .nwb-locked-msg { font-size: 17px; color: #888; }
    `;
  }
}
