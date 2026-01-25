import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.10.0/+esm';

const MILADY_STATION_ADDRESS = '0xB24BaB1732D34cAD0A7C7035C3539aEC553bF3a0'; // Milady Station NFT contract
const ERC721A_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)'
];
const ADMIN_TOKEN_ID = 598;

let adminVerified = false;
let currentAccount = null;
let listeners = [];

function emitStatusChange() {
  listeners.forEach(fn => fn(adminVerified));
}

export function onAdminStatusChange(fn) {
  listeners.push(fn);
}

async function verifyAdmin(provider, account, statusDiv, nftDiv) {
  currentAccount = account;
  statusDiv.innerHTML = `Connected: ${account}<br>Verifying admin...`;

  try {
    const contract = new ethers.Contract(MILADY_STATION_ADDRESS, ERC721A_ABI, provider);
    const owner = await contract.ownerOf(ADMIN_TOKEN_ID);

    if (owner.toLowerCase() === account.toLowerCase()) {
      adminVerified = true;
      statusDiv.innerHTML = `Connected: ${account}<br><span style='color:green;'>Admin Verified</span>`;

      // Fetch and display NFT
      try {
        const tokenURI = await contract.tokenURI(ADMIN_TOKEN_ID);
        let imageUrl = '';
        if (tokenURI.startsWith('data:application/json;base64,')) {
          const json = JSON.parse(atob(tokenURI.split(',')[1]));
          imageUrl = json.image;
        } else if (tokenURI.startsWith('http')) {
          const resp = await fetch(tokenURI);
          const json = await resp.json();
          imageUrl = json.image;
        }
        if (imageUrl) {
          nftDiv.innerHTML = `<img src="${imageUrl}" alt="Admin NFT" style="max-width:120px;max-height:120px;margin-top:1em;border-radius:8px;box-shadow:0 2px 8px #0002;">`;
        }
      } catch (e) {
        // NFT image loading is optional
      }
    } else {
      adminVerified = false;
      statusDiv.innerHTML = `Connected: ${account}<br><span style='color:red;'>Not Authorized</span>`;
      nftDiv.innerHTML = '';
    }
  } catch (e) {
    adminVerified = false;
    statusDiv.innerHTML = `Connected: ${account}<br><span style='color:red;'>Error verifying admin</span>`;
    nftDiv.innerHTML = '';
  }

  emitStatusChange();
}

export function setupWalletGate() {
  const panel = document.getElementById('wallet-connection-panel');
  if (!panel) return;

  panel.innerHTML = `<button id="connect-wallet-btn" style="display:none;">Connect Wallet</button><div id="wallet-status">Checking wallet...</div><div id="nft-preview"></div>`;
  const btn = document.getElementById('connect-wallet-btn');
  const statusDiv = document.getElementById('wallet-status');
  const nftDiv = document.getElementById('nft-preview');

  // Check if wallet is already connected (doesn't prompt user)
  async function checkExistingConnection() {
    if (!window.ethereum) {
      statusDiv.innerHTML = 'No Ethereum wallet found.';
      btn.style.display = 'block';
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      // eth_accounts doesn't prompt - just returns already connected accounts
      const accounts = await provider.send('eth_accounts', []);

      if (accounts.length > 0) {
        // Already connected - verify admin automatically
        await verifyAdmin(provider, accounts[0], statusDiv, nftDiv);
      } else {
        // Not connected - show button
        statusDiv.innerHTML = '';
        btn.style.display = 'block';
      }
    } catch (e) {
      statusDiv.innerHTML = 'Error checking wallet connection.';
      btn.style.display = 'block';
    }
  }

  // Connect button handler (only shown if not already connected)
  btn.onclick = async () => {
    if (!window.ethereum) {
      statusDiv.innerHTML = 'No Ethereum wallet found.';
      return;
    }
    try {
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      await verifyAdmin(provider, accounts[0], statusDiv, nftDiv);
      btn.style.display = 'none';
    } catch (e) {
      statusDiv.innerHTML = 'Error connecting wallet.';
      btn.disabled = false;
      btn.textContent = 'Connect Wallet';
    }
  };

  // Listen for account changes
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', async (accounts) => {
      if (accounts.length === 0) {
        adminVerified = false;
        currentAccount = null;
        statusDiv.innerHTML = '';
        nftDiv.innerHTML = '';
        btn.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Connect Wallet';
        emitStatusChange();
      } else {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await verifyAdmin(provider, accounts[0], statusDiv, nftDiv);
      }
    });
  }

  // Check on load
  checkExistingConnection();
}

export { adminVerified, currentAccount };
