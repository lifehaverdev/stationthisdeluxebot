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
    statsSection.innerHTML = ''; // Clear spinner
    errorDisplay.style.display = 'block';
    errorDisplay.textContent = dashboardState.error;
    withdrawBtn.disabled = true;
  } else if (dashboardState.stats && dashboardState.stats.length > 0) {
    errorDisplay.style.display = 'none';
    statsSection.innerHTML = dashboardState.stats.map(token => {
      const { symbol, iconUrl, totalDeposits, totalDepositsUsd, currentWithdrawable, currentWithdrawableUsd, decimals } = token;
      const formattedWithdrawable = parseFloat(formatUnits(currentWithdrawable, decimals)).toFixed(6);
      
      return `
        <div class="vault-token-stats">
          <div class="token-header">
            ${iconUrl ? `<img src="${iconUrl}" class="token-icon" alt="${symbol}">` : '<div class="token-icon"></div>'}
            <span class="token-symbol">${symbol}</span>
          </div>
          <div class="stat-item">
            <span>Withdrawable</span>
            <span>${formattedWithdrawable} (~$${currentWithdrawableUsd.toFixed(2)})</span>
          </div>
          <div class="stat-item">
            <span>Total Deposits</span>
            <span>~$${totalDepositsUsd.toFixed(2)}</span>
          </div>
        </div>
      `;
    }).join('');
    // Enable withdraw button only if there's at least one token with a withdrawable balance
    const canWithdraw = dashboardState.stats.some(t => BigInt(t.currentWithdrawable) > 0n);
    withdrawBtn.disabled = !canWithdraw;
  } else {
    statsSection.innerHTML = '<p>No deposit history for this vault yet.</p>';
    withdrawBtn.disabled = true;
  }
  
  withdrawBtn.textContent = dashboardState.withdrawing ? 'Withdrawing...' : 'Withdraw All';
  // Also disable if loading or already withdrawing
  if (dashboardState.loading || dashboardState.withdrawing) {
    withdrawBtn.disabled = true;
  }
  
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

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1500);
  });
}

// Minimal formatUnits utility (BigInt-safe, ethers.js alternative)
function formatUnits(value, decimals) {
    value = BigInt(value);
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    let fraction = (value % divisor).toString().padStart(decimals, '0');
    // Remove trailing zeros for display
    fraction = fraction.replace(/0+$/, '');
    return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

async function fetchStats(vault) {
  dashboardState.loading = true;
  dashboardState.error = null;
  render();

  try {
    const response = await fetch(`/api/v1/referral-vault/${vault.vault_address}/dashboard`);
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || `Failed to fetch vault data (${response.status})`);
    }
    const data = await response.json();
    dashboardState.stats = data.tokens; // The API returns an object with a 'tokens' array
    dashboardState.loading = false;
    render();
  } catch (err) {
    dashboardState.loading = false;
    dashboardState.error = err.message;
    render();
  }
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
.vault-dashboard-modal-header p { margin: 4px 0 0; color: #b0b0b0; font-size: 0.9em; }
.vault-dashboard-info { margin-bottom: 1.5rem; }
.vault-dashboard-info .copy-btn { margin-left: 8px; font-size: 0.9em; cursor: pointer; color: #90caf9; background: none; border: none; padding: 2px 4px; }
.vault-dashboard-stats-container { margin-bottom: 1.5rem; }
.vault-token-stats { border: 1px solid #333; border-radius: 4px; padding: 1rem; margin-bottom: 1rem; }
.vault-token-stats .token-header { display: flex; align-items: center; margin-bottom: 0.5rem; }
.vault-token-stats .token-icon { width: 24px; height: 24px; margin-right: 8px; border-radius: 50%; }
.vault-token-stats .token-symbol { font-weight: bold; font-size: 1.2em; color: #fff; }
.vault-token-stats .stat-item { display: flex; justify-content: space-between; padding: 4px 0; }
.vault-token-stats .stat-item span:first-child { color: #c0c0c0; }
.vault-token-stats .stat-item span:last-child { color: #f0f0f0; font-weight: bold; }
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
      <h2>${vault.vault_name || '(unnamed)'}</h2>
      <p>${vault.vault_address} <button class="copy-btn" id="copy-address-btn">Copy</button></p>
    </div>
    <div class="vault-dashboard-info">
      <div><b>Referral Link:</b> <span>noema.art/referral/${vault.vault_name}</span> <button class="copy-btn" id="copy-link-btn">Copy</button></div>
    </div>
    <div id="vault-dashboard-modal-error"></div>
    <div id="vault-dashboard-stats-container"></div>
    <div class="vault-dashboard-modal-actions">
      <button id="vault-dashboard-withdraw-btn" disabled>Withdraw All</button>
    </div>
  </div>
</div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    modal = document.querySelector('.vault-dashboard-modal-overlay');
    closeBtn = modal.querySelector('.vault-dashboard-modal-close-btn');
    statsSection = modal.querySelector('#vault-dashboard-stats-container');
    withdrawBtn = modal.querySelector('#vault-dashboard-withdraw-btn');
    errorDisplay = modal.querySelector('#vault-dashboard-modal-error');
    copyAddressBtn = modal.querySelector('#copy-address-btn');
    copyLinkBtn = modal.querySelector('#copy-link-btn');

    closeBtn.addEventListener('click', closeModal);
    withdrawBtn.addEventListener('click', handleWithdraw);
    copyAddressBtn.addEventListener('click', (e) => copyToClipboard(vault.vault_address, e.target));
    copyLinkBtn.addEventListener('click', (e) => copyToClipboard(`noema.art/referral/${vault.vault_name}`, e.target));

    render();
    fetchStats(vault);
}

window.openVaultDashboardModal = initVaultDashboardModal; 