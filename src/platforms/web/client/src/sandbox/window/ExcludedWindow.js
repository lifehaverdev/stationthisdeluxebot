import BaseWindow from './BaseWindow.js';
import { renderResultContent } from '../node/resultContent.js';

const PAGE_SIZE = 16;

class ExcludedWindow extends BaseWindow {
  constructor({ collection, position = { x: 240, y: 160 } }) {
    const id = `excluded-${Math.random().toString(36).slice(2, 10)}`;
    const title = `${collection.name || 'Collection'} · Revive Excluded`;
    super({ id, title, position, classes: ['collection-window', 'excluded-review-window'] });
    this.collection = collection;
    this._items = [];
    this._cursor = null;
    this._fetchPromise = null;
    this._loading = false;
    this._completed = false;
    this.renderBody();
  }

  static async _getCsrfToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && ExcludedWindow._csrfToken) return ExcludedWindow._csrfToken;
    const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch CSRF token');
    const data = await res.json();
    ExcludedWindow._csrfToken = data?.token || data?.csrfToken || '';
    return ExcludedWindow._csrfToken;
  }

  renderBody() {
    this.body.innerHTML = '';
    const intro = document.createElement('div');
    intro.className = 'excluded-intro';
    intro.style.cssText = 'padding: 10px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 8px; font-size: 13px; line-height: 1.4;';
    intro.innerHTML = `<strong>Revive excluded pieces.</strong> Review previously dropped items and mark the ones you want to keep again.`;
    this.body.appendChild(intro);

    const counter = document.createElement('div');
    counter.className = 'excluded-counter';
    counter.style.cssText = 'margin-bottom: 8px; font-size: 13px; color: #d0d0d0;';
    counter.textContent = 'Loading excluded pieces…';
    this._counterEl = counter;
    this.body.appendChild(counter);

    const resultContainer = document.createElement('div');
    resultContainer.className = 'result-container';
    resultContainer.style.minHeight = '320px';
    this.body.appendChild(resultContainer);
    this._resultContainer = resultContainer;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top: 12px; display: flex; gap: 8px;';
    const keepBtn = document.createElement('button');
    keepBtn.textContent = 'Keep ✅';
    keepBtn.onclick = () => this._markKeep();
    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'Skip ↷';
    skipBtn.onclick = () => this._skipPiece();
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => this.close();
    btnRow.append(keepBtn, skipBtn, closeBtn);
    this.body.appendChild(btnRow);
    this._keepBtn = keepBtn;
    this._skipBtn = skipBtn;
    this._emptyMessage = document.createElement('div');
    this._emptyMessage.style.cssText = 'margin-top: 16px; font-size: 14px; color: #9ac899;';
    this.body.appendChild(this._emptyMessage);

    this._loadNext();
  }

  async _loadNext() {
    if (this._loading) return;
    if (!this._items.length && this._completed) {
      this._renderNoItems();
      return;
    }
    if (!this._items.length) {
      await this._fetchBatch();
    }
    if (!this._items.length) {
      this._renderNoItems();
      return;
    }
    const entry = this._items[0];
    this._renderEntry(entry);
    this._updateCounter();
  }

  async _fetchBatch() {
    if (this._fetchPromise) {
      return this._fetchPromise;
    }
    this._loading = true;
    this._fetchPromise = (async () => {
      try {
        const params = new URLSearchParams({
          limit: PAGE_SIZE
        });
        if (this._cursor) params.set('cursor', this._cursor);
        const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/excluded?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store'
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length) {
          this._items.push(...items);
          this._cursor = data.nextCursor || null;
        } else {
          this._completed = true;
        }
      } catch (err) {
        console.error('[ExcludedWindow] failed to load excluded pieces', err);
        this._emptyMessage.textContent = 'Failed to load excluded pieces. Please close and try again.';
      } finally {
        this._loading = false;
        this._fetchPromise = null;
      }
    })();
    await this._fetchPromise;
  }

  _renderEntry(entry) {
    if (!entry) return;
    const gen = entry.generation || entry;
    if (!gen) {
      this._resultContainer.textContent = 'Unable to load piece.';
      return;
    }
    this._resultContainer.innerHTML = '';
    const data = this._normaliseGeneration(gen);
    renderResultContent(this._resultContainer, data);
    this._emptyMessage.textContent = '';
  }

  _normaliseGeneration(gen) {
    const outputs = gen.outputs || gen.responsePayload || gen.artifactUrls || {};
    if (Array.isArray(outputs) && outputs[0]?.data?.images?.[0]?.url) {
      return { type: 'image', url: outputs[0].data.images[0].url, generationId: gen._id };
    }
    if (Array.isArray(outputs.images) && outputs.images.length) {
      const firstImg = outputs.images[0];
      return { type: 'image', url: (typeof firstImg === 'string' ? firstImg : firstImg.url), generationId: gen._id };
    }
    if (outputs.image) {
      return { type: 'image', url: outputs.image, generationId: gen._id };
    }
    if (outputs.imageUrl) {
      return { type: 'image', url: outputs.imageUrl, generationId: gen._id };
    }
    if (outputs.text) {
      return { type: 'text', text: outputs.text, generationId: gen._id };
    }
    if (outputs.response) {
      return { type: 'text', text: outputs.response, generationId: gen._id };
    }
    if (outputs.steps && Array.isArray(outputs.steps)) {
      return { type: 'spell', steps: outputs.steps, generationId: gen._id };
    }
    return { type: 'unknown', generationId: gen._id, ...outputs };
  }

  async _markKeep() {
    if (!this._items.length) return;
    const entry = this._items.shift();
    this._updateButtons(true);
    try {
      const csrf = await ExcludedWindow._getCsrfToken();
      const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/commit`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf
        },
        body: JSON.stringify({
          decisions: [{ generationId: entry.generationId || entry.generation?._id, action: 'keep' }]
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Keep failed');
      }
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('collection:cull-updated', {
            detail: { collectionId: this.collection.collectionId }
          }));
        } catch (_) {
          // ignore
        }
      }
    } catch (err) {
      console.error('[ExcludedWindow] failed to mark keep', err);
      alert('Failed to keep piece: ' + (err.message || 'unknown error'));
    } finally {
      this._updateButtons(false);
      this._loadNext();
    }
  }

  _skipPiece() {
    if (!this._items.length) {
      this._loadNext();
      return;
    }
    const entry = this._items.shift();
    this._items.push(entry);
    this._loadNext();
  }

  _renderNoItems() {
    this._resultContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #9ac899;">No excluded pieces left to review.</div>';
    this._emptyMessage.textContent = '';
    this._completed = true;
  }

  _updateButtons(disabled) {
    if (this._keepBtn) this._keepBtn.disabled = !!disabled;
    if (this._skipBtn) this._skipBtn.disabled = !!disabled;
  }

  _updateCounter() {
    if (!this._counterEl) return;
    if (this._completed && !this._items.length) {
      this._counterEl.textContent = 'All excluded pieces reviewed.';
      return;
    }
    const remaining = this._items.length;
    this._counterEl.textContent = `${remaining} piece${remaining === 1 ? '' : 's'} in queue • more load automatically`;
  }
}

export function createExcludedWindow(collection, position) {
  const win = new ExcludedWindow({ collection, position });
  win.mount();
  return win.el;
}

export default ExcludedWindow;
