// AccountDropdown.js
// Boilerplate for Account/Profile dropdown component

import HistoryModal from './historyModal.js';

export default class AccountDropdown {
    constructor(container) {
        this.container = container;
        this.dropdownOpen = false;
        this.state = {
            loading: true,
            error: null,
            data: null
        };
        this.render();
        this.fetchDashboard();
    }

    async fetchDashboard() {
        this.setState({ loading: true, error: null });
        try {
            const res = await fetch('/api/v1/user/dashboard', {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) throw new Error('Failed to fetch account info');
            const data = await res.json();
            this.setState({ loading: false, data });
        } catch (err) {
            this.setState({ loading: false, error: err.message });
        }
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.render();
        // Update wallet and points in header
        const { data } = this.state;
        const walletEl = document.querySelector('.wallet-display');
        const pointsEl = document.querySelector('.points-display');
        if (data) {
            if (walletEl) {
                walletEl.textContent = this.shortenWallet(data.wallet);
                walletEl.title = data.wallet;
                walletEl.style.cursor = 'pointer';
                walletEl.onclick = () => {
                    navigator.clipboard.writeText(data.wallet);
                    walletEl.classList.add('copied');
                    setTimeout(() => walletEl.classList.remove('copied'), 800);
                };
            }
            if (pointsEl) {
                pointsEl.textContent = `💎 ${parseFloat(data.points).toFixed(2)}`;
            }
        } else {
            if (walletEl) walletEl.textContent = '0x0000...0000';
            if (pointsEl) pointsEl.textContent = '💎 0.00';
        }
    }

    render() {
        const { loading, error, data } = this.state;
        const referralVaults = data && Array.isArray(data.referralVaults) ? data.referralVaults : [];
        // Determine if we should show minimal fallback (error but user is likely authenticated)
        const showMinimal = (!data && error && !loading);
        this.container.innerHTML = `
            <div class="account-dropdown-root">
                <button class="account-web3-btn" aria-haspopup="true" aria-expanded="${this.dropdownOpen}">
                    <span class="wallet-icon">🔗</span> ${data && data.wallet ? this.shortenWallet(data.wallet) : 'Connect Wallet'}
                </button>
                <div class="account-dropdown-menu" hidden>
                    <div class="dropdown-header">Account</div>
                    <div class="dropdown-content">
                        ${loading ? '<div class="dropdown-item">Loading...</div>' : ''}
                        ${error && !data ? `<div class="dropdown-item" style="color:#f44336;">${error}</div>` : ''}
                        ${data ? `
                            <div class="dropdown-item"><b>${data.username}</b></div>
                            <div class="dropdown-item">Wallet: ${data.wallet ? this.shortenWallet(data.wallet) : '—'}</div>
                            <div class="dropdown-item">Level: ${data.level}</div>
                            <div class="dropdown-item">EXP:</div>
                            <div class="dropdown-item">
                                <div style="background:#333;border-radius:4px;height:8px;width:100%;margin:4px 0;">
                                    <div style="background:#90caf9;height:8px;border-radius:4px;width:${Math.round((data.levelProgressRatio||0)*100)}%;transition:width 0.3s;"></div>
                                </div>
                            </div>
                            <div class="dropdown-item">Points: ${data.points}</div>
                            <a href="#" class="action-btn" data-action="get-more-points">Get More Points</a>
                            <div class="dropdown-item"><b>Referral Vaults</b></div>
                            <div class="dropdown-item">
                              ${referralVaults.length ? referralVaults.map(vault => `
                                <div class="vault-list-item">
                                  <b>${vault.vault_name || '(unnamed)'}</b><br>
                                  <span class="vault-address">${this.shortenWallet(vault.vault_address)}</span><br>
                                  <a href="/referral/${vault.vault_name}" target="_blank">Referral Link</a>
                                  <button class="vault-dashboard-btn" data-vault-address="${vault.vault_address}">Dashboard</button>
                                </div>
                              `).join('') : '<div class="vault-list-item">No referral vaults yet.</div>'}
                            </div>
                            <div class="dropdown-item">Model: ${data.rewards.model}</div>
                            <div class="dropdown-item">Spell: ${data.rewards.spell}</div>
                        ` : ''}
                        ${showMinimal ? `
                            <div class="dropdown-item">Points: 0</div>
                            <a href="#" class="action-btn" data-action="get-more-points">Get More Points</a>
                        ` : ''}
                        <div class="dropdown-actions">
                            <a href="#" class="action-btn" data-action="history">History</a>
                            <a href="#" class="action-btn" data-action="settings">Settings</a>
                            <a href="#" class="action-btn" data-action="logout">Logout</a>
                        </div>
                    </div>
                </div>
            </div>
        `;
        this.attachEvents();
        this.attachActionEvents();
        // Attach dashboard button events
        const dashboardBtns = this.container.querySelectorAll('.vault-dashboard-btn');
        dashboardBtns.forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.preventDefault();
            this.closeDropdown();
            const vaultAddress = btn.getAttribute('data-vault-address');
            const vault = referralVaults.find(v => v.vault_address === vaultAddress);
            if (!window.openVaultDashboardModal) {
              await this.loadVaultDashboardModalScript();
            }
            if (window.openVaultDashboardModal && vault) window.openVaultDashboardModal(vault);
          });
        });
        // Attach referral vault setup button event
        const setupReferralBtn = this.container.querySelector('.setup-referral-btn');
        if (setupReferralBtn) {
            setupReferralBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeDropdown();
                if (window.openReferralVaultModal) window.openReferralVaultModal();
                // TODO: Implement openReferralVaultModal
            });
        }
    }

    shortenWallet(addr) {
        if (!addr) return '';
        // If address starts with 0x1152, show 0x1152 + next 4 + ... + last 4
        if (addr.startsWith('0x1152')) {
            return addr.slice(0, 10) + '...' + addr.slice(-4);
        }
        // Default: first 6 + ... + last 4
        return addr.slice(0, 6) + '...' + addr.slice(-4);
    }

    attachEvents() {
        this.profileBtn = this.container.querySelector('.account-web3-btn');
        this.dropdownMenu = this.container.querySelector('.account-dropdown-menu');

        this.profileBtn.addEventListener('click', () => this.toggleDropdown());

        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.closeDropdown();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.dropdownOpen) {
                this.closeDropdown();
            }
        });
    }

    attachActionEvents() {
        const historyBtn = this.container.querySelector('[data-action="history"]');
        if (historyBtn) {
            historyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeDropdown();
                const modal = new HistoryModal();
                modal.show();
            });
        }
        const getMorePointsBtn = this.container.querySelector('[data-action="get-more-points"]');
        if (getMorePointsBtn) {
            getMorePointsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeDropdown();
                if (window.openBuyPointsModal) window.openBuyPointsModal();
            });
        }
        // ... add other action handlers here
    }

    toggleDropdown() {
        this.dropdownOpen = !this.dropdownOpen;
        this.dropdownMenu.hidden = !this.dropdownOpen;
        this.profileBtn.setAttribute('aria-expanded', this.dropdownOpen);
    }

    closeDropdown() {
        this.dropdownOpen = false;
        this.dropdownMenu.hidden = true;
        this.profileBtn.setAttribute('aria-expanded', 'false');
    }

    // Add a utility to dynamically load the dashboard modal script
    async loadVaultDashboardModalScript() {
        if (document.getElementById('vault-dashboard-modal-script')) return;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.id = 'vault-dashboard-modal-script';
            script.src = '/components/ReferralVaultDashboardModal/vaultDashboardModal.js';
            script.onload = resolve;
            script.onerror = reject;
            document.body.appendChild(script);
        });
    }
} 