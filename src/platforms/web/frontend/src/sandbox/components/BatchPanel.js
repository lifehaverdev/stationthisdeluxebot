import { Component, h } from '@monygroupcorp/microact';
import { uploadToStorage } from '../io.js';
import { postWithCsrf, fetchJson } from '../../lib/api.js';
import { Loader } from './Modal.js';
import { AsyncButton } from './ModalKit.js';

const STATUS = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
};

const ITEM_STATUS = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETE: 'complete',
  FAILED: 'failed',
};

/**
 * BatchPanel — bottom-sheet overlay for batch image processing.
 *
 * Props:
 *   files       — File[] (from the upload trigger)
 *   onClose     — () => void
 *   initialTool — tool object pre-selected from canvas (optional)
 */
export class BatchPanel extends Component {
  constructor(props) {
    super(props);

    const items = (props.files || []).map((file, i) => ({
      id: `item-${i}`,
      file,
      previewUrl: URL.createObjectURL(file),
      storageUrl: null,
      status: ITEM_STATUS.PENDING,
      result: null,
      error: null,
      durationMs: null,
      costUsd: null,
    }));

    this.state = {
      status: STATUS.IDLE,
      items,
      batchId: null,

      // Generator selection
      selectedTool: props.initialTool || null,
      selectedSpell: null,
      generatorType: props.initialTool ? 'tool' : null,
      paramOverrides: {},

      // Tool picker visibility
      showToolPicker: false,
      toolOptions: [],

      // Stats
      completedCount: 0,
      failedCount: 0,
      totalCostUsd: 0,
      startedAt: null,

      // ZIP
      zipUrl: null,
      zipBuilding: false,
      zipError: null,
    };

    this._pollInterval = null;
  }

  willUnmount() {
    clearInterval(this._pollInterval);
    this.state.items.forEach(item => URL.revokeObjectURL(item.previewUrl));
  }

  async _loadToolOptions() {
    try {
      const tools = await fetchJson('/api/v1/tools/registry');
      this.setState({ toolOptions: Array.isArray(tools) ? tools : [] });
    } catch (e) {
      console.warn('[BatchPanel] Could not load tool options:', e);
    }
  }

