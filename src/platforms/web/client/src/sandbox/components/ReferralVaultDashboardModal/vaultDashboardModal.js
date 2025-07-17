// src/platforms/web/client/src/sandbox/components/ReferralVaultDashboardModal/vaultDashboardModal.js

// --- State Management ---
const dashboardState = {
    loading: true,
    error: null,
    vault: null,
    stats: null,
    withdrawing: false,
    withdrawResult: null
};

let modal, closeBtn, statsSection, withdrawBtn, errorDisplay, copyAddressBtn, copyLinkBtn;

function render() {
    if (!modal) return;
    // Loading
    if (dashboardState.loading) {
        statsSection.innerHTML = '<div class="dashboard-spinner"></div><div>Loading vault stats...</div>';
        withdrawBtn.disabled = true;
    } else if (dashboardState.error) {
        statsSection.innerHTML = '';
        errorDisplay.style.display = 'block';
        errorDisplay.textContent = dashboardState.error;
        withdrawBtn.disabled = true;
    } else if (dashboardState.stats) {
        errorDisplay.style.display = 'none';
        const { fees, deposits, rewards, fundsAvailable } = dashboardState.stats;
        statsSection.innerHTML = `
            <div class="vault-dashboard-stats">
                <div><b>Referral Fees Collected:</b> <span>${fees ?? '-'}</span></div>
                <div><b>Total Deposits:</b> <span>${deposits ?? '-'}</span></div>
                <div><b>Rewards:</b> <span>${rewards ?? '-'}</span></div>
                <div><b>Funds Available:</b> <span>${fundsAvailable ?? '-'}</span></div>
            </div>
        `;
        withdrawBtn.disabled = false;
    }
    withdrawBtn.textContent = dashboardState.withdrawing ? 'Withdrawing...' : 'Withdraw';
    withdrawBtn.disabled = dashboardState.loading || dashboardState.withdrawing;
    if (dashboardState.withdrawResult) {
        statsSection.innerHTML += `<div class="withdraw-result">${dashboardState.withdrawResult}</div>`;
    }
}

function closeModal() {
    if (modal) modal.remove();
    dashboardState.loading = true;
    dashboardState.error = null;
    dashboardState.vault = null;
    dashboardState.stats = null;
    dashboardState.withdrawing = false;
    dashboardState.withdrawResult = null;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
}

// Placeholder for API call
async function fetchStats(vault) {
    dashboardState.loading = true;
    dashboardState.error = null;
    render();
    // Simulate async fetch
    setTimeout(() => {
        dashboardState.stats = {
            fees: '0.00 ETH',
            deposits: '0.00 ETH',
            rewards: '0.00 ETH',
            fundsAvailable: '0.00 ETH'
        };
        dashboardState.loading = false;
        render();
    }, 1000);
}

// Placeholder for withdraw
async function handleWithdraw() {
    dashboardState.withdrawing = true;
    render();
    setTimeout(() => {
        dashboardState.withdrawing = false;
        dashboardState.withdrawResult = 'Withdrawal successful!';
        render();
    }, 1200);
}

function initVaultDashboardModal(vault) {
    dashboardState.vault = vault;
    dashboardState.loading = true;
    dashboardState.error = null;
    dashboardState.stats = null;
    dashboardState.withdrawing = false;
    dashboardState.withdrawResult = null;

    // Inject CSS if not present
    if (!document.getElementById('vault-dashboard-modal-styles')) {
        const style = document.createElement('style');
        style.id = 'vault-dashboard-modal-styles';
        style.textContent = `
.vault-dashboard-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.vault-dashboard-modal-content { background: #23272f; padding: 2rem; border-radius: 8px; width: 90%; max-width: 500px; position: relative; border: 1px solid #444; box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
.vault-dashboard-modal-close-btn { position: absolute; top: 10px; right: 15px; background: none; border: none; font-size: 1.8rem; color: #aaa; cursor: pointer; }
.vault-dashboard-modal-header { margin-bottom: 1.5rem; }
.vault-dashboard-modal-header h2 { margin: 0; color: #e0e0e0; }
.vault-dashboard-info { margin-bottom: 1.5rem; }
.vault-dashboard-info .copy-btn { margin-left: 8px; font-size: 0.9em; cursor: pointer; color: #90caf9; background: none; border: none; }
.vault-dashboard-stats { margin-bottom: 1.5rem; }
.dashboard-spinner { border: 4px solid #f3f3f3; border-top: 4px solid #90caf9; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.vault-dashboard-modal-actions { display: flex; justify-content: flex-end; }
.vault-dashboard-modal-actions button { padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; background-color: #3f51b5; color: #fff; font-size: 1rem; margin-left: 10px; }
.vault-dashboard-modal-actions button:disabled { background-color: #555; cursor: not-allowed; }
.withdraw-result { color: #2ecc71; margin-top: 1rem; }
#vault-dashboard-modal-error { color: #e74c3c; margin-bottom: 1rem; display: none; }
        `;
        document.head.appendChild(style);
    }

    // Modal HTML
    const html = `
<div class="vault-dashboard-modal-overlay">
  <div class="vault-dashboard-modal-content">
    <button class="vault-dashboard-modal-close-btn">&times;</button>
    <div class="vault-dashboard-modal-header">
      <h2>Vault Dashboard</h2>
    </div>
    <div class="vault-dashboard-info">
      <div><b>Name:</b> <span>${vault.vault_name || '(unnamed)'}</span></div>
      <div><b>Address:</b> <span>${vault.vault_address}</span> <button class="copy-btn" id="copy-address-btn">Copy</button></div>
      <div><b>Referral Link:</b> <span>noema.art/referral/${vault.vault_name}</span> <button class="copy-btn" id="copy-link-btn">Copy</button></div>
    </div>
    <div id="vault-dashboard-modal-error"></div>
    <div id="vault-dashboard-stats"></div>
    <div class="vault-dashboard-modal-actions">
      <button id="vault-dashboard-withdraw-btn" disabled>Withdraw</button>
    </div>
  </div>
</div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    modal = document.querySelector('.vault-dashboard-modal-overlay');
    closeBtn = modal.querySelector('.vault-dashboard-modal-close-btn');
    statsSection = modal.querySelector('#vault-dashboard-stats');
    withdrawBtn = modal.querySelector('#vault-dashboard-withdraw-btn');
    errorDisplay = modal.querySelector('#vault-dashboard-modal-error');
    copyAddressBtn = modal.querySelector('#copy-address-btn');
    copyLinkBtn = modal.querySelector('#copy-link-btn');

    closeBtn.addEventListener('click', closeModal);
    withdrawBtn.addEventListener('click', handleWithdraw);
    copyAddressBtn.addEventListener('click', () => copyToClipboard(vault.vault_address));
    copyLinkBtn.addEventListener('click', () => copyToClipboard(`noema.art/referral/${vault.vault_name}`));

    render();
    fetchStats(vault);
}

window.openVaultDashboardModal = initVaultDashboardModal; 