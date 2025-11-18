/**
 * Wallet Connection Utilities
 * 
 * Handles Web3 wallet connection (MetaMask, WalletConnect, etc.)
 * for on-chain spell payments.
 * 
 * Uses ethers v6 BrowserProvider (matching sandbox implementation)
 */

// Wallet connection state
let provider = null;
let signer = null;
let walletAddress = null;

/**
 * Ensure ethers v6 is loaded (matching sandbox pattern)
 */
async function ensureEthers() {
  if (window.ethers) return;
  return new Promise((resolve, reject) => {
    // Avoid duplicating script tags
    const existing = document.querySelector('script[data-ethers]');
    if (existing) {
      existing.addEventListener('load', resolve);
      existing.addEventListener('error', () => reject(new Error('Failed to load wallet library.')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js';
    script.async = true;
    script.setAttribute('data-ethers', 'true');
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load wallet library.'));
    document.head.appendChild(script);
  });
}

/**
 * Check if wallet is already connected
 * @returns {Promise<string|null>} Wallet address if connected, null otherwise
 */
async function checkExistingConnection() {
  if (typeof window.ethereum === 'undefined') {
    return null;
  }
  
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
      walletAddress = accounts[0];
      
      // Initialize ethers v6 provider if we have an account
      try {
        await ensureEthers();
        if (!window.ethers) {
          console.warn('Ethers.js not properly loaded');
          return walletAddress; // Return address but don't initialize provider
        }
        
        // Use ethers v6 BrowserProvider (matching sandbox)
        provider = new window.ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        
        return walletAddress;
      } catch (err) {
        console.warn('Failed to initialize ethers provider:', err);
        return walletAddress; // Return address even if provider init fails
      }
    }
  } catch (error) {
    console.warn('Error checking existing connection:', error);
  }
  
  return null;
}

/**
 * Connect to user's Ethereum wallet
 * @returns {Promise<Object>} { walletAddress, provider, signer }
 */
async function connectWallet() {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('No Ethereum wallet found. Please install MetaMask (https://metamask.io) or another Web3 wallet.');
  }
  
  try {
    // Ensure ethers v6 is loaded (matching sandbox pattern)
    await ensureEthers();
    if (!window.ethers) {
      throw new Error('Wallet library not loaded.');
    }
    
    // Check if already connected
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0 && accounts[0] === walletAddress && provider && signer) {
      // Already connected with same account
      return { walletAddress, provider, signer };
    }
    
    // Request account access
    const requestedAccounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    walletAddress = requestedAccounts[0];
    
    if (!walletAddress) {
      throw new Error('No account selected. Please select an account in your wallet.');
    }
    
    // Initialize ethers v6 BrowserProvider (matching sandbox)
    provider = new window.ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    
    // Verify signer is available
    try {
      const address = await signer.getAddress();
      if (address.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error('Wallet address mismatch.');
      }
    } catch (err) {
      throw new Error('Failed to get wallet signer. Please try reconnecting.');
    }
    
    // Listen for account changes
    window.ethereum.on('accountsChanged', async (accounts) => {
      if (accounts.length === 0) {
        walletAddress = null;
        provider = null;
        signer = null;
        window.dispatchEvent(new CustomEvent('walletDisconnected'));
      } else if (accounts[0] !== walletAddress) {
        walletAddress = accounts[0];
        if (provider) {
          signer = await provider.getSigner();
        }
        window.dispatchEvent(new CustomEvent('walletConnected', { detail: { address: walletAddress } }));
      }
    });
    
    // Listen for network changes
    window.ethereum.on('chainChanged', (chainId) => {
      console.warn('Network changed to:', chainId);
      // Reload page or reconnect
      window.location.reload();
    });
    
    return { walletAddress, provider, signer };
  } catch (error) {
    // Handle specific error codes
    if (error.code === 4001) {
      throw new Error('Wallet connection was rejected. Please approve the connection request.');
    } else if (error.code === -32002) {
      throw new Error('Connection request already pending. Please check your wallet.');
    } else if (error.code === 'NETWORK_ERROR' || error.message.includes('network')) {
      throw new Error('Network error. Please check your internet connection.');
    } else if (error.message) {
      throw error; // Re-throw with original message
    } else {
      throw new Error(`Wallet connection failed: ${error.code || 'Unknown error'}`);
    }
  }
}

/**
 * Get current wallet address
 * @returns {string|null}
 */
function getWalletAddress() {
  return walletAddress;
}

/**
 * Get current signer
 * @returns {Object|null}
 */
function getSigner() {
  return signer;
}

/**
 * Check if wallet is connected
 * @returns {boolean}
 */
function isWalletConnected() {
  return !!walletAddress;
}

/**
 * Disconnect wallet (clear state)
 */
function disconnectWallet() {
  walletAddress = null;
  provider = null;
  signer = null;
}

/**
 * Show wallet connection modal
 */
function showWalletModal() {
  const modal = document.getElementById('wallet-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

/**
 * Hide wallet connection modal
 */
function hideWalletModal() {
  const modal = document.getElementById('wallet-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Initialize wallet modal handlers
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Close modal handlers
    const closeBtn = document.getElementById('wallet-modal-close');
    const modal = document.getElementById('wallet-modal');
    
    if (closeBtn) {
      closeBtn.addEventListener('click', hideWalletModal);
    }
    
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          hideWalletModal();
        }
      });
    }
    
    // Wallet option handlers
    const metamaskBtn = document.getElementById('wallet-option-metamask');
    const walletconnectBtn = document.getElementById('wallet-option-walletconnect');
    
    if (metamaskBtn) {
      metamaskBtn.addEventListener('click', async () => {
        try {
          await connectWallet();
          hideWalletModal();
          // Emit event for other scripts to listen
          window.dispatchEvent(new CustomEvent('walletConnected', { detail: { address: walletAddress } }));
        } catch (err) {
          alert(`Failed to connect: ${err.message}`);
        }
      });
    }
    
    if (walletconnectBtn) {
      walletconnectBtn.addEventListener('click', () => {
        alert('WalletConnect integration coming soon. Please use MetaMask for now.');
      });
    }
    
    // Check for existing connection on page load
    checkExistingConnection().then(address => {
      if (address) {
        window.dispatchEvent(new CustomEvent('walletConnected', { detail: { address } }));
      }
    });
  });
}

// Expose to window for use in other scripts
window.walletConnect = {
  connectWallet,
  getWalletAddress,
  getSigner,
  isWalletConnected,
  disconnectWallet,
  checkExistingConnection,
  showWalletModal,
  hideWalletModal
};