  _removeItem(id) {
    if (this.state.status !== STATUS.IDLE) return;
    const items = this.state.items.filter(it => it.id !== id);
    const removed = this.state.items.find(it => it.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    this.setState({ items });
  }

  _updateItem(id, updates) {
    const items = this.state.items.map(it => it.id === id ? { ...it, ...updates } : it);
    this.setState({ items });
  }

  async _runBatch() {
    const { items, selectedTool, selectedSpell, generatorType, paramOverrides } = this.state;
    if (!items.length) return;
    if (!selectedTool && !selectedSpell) {
      alert('Please select a tool or spell first.');
      return;
    }

    this.setState({ status: STATUS.UPLOADING, startedAt: Date.now() });

    // 1. Upload all images
    const uploadedItems = [];
    for (const item of items) {
      this._updateItem(item.id, { status: ITEM_STATUS.UPLOADING });
      try {
        const storageUrl = await uploadToStorage(item.file);
        uploadedItems.push({ ...item, storageUrl, status: ITEM_STATUS.QUEUED });
        this._updateItem(item.id, { status: ITEM_STATUS.QUEUED, storageUrl });
      } catch (err) {
        this._updateItem(item.id, { status: ITEM_STATUS.FAILED, error: err.message });
      }
    }

    const successfulUploads = uploadedItems.filter(it => it.storageUrl);
    if (!successfulUploads.length) {
      this.setState({ status: STATUS.ERROR });
      return;
    }

    // 2. Start batch run
    this.setState({ status: STATUS.RUNNING });
    try {
      const body = {
        images: successfulUploads.map(it => it.storageUrl),
        paramOverrides,
      };
      if (generatorType === 'tool' && selectedTool) body.toolId = selectedTool.id || selectedTool._id;
      if (generatorType === 'spell' && selectedSpell) body.spellId = selectedSpell.id || selectedSpell._id;

      const res = await postWithCsrf('/api/v1/batch/start', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch start failed');

      const batchId = data.collectionId || data.batchId;
      this.setState({ batchId });
      this._startPolling(batchId, successfulUploads);
    } catch (err) {
      this.setState({ status: STATUS.ERROR });
      console.error('[BatchPanel] start error:', err);
    }
  }

  _startPolling(batchId, uploadedItems) {
    const urlToId = {};
    uploadedItems.forEach(it => { urlToId[it.storageUrl] = it.id; });

    this._pollInterval = setInterval(async () => {
      try {
        const data = await fetchJson(`/api/v1/batch/${batchId}`);
        const outputs = data.outputs || [];
        let completedCount = 0;
        let failedCount = 0;
        let totalCostUsd = 0;

        for (const output of outputs) {
          const itemId = urlToId[output.sourceUrl] || urlToId[output.inputImageUrl];
          if (!itemId) continue;
          if (output.error) {
            this._updateItem(itemId, { status: ITEM_STATUS.FAILED, error: output.error });
            failedCount++;
          } else if (output.resultUrl || output.imageUrl) {
            this._updateItem(itemId, {
              status: ITEM_STATUS.COMPLETE,
              result: { type: 'image', url: output.resultUrl || output.imageUrl },
              durationMs: output.durationMs,
              costUsd: output.costUsd,
            });
            completedCount++;
            totalCostUsd += output.costUsd || 0;
          }
        }

        this.setState({ completedCount, failedCount, totalCostUsd });

        const allSettled = (completedCount + failedCount) >= uploadedItems.length;
        if (allSettled) {
          clearInterval(this._pollInterval);
          this.setState({ status: STATUS.COMPLETE });
        }
      } catch (e) {
        console.warn('[BatchPanel] poll error:', e);
      }
    }, 2000);
  }

  async _buildZip() {
    const { batchId } = this.state;
    if (!batchId) return;
    this.setState({ zipBuilding: true, zipError: null });
    try {
      const res = await postWithCsrf(`/api/v1/batch/${batchId}/zip`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ZIP failed');
      this.setState({ zipUrl: data.zipUrl, zipBuilding: false });
    } catch (err) {
      this.setState({ zipBuilding: false, zipError: err.message });
    }
  }

  async _promote() {
    const { batchId } = this.state;
    if (!batchId) return;
    try {
      const res = await postWithCsrf(`/api/v1/batch/${batchId}/promote`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Promote failed');
      window.dispatchEvent(new CustomEvent('batch:promoted', { detail: { collectionId: data.collectionId } }));
      this.props.onClose?.();
    } catch (err) {
      console.error('[BatchPanel] promote error:', err);
    }
  }

  _renderHeader() {
    const { status, items, selectedTool, selectedSpell } = this.state;
    const generatorName = selectedTool?.displayName || selectedSpell?.name || 'No generator';
    const isRunning = status === STATUS.RUNNING || status === STATUS.UPLOADING;

    return h('div', { className: 'bp-header' },
      h('div', { className: 'bp-header-left' },
        h('span', { className: 'bp-title' }, 'Batch'),
        h('span', { className: 'bp-meta' }, `${items.length} images`),
        h('span', { className: 'bp-meta' }, generatorName),
      ),
      h('button', {
        className: 'bp-close',
        onclick: () => this.props.onClose?.(),
        disabled: isRunning,
      }, isRunning ? 'Running...' : '\u00D7')
    );
  }

  _renderControls() {
    const { status, selectedTool, selectedSpell, showToolPicker } = this.state;
    const isRunning = status === STATUS.RUNNING || status === STATUS.UPLOADING;
    const generatorLabel = selectedTool?.displayName || selectedSpell?.name || 'Select tool or spell...';

    return h('div', { className: 'bp-controls' },
      h('button', {
        className: 'bp-generator-btn',
        onclick: () => {
          if (!this.state.toolOptions.length) this._loadToolOptions();
          this.setState({ showToolPicker: !showToolPicker });
        },
        disabled: isRunning,
      }, generatorLabel),
      showToolPicker ? this._renderToolPicker() : null,
      h(AsyncButton, {
        label: 'Run Batch',
        loading: isRunning,
        disabled: isRunning || (!selectedTool && !selectedSpell),
        onclick: () => this._runBatch(),
      })
    );
  }

  _renderToolPicker() {
    const { toolOptions } = this.state;
    if (!toolOptions.length) return h('div', { className: 'bp-picker-loading' }, 'Loading tools...');

    return h('div', { className: 'bp-tool-picker' },
      ...toolOptions.map(tool =>
        h('button', {
          key: tool.id || tool._id,
          className: 'bp-tool-option',
          onclick: () => this.setState({
            selectedTool: tool,
            selectedSpell: null,
            generatorType: 'tool',
            showToolPicker: false,
          }),
        }, tool.displayName || tool.name)
      )
    );
  }

  _renderInputStrip() {
    const { items, status } = this.state;
    const isRunning = status === STATUS.RUNNING || status === STATUS.UPLOADING;

    return h('div', { className: 'bp-input-strip' },
      ...items.map(item =>
        h('div', { key: item.id, className: 'bp-input-thumb' },
          h('img', { src: item.previewUrl, className: 'bp-thumb-img', alt: '' }),
          !isRunning ? h('button', {
            className: 'bp-thumb-remove',
            onclick: () => this._removeItem(item.id),
          }, '\u00D7') : null
        )
      )
    );
  }

  _renderGallery() {
    const { items } = this.state;
    const hasResults = items.some(it =>
      it.status === ITEM_STATUS.COMPLETE ||
      it.status === ITEM_STATUS.FAILED ||
      it.status === ITEM_STATUS.RUNNING ||
      it.status === ITEM_STATUS.QUEUED
    );
    if (!hasResults) return null;

    return h('div', { className: 'bp-gallery' },
      ...items.map(item => {
        if (item.status === ITEM_STATUS.COMPLETE) {
          return h('div', { key: item.id, className: 'bp-result-card bp-result-card--done' },
            h('img', { src: item.result?.url, className: 'bp-result-img', alt: '' }),
            h('div', { className: 'bp-result-stats' },
              item.durationMs ? h('span', {}, `${(item.durationMs / 1000).toFixed(1)}s`) : null,
              item.costUsd ? h('span', {}, `$${item.costUsd.toFixed(3)}`) : null,
            )
          );
        }
        if (item.status === ITEM_STATUS.FAILED) {
          return h('div', { key: item.id, className: 'bp-result-card bp-result-card--error' },
            h('div', { className: 'bp-result-error' }, item.error || 'Failed'),
          );
        }
        if (item.status === ITEM_STATUS.RUNNING || item.status === ITEM_STATUS.QUEUED || item.status === ITEM_STATUS.UPLOADING) {
          return h('div', { key: item.id, className: 'bp-result-card bp-result-card--loading' },
            h(Loader, { message: item.status })
          );
        }
        return null;
      }).filter(Boolean)
    );
  }

  _renderStatsBar() {
    const { status, completedCount, failedCount, totalCostUsd, items, startedAt,
            zipUrl, zipBuilding, zipError } = this.state;
    if (status === STATUS.IDLE) return null;

    const total = items.length;
    const avgS = completedCount > 0 && startedAt
      ? ((Date.now() - startedAt) / completedCount / 1000).toFixed(1)
      : null;

    return h('div', { className: 'bp-stats-bar' },
      h('span', { className: 'bp-stat' }, `${completedCount}/${total} done`),
      failedCount > 0 ? h('span', { className: 'bp-stat bp-stat--warn' }, `${failedCount} failed`) : null,
      totalCostUsd > 0 ? h('span', { className: 'bp-stat' }, `$${totalCostUsd.toFixed(3)}`) : null,
      avgS ? h('span', { className: 'bp-stat' }, `avg ${avgS}s`) : null,
      h('div', { className: 'bp-stats-actions' },
        status === STATUS.COMPLETE
          ? h('button', {
              className: 'bp-promote-btn',
              onclick: () => this._promote(),
            }, 'Promote to Collection')
          : null,
        status === STATUS.COMPLETE && !zipUrl
          ? h(AsyncButton, {
              label: zipBuilding ? 'Building ZIP...' : 'Download ZIP',
              loading: zipBuilding,
              onclick: () => this._buildZip(),
            })
          : null,
        zipUrl
          ? h('a', { href: zipUrl, className: 'bp-zip-link', download: true }, 'Download ZIP')
          : null,
        zipError ? h('span', { className: 'bp-stat bp-stat--warn' }, zipError) : null,
      )
    );
  }

  render() {
    return h('div', { className: 'bp-overlay' },
      h('div', { className: 'bp-panel' },
        this._renderHeader(),
        this._renderControls(),
        this._renderInputStrip(),
        this._renderGallery(),
        this._renderStatsBar(),
      )
    );
  }

  static get styles() {
    return `
      .bp-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        pointer-events: none;
        display: flex;
        align-items: flex-end;
      }
      .bp-panel {
        pointer-events: auto;
        width: 100%;
        background: var(--surface-1, #1a1a1a);
        border-top: 1px solid var(--border, #333);
        border-radius: 12px 12px 0 0;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 70vh;
        overflow-y: auto;
      }
      .bp-header { display: flex; align-items: center; justify-content: space-between; }
      .bp-header-left { display: flex; align-items: center; gap: 12px; }
      .bp-title { font-size: 15px; font-weight: 600; color: var(--text-primary, #fff); }
      .bp-meta { font-size: 13px; color: var(--text-label, #888); font-family: var(--ff-mono, monospace); }
      .bp-close { background: none; border: none; color: var(--text-label, #888); font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
      .bp-close:hover { color: var(--text-primary, #fff); }
      .bp-close:disabled { opacity: 0.4; cursor: not-allowed; }
      .bp-controls { display: flex; align-items: center; gap: 8px; position: relative; }
      .bp-generator-btn { background: var(--surface-2, #222); border: 1px solid var(--border, #333); color: var(--text-primary, #fff); padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; }
      .bp-generator-btn:hover { border-color: var(--accent, #90caf9); }
      .bp-tool-picker { position: absolute; top: 100%; left: 0; background: var(--surface-2, #222); border: 1px solid var(--border, #333); border-radius: 8px; padding: 8px; z-index: 10; max-height: 240px; overflow-y: auto; min-width: 240px; display: flex; flex-direction: column; gap: 2px; }
      .bp-tool-option { background: none; border: none; color: var(--text-primary, #fff); padding: 6px 10px; border-radius: 4px; cursor: pointer; text-align: left; font-size: 13px; }
      .bp-tool-option:hover { background: var(--surface-3, #333); }
      .bp-input-strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
      .bp-input-thumb { position: relative; flex-shrink: 0; }
      .bp-thumb-img { width: 64px; height: 64px; object-fit: cover; border-radius: 4px; display: block; }
      .bp-thumb-remove { position: absolute; top: -4px; right: -4px; background: #333; border: none; color: #fff; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      .bp-gallery { display: flex; flex-wrap: wrap; gap: 8px; }
      .bp-result-card { width: 140px; border-radius: 6px; overflow: hidden; background: var(--surface-2, #222); border: 1px solid var(--border, #333); }
      .bp-result-card--done { border-color: var(--border, #333); }
      .bp-result-card--error { border-color: #f44; padding: 8px; }
      .bp-result-card--loading { height: 80px; display: flex; align-items: center; justify-content: center; }
      .bp-result-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
      .bp-result-stats { display: flex; gap: 8px; padding: 4px 6px; font-size: 11px; color: var(--text-label, #888); font-family: var(--ff-mono, monospace); }
      .bp-result-error { color: #f44; font-size: 12px; }
      .bp-stats-bar { display: flex; align-items: center; gap: 12px; padding-top: 8px; border-top: 1px solid var(--border, #333); flex-wrap: wrap; }
      .bp-stat { font-size: 12px; color: var(--text-label, #888); font-family: var(--ff-mono, monospace); }
      .bp-stat--warn { color: #f44; }
      .bp-stats-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
      .bp-zip-link { background: var(--accent, #90caf9); color: #000; padding: 6px 14px; border-radius: 6px; font-size: 13px; text-decoration: none; font-weight: 600; }
      .bp-promote-btn { background: none; border: 1px solid var(--border, #333); color: var(--text-label, #888); padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; }
      .bp-promote-btn:hover { border-color: var(--accent, #90caf9); color: var(--text-primary, #fff); }
      .bp-picker-loading { padding: 12px; color: var(--text-label, #888); font-size: 13px; }
    `;
  }
}
