import { Component, h } from '@monygroupcorp/microact';

const USD_PER_POINT = 0.000337;

function formatCategory(cat) {
  return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function toNumber(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val);
  if (typeof val === 'object' && '$numberDecimal' in val) return parseFloat(val.$numberDecimal);
  return Number(val) || null;
}

function costEstimate(tool) {
  if (tool.metadata?.costEstimate) return tool.metadata.costEstimate;
  const mul = tool.pricing?.standardMultiplier || 1;
  const pts = (usd) => `~${Math.round((usd * mul) / USD_PER_POINT)} POINTS`;

  const rate = toNumber(tool.costingModel?.rate);
  const avg = toNumber(tool.metadata?.avgHistoricalDurationMs);
  if (rate && tool.costingModel?.unit === 'second' && avg) {
    const cost = rate * (avg / 1000);
    if (cost > 0) return pts(cost);
  }
  if (tool.costingModel?.rateSource === 'static' && tool.costingModel.staticCost?.unit === 'request') {
    return pts(tool.costingModel.staticCost.amount);
  }
  return '???';
}

function groupByCategory(tools) {
  const groups = {};
  tools.forEach(t => {
    const cat = t.category || 'uncategorized';
    (groups[cat] || (groups[cat] = [])).push(t);
  });
  return groups;
}

/**
 * Sidebar — collapsible tool list.
 *
 * Listens for sandbox:availableTools via eventBus. Creates tool windows
 * by calling window.sandboxCanvas.addToolWindow() — no old module graph deps.
 */
export class Sidebar extends Component {
  constructor(props) {
    super(props);
    this.state = { collapsed: true, tools: [] };
  }

  didMount() {
    this.subscribe('sandbox:availableTools', (tools) => {
      this.setState({ tools: [...tools] });
    });

    // Pick up tools that loaded before we mounted
    const shared = window.__sandboxState__?.availableTools;
    if (shared?.length) this.setState({ tools: [...shared] });
  }

  _toggle() {
    this.setState({ collapsed: !this.state.collapsed });
  }

  _createTool(tool) {
    const canvas = window.sandboxCanvas;
    if (!canvas) {
      console.warn('[Sidebar] sandboxCanvas not ready yet');
      return;
    }

    // Place the new window near the center of the canvas viewport
    const canvasEl = document.querySelector('.sc-root');
    let pos = { x: 200, y: 200 };
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      pos = canvas.screenToWorkspace(rect.left + rect.width / 2, rect.top + rect.height / 2);
      // Offset each window a bit so they don't stack exactly
      pos.x += (Math.random() - 0.5) * 80;
      pos.y += (Math.random() - 0.5) * 80;
    }

    canvas.addToolWindow(tool, pos);
  }

  static get styles() {
    return `
      .sb-sidebar-wrap { display: flex; align-items: stretch; position: relative; }
      .sb-tools { padding: 8px; overflow-y: auto; max-height: calc(100vh - 120px); }
      .sb-cat { margin: 12px 0 6px; color: rgba(255,255,255,0.9); font-family: monospace; font-size: 13px; font-weight: 600; }
      .sb-tool {
        display: block; width: 100%; padding: 10px; margin: 3px 0; text-align: left;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px; color: #fff; cursor: pointer; position: relative;
        font-family: inherit; transition: background 0.15s;
      }
      .sb-tool:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); }
      .sb-tool-name { font-family: monospace; font-size: 13px; margin-bottom: 3px; }
      .sb-tool-desc { font-size: 11px; color: rgba(255,255,255,0.5); line-height: 1.3; }
      .sb-tool-cost {
        position: absolute; bottom: 4px; right: 4px;
        background: rgba(0,255,0,0.15); border: 1px solid rgba(0,255,0,0.3);
        border-radius: 3px; padding: 1px 5px; font-size: 9px; color: #0f0;
        font-family: monospace;
      }
      .sb-empty { color: #666; font-size: 13px; padding: 16px 8px; }
    `;
  }

  _renderTools() {
    const { tools } = this.state;
    if (!tools.length) return [h('div', { className: 'sb-empty' }, 'No tools loaded.')];

    const groups = groupByCategory(tools);
    const items = [];
    for (const [cat, catTools] of Object.entries(groups)) {
      items.push(h('div', { className: 'sb-cat', key: `cat-${cat}` }, formatCategory(cat)));
      for (const tool of catTools) {
        items.push(
          h('button', {
            className: 'sb-tool',
            key: tool.toolId || tool.displayName,
            onclick: () => this._createTool(tool),
          },
            h('div', { className: 'sb-tool-name' }, tool.displayName),
            h('div', { className: 'sb-tool-desc' }, (tool.description || '').split('.')[0]),
            h('div', { className: 'sb-tool-cost' }, costEstimate(tool))
          )
        );
      }
    }
    return items;
  }

  render() {
    const { collapsed } = this.state;

    return h('div', { className: 'sb-sidebar-wrap' },
      h('aside', {
        id: 'sidebar',
        className: `sandbox-sidebar${collapsed ? ' collapsed' : ''}`,
      },
        h('div', { className: 'sidebar-content' },
          h('h3', null, 'Tools'),
          h('div', { className: 'sb-tools' },
            ...(collapsed ? [] : this._renderTools())
          )
        )
      ),
      h('button', {
        id: 'sidebar-toggle',
        className: 'sidebar-toggle',
        onclick: this.bind(this._toggle),
      }, collapsed ? '\u2692\uFE0E' : '\u2715')
    );
  }
}
