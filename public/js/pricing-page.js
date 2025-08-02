// pricing-page.js
// Dynamically loads supported assets and displays their funding fees on the pricing page.

(function initPricingPage() {
    const container = document.getElementById('assets-container');
    if (!container) return;

    // Inject minimal CSS for the asset grid/cards (only once)
    if (!document.getElementById('pricing-asset-style')) {
        const style = document.createElement('style');
        style.id = 'pricing-asset-style';
        style.textContent = `
            .assets-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-top: 16px; }
            .asset-card { background: #1b1b1b; border-radius: 8px; padding: 12px; text-align: center; display: flex; flex-direction: column; align-items: center; }
            .asset-card img { width: 48px; height: 48px; border-radius: 50%; background: #222; margin-bottom: 8px; }
            .asset-card .asset-symbol { font-weight: bold; margin-bottom: 4px; color:#f1f1f1; }
            .asset-card .asset-fee { color: #90caf9; font-size: 0.9em; }
            .asset-tier-group { margin-top: 24px; }
            .asset-tier-heading { font-weight: bold; margin-bottom: 8px; font-size: 1.1em; color: #90caf9; }
        `;
        document.head.appendChild(style);
    }

    // Helper to convert fundingRate (0.95) => fee percentage (5)
    function fundingRateToFeePct(rate) {
        if (typeof rate !== 'number') return '?';
        return ((1 - rate) * 100).toFixed(0);
    }

    async function loadAssets() {
        try {
            const res = await fetch('/api/v1/points/supported-assets', { credentials: 'include' });
            if (!res.ok) throw new Error('Failed to fetch assets');
            const data = await res.json();
            const tokens = Array.isArray(data.tokens) ? data.tokens : [];
            // Sort lowest fee first
            tokens.sort((a, b) => (1 - (a.fundingRate || 0)) - (1 - (b.fundingRate || 0)));
            if (tokens.length === 0) {
                container.innerHTML = '<div>No assets available at this time.</div>';
                return;
            }
            // Group tokens by fee percentage
            const grouped = {};
            tokens.forEach(tk => {
                const pct = fundingRateToFeePct(tk.fundingRate);
                if (!grouped[pct]) grouped[pct] = [];
                grouped[pct].push(tk);
            });
            const sortedFees = Object.keys(grouped).sort((a,b)=>parseFloat(a)-parseFloat(b));
            sortedFees.forEach((feePct, idx) => {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'asset-tier-group';
                groupDiv.innerHTML = `<div class="asset-tier-heading">Tier ${idx+1} - ${feePct}% fee</div>`;
                const grid = document.createElement('div');
                grid.className = 'assets-grid';
                grouped[feePct].forEach(token => {
                    const card = document.createElement('div');
                    card.className = 'asset-card';
                    card.innerHTML = `
                        <img src="${token.iconUrl}" alt="${token.symbol || token.name}">
                        <div class="asset-symbol">${token.symbol || token.name}</div>
                        <div class="asset-fee">${feePct}% fee</div>
                    `;
                    grid.appendChild(card);
                });
                groupDiv.appendChild(grid);
                container.appendChild(groupDiv);
            });
        } catch (err) {
            console.error('[pricing-page] Could not load assets:', err);
            container.innerHTML = '<div style="color:#e74c3c;">Error loading assets.</div>';
        }
    }

    document.addEventListener('DOMContentLoaded', loadAssets);
})(); 