import { adminVerified, onAdminStatusChange } from './wallet-gate.js';
const dashboard = document.getElementById('dashboard');
const tbody = document.querySelector('#balances-table tbody');
const statusMsg = document.getElementById('status-msg');

async function fetchBalances() {
  statusMsg.textContent = 'Loading balances…';
  const sigData = await signAuthMessage();
  const res = await fetch('/internal/v1/data/admin/vaults/balances', {
    headers: {
      'x-address': sigData.address,
      'x-signature': sigData.signature,
      'x-message': sigData.message
    }
  });
  const json = await res.json();
  renderBalances(json.vaults || []);
  statusMsg.textContent = '';
}

function renderBalances(vaults) {
  tbody.innerHTML = '';
  vaults.forEach(v => {
    v.tokens.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${v.vaultName||v.vaultAddress.slice(0,6)+'…'}</td><td>${t.symbol}</td><td>${formatWei(t.balanceWei, t.decimals)}</td><td><button data-v="${v.vaultAddress}" data-t="${t.tokenAddress}" data-a="${t.balanceWei}">Queue Withdrawal</button></td>`;
      tbody.appendChild(tr);
    });
  });
}

function formatWei(wei, decimals) {
  return (Number(wei) / 10 ** decimals).toFixed(6);
}

document.addEventListener('click', async (e) => {
  if (e.target.tagName === 'BUTTON' && e.target.dataset.v) {
    const { v: vault, t: token, a: amount } = e.target.dataset;
    const sig = await signAuthMessage();
    await fetch('/internal/v1/data/admin/withdrawals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-address': sig.address,
        'x-signature': sig.signature,
        'x-message': sig.message
      },
      body: JSON.stringify({ vault_address: vault, token_address: token, amount_wei: amount })
    });
    statusMsg.textContent = 'Withdrawal queued';
  }
});

async function signAuthMessage() {
  const msg = 'Admin dashboard auth ' + Date.now();
  const provider = new window.ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const signature = await signer.signMessage(msg);
  return { address, signature, message: msg };
}

onAdminStatusChange((isAdmin) => {
  if (isAdmin) {
    dashboard.style.display = 'block';
    fetchBalances();
  } else {
    dashboard.style.display = 'none';
  }
});
