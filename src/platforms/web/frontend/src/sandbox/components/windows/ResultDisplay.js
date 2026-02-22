import { Component, h } from '@monygroupcorp/microact';
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
    this.state = { spellStepIdx: 0, copied: false };
  }

  // ── Output normalization ──────────────────────────────────

  _normalize(output) {
    if (!output) return null;
    if (output.type) return output;

    // Auto-detect type from common response shapes
    if (Array.isArray(output.artifactUrls) && output.artifactUrls.length) {
      return { ...output, type: 'image', url: output.artifactUrls[0] };
    }
    if (Array.isArray(output.images) && output.images.length) {
      const first = output.images[0];
      return { ...output, type: 'image', url: typeof first === 'string' ? first : first.url };
    }
    if (output.imageUrl) return { ...output, type: 'image', url: output.imageUrl };
    if (output.image) return { ...output, type: 'image', url: output.image };

    if (output.text || output.response || output.data?.text || output.data?.response) {
      const txt = output.text || output.response || output.data?.text || output.data?.response;
      return { ...output, type: 'text', text: txt };
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

  // ── Copy text to clipboard ────────────────────────────────

  _copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      this.setTimeout(() => this.setState({ copied: false }), 1500);
    });
  }

  // ── Render by type ────────────────────────────────────────

  _renderImage(output) {
    const url = output.url;
    return h('div', { className: 'rd-image' },
      h('img', {
        src: url,
        className: 'rd-img',
        onclick: () => this.props.onImageClick?.(url),
        title: 'Click to enlarge',
      }),
      this.props.onDuplicate
        ? h('button', { className: 'rd-action', onclick: this.props.onDuplicate }, '\u21BB Rerun')
        : null
    );
  }

  _renderText(output) {
    const text = output.text || '';
    return h('div', { className: 'rd-text' },
      h('div', {
        className: 'rd-text-content',
        onclick: () => this._copyText(text),
        title: 'Click to copy',
      }, text),
      h('div', { className: 'rd-text-hint' }, this.state.copied ? 'Copied!' : 'Click to copy')
    );
  }

  _renderVideo(output) {
    const url = output.url;
    return h('div', { className: 'rd-video' },
      h('video', {
        src: url,
        controls: true,
        className: 'rd-vid',
        onclick: (e) => { e.preventDefault(); this.props.onVideoClick?.(url); },
      })
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
      .rd-image { text-align: center; }
      .rd-img { max-width: 100%; max-height: 300px; border-radius: 6px; cursor: pointer; transition: opacity 0.15s; }
      .rd-img:hover { opacity: 0.9; }

      .rd-text-content { background: #222; border: 1px solid #333; border-radius: 6px; padding: 10px; font-size: 13px; color: #e0e0e0; white-space: pre-wrap; word-break: break-word; cursor: pointer; max-height: 200px; overflow-y: auto; line-height: 1.5; }
      .rd-text-content:hover { border-color: #90caf9; }
      .rd-text-hint { font-size: 11px; color: #666; text-align: right; margin-top: 4px; }

      .rd-video { text-align: center; }
      .rd-vid { max-width: 100%; max-height: 300px; border-radius: 6px; }

      .rd-files { display: flex; flex-direction: column; gap: 6px; }
      .rd-file-item { padding: 6px 0; }
      .rd-file-link { color: #90caf9; font-size: 13px; text-decoration: none; }
      .rd-file-link:hover { text-decoration: underline; }

      .rd-spell-tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
      .rd-spell-tab { background: #222; border: 1px solid #444; color: #888; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; }
      .rd-spell-tab:hover { border-color: #666; color: #ccc; }
      .rd-spell-tab--active { background: #3f51b5; border-color: #3f51b5; color: #fff; }

      .rd-empty { color: #666; font-size: 13px; text-align: center; padding: 16px; }

      .rd-action { background: none; border: 1px solid #444; color: #888; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; margin-top: 8px; }
      .rd-action:hover { border-color: #666; color: #ccc; }
    `;
  }

  // ── Main render ───────────────────────────────────────────

  render() {
    const output = this._normalize(this.props.output);
    if (!output) return h('div', { style: 'display:none' });

    switch (output.type) {
      case 'image': return this._renderImage(output);
      case 'text': return this._renderText(output);
      case 'video': return this._renderVideo(output);
      case 'file': return this._renderFiles(output);
      case 'spell-steps': return this._renderSpellSteps(output);
      default:
        // Unknown type — show raw JSON
        return h('div', { className: 'rd-text' },
          h('div', { className: 'rd-text-content' }, JSON.stringify(output, null, 2))
        );
    }
  }
}
