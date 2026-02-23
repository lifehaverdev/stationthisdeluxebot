import { Component, h } from '@monygroupcorp/microact';
import { marked } from 'marked';
import { fetchJson } from '../lib/api.js';
import { RawHtml } from '../components/RawHtml.js';

export class Docs extends Component {
  constructor(props) {
    super(props);
    this.state = {
      sections: [],
      currentIndex: -1,
      contentHtml: '',
      loading: true,
      pricingData: null,
      pricingLoading: false,
      pricingError: null,
    };
  }

  async didMount() {
    // Load NOEMA design-system CSS (same mechanism as Sandbox)
    this._cssLink = document.createElement('link');
    this._cssLink.rel = 'stylesheet';
    this._cssLink.href = '/index.css';
    document.head.appendChild(this._cssLink);

    try {
      const sections = await fetchJson('/docs/docs-manifest.json');
      this.setState({ sections });
      window.addEventListener('hashchange', this.bind(this.onHashChange));
      this.loadFromHash(sections);
    } catch (err) {
      this.setState({ contentHtml: '<p>Error loading documentation.</p>', loading: false });
    }
  }

  willUnmount() {
    window.removeEventListener('hashchange', this.bind(this.onHashChange));
    if (this._cssLink?.parentNode) this._cssLink.parentNode.removeChild(this._cssLink);
  }

  onHashChange() {
    this.loadFromHash(this.state.sections);
  }

  async loadFromHash(sections) {
    if (!sections.length) return;
    const hash = (location.hash.substring(1) || sections[0].id).split('#')[0];
    const idx = sections.findIndex(s => s.id === hash);
    const sectionIdx = idx === -1 ? 0 : idx;
    const section = sections[sectionIdx];

    this.setState({ currentIndex: sectionIdx, loading: true });

    if (section.special === 'tools-renderer') {
      await this.renderTools();
    } else if (section.special === 'pricing-renderer') {
      await this.renderPricing();
    } else {
      await this.renderMarkdown(section.file);
    }
  }

