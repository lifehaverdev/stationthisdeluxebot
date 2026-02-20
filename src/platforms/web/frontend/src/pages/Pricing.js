import { Component, h } from '@monygroupcorp/microact';
import { fetchJson } from '../lib/api.js';

export class Pricing extends Component {
  constructor(props) {
    super(props);
    this.state = {
      tiers: [],       // grouped by fee %
      loading: true,
      error: null,
    };
  }

  async didMount() {
    try {
      const data = await fetchJson('/api/v1/points/supported-assets');
      const tokens = Array.isArray(data.tokens) ? data.tokens : [];
      tokens.sort((a, b) => (1 - (a.fundingRate || 0)) - (1 - (b.fundingRate || 0)));

      // Group by fee percentage
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
        .map(([fee, tokens], i) => ({ fee, tokens, tier: i + 1 }));

      this.setState({ tiers, loading: false });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  static get styles() {
    return `
      .pricing-page {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem 1rem;
      }
      .pricing-page h1 {
        color: #fff;
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }
      .pricing-page .pricing-subtitle {
        color: #666;
        margin-bottom: 2rem;
      }
      .pricing-section {
        margin-bottom: 2rem;
      }
      .pricing-section h2 {
        color: #fff;
        font-size: 1.2rem;
        margin-bottom: 0.5rem;
      }
      .pricing-section p {
        color: #888;
        line-height: 1.6;
      }
      .tier-group {
        margin-bottom: 1.5rem;
      }
      .tier-heading {
        color: #90caf9;
        font-weight: 600;
        margin-bottom: 0.5rem;
      }
      .assets-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.75rem;
      }
      .asset-card {
        background: #141414;
        border: 1px solid #1e1e1e;
        border-radius: 8px;
        padding: 0.75rem;
        text-align: center;
      }
      .asset-card img {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #222;
        margin-bottom: 0.5rem;
      }
      .asset-symbol {
        color: #e0e0e0;
        font-weight: 600;
        font-size: 0.9rem;
      }
      .asset-fee {
        color: #90caf9;
        font-size: 0.8rem;
      }
      .faq-list {
        list-style: none;
        padding: 0;
      }
      .faq-list li {
        color: #888;
        padding: 0.5rem 0;
        line-height: 1.5;
      }
      .faq-list li strong {
        color: #ccc;
      }
      .faq-list a {
        color: #90caf9;
      }
    `;
  }

  render() {
    const { tiers, loading, error } = this.state;

    return h('div', { className: 'pricing-page' },
      h('h1', null, 'Pricing & Tokenomics'),
      h('p', { className: 'pricing-subtitle' }, 'Transparent, Community-Driven, On-Chain'),

      h('section', { className: 'pricing-section' },
        h('h2', null, 'How Points Work'),
        h('p', null, 'Points are the core unit for compute, generation, and platform features. Fund your account with supported crypto assets to receive points, which can be spent on AI generation, NFT minting, and more.')
      ),

      h('section', { className: 'pricing-section' },
        h('h2', null, 'Supported Assets & Funding Fees'),
        h('p', null, 'Funding fees are automatically deducted from every contribution. Lower fees mean more points for you.'),
        loading
          ? h('p', { style: { color: '#666' } }, 'Loading assets...')
          : error
            ? h('p', { style: { color: '#f88' } }, 'Error loading assets.')
            : tiers.map(t =>
                h('div', { className: 'tier-group', key: t.tier },
                  h('div', { className: 'tier-heading' }, `Tier ${t.tier} \u2014 ${t.fee}% fee`),
                  h('div', { className: 'assets-grid' },
                    ...t.tokens.map(tk =>
                      h('div', { className: 'asset-card', key: tk.symbol || tk.name },
                        tk.iconUrl ? h('img', { src: tk.iconUrl, alt: tk.symbol || tk.name }) : null,
                        h('div', { className: 'asset-symbol' }, tk.symbol || tk.name),
                        h('div', { className: 'asset-fee' }, `${t.fee}% fee`)
                      )
                    )
                  )
                )
              )
      ),

      h('section', { className: 'pricing-section' },
        h('h2', null, 'Withdrawals & Refunds'),
        h('p', null, 'If you purchase more points than you need, you can withdraw your remaining balance. Withdrawals are subject to a processing fee to cover operational and gas costs.')
      ),

      h('section', { className: 'pricing-section' },
        h('h2', null, 'Gas Fees & Operational Costs'),
        h('p', null, 'Gas fees for on-chain operations (like crediting points or withdrawals) are deducted from your offchain credit. This ensures the platform remains sustainable and transparent about costs.')
      ),

      h('section', { className: 'pricing-section' },
        h('h2', null, 'Referral Vaults'),
        h('p', null, 'Create a referral vault to earn rewards: when someone uses your referral code, their contribution is directed to your vault and you receive 5% of that contribution. Rewards are distributed automatically on-chain.')
      ),

      h('section', { className: 'pricing-section' },
        h('h2', null, 'FAQ'),
        h('ul', { className: 'faq-list' },
          h('li', null, h('strong', null, 'Are rates fixed?'), ' Funding rates may change as the platform grows. Always check this page for the latest info.'),
          h('li', null, h('strong', null, 'What if I have unused points?'), ' You can withdraw them, subject to fees.'),
          h('li', null, h('strong', null, 'How do I get the best rate?'), ' Fund with MS2 or CULT and use a referral vault for at-cost compute.'),
          h('li', null, h('strong', null, 'Is everything on-chain?'), ' All funding and withdrawals are on-chain. Points are off-chain credits, but fully auditable.'),
          h('li', null, h('strong', null, 'Where can I learn more?'), ' ', h('a', { href: '/docs' }, 'Read the Docs'), ' or join our community.')
        )
      )
    );
  }
}
