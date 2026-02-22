import { Component, h } from '@monygroupcorp/microact';
import { ParameterForm } from '../components/windows/ParameterForm.js';
import { ResultDisplay } from '../components/windows/ResultDisplay.js';
import { AsyncButton } from '../components/ModalKit.js';
import { Loader } from '../components/Modal.js';

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
    return oldProps.win !== newProps.win;
  }

  render() {
    const { win, connections, onParamChange, onExecute, onLoadOutput } = this.props;
    const content = [];

    // Error
    if (win.error) {
      content.push(h('div', { className: 'nwb-error', key: 'error' }, win.error));
    }

    // Parameter form
    content.push(h(ParameterForm, {
      key: 'params',
      schema: win.tool?.inputSchema,
      mappings: win.parameterMappings,
      connections: connections || [],
      onMappingChange: (key, value) => onParamChange?.(win.id, key, value),
    }));

    // Progress
    if (win.executing) {
      content.push(h('div', { className: 'nwb-progress', key: 'progress' },
        h(Loader, { message: win.progress || 'Executing...' })
      ));
    }

    // Execute button
    content.push(h('div', { className: 'nwb-actions', key: 'actions' },
      h(AsyncButton, {
        label: 'Execute',
        loading: win.executing,
        onclick: () => onExecute?.(win.id),
      })
    ));

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
        h(ResultDisplay, { output: win.output })
      ));
    }

    return h('div', { className: 'nwb-root' }, ...content);
  }

  static get styles() {
    return `
      .nwb-error { color: #f44; font-size: 13px; padding: 8px; background: rgba(255,68,68,0.08); border-radius: 6px; margin-bottom: 8px; }
      .nwb-progress { padding: 8px 0; }
      .nwb-actions { margin-top: 8px; }
      .nwb-output { margin-top: 8px; }
      .nwb-load { background: #222; border: 1px solid #444; color: #90caf9; padding: 6px 14px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-top: 8px; width: 100%; }
      .nwb-load:hover { border-color: #90caf9; }
    `;
  }
}

/**
 * UploadWindowBody — body content for upload nodes.
 *
 * Displays the uploaded image. The node's output is already set at creation
 * time so other nodes can connect to it as an image input.
 *
 * Props:
 *   win — window state { output: { type: 'image', url } }
 */
export class UploadWindowBody extends Component {
  shouldUpdate(oldProps, newProps) {
    return oldProps.win !== newProps.win;
  }

  render() {
    const { win } = this.props;
    const url = win.output?.url;

    if (!url) {
      return h('div', { className: 'nwb-root nwb-upload-empty' }, 'No image.');
    }

    return h('div', { className: 'nwb-root nwb-upload' },
      h('img', {
        src: url,
        className: 'nwb-upload-img',
        alt: 'Uploaded image',
      }),
      h('div', { className: 'nwb-upload-url', title: url }, url.split('/').pop())
    );
  }

  static get styles() {
    return `
      .nwb-upload { padding: 0; }
      .nwb-upload-img { display: block; width: 100%; border-radius: 0 0 6px 6px; max-height: 280px; object-fit: contain; background: #111; }
      .nwb-upload-url { font-size: 10px; color: #555; padding: 4px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nwb-upload-empty { color: #666; font-size: 13px; text-align: center; padding: 16px; }
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
    return oldProps.win !== newProps.win;
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
    const { win, onParamChange, onExecute, onLoadOutput } = this.props;

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
      content.push(h('div', { className: 'nwb-error', key: 'error' }, win.error));
    }

    // Exposed inputs form
    const schema = this._getExposedSchema(win);
    content.push(h(ParameterForm, {
      key: 'params',
      schema,
      mappings: win.parameterMappings,
      connections: [],
      onMappingChange: (key, value) => onParamChange?.(win.id, key, value),
    }));

    if (win.executing) {
      content.push(h('div', { className: 'nwb-progress', key: 'progress' },
        h(Loader, { message: win.progress || 'Casting...' })
      ));
    }

    content.push(h('div', { className: 'nwb-actions', key: 'actions' },
      h(AsyncButton, {
        label: 'Cast Spell',
        loading: win.executing,
        disabled: win.isAccessible === false,
        onclick: () => onExecute?.(win.id),
      })
    ));

    if (win.output && win.outputLoaded !== false) {
      content.push(h('div', { className: 'nwb-output', key: 'output' },
        h(ResultDisplay, { output: win.output })
      ));
    }

    return h('div', { className: 'nwb-root' }, ...content);
  }

  static get styles() {
    return `
      .nwb-locked { text-align: center; padding: 24px; color: #999; display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .nwb-locked-icon { font-size: 32px; opacity: 0.7; }
      .nwb-locked-title { font-weight: 600; color: #666; font-size: 16px; }
      .nwb-locked-msg { font-size: 14px; color: #888; }
    `;
  }
}
