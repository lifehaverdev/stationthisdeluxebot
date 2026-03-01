import { Component, h } from '@monygroupcorp/microact';
import { ethers } from 'ethers';

const MILADY_STATION_ADDRESS = '0xB24BaB1732D34cAD0A7C7035C3539aEC553bF3a0';
const ERC721A_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)'
];
const ADMIN_TOKEN_ID = 598;

/**
 * NFT-gated admin verification.
 * Props: { onVerified: (account, provider, signer) => void }
 */
export class WalletGate extends Component {
  constructor(props) {
    super(props);
    this.state = {
      status: 'checking',  // checking | disconnected | verifying | verified | denied | error
      account: null,
      nftImage: null,
      errorMsg: null,
    };
  }

  async didMount() {
    await this.checkExisting();
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => this.onAccountsChanged(accounts));
    }
  }

  async checkExisting() {
    if (!window.ethereum) {
      this.setState({ status: 'disconnected', errorMsg: 'No Ethereum wallet found.' });
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_accounts', []);
      if (accounts.length > 0) {
        await this.verify(provider, accounts[0]);
      } else {
        this.setState({ status: 'disconnected' });
      }
    } catch {
      this.setState({ status: 'disconnected' });
    }
  }

  async connectWallet() {
    if (!window.ethereum) {
      this.setState({ status: 'error', errorMsg: 'No wallet found.' });
      return;
    }
    this.setState({ status: 'verifying' });
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      await this.verify(provider, accounts[0]);
    } catch (e) {
      this.setState({ status: 'error', errorMsg: e.message });
    }
  }

  async verify(provider, account) {
    this.setState({ status: 'verifying', account });
    try {
      const contract = new ethers.Contract(MILADY_STATION_ADDRESS, ERC721A_ABI, provider);
      const owner = await contract.ownerOf(ADMIN_TOKEN_ID);

      if (owner.toLowerCase() === account.toLowerCase()) {
        const signer = await provider.getSigner();
        this.setState({ status: 'verified' });

        // Try to load NFT image
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
          if (imageUrl) this.setState({ nftImage: imageUrl });
        } catch { /* optional */ }

        if (this.props.onVerified) {
          this.props.onVerified(account, provider, signer);
        }
      } else {
        this.setState({ status: 'denied' });
      }
    } catch (e) {
      this.setState({ status: 'error', errorMsg: 'Error verifying admin: ' + e.message });
    }
  }

  async onAccountsChanged(accounts) {
    if (accounts.length === 0) {
      this.setState({ status: 'disconnected', account: null, nftImage: null });
    } else {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await this.verify(provider, accounts[0]);
    }
  }

  static get styles() {
    return `
      .wallet-gate {
        text-align: center;
        padding: 2rem;
        max-width: 500px;
        margin: 0 auto;
      }
      .wallet-gate-status {
        color: #888;
        margin-bottom: 1rem;
      }
      .wallet-gate-account {
        font-family: monospace;
        color: #ccc;
        font-size: 0.9rem;
        margin-bottom: 0.5rem;
      }
      .wallet-gate-verified {
        color: #4caf50;
        font-weight: 600;
      }
      .wallet-gate-denied {
        color: #d32f2f;
        font-weight: 600;
      }
      .wallet-gate-btn {
        background: #3f51b5;
        color: #fff;
        border: none;
        padding: 0.6rem 1.5rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.95rem;
      }
      .wallet-gate-btn:hover { background: #5c6bc0; }
      .wallet-gate-btn:disabled { background: #555; cursor: wait; }
      .wallet-gate-nft {
        max-width: 120px;
        border-radius: 8px;
        margin-top: 1rem;
      }
    `;
  }

  render() {
    const { status, account, nftImage, errorMsg } = this.state;

    if (status === 'checking') {
      return h('div', { className: 'wallet-gate' },
        h('p', { className: 'wallet-gate-status' }, 'Checking wallet...')
      );
    }

    if (status === 'disconnected') {
      return h('div', { className: 'wallet-gate' },
        errorMsg ? h('p', { className: 'wallet-gate-status' }, errorMsg) : null,
        h('button', { className: 'wallet-gate-btn', onClick: this.bind(this.connectWallet) }, 'Connect Wallet')
      );
    }

    if (status === 'verifying') {
      return h('div', { className: 'wallet-gate' },
        account ? h('p', { className: 'wallet-gate-account' }, account) : null,
        h('p', { className: 'wallet-gate-status' }, 'Verifying admin...')
      );
    }

    if (status === 'verified') {
      return h('div', { className: 'wallet-gate' },
        h('p', { className: 'wallet-gate-account' }, account),
        h('p', { className: 'wallet-gate-verified' }, 'Admin Verified'),
        nftImage ? h('img', { src: nftImage, className: 'wallet-gate-nft', alt: 'Admin NFT' }) : null
      );
    }

    if (status === 'denied') {
      return h('div', { className: 'wallet-gate' },
        h('p', { className: 'wallet-gate-account' }, account),
        h('p', { className: 'wallet-gate-denied' }, 'Not Authorized')
      );
    }

    return h('div', { className: 'wallet-gate' },
      h('p', { style: { color: '#d32f2f' } }, errorMsg || 'Unknown error'),
      h('button', { className: 'wallet-gate-btn', onClick: this.bind(this.connectWallet) }, 'Retry')
    );
  }
}
