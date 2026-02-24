import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { CopyButton, AsyncButton } from './ModalKit.js';
import { fetchJson, postWithCsrf } from '../../lib/api.js';
import { websocketClient } from '../ws.js';

// ── Constants ───────────────────────────────────────────────

const STEP = { ASSET: 1, AMOUNT: 2, REVIEW: 3, TX: 4, RECEIPT: 5 };
const API_BASE = '/api/v1/points';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const TIER_ORDER = ['native', 1, 2, 3];
const TIER_ASSETS = {
  native: ['eth'],
  1: ['ms2', 'cult'],
  2: ['eth', 'weth', 'usdt', 'usdc'],
  3: ['pepe', 'mog', 'spx6900'],
};

const PHASE_LABELS = {
  preparing: 'Step 1/4: Preparing transaction',
  approval: 'Step 2/4: Waiting for wallet signature',
  approving: 'Step 2/4: Confirming approval on-chain',
  deposit: 'Step 3/4: Waiting for wallet signature',
  confirming: 'Step 4/4: Processing deposit',
};

// ── Helpers ─────────────────────────────────────────────────

function safeToFixed(val, digits = 2) {
  const num = Number(val);
  return isFinite(num) ? num.toFixed(digits) : '-';
}

function normalizeAddress(addr) {
  return (addr || '').toLowerCase();
}

function isValidAddress(addr) {
  return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x' || hex === '0X') return 0n;
  return BigInt(hex);
}

