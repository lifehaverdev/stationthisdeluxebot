import { Component, h, eventBus } from '@monygroupcorp/microact';
import { uploadToStorage } from '../io.js';
import { postWithCsrf } from '../../lib/api.js';
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
    this.state = {
      uploading: false,
      uploadError: null,
      dragOver: false,
      // Batch execution state
      batchId: null,
      batchStatus: null, // 'running' | 'complete' | 'error'
      batchCompleted: 0,
      batchFailed: 0,
      batchTotal: 0,
      batchZipUrl: null,
      batchZipBuilding: false,
      batchResults: [],
    };
    this._processedResults = new Set();
    this._batchPieceHandler = this._handleBatchPiece.bind(this);
  }

  willUnmount() {
    eventBus.off('batchPieceComplete', this._batchPieceHandler);
  }

  _onFiles(rawFiles) {
    const files = Array.from(rawFiles || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    if (files.length > 1) {
      this._handleFiles(files);
      return;
    }
    this._handleFile(files[0]);
  }

  async _handleFile(file) {
    if (!file) return;
    this.setState({ uploading: true, uploadError: null });
    try {
      const url = await uploadToStorage(file);
      this.setState({ uploading: false });
      window.sandboxCanvas?.updateWindowOutput(this.props.win.id, { type: 'image', url });
    } catch (err) {
      this.setState({ uploading: false, uploadError: err.message });
    }
  }

  _removeOutput(index) {
    const outputs = this.props.win.outputs || [];
    const next = outputs.filter((_, i) => i !== index);
    window.sandboxCanvas?.updateWindowOutputs(this.props.win.id, next);
  }

  _clearOutput() {
    window.sandboxCanvas?.clearWindowOutput(this.props.win.id);
  }

  async _handleFiles(files) {
    this.setState({ uploading: true, uploadError: null });
    try {
      const urls = await Promise.all(files.map(f => uploadToStorage(f)));
      const outputs = urls.map((url, i) => ({ key: `image_${i}`, type: 'image', url }));
      this.setState({ uploading: false });
      window.sandboxCanvas?.updateWindowOutputs(this.props.win.id, outputs);
    } catch (err) {
      this.setState({ uploading: false, uploadError: err.message });
    }
  }

  _getBatchConn() {
    return (this.props.connections || []).find(c => c.fromOutput === 'batch');
  }

  _getBatchToolWin(batchConn) {
    if (!batchConn) return null;
    return window.sandboxCanvas?.state.windows.get(batchConn.toWindowId) || null;
  }

  _handleBatchPiece({ collectionId, generationId, status, payload }) {
    if (collectionId !== this.state.batchId) return;

    // Webhook-path payloads nest outputs under `outputs: { images: [{ url }] }`;
    // immediate-path payloads spread images to top-level. Check both.
    const images = payload?.outputs?.images ?? payload?.images;
    const url = Array.isArray(images) ? images[0]?.url : null;
    const batchConn = this._getBatchConn();
    const toolWindowId = batchConn?.toWindowId;

    if (status === 'completed' && url && toolWindowId && !this._processedResults.has(url)) {
      this._processedResults.add(url);
      window.sandboxCanvas?.updateWindowOutput(toolWindowId, { type: 'image', url });
    }

    const wasCompleted = status === 'completed' && !!url;
    const wasFailed = status === 'failed' || (status === 'completed' && !url);
    if (!wasCompleted && !wasFailed) return;

    const newCompleted = this.state.batchCompleted + (wasCompleted ? 1 : 0);
    const newFailed = this.state.batchFailed + (wasFailed ? 1 : 0);
    const total = this.state.batchTotal;
    const newResults = wasCompleted ? [...this.state.batchResults, url] : this.state.batchResults;
    const newState = { batchCompleted: newCompleted, batchFailed: newFailed, batchResults: newResults };

    if (total > 0 && (newCompleted + newFailed) >= total) {
      eventBus.off('batchPieceComplete', this._batchPieceHandler);
      newState.batchStatus = newCompleted > 0 ? 'complete' : 'error';
    }
    this.setState(newState);
  }

  async _runBatch() {
    const batchConn = this._getBatchConn();
    const toolWin = this._getBatchToolWin(batchConn);
    if (!toolWin?.tool) return;

    const images = (this.props.win.outputs || []).map(o => o.url);
    if (!images.length) return;

    const toolId = toolWin.tool.toolId || toolWin.tool.id || toolWin.tool._id;
    // Use the actual connected input key — not a hardcoded guess
    const imageParamKey = batchConn.toInput || 'input_image';

    // Resolve parameterMappings: nodeOutput refs (connected nodes) → actual values.
    // Raw nodeOutput objects would be rejected by ComfyDeploy with a 422.
    const paramOverrides = {};
    const canvas = window.sandboxCanvas;
    for (const [key, val] of Object.entries(toolWin.parameterMappings || {})) {
      if (val && typeof val === 'object' && val.type === 'nodeOutput') {
        // Resolve to the actual current output of the referenced window
        const refWin = canvas?.state.windows.get(val.nodeId);
        const out = refWin?.output;
        if (out) {
          const resolved = out.text ?? out.url ?? (out.value !== undefined ? out.value : undefined);
          if (resolved !== undefined) paramOverrides[key] = resolved;
        }
        // If unresolvable, omit — don't send the ref object
      } else {
        // Static mapping: extract the raw value, not the { type, value } wrapper
        paramOverrides[key] = (val && typeof val === 'object' && val.type === 'static') ? val.value : val;
      }
    }
    // The image slot is provided per-image by the batch loop — don't include it in overrides
    delete paramOverrides[imageParamKey];

    this._processedResults = new Set();
    this.setState({
      batchStatus: 'running',
      batchTotal: images.length,
      batchCompleted: 0,
      batchFailed: 0,
      batchZipUrl: null,
      batchResults: [],
    });

    try {
      const res = await postWithCsrf('/api/v1/batch/start', { images, toolId, imageParamKey, paramOverrides });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch start failed');
      const batchId = data.collectionId || data.batchId;
      this.setState({ batchId });
      eventBus.on('batchPieceComplete', this._batchPieceHandler);
    } catch (err) {
      this.setState({ batchStatus: 'error' });
      console.error('[UploadWindowBody] batch start error:', err);
    }
  }

  async _buildZip() {
    const { batchId } = this.state;
    if (!batchId) return;
    this.setState({ batchZipBuilding: true });
    try {
      const res = await postWithCsrf(`/api/v1/batch/${batchId}/zip`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ZIP failed');
      this.setState({ batchZipUrl: data.zipUrl, batchZipBuilding: false });
    } catch (err) {
      this.setState({ batchZipBuilding: false });
      console.error('[UploadWindowBody] zip error:', err);
    }
  }

  _renderBatchFooter(outputs) {
    const { batchStatus, batchCompleted, batchFailed, batchTotal, batchZipUrl, batchZipBuilding, batchResults } = this.state;
    const batchConn = this._getBatchConn();
    const toolWin = this._getBatchToolWin(batchConn);
    const isRunning = batchStatus === 'running';
    const isComplete = batchStatus === 'complete';

    return h('div', { className: 'nwb-batch-footer' },
      h('div', { className: 'nwb-batch-footer-top' },
        h('span', { className: 'nwb-batch-label' }, 'batch'),
        h('span', {
          className: 'nwb-batch-info',
          title: 'Connect the batch anchor (circular dot, right side) to a tool\'s image input. Then click Run to process each image through that tool. Results appear as versions on the tool node.',
        }, '?'),
        toolWin
          ? h('span', { className: 'nwb-batch-connected' }, `\u2192 ${toolWin.tool?.displayName || 'tool'}`)
          : h('span', { className: 'nwb-batch-unconnected' }, 'connect to a tool'),
      ),

      // Progress bar
      isRunning
        ? h('div', { className: 'nwb-batch-progress' },
            h('div', { className: 'nwb-batch-bar-track' },
              h('div', {
                className: 'nwb-batch-bar-fill',
                style: `width:${batchTotal > 0 ? Math.round((batchCompleted / batchTotal) * 100) : 0}%`,
              })
            ),
            h('span', { className: 'nwb-batch-progress-text' }, `${batchCompleted}/${batchTotal}`)
          )
        : null,

      // Results gallery — builds up as pieces arrive
      (isRunning || isComplete) && batchResults.length > 0
        ? h('div', { className: 'nwb-batch-gallery' },
            ...batchResults.map((url, i) =>
              h('a', { key: url, href: url, target: '_blank', className: 'nwb-batch-gallery-thumb' },
                h('img', { src: url, alt: `Result ${i + 1}` })
              )
            )
          )
        : null,

      isComplete
        ? h('div', { className: 'nwb-batch-results' },
            h('span', { className: 'nwb-batch-done-text' },
              `${batchCompleted} done${batchFailed > 0 ? `, ${batchFailed} failed` : ''}`
            ),
            batchZipUrl
              ? h('a', { href: batchZipUrl, className: 'nwb-batch-zip-link', download: true }, 'ZIP')
              : h('button', {
                  className: 'nwb-batch-zip-btn',
                  disabled: batchZipBuilding,
                  onclick: () => this._buildZip(),
                }, batchZipBuilding ? '\u22ef' : 'ZIP'),
          )
        : null,

      // Run button
      !isRunning && !isComplete
        ? h('button', {
            className: 'nwb-batch-run-btn',
            disabled: !toolWin || !outputs.length,
            onclick: () => this._runBatch(),
          }, 'Run as Batch')
        : null,

      isComplete
        ? h('button', {
            className: 'nwb-batch-run-btn nwb-batch-run-btn--rerun',
            onclick: () => this._runBatch(),
          }, 'Re-run')
        : null,
    );
  }

  render() {
    const { win } = this.props;
    const { uploading, uploadError, dragOver } = this.state;
    const outputs = win.outputs || [];
    const url = win.output?.url;
    const isBatchReady = outputs.length > 1 && outputs.every(o => o.type === outputs[0].type);

    // State: multiple outputs — show thumbnail grid, one per file
    if (outputs.length > 0) {
      return h('div', { className: 'nwb-root nwb-upload nwb-upload--multi' },
        h('div', { className: 'nwb-upload-multi-grid' },
          ...outputs.map((slot, i) =>
            h('div', { key: slot.key, className: 'nwb-upload-multi-thumb' },
              h('img', { src: slot.url, className: 'nwb-upload-multi-img', alt: `Image ${i + 1}` }),
              h('span', { className: 'nwb-upload-multi-idx' }, `${i + 1}`),
              h('button', {
                className: 'nwb-upload-remove-btn',
                onclick: (e) => { e.stopPropagation(); this._removeOutput(i); },
                title: 'Remove',
              }, '\u00D7'),
            )
          )
        ),
        isBatchReady ? this._renderBatchFooter(outputs) : null,
      );
    }

    // State: single image uploaded — show preview + remove button
    if (url) {
      return h('div', { className: 'nwb-root nwb-upload nwb-upload--done' },
        h('img', { src: url, className: 'nwb-upload-img', alt: 'Uploaded image' }),
        h('button', {
          className: 'nwb-upload-remove-btn',
          onclick: () => this._clearOutput(),
          title: 'Remove',
        }, '\u00D7'),
      );
    }

    // State: uploading
    if (uploading) {
      return h('div', { className: 'nwb-root nwb-upload-zone nwb-upload-zone--uploading' },
        h('div', { className: 'nwb-upload-spinner' }),
        h('div', { className: 'nwb-upload-zone-label' }, 'Uploading\u2026'),
      );
    }

    // State: idle — drag zone with visible file input
    return h('label', {
      className: `nwb-root nwb-upload-zone${dragOver ? ' nwb-upload-zone--over' : ''}`,
      ondragover: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ dragOver: true }); },
      ondragleave: () => this.setState({ dragOver: false }),
      ondrop: (e) => { e.preventDefault(); e.stopPropagation(); this.setState({ dragOver: false }); this._onFiles(e.dataTransfer?.files); },
    },
      h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: (e) => this._onFiles(e.target.files) }),
      h('div', { className: 'nwb-upload-zone-icon' }, '\uD83D\uDDBC\uFE0F'),
      h('div', { className: 'nwb-upload-zone-label' }, dragOver ? 'Drop to upload' : 'Drop images or click'),
      h('div', { className: 'nwb-upload-zone-hint' }, 'Single or multiple \u2014 each gets its own anchor'),
      uploadError ? h('div', { className: 'nwb-upload-zone-error' }, uploadError) : null,
    );
  }

  static get styles() {
    return `
      .nwb-upload--done { padding: 0; position: relative; }
      .nwb-upload--multi { padding: 0; position: relative; }
      .nwb-upload-multi-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
        gap: 2px; padding: 4px;
      }
      .nwb-upload-multi-thumb { position: relative; }
      .nwb-upload-multi-img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
      .nwb-upload-multi-idx {
        position: absolute; bottom: 2px; left: 2px;
        background: rgba(0,0,0,0.65); color: #fff;
        font-size: 9px; padding: 1px 3px; border-radius: 2px;
        font-family: var(--ff-mono, monospace); line-height: 1.2;
      }
      .nwb-upload-img { display: block; width: 100%; max-height: 280px; object-fit: contain; background: #111; }

      /* X button — appears on hover over the thumb or single image */
      .nwb-upload-remove-btn {
        position: absolute; top: 3px; right: 3px;
        width: 18px; height: 18px;
        background: rgba(0,0,0,0.72); color: #fff;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 50%; font-size: 13px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        padding: 0; cursor: pointer;
        opacity: 0; transition: opacity 0.1s, background 0.1s;
      }
      .nwb-upload-multi-thumb:hover .nwb-upload-remove-btn,
      .nwb-upload--done:hover .nwb-upload-remove-btn { opacity: 1; }
      .nwb-upload-remove-btn:hover { background: rgba(200,40,40,0.85); border-color: rgba(255,100,100,0.4); }

      .nwb-upload-zone {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 6px; padding: 24px 16px; text-align: center; cursor: pointer;
        border: var(--border-width, 1px) dashed var(--border, #333);
        transition: border-color 0.15s, background 0.15s;
        margin: 8px; min-height: 100px;
      }
      .nwb-upload-zone input[type=file] { display: none; }
      .nwb-upload-zone:hover, .nwb-upload-zone--over { border-color: var(--accent-border, #90caf9); }
      .nwb-upload-zone--over { background: var(--accent-dim, rgba(144,202,249,0.08)); }
      .nwb-upload-zone--uploading { cursor: default; }
      .nwb-upload-zone-icon { font-size: 24px; line-height: 1; pointer-events: none; }
      .nwb-upload-zone-label {
        font-family: var(--ff-mono, monospace); font-size: var(--fs-xs, 11px);
        letter-spacing: var(--ls-wide, 0.08em); text-transform: uppercase;
        color: var(--text-label, #888); pointer-events: none;
      }
      .nwb-upload-zone--over .nwb-upload-zone-label { color: var(--accent, #90caf9); }
      .nwb-upload-zone-hint {
        font-size: 10px; color: var(--text-label, #888); opacity: 0.6; pointer-events: none;
      }
      .nwb-upload-zone-error { color: var(--danger, #f44); font-size: 11px; margin-top: 4px; }

      .nwb-upload-spinner {
        width: 20px; height: 20px; border: 2px solid var(--border, #333);
        border-top-color: var(--accent, #90caf9); border-radius: 50%;
        animation: nwb-spin 0.8s linear infinite;
      }
      @keyframes nwb-spin { to { transform: rotate(360deg); } }

      /* ── Batch footer ── */
      .nwb-batch-footer {
        border-top: var(--border-width, 1px) solid var(--border, #333);
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .nwb-batch-footer-top { display: flex; align-items: center; gap: 5px; }
      .nwb-batch-label {
        font-family: var(--ff-mono, monospace); font-size: 9px;
        letter-spacing: 0.1em; text-transform: uppercase;
        color: var(--accent, #90caf9);
      }
      .nwb-batch-info {
        width: 13px; height: 13px; border-radius: 50%;
        border: 1px solid var(--border, #444); color: var(--text-label, #888);
        font-size: 9px; display: flex; align-items: center; justify-content: center;
        cursor: default; flex-shrink: 0;
      }
      .nwb-batch-connected {
        font-family: var(--ff-mono, monospace); font-size: 10px;
        color: var(--accent, #90caf9);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .nwb-batch-unconnected {
        font-family: var(--ff-mono, monospace); font-size: 10px;
        color: var(--text-label, #666);
      }
      .nwb-batch-run-btn {
        width: 100%; padding: 4px 0;
        background: var(--accent-dim, rgba(144,202,249,0.1));
        border: 1px solid var(--accent-border, #4a90d9);
        color: var(--accent, #90caf9);
        font-family: var(--ff-mono, monospace); font-size: 10px;
        letter-spacing: 0.06em; text-transform: uppercase;
        cursor: pointer; border-radius: 3px;
        transition: background var(--dur-micro) var(--ease);
      }
      .nwb-batch-run-btn:hover:not(:disabled) { background: rgba(144,202,249,0.18); }
      .nwb-batch-run-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .nwb-batch-run-btn--rerun { border-color: var(--border, #444); color: var(--text-label, #888); background: none; }
      .nwb-batch-progress { display: flex; align-items: center; gap: 6px; }
      .nwb-batch-bar-track {
        flex: 1; height: 3px; background: var(--surface-3, #2a2a2a);
        border-radius: 2px; overflow: hidden;
      }
      .nwb-batch-bar-fill {
        height: 100%; background: var(--accent, #90caf9);
        transition: width 0.3s ease; border-radius: 2px;
      }
      .nwb-batch-progress-text {
        font-family: var(--ff-mono, monospace); font-size: 9px;
        color: var(--text-label, #888); flex-shrink: 0;
      }
      .nwb-batch-results { display: flex; align-items: center; gap: 6px; }
      .nwb-batch-done-text {
        font-family: var(--ff-mono, monospace); font-size: 10px;
        color: var(--text-label, #888); flex: 1;
      }
      .nwb-batch-zip-btn {
        padding: 2px 8px; background: none;
        border: 1px solid var(--border, #444); color: var(--text-label, #888);
        font-size: 10px; cursor: pointer; border-radius: 3px;
      }
      .nwb-batch-zip-btn:hover { color: var(--text-primary); border-color: var(--border-hover); }
      .nwb-batch-zip-link {
        padding: 2px 8px; background: var(--accent-dim);
        border: 1px solid var(--accent-border, #4a90d9);
        color: var(--accent); font-size: 10px;
        text-decoration: none; border-radius: 3px;
      }
      .nwb-batch-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
        gap: 2px;
        margin-top: 2px;
      }
      .nwb-batch-gallery-thumb {
        display: block;
        aspect-ratio: 1;
        overflow: hidden;
        border-radius: 2px;
        background: #111;
      }
      .nwb-batch-gallery-thumb img {
        width: 100%; height: 100%; object-fit: cover;
        transition: opacity 0.2s;
      }
      .nwb-batch-gallery-thumb:hover img { opacity: 0.85; }
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
        type: inp.paramType || 'string',
        required: true,
      };
    });
    return schema;
  }

  // Parse the progress % from win.progress string ("Running… 45%" → 45)
  _getProgressPct(win) {
    if (!win.progress) return null;
    const m = win.progress.match(/(\d+)%/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Determine which step index is currently active based on overall progress
  _getActiveStepIndex(win) {
    const steps = win.spell?.steps || [];
    if (!steps.length) return -1;
    const pct = this._getProgressPct(win);
    if (pct == null) return 0; // executing but no % yet → first step
    return Math.min(Math.floor((pct / 100) * steps.length), steps.length - 1);
  }

  _renderSteps(win) {
    const steps = win.spell?.steps || [];
    if (!steps.length) return null;

    const isExecuting = win.executing;
    const isDone = !isExecuting && !!win.output;
    const activeIdx = isExecuting ? this._getActiveStepIndex(win) : -1;

    // Status line shown under the active step during execution
    const statusText = isExecuting
      ? (win.progress || 'Casting…').replace(/\d+%/, '').trim() || 'Running…'
      : null;

    return h('div', { className: 'spw-steps' },
      ...steps.map((step, i) => {
        let cls = 'spw-step';
        if (isExecuting) {
          if (i < activeIdx)      cls += ' spw-step--done';
          else if (i === activeIdx) cls += ' spw-step--active';
          else                    cls += ' spw-step--pending';
        } else if (isDone) {
          cls += ' spw-step--done';
        }

        const pct = isExecuting && i === activeIdx ? this._getProgressPct(win) : null;

        return h('div', { className: cls, key: step.id || i },
          h('div', { className: 'spw-step-num' },
            // Show checkmark for completed steps
            (isDone || (isExecuting && i < activeIdx)) ? '\u2713' : String(i + 1)
          ),
          h('div', { className: 'spw-step-body' },
            h('div', { className: 'spw-step-name' }, step.displayName || step.toolIdentifier || `Step ${i + 1}`),
            // Active step: show live status text
            isExecuting && i === activeIdx && statusText
              ? h('div', { className: 'spw-step-status' }, statusText)
              : null,
            // Active step: show progress bar if % is available
            pct != null
              ? h('div', { className: 'spw-step-bar' },
                h('div', { className: 'spw-step-bar-fill', style: `width:${pct}%` })
              )
              : null
          )
        );
      })
    );
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

    // Step pipeline — always visible when steps are known
    const stepsEl = this._renderSteps(win);
    if (stepsEl) content.push(h('div', { key: 'steps' }, stepsEl));

    if (!compact) {
      content.push(h('div', { className: 'nwb-actions', key: 'actions' },
        h(AsyncButton, {
          label: win.executing ? 'Casting…' : 'Cast Spell',
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

      /* ── Spell step pipeline ────────────────────── */
      .spw-steps {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 6px 0;
        border-top: var(--border-width) solid var(--border);
      }

      .spw-step {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 5px 8px;
        opacity: 0.45;
        transition: opacity var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease);
      }
      .spw-step--active  { opacity: 1; background: var(--accent-dim); }
      .spw-step--done    { opacity: 0.55; }
      .spw-step--pending { opacity: 0.2; }

      .spw-step-num {
        font-family: var(--ff-mono);
        font-size: 10px;
        color: var(--text-label);
        width: 16px;
        height: 16px;
        border: var(--border-width) solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 1px;
        transition: background var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .spw-step--active .spw-step-num {
        background: var(--accent-dim);
        border-color: var(--accent-border);
        color: var(--accent);
      }
      .spw-step--done .spw-step-num {
        border-color: var(--accent-border);
        color: var(--accent);
      }

      .spw-step-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .spw-step-name {
        font-family: var(--ff-sans);
        font-size: var(--fs-xs);
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color var(--dur-micro) var(--ease);
      }
      .spw-step--active .spw-step-name { color: var(--text-primary); font-weight: var(--fw-medium); }

      .spw-step-status {
        font-family: var(--ff-mono);
        font-size: 10px;
        color: var(--accent);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
      }

      .spw-step-bar {
        height: 2px;
        background: var(--surface-3);
        overflow: hidden;
      }
      .spw-step-bar-fill {
        height: 100%;
        background: var(--accent);
        transition: width 0.4s var(--ease);
      }
    `;
  }
}