  async renderMarkdown(filePath) {
    try {
      const res = await fetch(filePath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const md = await res.text();
      this.setState({ contentHtml: marked.parse(md), loading: false });
    } catch (err) {
      this.setState({ contentHtml: '<p>Error loading content.</p>', loading: false });
    }
  }

  async renderTools() {
    try {
      const tools = await fetchJson('/api/v1/tools');
      let html = '<h1>Tools</h1>';
      html += '<p>The following tools are available through the API and other integrations.</p>';
      tools.forEach(tool => {
        const cmdId = tool.commandName ? tool.commandName.replace('/', '') : tool.toolId;
        html += `
          <div class="doc-tool-card" id="tool-${cmdId}">
            <h2>${tool.displayName || tool.toolId}</h2>
            <div class="doc-tool-meta">
              <span class="doc-tool-cmd">${tool.commandName || 'N/A'}</span>
              <span class="doc-tool-cat">${tool.category || 'uncategorized'}</span>
            </div>
            <p>${tool.description || 'No description available.'}</p>
            ${this.renderParamsTable(tool.inputSchema)}
          </div>`;
      });
      this.setState({ contentHtml: html, loading: false });
    } catch (err) {
      this.setState({ contentHtml: '<p>Error loading tools.</p>', loading: false });
    }
  }

  async renderPricing() {
    this.setState({ loading: false, pricingLoading: true, pricingError: null });
    try {
      const data = await fetchJson('/api/v1/points/supported-assets');
      const tokens = Array.isArray(data.tokens) ? data.tokens : [];
      tokens.sort((a, b) => (1 - (a.fundingRate || 0)) - (1 - (b.fundingRate || 0)));

      const grouped = {};
      tokens.forEach(tk => {
        const pct = typeof tk.fundingRate === 'number'
          ? ((1 - tk.fundingRate) * 100).toFixed(0)
          : '?';
        if (!grouped[pct]) grouped[pct] = [];
        grouped[pct].push(tk);
      });

      const tiers = Object.entries(grouped)
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
        .map(([fee, tks], i) => ({ fee, tokens: tks, tier: i + 1 }));

      this.setState({ pricingData: tiers, pricingLoading: false });
    } catch (err) {
      this.setState({ pricingLoading: false, pricingError: err.message });
    }
  }

  renderParamsTable(schema) {
    if (!schema || Object.keys(schema).length === 0) return '';
    let t = '<h3>Parameters</h3><table><thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>';
    for (const key in schema) {
      const p = schema[key];
      t += `<tr>
        <td><code>${p.name}</code></td>
        <td>${p.type}</td>
        <td>${p.default !== undefined ? `<code>${p.default}</code>` : 'N/A'}</td>
        <td>${p.description || ''} ${p.required ? '<strong>(Required)</strong>' : ''}</td>
      </tr>`;
    }
    return t + '</tbody></table>';
  }

  navigateTo(id) {
    location.hash = id;
  }

  _renderPricingContent() {
    const { pricingData, pricingLoading, pricingError } = this.state;

    if (pricingLoading) {
      return h('p', { className: 'docs-loading-text' }, 'Loading assets...');
    }
    if (pricingError) {
      return h('p', { className: 'docs-error-text' }, 'Error loading assets.');
    }

    return h('div', { className: 'docs-pricing' },
      h('h1', null, 'Pricing & Tokenomics'),
      h('p', null, 'Points are the core unit for compute, generation, and platform features. Fund your account with supported crypto assets to receive points.'),

      h('h2', null, 'Supported Assets & Funding Fees'),
      h('p', null, 'Funding fees are automatically deducted from every contribution. Lower fees mean more points.'),

      pricingData ? pricingData.map(t =>
        h('div', { className: 'docs-tier-group', key: t.tier },
          h('div', { className: 'docs-tier-heading' }, `Tier ${t.tier} — ${t.fee}% fee`),
          h('div', { className: 'docs-assets-grid' },
            ...t.tokens.map(tk =>
              h('div', { className: 'docs-asset-card', key: tk.symbol || tk.name },
                tk.iconUrl ? h('img', { src: tk.iconUrl, alt: tk.symbol || tk.name }) : null,
                h('div', { className: 'docs-asset-symbol' }, tk.symbol || tk.name),
                h('div', { className: 'docs-asset-fee' }, `${t.fee}% fee`),
              )
            )
          )
        )
      ) : null,

      h('h2', null, 'Withdrawals & Refunds'),
      h('p', null, 'If you purchase more points than you need, you can withdraw your remaining balance. Withdrawals are subject to a processing fee to cover operational and gas costs.'),

      h('h2', null, 'Gas Fees & Operational Costs'),
      h('p', null, 'Gas fees for on-chain operations (like crediting points or withdrawals) are deducted from your offchain credit. This ensures the platform remains sustainable and transparent.'),

      h('h2', null, 'Referral Vaults'),
      h('p', null, 'Create a referral vault to earn rewards: when someone uses your referral code, their contribution is directed to your vault and you receive 5% of that contribution. Rewards are distributed automatically on-chain.'),
    );
  }

  static get styles() {
    return `
      /* ── Shell ──────────────────────────────────────────── */
      .docs-shell {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
        background: var(--canvas-bg);
      }

      /* ── Header ─────────────────────────────────────────── */
      .docs-header {
        height: var(--header-height, 44px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-1);
        flex-shrink: 0;
      }

      .docs-header-wordmark {
        font-family: var(--ff-display);
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-primary);
        text-decoration: none;
        line-height: 1;
        transition: opacity var(--dur-micro) var(--ease);
      }
      .docs-header-wordmark:hover { opacity: 0.7; }

      /* ── Body ───────────────────────────────────────────── */
      .docs-body {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      /* ── Sidebar ────────────────────────────────────────── */
      .docs-sidebar {
        width: 200px;
        flex-shrink: 0;
        border-right: var(--border-width) solid var(--border);
        overflow-y: auto;
        background: var(--surface-1);
        padding: 8px 0;
      }

      .docs-sidebar a {
        display: block;
        padding: 6px 16px;
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        color: var(--text-label);
        text-decoration: none;
        cursor: pointer;
        transition: color var(--dur-micro) var(--ease);
      }
      .docs-sidebar a:hover { color: var(--text-secondary); }
      .docs-sidebar a.active {
        color: var(--accent);
        border-left: 2px solid var(--accent);
        padding-left: 14px;
      }

      /* ── Content ─────────────────────────────────────────── */
      .docs-content {
        flex: 1;
        overflow-y: auto;
        padding: 32px 48px;
        max-width: 760px;
      }

      .docs-content h1 {
        font-family: var(--ff-display);
        font-size: 1.6rem;
        font-weight: var(--fw-bold);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-primary);
        margin: 0 0 20px;
      }
      .docs-content h2 {
        font-family: var(--ff-condensed);
        font-size: 1rem;
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-secondary);
        margin: 28px 0 10px;
      }
      .docs-content h3 {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        color: var(--text-label);
        margin: 20px 0 8px;
      }
      .docs-content p {
        font-family: var(--ff-condensed);
        font-size: 13px;
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
        line-height: 1.7;
        margin-bottom: 12px;
      }
      .docs-content a { color: var(--accent); }
      .docs-content code {
        background: var(--surface-3);
        border: var(--border-width) solid var(--border);
        padding: 0.1rem 0.3rem;
        font-family: var(--ff-mono);
        font-size: 0.8em;
        color: var(--text-secondary);
      }
      .docs-content pre {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 16px;
        overflow-x: auto;
        margin-bottom: 16px;
      }
      .docs-content pre code {
        background: none;
        border: none;
        padding: 0;
        font-size: 0.85em;
      }
      .docs-content ul, .docs-content ol {
        padding-left: 1.2rem;
        margin-bottom: 12px;
      }
      .docs-content li {
        font-family: var(--ff-condensed);
        font-size: 13px;
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
        margin-bottom: 4px;
        line-height: 1.6;
      }
      .docs-content table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 16px;
      }
      .docs-content th, .docs-content td {
        text-align: left;
        padding: 6px 10px;
        border-bottom: var(--border-width) solid var(--border);
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
      }
      .docs-content th {
        color: var(--text-secondary);
        border-bottom-color: var(--border-hover);
      }
      .docs-content strong { color: var(--text-secondary); }

      /* Tool cards */
      .doc-tool-card {
        border: var(--border-width) solid var(--border);
        background: var(--surface-1);
        padding: 14px;
        margin-bottom: 12px;
      }
      .doc-tool-card h2 { margin-top: 0; }
      .doc-tool-meta {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      .doc-tool-cmd, .doc-tool-cat {
        font-family: var(--ff-mono);
        font-size: 10px;
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 2px 6px;
        background: var(--surface-3);
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
      }

      /* Pricing section */
      .docs-pricing h1, .docs-pricing h2 {
        font-family: var(--ff-display);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
      }
      .docs-tier-group { margin-bottom: 24px; }
      .docs-tier-heading {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 10px;
      }
      .docs-assets-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
      }
      .docs-asset-card {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 10px;
        text-align: center;
      }
      .docs-asset-card img {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--surface-3);
        margin-bottom: 6px;
        display: block;
        margin-left: auto;
        margin-right: auto;
      }
      .docs-asset-symbol {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        color: var(--text-secondary);
      }
      .docs-asset-fee {
        font-family: var(--ff-mono);
        font-size: 10px;
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
        margin-top: 2px;
      }

      /* Misc */
      .docs-loading-text, .docs-error-text {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 20px 0;
      }
      .docs-loading-text { color: var(--text-label); }
      .docs-error-text { color: var(--danger); }

      /* Nav footer */
      .docs-nav-footer {
        display: flex;
        justify-content: space-between;
        padding: 20px 0;
        margin-top: 16px;
        border-top: var(--border-width) solid var(--border);
      }
      .docs-nav-footer a {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-label);
        text-decoration: none;
        cursor: pointer;
        transition: color var(--dur-micro) var(--ease);
      }
      .docs-nav-footer a:hover { color: var(--accent); }
      .docs-nav-footer a[hidden] { visibility: hidden; }
    `;
  }

  render() {
    const { sections, currentIndex, contentHtml, loading } = this.state;
    const section = sections[currentIndex];
    const isPricing = section?.special === 'pricing-renderer';
    const prevSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
    const nextSection = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

    return h('div', { className: 'docs-shell' },

      /* Header */
      h('header', { className: 'docs-header' },
        h('a', { href: '/', className: 'docs-header-wordmark' }, 'NOEMA'),
      ),

      /* Body */
      h('div', { className: 'docs-body' },

        /* Sidebar */
        h('aside', { className: 'docs-sidebar' },
          ...sections.map((s, i) =>
            h('a', {
              key: s.id,
              href: `#${s.id}`,
              className: i === currentIndex ? 'active' : '',
            }, s.title)
          )
        ),

        /* Content */
        h('div', { className: 'docs-content' },
          loading
            ? h('p', { className: 'docs-loading-text' }, 'Loading...')
            : isPricing
              ? this._renderPricingContent()
              : h(RawHtml, { html: contentHtml }),

          !loading ? h('div', { className: 'docs-nav-footer' },
            prevSection
              ? h('a', { onclick: () => this.navigateTo(prevSection.id) }, `\u2190 ${prevSection.title}`)
              : h('a', { hidden: true }),
            nextSection
              ? h('a', { onclick: () => this.navigateTo(nextSection.id) }, `${nextSection.title} \u2192`)
              : h('a', { hidden: true }),
          ) : null,
        ),
      ),
    );
  }
}