function formatBigIntBalance(raw, decimals = 18, precision = 4) {
  if (typeof raw !== 'bigint') return '0';
  if (raw === 0n) return '0';
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  if (fraction === 0n) return whole.toString();
  if (precision <= 0) return whole.toString();
  const scale = 10n ** BigInt(precision);
  const scaledFraction = (fraction * scale) / divisor;
  let fractionStr = scaledFraction.toString().padStart(precision, '0');
  fractionStr = fractionStr.replace(/0+$/, '');
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

function toSmallestUnit(amountStr, decimals) {
  if (!amountStr || isNaN(amountStr)) return '0';
  const [whole, fraction = ''] = amountStr.split('.');
  const frac = fraction.padEnd(decimals, '0').slice(0, decimals);
  return (whole + frac).replace(/^0+/, '') || '0';
}

// ── BuyPointsModal ──────────────────────────────────────────

/**
 * BuyPointsModal — 5-step purchase wizard for buying points with crypto.
 *
 * Props:
 *   onClose — close handler
 */
export class BuyPointsModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      step: STEP.ASSET,
      // Asset selection
      supportedAssets: null,
      assetsLoading: true,
      selectedAsset: null,
      // Wallet
      walletAddress: null,
      walletBalances: null,
      balancesLoading: false,
      // Chain
      supportedChains: {},
      supportedChainIds: [],
      preferredChainId: '11155111',
      // Amount + quote
      amount: '',
      quote: null,
      donateQuote: null,
      quoteLoading: false,
      mode: 'contribute', // 'contribute' | 'donate'
      // Purchase
      purchase: null,
      // Tx status
      txStatus: null,
      statusMessage: null,
      statusPhase: null,
      statusProgress: 0,
      // Errors
      error: null,
    };
    this._quoteDebounce = null;
    this._quoteAbort = null;
    this._wsPointsHandler = null;
    this._wsTxHandler = null;
    this._progressInterval = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────

  didMount() {
    this._init();
    this._wsPointsHandler = (evt) => this._onPointsDeposit(evt);
    this._wsTxHandler = (evt) => this._onTxStatusUpdate(evt);
    websocketClient.on('pointsDepositUpdate', this._wsPointsHandler);

    this.registerCleanup(() => {
      websocketClient.off('pointsDepositUpdate', this._wsPointsHandler);
      if (this._wsTxHandler) websocketClient.off('transactionStatusUpdate', this._wsTxHandler);
      clearTimeout(this._quoteDebounce);
      clearInterval(this._progressInterval);
      if (this._quoteAbort) this._quoteAbort.abort();
    });

    // Chain change listener
    if (window.ethereum && window.ethereum.on) {
      this._chainListener = async () => {
        await this._refreshWallet();
        await this._fetchAssets();
      };
      window.ethereum.on('chainChanged', this._chainListener);
      this.registerCleanup(() => {
        if (window.ethereum && window.ethereum.removeListener) {
          window.ethereum.removeListener('chainChanged', this._chainListener);
        }
      });
    }
  }

  async _init() {
    await this._fetchChains();
    await this._refreshWallet();
    await this._fetchAssets();
  }

  // ── Chain helpers ───────────────────────────────────────────

  async _fetchChains() {
    try {
      const data = await fetchJson('/api/v1/points/supported-chains');
      if (data && Array.isArray(data.chains)) {
        const chains = {};
        data.chains.forEach(ch => { chains[ch.chainId] = ch.name; });
        const ids = Object.keys(chains);
        const preferred = ids.includes(this.state.preferredChainId) ? this.state.preferredChainId : (ids[0] || '11155111');
        this.setState({ supportedChains: chains, supportedChainIds: ids, preferredChainId: preferred });
      }
    } catch (err) {
      console.warn('[BuyPointsModal] Failed to fetch supported chains:', err);
    }
  }

  async _getCurrentChainId() {
    if (!window.ethereum) return null;
    try {
      const hexId = await window.ethereum.request({ method: 'eth_chainId' });
      return parseInt(hexId, 16).toString();
    } catch { return null; }
  }

  async _ensureCorrectNetwork() {
    const chainId = await this._getCurrentChainId();
    if (!chainId || this.state.supportedChainIds.includes(chainId)) return true;
    this.setState({ error: `Unsupported network (chain ${chainId}). Please switch to a supported network.` });
    return false;
  }

  // ── Wallet ──────────────────────────────────────────────────

  async _connectWallet() {
    if (!window.ethereum) throw new Error('No Ethereum wallet detected. Please install MetaMask.');
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      return accounts[0];
    } catch {
      throw new Error('Wallet connection rejected.');
    }
  }

  async _refreshWallet() {
    if (!window.ethereum) {
      this.setState({ walletAddress: null, walletBalances: null, balancesLoading: false });
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts || !accounts.length) {
        this.setState({ walletAddress: null, walletBalances: null, balancesLoading: false });
        return;
      }
      this.setState({ walletAddress: accounts[0] });
    } catch {
      this.setState({ walletAddress: null, walletBalances: null, balancesLoading: false });
    }
  }

  async _fetchBalances() {
    const { walletAddress, supportedAssets } = this.state;
    if (!window.ethereum || !walletAddress || !supportedAssets) return;

    this.setState({ balancesLoading: true });
    const balances = { tokens: {} };

    // Native ETH
    try {
      const ethHex = await window.ethereum.request({ method: 'eth_getBalance', params: [walletAddress, 'latest'] });
      const raw = BigInt(ethHex || '0x0');
      balances.tokens[normalizeAddress(ZERO_ADDRESS)] = { raw, decimals: 18, formatted: formatBigIntBalance(raw, 18) };
    } catch (err) {
      console.warn('[BuyPointsModal] ETH balance fetch failed:', err);
    }

    // ERC20 tokens
    const tokens = (supportedAssets.tokens || []).filter(Boolean);
    const balanceOfSel = '0x70a08231';
    const addrParam = walletAddress.toLowerCase().replace('0x', '').padStart(64, '0');

    for (const token of tokens) {
      const tokenAddr = normalizeAddress(token.address);
      if (!tokenAddr || tokenAddr === normalizeAddress(ZERO_ADDRESS)) continue;
      if (!isValidAddress(token.address)) continue;
      try {
        const data = `${balanceOfSel}${addrParam}`;
        const hex = await window.ethereum.request({ method: 'eth_call', params: [{ to: token.address, data }, 'latest'] });
        const raw = hexToBigInt(hex);
        balances.tokens[tokenAddr] = { raw, decimals: token.decimals || 18, formatted: formatBigIntBalance(raw, token.decimals || 18) };
      } catch (err) {
        console.warn('[BuyPointsModal] Token balance failed:', token.symbol, err);
      }
    }

    // NFTs
    const nfts = (supportedAssets.nfts || []).filter(Boolean);
    for (const nft of nfts) {
      const nftAddr = normalizeAddress(nft.address);
      if (!nftAddr || !isValidAddress(nft.address)) continue;
      try {
        const data = `${balanceOfSel}${addrParam}`;
        const hex = await window.ethereum.request({ method: 'eth_call', params: [{ to: nft.address, data }, 'latest'] });
        const raw = hexToBigInt(hex);
        balances.tokens[nftAddr] = { raw, decimals: 0, formatted: formatBigIntBalance(raw, 0) };
      } catch (err) {
        console.warn('[BuyPointsModal] NFT balance failed:', nft.name, err);
      }
    }

    this.setState({ walletBalances: balances, balancesLoading: false });
  }

  _getBalanceEntry(asset) {
    if (!asset || !this.state.walletBalances) return null;
    const map = this.state.walletBalances.tokens || {};
    const isEth = (asset.symbol || '').toUpperCase() === 'ETH';
    const addr = normalizeAddress(asset.address || (isEth ? ZERO_ADDRESS : ''));
    return map[addr] || null;
  }

  _assetHasBalance(asset) {
    const entry = this._getBalanceEntry(asset);
    return entry ? entry.raw > 0n : false;
  }

  _balanceLabel(asset) {
    const entry = this._getBalanceEntry(asset);
    if (!entry) return null;
    const sym = (asset.symbol || asset.name || '').toUpperCase();
    return `${entry.formatted} ${sym}`;
  }

  // ── Data fetching ───────────────────────────────────────────

  async _fetchAssets() {
    this.setState({ assetsLoading: true, error: null });
    try {
      const chainId = await this._getCurrentChainId() || this.state.preferredChainId;
      const data = await fetchJson(`${API_BASE}/supported-assets?chainId=${chainId}&t=${Date.now()}`);
      this.setState({ supportedAssets: data, assetsLoading: false });
      this._fetchBalances();
    } catch {
      this.setState({ error: 'Could not load supported assets.', assetsLoading: false });
    }
  }

  _onAmountInput(e) {
    const val = e.target.value;
    if (val !== '' && !/^\d*\.?\d*$/.test(val)) return;
    if (val.startsWith('-')) return;
    this.setState({ amount: val, quote: null, donateQuote: null, error: null });
    clearTimeout(this._quoteDebounce);
    if (val && this.state.selectedAsset) {
      this._quoteDebounce = setTimeout(() => this._fetchQuote(), 400);
    }
  }

  async _fetchQuote() {
    const { selectedAsset, amount, mode } = this.state;
    if (!selectedAsset || !amount) return;

    if (!(await this._ensureCorrectNetwork())) return;

    if (this._quoteAbort) this._quoteAbort.abort();
    this._quoteAbort = new AbortController();

    this.setState({ quoteLoading: true, error: null });

    try {
      let amountToSend = amount;
      if (selectedAsset.type === 'token') {
        amountToSend = toSmallestUnit(amount, selectedAsset.decimals || 18);
      }

      const fetchQuoteMode = async (quoteMode) => {
        const body = { type: selectedAsset.type, assetAddress: selectedAsset.address, amount: amountToSend, mode: quoteMode };
        const res = await postWithCsrf(`${API_BASE}/quote`, body);
        if (!res.ok) {
          const text = await res.text();
          let msg = 'Could not fetch quote.';
          try { msg = JSON.parse(text).message || msg; } catch {}
          throw new Error(msg);
        }
        return res.json();
      };

      if (mode === 'contribute') {
        const [cQuote, dQuote] = await Promise.all([
          fetchQuoteMode('contribute'),
          fetchQuoteMode('donate').catch(e => { if (e.name !== 'AbortError') console.warn('[BuyPointsModal] donate quote failed:', e); return null; }),
        ]);
        this.setState({ quote: cQuote, donateQuote: dQuote, quoteLoading: false });
      } else {
        const q = await fetchQuoteMode('donate');
        this.setState({ quote: q, donateQuote: null, quoteLoading: false });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      this.setState({ quoteLoading: false, error: err.message || 'Could not fetch quote.' });
    } finally {
      this._quoteAbort = null;
    }
  }

  // ── Purchase flow ───────────────────────────────────────────

  async _sendTransaction(tx) {
    const params = [{
      from: tx.from,
      to: tx.to,
      value: tx.value && tx.value !== '0' ? '0x' + BigInt(tx.value).toString(16) : '0x0',
      data: tx.data,
    }];
    return window.ethereum.request({ method: 'eth_sendTransaction', params });
  }

  async _waitForConfirmation(txHash, maxMs = 120000, pollMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
        if (receipt && receipt.blockNumber) {
          if (parseInt(receipt.status, 16) === 0) throw new Error('Transaction reverted on-chain');
          return receipt;
        }
      } catch (err) {
        console.warn('[BuyPointsModal] receipt poll error:', err.message);
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    throw new Error(`Confirmation timeout after ${maxMs / 1000}s`);
  }

  async _initiatePurchase() {
    const { quote, selectedAsset, amount, mode } = this.state;
    if (!quote) return;
    if (!(await this._ensureCorrectNetwork())) return;

    this.setState({ error: null, statusMessage: 'Preparing your transaction...', statusPhase: 'preparing', statusProgress: 10 });

    try {
      let amountToSend = amount;
      if (selectedAsset.type === 'token') {
        amountToSend = toSmallestUnit(amount, selectedAsset.decimals || 18);
      }

      let addr = this.state.walletAddress;
      if (!addr) {
        this.setState({ statusMessage: 'Connecting to wallet...', statusProgress: 15 });
        addr = await this._connectWallet();
        this.setState({ walletAddress: addr });
      }

      this.setState({ statusMessage: 'Checking token allowance...', statusProgress: 20 });

      const body = {
        quoteId: quote.quoteId,
        type: selectedAsset.type,
        assetAddress: selectedAsset.address,
        amount: amountToSend,
        userWalletAddress: addr,
        mode,
      };

      const res = await postWithCsrf(`${API_BASE}/purchase`, body);
      if (!res.ok) throw new Error('Failed to initiate purchase');
      const purchase = await res.json();
      this.setState({ purchase });

      const { approvalRequired, approvalTx, depositTx, donationTx } = purchase;
      let txHash;

      // Approval phase
      if (approvalRequired && approvalTx) {
        this.setState({ statusMessage: 'Please sign the APPROVAL in your wallet...', statusPhase: 'approval', statusProgress: 30 });
        try {
          const approvalHash = await this._sendTransaction(approvalTx);
          this.setState({ statusMessage: 'Approval submitted! Waiting for confirmation...', statusPhase: 'approving', statusProgress: 40 });

          let prog = 40;
          this._progressInterval = setInterval(() => {
            if (prog < 55) { prog += 1; this.setState({ statusMessage: 'Waiting for approval confirmation...', statusPhase: 'approving', statusProgress: prog }); }
          }, 2000);

          await this._waitForConfirmation(approvalHash, 120000, 2000);
          clearInterval(this._progressInterval);
          this.setState({ statusMessage: 'Approval confirmed!', statusPhase: 'approving', statusProgress: 60 });
        } catch (err) {
          clearInterval(this._progressInterval);
          const msg = err.message?.includes('reverted') ? 'Approval transaction reverted on-chain.'
            : err.message?.includes('timeout') ? 'Approval confirmation timed out. Please try again.'
            : 'Approval transaction was rejected or failed.';
          this.setState({ error: msg, statusMessage: null, statusPhase: null, statusProgress: 0 });
          return;
        }
      } else {
        this.setState({ statusMessage: 'No approval needed, proceeding to deposit...', statusProgress: 60 });
      }

      // Deposit phase
      const finalTx = mode === 'donate' ? (donationTx || depositTx) : depositTx;
      const actionLabel = mode === 'donate' ? 'DONATION' : 'DEPOSIT';

      try {
        this.setState({ statusMessage: `Please sign the ${actionLabel} in your wallet...`, statusPhase: 'deposit', statusProgress: 65 });
        txHash = await this._sendTransaction(finalTx);
        this.setState({
          statusMessage: null, statusPhase: null, statusProgress: 0,
          txStatus: { status: 'submitted', txHash, message: 'Transaction submitted. Waiting for confirmation...' },
          step: STEP.TX,
        });
        this._subscribeTxUpdates(txHash);
      } catch {
        this.setState({ error: 'Transaction was rejected or failed.', statusMessage: null, statusPhase: null, statusProgress: 0 });
        return;
      }
    } catch (err) {
      this.setState({ error: err.message || 'Could not initiate purchase.', statusMessage: null, statusPhase: null, statusProgress: 0 });
    }
  }

  // ── WebSocket handlers ──────────────────────────────────────

  _subscribeTxUpdates(txHash) {
    if (this._wsTxHandler) websocketClient.off('transactionStatusUpdate', this._wsTxHandler);
    this._wsTxHandler = (evt) => this._onTxStatusUpdate(evt);
    websocketClient.on('transactionStatusUpdate', this._wsTxHandler);
  }

  _onTxStatusUpdate(event) {
    const { txHash, status, message, error, receipt, originalTxHashes } = event;
    const { txStatus } = this.state;
    if (!txStatus) return;

    // Check relevance
    if (txStatus.txHash !== txHash) {
      if (originalTxHashes && originalTxHashes.includes(txStatus.txHash)) {
        this.setState({ txStatus: { ...txStatus, confirmationTxHash: txHash } });
      } else {
        return;
      }
    }

    const updated = { ...txStatus };
    switch (status) {
      case 'submitted': updated.status = 'submitted'; updated.message = message || 'Transaction submitted...'; break;
      case 'pending': updated.status = 'pending'; updated.message = message || 'Pending in mempool...'; break;
      case 'confirming': updated.status = 'confirming'; updated.message = message || 'Being confirmed...'; break;
      case 'confirmed': updated.status = 'confirmed'; updated.message = message || 'Confirmed!'; if (receipt) updated.receipt = receipt; break;
      case 'failed': updated.status = 'Failed'; updated.failureReason = error || message || 'Transaction failed'; break;
    }
    this.setState({ txStatus: updated, error: status === 'failed' ? updated.failureReason : this.state.error });
  }

  _onPointsDeposit(event) {
    const { status, reason, originalTxHashes, ...receiptData } = event;
    const { step, txStatus } = this.state;
    if (step !== STEP.TX || !txStatus || !originalTxHashes || !originalTxHashes.includes(txStatus.txHash)) return;

    if (status === 'confirmed') {
      this.setState({
        txStatus: { ...txStatus, status: 'Success!', receipt: receiptData, confirmationTxHash: receiptData.confirmation_tx_hash },
        step: STEP.RECEIPT,
      });
    } else if (status === 'failed') {
      this.setState({
        txStatus: { ...txStatus, status: 'Failed', failureReason: reason || 'Transaction failed.' },
        error: reason || 'Transaction failed.',
      });
    }
  }

  // ── Manual refresh ──────────────────────────────────────────

  async _manualRefresh() {
    const { txStatus } = this.state;
    if (!txStatus || !txStatus.txHash) return;

    this.setState({ error: null });
    try {
      const data = await fetchJson(`${API_BASE}/tx-status?txHash=${txStatus.txHash}`);
      const updated = {
        ...txStatus,
        status: data.status,
        receipt: data.receipt,
        confirmationTxHash: data.receipt?.confirmation_tx_hash || data.receipt?.confirmationTxHash,
        failureReason: data.failureReason,
      };
      if (data.status === 'CONFIRMED' && data.receipt) {
        this.setState({ txStatus: updated, step: STEP.RECEIPT });
      } else if (data.status === 'FAILED') {
        this.setState({ txStatus: updated, error: data.failureReason || 'Transaction failed' });
      } else {
        this.setState({ txStatus: updated });
      }
    } catch (err) {
      this.setState({ error: err.message || 'Failed to refresh status.' });
    }
  }

  // ── Navigation ──────────────────────────────────────────────

  _goStep(n) {
    this.setState({ step: n, error: null });
  }

  _selectAsset(asset, type) {
    this.setState({ selectedAsset: { ...asset, type }, amount: '', quote: null, donateQuote: null, mode: 'contribute' });
    this._goStep(STEP.AMOUNT);
  }

  _acceptDonateDeal() {
    this.setState({ mode: 'donate', quote: null, donateQuote: null });
    clearTimeout(this._quoteDebounce);
    this._quoteDebounce = setTimeout(() => this._fetchQuote(), 50);
  }

  // ── Render: Step 1 — Asset Selection ────────────────────────

  _renderAssetStep() {
    const { supportedAssets, assetsLoading, walletAddress, walletBalances, balancesLoading } = this.state;

    if (assetsLoading) return h(Loader, { message: 'Loading assets...' });

    if (!walletAddress) {
      return h('div', null,
        h('p', { style: 'color:var(--text-secondary);margin-bottom:12px' }, 'Connect your wallet to view available payment assets.'),
        h(AsyncButton, { onclick: this.bind(this._onConnectWallet), label: 'Connect Wallet' })
      );
    }

    if (balancesLoading || !walletBalances) {
      return h(Loader, { message: 'Checking wallet balances...' });
    }

    if (!supportedAssets) {
      return h('div', { style: 'color:var(--text-secondary)' }, 'No asset data available.');
    }

    const tokens = (supportedAssets.tokens || []).filter(t => t && (t.symbol || t.name));
    const nfts = (supportedAssets.nfts || []).filter(n => n && n.name);
    const renderedAddrs = new Set();
    const tierGroups = [];

    // Native ETH balance header
    const nativeEntry = this._getBalanceEntry({ address: ZERO_ADDRESS, symbol: 'ETH' });
    const ethBal = nativeEntry ? `${nativeEntry.formatted} ETH` : '0 ETH';

    // Render tiers
    for (const tier of TIER_ORDER) {
      const syms = TIER_ASSETS[tier];
      if (!syms) continue;
      const tierTokens = syms
        .map(sym => tokens.find(a => (a.symbol || a.name || '').toLowerCase() === sym.toLowerCase()))
        .filter(a => a && this._assetHasBalance(a));
      if (!tierTokens.length) continue;

      const heading = tier === 'native' ? 'Native Assets' : `Tier ${tier}`;
      tierGroups.push(
        h('div', { className: 'bp-tier', key: `tier-${tier}` },
          h('div', { className: 'bp-tier-heading' }, heading),
          ...tierTokens.map(asset => {
            renderedAddrs.add(normalizeAddress(asset.address));
            return this._renderAssetBtn(asset, 'token');
          })
        )
      );
    }

    // Remaining tokens
    const remaining = tokens.filter(t => !renderedAddrs.has(normalizeAddress(t.address))).filter(a => this._assetHasBalance(a));
    if (remaining.length) {
      tierGroups.push(
        h('div', { className: 'bp-tier', key: 'tier-other' },
          h('div', { className: 'bp-tier-heading' }, 'Other'),
          ...remaining.map(asset => this._renderAssetBtn(asset, 'token'))
        )
      );
    }

    // NFTs
    const nftsWithBal = nfts.filter(n => this._assetHasBalance(n));
    if (nftsWithBal.length) {
      tierGroups.push(
        h('div', { className: 'bp-tier', key: 'tier-nft' },
          h('div', { className: 'bp-tier-heading' }, 'NFTs'),
          ...nftsWithBal.map(asset => this._renderAssetBtn(asset, 'nft'))
        )
      );
    }

    if (!tierGroups.length) {
      return h('div', null,
        h('div', { className: 'bp-wallet-summary' }, `ETH Balance: ${ethBal}`),
        h('div', { style: 'color:var(--text-secondary);text-align:center;padding:20px 0' }, 'No supported token balances detected. Deposit a supported asset to continue.')
      );
    }

    return h('div', null,
      h('div', { className: 'bp-wallet-summary' }, `ETH Balance: ${ethBal}`),
      ...tierGroups
    );
  }

  _renderAssetBtn(asset, type) {
    const iconSrc = asset.iconUrl || '/images/sandbox/components/placeholder.png';
    const sym = asset.symbol || asset.name;
    const bal = this._balanceLabel(asset);

    return h('button', {
      className: 'bp-asset-btn',
      key: normalizeAddress(asset.address),
      onclick: () => this._selectAsset(asset, type),
    },
      h('div', { className: 'bp-asset-main' },
        h('img', { src: iconSrc, alt: sym, className: 'bp-asset-icon' }),
        h('span', null, sym)
      ),
      bal ? h('div', { className: 'bp-asset-bal' }, `Bal: ${bal}`) : null
    );
  }

  async _onConnectWallet() {
    try {
      const addr = await this._connectWallet();
      this.setState({ walletAddress: addr });
      await this._fetchBalances();
    } catch (err) {
      this.setState({ error: err.message });
    }
  }

  // ── Render: Step 2 — Amount Input ───────────────────────────

  _renderAmountStep() {
    const { selectedAsset, amount, quote, donateQuote, quoteLoading, mode } = this.state;
    const sym = selectedAsset ? (selectedAsset.symbol || selectedAsset.name) : '';

    const quoteBody = quoteLoading
      ? h(Loader, { message: 'Fetching quote...' })
      : quote
        ? h('div', { className: 'bp-quote' },
          h('div', null, 'Points: ', h('b', { style: 'color:var(--accent)' }, quote.pointsCredited ?? '-')),
          h('div', null, `Funding Rate: ${quote.fundingRate ?? '-'}`),
          h('div', null, `USD Value: $${safeToFixed(quote.usdValue?.gross)}`),
          h('div', null, `Fees: $${safeToFixed(quote.fees?.totalFeesUsd)}`)
        )
        : h('div', { style: 'color:var(--text-secondary);font-size:var(--fs-base)' }, 'Enter an amount to get a quote.');

    // Donate deal banner
    const isEligible = mode === 'contribute' && quote && donateQuote && donateQuote.pointsCredited > quote.pointsCredited;
    const donateBanner = isEligible
      ? h('div', { className: 'bp-donate-banner' },
        h('span', { style: 'font-weight:bold' }, `Get +${donateQuote.pointsCredited - quote.pointsCredited} more points by donating `),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._acceptDonateDeal), label: 'Accept Deal' })
      )
      : null;

    return h('div', null,
      h('div', { className: 'bp-selected' }, `Selected: ${sym}`),
      h('input', {
        type: 'text',
        className: 'bp-input',
        placeholder: 'Amount to spend',
        value: amount,
        oninput: this.bind(this._onAmountInput),
      }),
      quoteBody,
      donateBanner,
      h('div', { className: 'bp-nav' },
        h(AsyncButton, { variant: 'secondary', onclick: () => this._goStep(STEP.ASSET), label: 'Back' }),
        h(AsyncButton, { disabled: !quote, onclick: () => this._goStep(STEP.REVIEW), label: 'Review Purchase' })
      )
    );
  }

  // ── Render: Step 3 — Review ─────────────────────────────────

  _renderReviewStep() {
    const { selectedAsset, amount, quote, mode } = this.state;
    if (!quote) return h('div', { style: 'color:var(--text-secondary)' }, 'No quote available.');

    const q = quote;
    const b = q.breakdown || {};
    const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    const estimatedGas = toNum(b.estimatedGasUsd ?? q.fees?.estimatedGasUsd);
    const showGasRow = mode !== 'donate';
    let userReceives = toNum(b.userReceivesUsd ?? q.userReceivesUsd ?? q.usdValue?.netAfterFundingRate ?? q.usdValue?.gross);
    if (!showGasRow && estimatedGas) userReceives += estimatedGas;

    const sym = selectedAsset.symbol || selectedAsset.name;
    const ctaLabel = mode === 'donate' ? 'Donate & Buy Points' : 'Buy Points';

    return h('div', null,
      h('div', { className: 'bp-review' },
        h('div', null, `Asset: ${sym}`),
        h('div', null, `Amount: ${amount}`),
        h('div', null, 'Points: ', h('b', { style: 'color:var(--accent)' }, q.pointsCredited),
          mode === 'donate' ? h('span', { style: 'font-size:var(--fs-xs);color:var(--accent);margin-left:6px' }, '(boosted)') : null
        ),
        h('hr', { style: 'border-color:var(--border);margin:12px 0' }),
        h('div', null, 'Gross USD: ', h('b', null, `$${safeToFixed(b.grossUsd ?? q.usdValue?.gross)}`)),
        h('div', null, 'Funding Rate Deduction: ', h('b', null, `-$${safeToFixed(b.fundingRateDeduction ?? 0)}`)),
        h('div', null, 'Net After Funding Rate: ', h('b', null, `$${safeToFixed(b.netAfterFundingRate ?? q.usdValue?.netAfterFundingRate)}`)),
        showGasRow
          ? h('div', null, 'Estimated Gas Fee: ', h('b', null, `-$${safeToFixed(estimatedGas)}`))
          : h('div', null, 'Estimated Gas Fee: ', h('b', null, '$0 (covered for donations)')),
        h('div', { style: 'font-weight:bold;color:var(--accent);margin-top:8px' }, `User Receives: $${safeToFixed(userReceives)}`)
      ),
      h('div', { className: 'bp-nav' },
        h(AsyncButton, { variant: 'secondary', onclick: () => this._goStep(STEP.AMOUNT), label: 'Back' }),
        h(AsyncButton, { onclick: this.bind(this._initiatePurchase), label: ctaLabel })
      )
    );
  }

  // ── Render: Step 4 — Tx Status ──────────────────────────────

  _renderTxStep() {
    const { txStatus, statusMessage, statusPhase, statusProgress } = this.state;

    // Show loader with status if still in purchase flow before step 4 proper
    if (statusMessage) {
      return h('div', { className: 'bp-status-center' },
        h(Loader, { message: statusMessage, progress: statusProgress > 0 ? statusProgress / 100 : null }),
        statusPhase ? h('div', { className: 'bp-phase' }, PHASE_LABELS[statusPhase] || '') : null
      );
    }

    if (!txStatus) return h(Loader, { message: 'Waiting for transaction status...' });

    const statusColors = { submitted: 'var(--accent)', pending: 'var(--accent-dim)', confirming: 'var(--accent-dim)', confirmed: 'var(--accent)', 'Success!': 'var(--accent)', Failed: 'var(--danger)' };
    const color = statusColors[txStatus.status] || 'var(--accent)';
    const isProcessing = ['submitted', 'pending', 'confirming'].includes(txStatus.status);

    const statusLabels = {
      submitted: 'Transaction Submitted',
      pending: 'Transaction Pending',
      confirming: 'Confirming...',
      confirmed: 'Confirmed!',
      'Success!': 'Confirmed!',
      Failed: 'Transaction Failed',
    };

    return h('div', null,
      h('div', { style: 'text-align:center;padding:20px 0' },
        isProcessing
          ? h('div', { className: 'bp-spinner-large', style: `border-top-color:${color}` })
          : null,
        h('div', { style: `font-size:var(--fs-xl);color:${color};font-weight:bold;margin-bottom:8px` },
          statusLabels[txStatus.status] || txStatus.status || 'Processing'
        ),
        txStatus.message ? h('p', { style: 'color:var(--text-secondary);font-size:var(--fs-md);margin:8px 0' }, txStatus.message) : null
      ),
      h('div', { className: 'bp-hash-box' },
        h('div', { style: 'font-size:var(--fs-xs);color:var(--text-label);margin-bottom:4px' }, 'Transaction Hash'),
        h('div', { style: 'display:flex;align-items:center;gap:8px' },
          h('code', { style: 'font-size:var(--fs-base);word-break:break-all;color:var(--accent);flex:1;font-family:var(--ff-mono)' }, txStatus.txHash),
          h(CopyButton, { text: txStatus.txHash })
        )
      ),
      txStatus.confirmationTxHash
        ? h('div', { className: 'bp-hash-box' },
          h('div', { style: 'font-size:var(--fs-xs);color:var(--text-label);margin-bottom:4px' }, 'Confirmation Tx'),
          h('div', { style: 'display:flex;align-items:center;gap:8px' },
            h('code', { style: 'font-size:var(--fs-base);word-break:break-all;color:var(--accent);flex:1;font-family:var(--ff-mono)' }, txStatus.confirmationTxHash),
            h(CopyButton, { text: txStatus.confirmationTxHash })
          )
        )
        : null,
      txStatus.failureReason
        ? h('div', { style: 'background:var(--danger-dim);color:var(--danger);padding:12px;border-radius:0;margin-top:12px;border:var(--border-width) solid var(--danger)' }, txStatus.failureReason)
        : null,
      isProcessing
        ? h('p', { style: 'text-align:center;color:var(--text-label);font-size:var(--fs-xs);margin-top:16px' }, 'This usually takes 15-60 seconds. You can close this modal - your points will be credited automatically.')
        : null,
      h('div', { className: 'bp-nav', style: 'margin-top:16px' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._manualRefresh), label: 'Refresh' })
      )
    );
  }

  // ── Render: Step 5 — Receipt ────────────────────────────────

  _renderReceiptStep() {
    const { txStatus, selectedAsset, amount } = this.state;
    if (!txStatus || !txStatus.receipt) return h('div', { style: 'color:var(--text-secondary)' }, 'No receipt available.');

    const r = txStatus.receipt;
    const sym = selectedAsset ? (selectedAsset.symbol || selectedAsset.name) : '-';

    return h('div', { className: 'bp-receipt' },
      h('h3', { style: 'color:var(--accent);margin:0 0 16px' }, 'Purchase Complete!'),
      h('div', null, 'Points Credited: ', h('b', { style: 'color:var(--accent)' }, `+${r.points_credited}`)),
      h('div', null, `USD Credited: $${safeToFixed(r.user_credited_usd)}`),
      h('hr', { style: 'border-color:var(--border);margin:12px 0' }),
      h('div', null, `Asset: ${sym}`),
      h('div', null, `Amount: ${amount}`),
      h('div', { style: 'margin-top:12px' },
        h('span', { style: 'color:var(--text-secondary);font-size:var(--fs-xs)' }, 'Your Tx Hash: '),
        h('code', { style: 'font-size:var(--fs-xs);word-break:break-all;color:var(--accent);font-family:var(--ff-mono)' }, txStatus.txHash),
        h(CopyButton, { text: txStatus.txHash })
      ),
      r.confirmation_tx_hash
        ? h('div', { style: 'margin-top:6px' },
          h('span', { style: 'color:var(--text-secondary);font-size:var(--fs-xs)' }, 'Confirmation Tx: '),
          h('code', { style: 'font-size:var(--fs-xs);word-break:break-all;color:var(--accent);font-family:var(--ff-mono)' }, r.confirmation_tx_hash),
          h(CopyButton, { text: r.confirmation_tx_hash })
        )
        : null,
      h('div', { className: 'bp-nav', style: 'margin-top:20px' },
        h(AsyncButton, { onclick: () => this.props.onClose?.(), label: 'Close' })
      )
    );
  }

  // ── Styles ──────────────────────────────────────────────────

  static get styles() {
    return `
      /* Wallet summary */
      .bp-wallet-summary { font-size:var(--fs-base); color:var(--accent); margin-bottom:12px; }

      /* Tiers */
      .bp-tier { margin-bottom:12px; }
      .bp-tier-heading { font-size:var(--fs-xs); color:var(--text-secondary); text-transform:uppercase; letter-spacing:var(--ls-wide); font-weight:600; margin-bottom:6px; padding-bottom:4px; border-bottom:var(--border-width) solid var(--border); }

      /* Asset button */
      .bp-asset-btn {
        display:flex; align-items:center; justify-content:space-between; width:100%; padding:10px 14px;
        background:var(--surface-2); border:var(--border-width) solid var(--border); border-radius:0; color:var(--text-primary); cursor:pointer;
        font-size:var(--fs-md); margin-bottom:6px; transition:border-color var(--dur-interact) var(--ease);
      }
      .bp-asset-btn:hover { border-color:var(--border-hover); }
      .bp-asset-main { display:flex; align-items:center; gap:10px; }
      .bp-asset-icon { width:24px; height:24px; border-radius:50%; }
      .bp-asset-bal { font-size:var(--fs-xs); color:var(--text-secondary); background:var(--surface-1); padding:2px 8px; border-radius:0; }

      /* Amount step */
      .bp-selected { font-size:var(--fs-md); color:var(--text-primary); margin-bottom:12px; }
      .bp-input {
        width:100%; padding:10px 14px; background:var(--surface-1); border:var(--border-width) solid var(--border); border-radius:0;
        color:var(--text-primary); font-size:var(--fs-md); box-sizing:border-box; margin-bottom:12px; outline:none;
      }
      .bp-input:focus { border-color:var(--accent-border); }
      .bp-quote { background:var(--surface-1); padding:12px; border-radius:0; font-size:var(--fs-base); line-height:1.8; }
      .bp-donate-banner {
        display:flex; align-items:center; justify-content:space-between; gap:12px;
        background:var(--surface-3); padding:10px 14px; border-radius:0; margin-top:10px; color:var(--text-primary);
        border:var(--border-width) solid var(--border);
      }

      /* Review */
      .bp-review { background:var(--surface-1); padding:16px; border-radius:0; font-size:var(--fs-md); line-height:1.8; }

      /* Navigation */
      .bp-nav { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }

      /* Tx status */
      .bp-status-center { text-align:center; padding:24px 0; }
      .bp-phase { font-size:var(--fs-xs); color:var(--text-secondary); margin-top:8px; }
      .bp-spinner-large {
        width:60px; height:60px; margin:0 auto 16px; border:3px solid var(--border);
        border-radius:50%; animation:bp-spin 1s linear infinite;
      }
      @keyframes bp-spin { to { transform:rotate(360deg); } }
      .bp-hash-box { background:var(--surface-1); padding:12px; border-radius:0; margin-top:12px; }

      /* Receipt */
      .bp-receipt { line-height:1.8; font-size:var(--fs-md); }
    `;
  }

  // ── Main render ─────────────────────────────────────────────

  render() {
    const { step, error, statusMessage, statusPhase } = this.state;

    // If we have status (mid-purchase), show loading overlay in review step
    const showPurchaseLoader = statusMessage && step === STEP.REVIEW;

    const titles = {
      [STEP.ASSET]: 'Buy Points',
      [STEP.AMOUNT]: 'Enter Amount',
      [STEP.REVIEW]: 'Review Purchase',
      [STEP.TX]: 'Transaction Status',
      [STEP.RECEIPT]: 'Purchase Complete',
    };

    let body;
    if (showPurchaseLoader) {
      body = h('div', { className: 'bp-status-center' },
        h(Loader, { message: statusMessage, progress: this.state.statusProgress > 0 ? this.state.statusProgress / 100 : null }),
        statusPhase ? h('div', { className: 'bp-phase' }, PHASE_LABELS[statusPhase] || '') : null
      );
    } else {
      switch (step) {
        case STEP.ASSET: body = this._renderAssetStep(); break;
        case STEP.AMOUNT: body = this._renderAmountStep(); break;
        case STEP.REVIEW: body = this._renderReviewStep(); break;
        case STEP.TX: body = this._renderTxStep(); break;
        case STEP.RECEIPT: body = this._renderReceiptStep(); break;
        default: body = h('div', { style: 'display:none' });
      }
    }

    return h(Modal, { onClose: this.props.onClose, title: titles[step] || 'Buy Points', wide: true, content: [
      error ? ModalError({ message: error }) : null,
      body,
    ] });
  }
}
