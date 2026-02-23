import { Component, h, eventBus } from '@monygroupcorp/microact';
import { CopyButton } from '../ModalKit.js';

/**
 * ResultDisplay — renders execution output (image/text/video/file/spell steps).
 *
 * Auto-normalizes output format from various API response shapes into a
 * consistent { type, url?, text?, files?, steps? } shape before rendering.
 *
 * Props:
 *   output        — raw output object from execution
 *   onImageClick  — (url) => void — opens image overlay
 *   onVideoClick  — (url) => void — opens video overlay
 *   onDuplicate   — () => void — duplicate-and-run (optional)
 */
export class ResultDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = { spellStepIdx: 0, copied: false, imgError: false };
  }

  // ── Output normalization ──────────────────────────────────

  _normalize(output) {
    if (!output) return null;
    if (output.type) {
      // Defensive: { type: 'text', data: { text: string|string[] } } with no top-level .text
      if (output.type === 'text' && output.text == null && output.data?.text) {
        const txt = Array.isArray(output.data.text) ? output.data.text[0] : output.data.text;
        return { ...output, text: txt ?? '' };
      }
      return output;
    }

    // Auto-detect type from common response shapes
    if (Array.isArray(output.artifactUrls) && output.artifactUrls.length) {
      return { ...output, type: 'image', url: output.artifactUrls[0] };
    }
    if (Array.isArray(output.images) && output.images.length) {
      const first = output.images[0];
      const url = typeof first === 'string'
        ? first
        : first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : null);
      return { ...output, type: 'image', url };
    }
    if (output.imageUrl) return { ...output, type: 'image', url: output.imageUrl };
    if (output.image) return { ...output, type: 'image', url: output.image };

    if (output.text || output.response || output.data?.text || output.data?.response) {
      const txt = output.text || output.response || output.data?.text || output.data?.response;
      return { ...output, type: 'text', text: txt };
    }

    if (output.audio || output.audioUrl || (Array.isArray(output.audios) && output.audios.length)) {
      const aud = Array.isArray(output.audios) ? output.audios[0] : (output.audio || output.audioUrl);
      return { ...output, type: 'audio', url: typeof aud === 'string' ? aud : aud.url };
    }

    if (output.video || output.videoUrl || (Array.isArray(output.videos) && output.videos.length)) {
      const vid = Array.isArray(output.videos) ? output.videos[0] : (output.video || output.videoUrl);
      return { ...output, type: 'video', url: typeof vid === 'string' ? vid : vid.url };
    }

    if (output.files || output.data?.files) {
      const filesArr = output.files || (Array.isArray(output.data?.files) ? output.data.files : Object.values(output.data?.files || {}));
      const vidFile = filesArr.find(f => /\.mp4$|\.webm$/i.test(f.url || f));
      if (vidFile && filesArr.length === 1) {
        return { ...output, type: 'video', url: vidFile.url || vidFile };
      }
      return { ...output, type: 'file', files: filesArr };
    }

    // Spell multi-step output
    if (output.steps && Array.isArray(output.steps)) {
      return { ...output, type: 'spell-steps' };
    }

    return output;
  }

  // ── Open result overlay ───────────────────────────────────

  _expand(output) {
    eventBus.emit('sandbox:openResultOverlay', { output, displayName: this.props.displayName });
  }

  // ── Render by type ────────────────────────────────────────

  _renderImage(output) {
    const imgError = this.state.imgError;

    if (imgError) {
      return h('div', { className: 'rd-img-expired' },
        h('div', { className: 'rd-img-expired-label' }, 'Image expired')
      );
    }

    return h('img', {
      src: output.url,
      className: 'rd-img',
      onclick: () => this._expand(output),
      title: 'Click to expand',
      onerror: () => this.setState({ imgError: true }),
    });
  }

  _renderText(output) {
    const text = output.text || '';
    return [
      h('div', {
        className: 'rd-text-content',
        onclick: () => this._expand(output),
        title: 'Click to expand',
      }, text),
      h('div', { className: 'rd-text-hint' }, 'Click to expand'),
    ];
  }

  _renderVideo(output) {
    return h('div', { className: 'rd-vid-wrap', onclick: () => this._expand(output), title: 'Click to expand' },
      h('video', { src: output.url, className: 'rd-vid' })
    );
  }

  _renderAudio(output) {
    return h('div', {
      className: 'rd-audio-wrap',
      onclick: () => this._expand(output),
      title: 'Click to expand',
    },
      h('div', { className: 'rd-audio-label' }, 'audio — click to play')
    );
  }

  _renderFiles(output) {
    const files = output.files || [];
    return h('div', { className: 'rd-files' },
      ...files.map((f, i) => {
        const url = typeof f === 'string' ? f : f.url;
        const name = f.name || url?.split('/').pop() || `File ${i + 1}`;
        const isVideo = /\.mp4$|\.webm$/i.test(url || '');

        if (isVideo) {
          return h('div', { className: 'rd-file-item', key: i },
            h('video', { src: url, controls: true, className: 'rd-vid' })
          );
        }

        return h('div', { className: 'rd-file-item', key: i },
          h('a', { href: url, target: '_blank', className: 'rd-file-link' }, name)
        );
      })
    );
  }

  _renderSpellSteps(output) {
    const steps = output.steps || [];
    const { spellStepIdx } = this.state;
    const currentStep = steps[spellStepIdx];

    return h('div', { className: 'rd-spell' },
      // Step selector buttons
      h('div', { className: 'rd-spell-tabs' },
        ...steps.map((step, i) =>
          h('button', {
            className: `rd-spell-tab${i === spellStepIdx ? ' rd-spell-tab--active' : ''}`,
            key: i,
            onclick: () => this.setState({ spellStepIdx: i }),
          }, `Step ${i + 1}`)
        )
      ),
      // Render current step's output recursively
      currentStep
        ? h(ResultDisplay, {
          output: currentStep,
          onImageClick: this.props.onImageClick,
          onVideoClick: this.props.onVideoClick,
        })
        : h('div', { className: 'rd-empty' }, 'No output for this step')
    );
  }

  // ── Styles ────────────────────────────────────────────────

  static get styles() {
    return `
      .rd-root {
        position: relative;
        background: var(--surface-1);
        border-top: var(--border-width) solid var(--border);
        overflow: hidden;
      }

      .rd-empty {
        padding: 16px 10px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        text-align: center;
      }

      /* Image fades in — no pop */
      .rd-img {
        display: block;
        width: 100%;
        height: auto;
        animation: fadeIn var(--dur-panel) var(--ease);
        cursor: pointer;
      }
      .rd-img:hover { opacity: 0.92; }

      /* Expired image placeholder */
      .rd-img-expired {
        padding: 20px 10px;
        background: var(--surface-2);
        text-align: center;
      }
      .rd-img-expired-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
      }


      .rd-text-content {
        padding: 10px;
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        color: var(--text-primary);
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        animation: fadeIn var(--dur-trans) var(--ease);
        cursor: pointer;
        max-height: 240px;
        overflow-y: auto;
      }
      .rd-text-content:hover { color: var(--accent); }
      .rd-text-hint {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        text-align: right;
        padding: 0 10px 6px;
        letter-spacing: var(--ls-wide);
      }

      .rd-vid-wrap {
        cursor: pointer;
        position: relative;
      }
      .rd-vid-wrap::after {
        content: '▶';
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 38px;
        color: rgba(255,255,255,0.7);
        background: rgba(0,0,0,0.3);
        opacity: 0;
        transition: opacity var(--dur-micro) var(--ease);
      }
      .rd-vid-wrap:hover::after { opacity: 1; }
      .rd-vid { display: block; width: 100%; pointer-events: none; }

      .rd-audio-wrap {
        padding: 14px 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background var(--dur-micro) var(--ease);
      }
      .rd-audio-wrap:hover { background: var(--surface-2); }
      .rd-audio-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
      }

      .rd-files { display: flex; flex-direction: column; }
      .rd-file-item { padding: 6px 10px; border-bottom: var(--border-width) solid var(--border); }
      .rd-file-link {
        color: var(--accent);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        text-decoration: none;
        letter-spacing: var(--ls-wide);
      }
      .rd-file-link:hover { color: var(--text-primary); }

      .rd-spell-tabs {
        display: flex;
        border-bottom: var(--border-width) solid var(--border);
        overflow-x: auto;
      }
      .rd-spell-tab {
        background: none;
        border: none;
        border-right: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 4px 10px;
        cursor: pointer;
        white-space: nowrap;
        transition: color var(--dur-micro) var(--ease);
      }
      .rd-spell-tab:hover { color: var(--text-secondary); }
      .rd-spell-tab--active { color: var(--accent); border-bottom: 1px solid var(--accent); }

      .rd-unknown-label {
        padding: 8px 10px 2px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        opacity: 0.6;
      }
      .rd-unknown-raw {
        font-size: var(--fs-xs);
        color: var(--text-label);
        max-height: 120px;
      }

      .rd-action {
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 4px 10px;
        margin: 8px 10px;
        transition:
          color var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease);
      }
      .rd-action:hover { color: var(--text-primary); border-color: var(--border-hover); }
    `;
  }

  // ── Main render ───────────────────────────────────────────

  render() {
    // Reset image error state when a new output arrives
    if (this.props.output !== this._lastOutput) {
      this._lastOutput = this.props.output;
      if (this.state.imgError) this.state.imgError = false;
    }

    const output = this._normalize(this.props.output);
    if (!output) return h('div', { style: 'display:none' });

    let inner;
    switch (output.type) {
      case 'image':       inner = this._renderImage(output); break;
      case 'text':        inner = this._renderText(output); break;
      case 'video':       inner = this._renderVideo(output); break;
      case 'audio':       inner = this._renderAudio(output); break;
      case 'file':        inner = this._renderFiles(output); break;
      case 'spell-steps': inner = this._renderSpellSteps(output); break;
      default:
        inner = [
          h('div', { className: 'rd-unknown-label' }, 'Unexpected output format'),
          h('div', {
            className: 'rd-text-content rd-unknown-raw',
            onclick: () => this._expand(output),
            title: 'Click to expand',
          }, JSON.stringify(output, null, 2)),
        ];
    }

    return h('div', { className: 'rd-root' },
      ...(Array.isArray(inner) ? inner : [inner])
    );
  }
}
