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
      .sb-root {
        width: var(--sidebar-width);
        background: var(--surface-1);
        border-left: var(--border-width) solid var(--border);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: width var(--dur-panel) var(--ease);
        position: relative;
        z-index: var(--z-sidebar);
        flex-shrink: 0;
      }

      .sb-root.collapsed { width: 0; }

      .sb-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: var(--border-width) solid var(--border);
        flex-shrink: 0;
        min-height: 36px;
      }

      .sb-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
      }

      .sb-list {
        flex: 1;
        overflow-y: auto;
      }

      .sb-category-header {
        padding: 8px 12px 4px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        border-bottom: var(--border-width) solid var(--border);
        position: sticky;
        top: 0;
        background: var(--surface-1);
      }

      .sb-tool {
        padding: 8px 12px;
        border-bottom: var(--border-width) solid var(--border);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        text-align: left;
        background: none;
        border-left: none;
        border-right: none;
        border-top: none;
        color: inherit;
        transition: background var(--dur-micro) var(--ease);
      }

      .sb-tool:hover { background: var(--surface-2); }
      .sb-tool:hover .sb-tool-name { color: var(--text-primary); }

      .sb-tool-name {
        font-family: var(--ff-sans);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--text-secondary);
        transition: color var(--dur-micro) var(--ease);
      }

      .sb-tool-desc {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .sb-handle {
        position: absolute;
        left: -20px;
        top: 50%;
        transform: translateY(-50%);
        width: 20px;
        height: 48px;
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        border-right: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--text-label);
        font-size: 8px;
        font-family: var(--ff-mono);
        transition: background var(--dur-micro) var(--ease);
      }
      .sb-handle:hover { background: var(--surface-2); }

      .sb-empty {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        padding: 16px 12px;
        letter-spacing: var(--ls-wide);
      }
    `;
  }

  _renderTools() {
    const { tools } = this.state;
    if (!tools.length) return [h('div', { className: 'sb-empty' }, 'No tools loaded.')];

    const groups = groupByCategory(tools);
    const items = [];
    for (const [cat, catTools] of Object.entries(groups)) {
      items.push(h('div', { className: 'sb-category-header', key: `cat-${cat}` }, formatCategory(cat)));
      for (const tool of catTools) {
        items.push(
          h('button', {
            className: 'sb-tool',
            key: tool.toolId || tool.displayName,
            onclick: () => this._createTool(tool),
          },
            h('div', { className: 'sb-tool-name' }, tool.displayName),
            h('div', { className: 'sb-tool-desc' }, (tool.description || '').split('.')[0])
          )
        );
      }
    }
    return items;
  }

  render() {
    const { collapsed } = this.state;

    return h('aside', {
      id: 'sidebar',
      className: `sb-root${collapsed ? ' collapsed' : ''}`,
    },
      h('div', { className: 'sb-panel-header' },
        h('span', { className: 'sb-label' }, 'Tools')
      ),
      h('div', { className: 'sb-list' },
        ...(collapsed ? [] : this._renderTools())
      ),
      h('button', {
        className: 'sb-handle',
        onclick: this.bind(this._toggle),
      }, collapsed ? '\u25B8' : '\u25C2')
    );
  }
}
