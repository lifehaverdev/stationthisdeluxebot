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
      sidebarOpen: false,
    };
  }

  async didMount() {
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

    this.setState({ currentIndex: sectionIdx, loading: true, sidebarOpen: false });

    if (section.special === 'tools-renderer') {
      await this.renderTools();
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

  static get styles() {
    return `
      .docs-layout {
        display: flex;
        min-height: calc(100vh - 120px);
      }
      .docs-sidebar {
        width: 220px;
        flex-shrink: 0;
        border-right: 1px solid #1a1a1a;
        padding: 1rem 0;
        overflow-y: auto;
      }
      .docs-sidebar a {
        display: block;
        padding: 0.4rem 1rem;
        color: #888;
        text-decoration: none;
        font-size: 0.9rem;
      }
      .docs-sidebar a:hover { color: #fff; }
      .docs-sidebar a.active {
        color: #fff;
        border-left: 2px solid #fff;
        padding-left: calc(1rem - 2px);
      }
      .docs-content {
        flex: 1;
        padding: 1.5rem 2rem;
        max-width: 740px;
        overflow-y: auto;
      }
      .docs-content h1 { color: #fff; font-size: 1.8rem; margin-bottom: 1rem; }
      .docs-content h2 { color: #e0e0e0; font-size: 1.3rem; margin: 1.5rem 0 0.5rem; }
      .docs-content h3 { color: #ccc; font-size: 1.1rem; margin: 1rem 0 0.5rem; }
      .docs-content p { color: #888; line-height: 1.7; margin-bottom: 0.75rem; }
      .docs-content a { color: #90caf9; }
      .docs-content code {
        background: #1a1a1a;
        padding: 0.15rem 0.35rem;
        border-radius: 3px;
        font-size: 0.85em;
        color: #ccc;
      }
      .docs-content pre {
        background: #111;
        padding: 1rem;
        border-radius: 6px;
        overflow-x: auto;
        margin-bottom: 1rem;
      }
      .docs-content pre code {
        background: none;
        padding: 0;
      }
      .docs-content ul, .docs-content ol {
        color: #888;
        padding-left: 1.5rem;
        margin-bottom: 0.75rem;
      }
      .docs-content li { margin-bottom: 0.3rem; line-height: 1.6; }
      .docs-content table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 1rem;
      }
      .docs-content th, .docs-content td {
        text-align: left;
        padding: 0.4rem 0.6rem;
        border-bottom: 1px solid #1e1e1e;
        color: #aaa;
        font-size: 0.85rem;
      }
      .docs-content th { color: #ccc; }
      .docs-content strong { color: #ccc; }
      .docs-nav-footer {
        display: flex;
        justify-content: space-between;
        padding: 1rem 0;
        margin-top: 1rem;
        border-top: 1px solid #1a1a1a;
      }
      .docs-nav-footer a {
        color: #90caf9;
        text-decoration: none;
        font-size: 0.9rem;
        cursor: pointer;
      }
      .docs-nav-footer a:hover { color: #fff; }
      .docs-nav-footer a[hidden] { visibility: hidden; }

      .doc-tool-card {
        border: 1px solid #1e1e1e;
        border-radius: 6px;
        padding: 1rem;
        margin-bottom: 1rem;
        background: #111;
      }
      .doc-tool-card h2 { margin-top: 0; font-size: 1.1rem; }
      .doc-tool-meta {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .doc-tool-cmd, .doc-tool-cat {
        font-size: 0.75rem;
        padding: 0.15rem 0.4rem;
        border-radius: 3px;
        background: #1a1a1a;
        color: #888;
      }

      /* Mobile sidebar toggle */
      .docs-sidebar-toggle {
        display: none;
        background: none;
        border: 1px solid #333;
        color: #aaa;
        padding: 0.3rem 0.6rem;
        border-radius: 4px;
        cursor: pointer;
        margin-bottom: 0.5rem;
      }
      @media (max-width: 768px) {
        .docs-sidebar { display: none; }
        .docs-sidebar.open { display: block; position: fixed; left: 0; top: 0; bottom: 0; background: #0a0a0a; z-index: 100; }
        .docs-sidebar-toggle { display: inline-block; }
      }
    `;
  }

  render() {
    const { sections, currentIndex, contentHtml, loading, sidebarOpen } = this.state;
    const prevSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
    const nextSection = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

    return h('div', { className: 'docs-layout' },
      // Sidebar
      h('aside', { className: `docs-sidebar${sidebarOpen ? ' open' : ''}` },
        ...sections.map((s, i) =>
          h('a', {
            key: s.id,
            href: `#${s.id}`,
            className: i === currentIndex ? 'active' : '',
            onClick: () => this.setState({ sidebarOpen: false })
          }, s.title)
        )
      ),

      // Content
      h('div', { className: 'docs-content' },
        h('button', {
          className: 'docs-sidebar-toggle',
          onClick: () => this.setState({ sidebarOpen: !sidebarOpen })
        }, '\u2630 Sections'),

        loading
          ? h('p', { style: { color: '#666' } }, 'Loading...')
          : h(RawHtml, { html: contentHtml }),

        // Prev / Next
        !loading ? h('div', { className: 'docs-nav-footer' },
          prevSection
            ? h('a', { onClick: () => this.navigateTo(prevSection.id) }, `\u2190 ${prevSection.title}`)
            : h('a', { hidden: true }),
          nextSection
            ? h('a', { onClick: () => this.navigateTo(nextSection.id) }, `${nextSection.title} \u2192`)
            : h('a', { hidden: true })
        ) : null
      )
    );
  }
}
