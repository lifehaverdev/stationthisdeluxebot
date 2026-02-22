import { Component, h } from '@monygroupcorp/microact';
import { fetchJson } from '../lib/api.js';
import { getAppUrl } from '../lib/urls.js';

export class Landing extends Component {
  constructor(props) {
    super(props);
    this.state = {
      tools: [],
      toolsLoading: true,
      toolsError: null,
    };
  }

  async didMount() {
    try {
      const payload = await fetchJson('/api/v1/tools/registry');
      const tools = Array.isArray(payload) ? payload : (payload?.tools || []);
      // Filter out internal tools
      const visible = tools.filter(t => {
        if (t.metadata?.hideFromLanding) return false;
        const name = t.displayName || '';
        if (/_COOK|_API/i.test(name)) return false;
        return true;
      });
      this.setState({ tools: visible, toolsLoading: false });
    } catch (err) {
      this.setState({ toolsError: err.message, toolsLoading: false });
    }
  }

  static get styles() {
    return `
      .landing-hero {
        text-align: center;
        padding: 4rem 1rem 2rem;
      }
      .landing-hero h1 {
        font-size: 3.5rem;
        font-weight: 800;
        color: #fff;
        margin-bottom: 0.5rem;
      }
      .landing-hero .subtitle {
        font-size: 1rem;
        color: #666;
        margin-bottom: 0.25rem;
      }
      .landing-hero .tagline {
        font-size: 1.15rem;
        color: #888;
        margin-bottom: 2rem;
      }
      .landing-cta {
        display: inline-block;
        background: #fff;
        color: #0a0a0a;
        padding: 0.75rem 2rem;
        border-radius: 6px;
        border: none;
        font-weight: 600;
        font-size: 1rem;
        cursor: pointer;
      }
      .landing-cta:hover { background: #e0e0e0; }

      .tools-section {
        padding: 2rem 1rem;
        max-width: 900px;
        margin: 0 auto;
      }
      .tools-section h2 {
        color: #fff;
        margin-bottom: 1rem;
        font-size: 1.3rem;
      }
      .tools-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 0.75rem;
      }
      .tool-tile {
        background: #141414;
        border: 1px solid #1e1e1e;
        border-radius: 6px;
        padding: 0.75rem;
      }
      .tool-tile h4 {
        color: #e0e0e0;
        font-size: 0.9rem;
        margin-bottom: 0.25rem;
      }
      .tool-tile p {
        color: #666;
        font-size: 0.8rem;
        line-height: 1.3;
      }
      .tool-tile .tool-category {
        font-size: 0.7rem;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.25rem;
      }

      .about-section {
        padding: 2rem 1rem;
        max-width: 700px;
        margin: 0 auto;
      }
      .about-section h2 {
        color: #fff;
        margin-bottom: 1rem;
        font-size: 1.3rem;
      }
      .about-section p {
        color: #888;
        line-height: 1.6;
        margin-bottom: 1rem;
      }
      .about-section ul {
        list-style: none;
        padding: 0;
      }
      .about-section li {
        color: #888;
        padding: 0.4rem 0;
        line-height: 1.5;
      }
      .about-section li strong {
        color: #ccc;
      }
    `;
  }

  render() {
    const { tools, toolsLoading, toolsError } = this.state;

    return h('div', null,
      // Hero
      h('section', { className: 'landing-hero' },
        h('h1', null, 'NOEMA.ART'),
        h('p', { className: 'subtitle' }, '[Powered by StationThis]'),
        h('p', { className: 'tagline' }, 'Generative Studio for Manifestation'),
        h('a', { className: 'landing-cta', href: getAppUrl() }, 'Create Now')
      ),

      // Tools
      h('section', { className: 'tools-section' },
        h('h2', null, 'Available Tools'),
        toolsLoading
          ? h('p', { style: { color: '#666' } }, 'Loading tools...')
          : toolsError
            ? h('p', { style: { color: '#f88' } }, 'Failed to load tools.')
            : h('div', { className: 'tools-grid' },
                ...tools.map(t =>
                  h('div', { className: 'tool-tile', key: t.toolId },
                    h('div', { className: 'tool-category' }, t.category || 'tool'),
                    h('h4', null, t.displayName || t.toolId),
                    h('p', null, t.description ? t.description.slice(0, 100) : '')
                  )
                )
              )
      ),

      // About
      h('section', { className: 'about-section' },
        h('h2', null, 'About NOEMA'),
        h('p', null, 'NOEMA is an independent AI lab that ships uncensored, fully-custom models. Everything we build is open-source and crypto-native.'),
        h('ul', null,
          h('li', null, h('strong', null, 'Usage-based pricing.'), ' Buy the points you need; no subscriptions, no lock-ins.'),
          h('li', null, h('strong', null, 'Creator stack included.'), ' NFT collection generator, model training, and dataset tools built-in.'),
          h('li', null, h('strong', null, 'Incentive engine.'), ' Contribute datasets or custom workflows and earn automatic rewards.'),
          h('li', null, h('strong', null, 'Multi-Platform.'), ' Web Canvas, Telegram bot, REST & WebSocket APIs; Discord coming soon.'),
          h('li', null, h('strong', null, 'Cypherpunk-aligned.'), ' Open repos, transparent weights, zero censorship filters.')
        )
      ),

    );
  }
}
