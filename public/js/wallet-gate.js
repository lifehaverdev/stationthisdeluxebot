import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.10.0/+esm';

const MILADY_STATION_ADDRESS = '0x...'; // TODO: Replace with actual contract address
const ERC721A_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)'
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

export function setupWalletGate() {
  const panel = document.getElementById('wallet-connection-panel');
  if (!panel) return;

  panel.innerHTML = `<button id="connect-wallet-btn">Connect Wallet</button><div id="wallet-status"></div>`;
  const btn = document.getElementById('connect-wallet-btn');
  const statusDiv = document.getElementById('wallet-status');

  btn.onclick = async () => {
    if (!window.ethereum) {
      statusDiv.innerHTML = 'No Ethereum wallet found.';
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      currentAccount = accounts[0];
      statusDiv.innerHTML = `Connected: ${currentAccount}<br>Verifying admin...`;
      const contract = new ethers.Contract(MILADY_STATION_ADDRESS, ERC721A_ABI, provider);
      const owner = await contract.ownerOf(ADMIN_TOKEN_ID);
      if (owner.toLowerCase() === currentAccount.toLowerCase()) {
        adminVerified = true;
        statusDiv.innerHTML = `Connected: ${currentAccount}<br><span style='color:green;'>Admin Verified</span>`;
      } else {
        adminVerified = false;
        statusDiv.innerHTML = `Connected: ${currentAccount}<br><span style='color:red;'>Not Authorized</span>`;
      }
      emitStatusChange();
    } catch (e) {
      statusDiv.innerHTML = 'Error connecting or verifying admin.';
      adminVerified = false;
      emitStatusChange();
    }
  };
}

export { adminVerified }; 