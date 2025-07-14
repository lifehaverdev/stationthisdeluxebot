import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.10.0/+esm';

const MILADY_STATION_ADDRESS = '0xYourMiladyStationAddressHere'; // <-- Set actual address
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

export function setupWalletGate() {
  const panel = document.getElementById('wallet-connection-panel');
  if (!panel) return;

  panel.innerHTML = `<button id="connect-wallet-btn">Connect Wallet</button><div id="wallet-status"></div><div id="nft-preview"></div>`;
  const btn = document.getElementById('connect-wallet-btn');
  const statusDiv = document.getElementById('wallet-status');
  const nftDiv = document.getElementById('nft-preview');

  btn.onclick = async () => {
    if (!window.ethereum || !window.ethers) {
      statusDiv.innerHTML = 'No Ethereum wallet or ethers.js found.';
      return;
    }
    try {
      const provider = new window.ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      currentAccount = accounts[0];
      statusDiv.innerHTML = `Connected: ${currentAccount}<br>Verifying admin...`;
      const contract = new window.ethers.Contract(MILADY_STATION_ADDRESS, ERC721A_ABI, provider);
      const owner = await contract.ownerOf(ADMIN_TOKEN_ID);
      if (owner.toLowerCase() === currentAccount.toLowerCase()) {
        adminVerified = true;
        statusDiv.innerHTML = `Connected: ${currentAccount}<br><span style='color:green;'>Admin Verified</span>`;
        // Fetch and display NFT
        try {
          const tokenURI = await contract.tokenURI(ADMIN_TOKEN_ID);
          let imageUrl = '';
          if (tokenURI.startsWith('data:application/json;base64,')) {
            // Base64-encoded JSON
            const json = JSON.parse(atob(tokenURI.split(',')[1]));
            imageUrl = json.image;
          } else if (tokenURI.startsWith('http')) {
            // URL to JSON
            const resp = await fetch(tokenURI);
            const json = await resp.json();
            imageUrl = json.image;
          }
          if (imageUrl) {
            nftDiv.innerHTML = `<img src="${imageUrl}" alt="Admin NFT" style="max-width:120px;max-height:120px;margin-top:1em;border-radius:8px;box-shadow:0 2px 8px #0002;">`;
          } else {
            nftDiv.innerHTML = '<span style="color:#888;">NFT image not found.</span>';
          }
        } catch (e) {
          nftDiv.innerHTML = '<span style="color:#888;">Error loading NFT image.</span>';
        }
      } else {
        adminVerified = false;
        statusDiv.innerHTML = `Connected: ${currentAccount}<br><span style='color:red;'>Not Authorized</span>`;
        nftDiv.innerHTML = '';
      }
      emitStatusChange();
    } catch (e) {
      statusDiv.innerHTML = 'Error connecting or verifying admin.';
      nftDiv.innerHTML = '';
      adminVerified = false;
      emitStatusChange();
    }
  };
}

export { adminVerified }; 