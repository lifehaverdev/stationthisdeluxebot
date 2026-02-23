// --- State Management ---
const buyPointsState = {
    step: 1,
    supportedAssets: null,
    selectedAsset: null,
    amount: '',
    quote: null,
    purchase: null,
    txStatus: null,
    error: null,
    isLoading: false,
    pollInterval: null,
    // New: operation mode – 'contribute' (default) or 'donate'
    mode: 'contribute',
    // Holds donate-mode quote for comparison
    donateQuote: null,
    // Wallet + balance tracking
    walletAddress: null,
    walletBalances: null,
    balancesLoading: false,
    // Status feedback for better UX
    statusMessage: null,
    statusPhase: null, // 'preparing' | 'approval' | 'approving' | 'deposit' | 'confirming'
    statusProgress: 0 // 0-100
};

// --- Request Cancellation ---
let currentQuoteAbortController = null;

// --- DOM Element References ---
let modal, modalContent, walletInfoDiv, closeModalBtn, closeModalBtnBottom, step1, step2, step3, step4, step5, loader, errorDisplay;
let assetSelection, amountInput, quoteDisplay, reviewSummary, txStatusDisplay, receiptDisplay;
let customCoinBtn, customCoinInputContainer, customCoinAddress, customCoinSubmit;
let selectedAssetDisplay, reviewPurchaseBtn, confirmPurchaseBtn;

// --- Utility Functions (Function Declarations) ---
function safeToFixed(val, digits = 2) {
    const num = Number(val);
    return isFinite(num) ? num.toFixed(digits) : '-';
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function normalizeAddress(address) {
    return (address || '').toLowerCase();
}

function isValidAddress(address) {
    return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
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
    return fractionStr ? `${whole.toString()}.${fractionStr}` : whole.toString();
}

function getBalanceEntryForAsset(asset) {
    if (!asset || !buyPointsState.walletBalances) return null;
    const map = buyPointsState.walletBalances.tokens || {};
    const isEth = (asset.symbol || '').toUpperCase() === 'ETH';
    const addr = normalizeAddress(asset.address || (isEth ? ZERO_ADDRESS : ''));
    return map[addr] || null;
}

function assetHasPositiveBalance(asset) {
    const entry = getBalanceEntryForAsset(asset);
    return entry ? entry.raw > 0n : false;
}

function getBalanceLabel(asset) {
    const entry = getBalanceEntryForAsset(asset);
    if (!entry) return null;
    const symbol = (asset.symbol || asset.name || '').toUpperCase();
    return `${entry.formatted} ${symbol}`;
}

function goToStep(stepNumber) {
    // Clear error when navigating between steps
    if (buyPointsState.error && stepNumber !== buyPointsState.step) {
        buyPointsState.error = null;
    }
    buyPointsState.step = stepNumber;
    render();
}

function showLoader(show) {
    buyPointsState.isLoading = show;
    render();
}

function showError(message) {
    buyPointsState.error = message;
    render();
}

/**
 * Show a status message with optional progress indicator
 * @param {string} message - The status message to display
 * @param {string} phase - The current phase: 'preparing' | 'approval' | 'approving' | 'deposit' | 'confirming'
 * @param {number} progress - Progress percentage (0-100)
 */
function showStatus(message, phase = null, progress = null) {
    buyPointsState.statusMessage = message;
    buyPointsState.statusPhase = phase;
    if (progress !== null) {
        buyPointsState.statusProgress = progress;
    }
    render();
}

function clearStatus() {
    buyPointsState.statusMessage = null;
    buyPointsState.statusPhase = null;
    buyPointsState.statusProgress = 0;
}

function render() {
    [step1, step2, step3, step4, step5].forEach(step => step && (step.style.display = 'none'));
    if (loader) {
        loader.style.display = buyPointsState.isLoading ? 'flex' : 'none';
        // Update status message in loader
        const statusEl = document.getElementById('loader-status');
        const progressContainer = document.getElementById('loader-progress-container');
        const progressBar = document.getElementById('loader-progress-bar');
        const phaseEl = document.getElementById('loader-phase');

        if (statusEl) {
            statusEl.textContent = buyPointsState.statusMessage || '';
        }
        if (progressContainer && progressBar && phaseEl) {
            if (buyPointsState.statusPhase) {
                progressContainer.style.display = 'block';
                progressBar.style.width = `${buyPointsState.statusProgress}%`;
                // Show phase labels
                const phaseLabels = {
                    'preparing': 'Step 1/4: Preparing transaction',
                    'approval': 'Step 2/4: Waiting for wallet signature',
                    'approving': 'Step 2/4: Confirming approval on-chain',
                    'deposit': 'Step 3/4: Waiting for wallet signature',
                    'confirming': 'Step 4/4: Processing deposit'
                };
                phaseEl.textContent = phaseLabels[buyPointsState.statusPhase] || '';
            } else {
                progressContainer.style.display = 'none';
            }
        }
    }
    if (errorDisplay) {
        errorDisplay.style.display = buyPointsState.error ? 'block' : 'none';
        errorDisplay.textContent = buyPointsState.error || '';
    }
    if (buyPointsState.step === 1) {
        step1.style.display = 'block';
        renderAssetSelection();
    }
    if (buyPointsState.step === 2) {
        step2.style.display = 'block';
        renderAmountStep();
    }
    if (buyPointsState.step === 3) {
        step3.style.display = 'block';
        renderReviewStep();
    }
    if (buyPointsState.step === 4) {
        step4.style.display = 'block';
        renderTxStatusStep();
    }
    if (buyPointsState.step === 5) {
        step5.style.display = 'block';
        renderReceiptStep();
    }
}

function renderAssetSelection() {
    if (!assetSelection) return;
    assetSelection.innerHTML = '';
    if (!buyPointsState.supportedAssets) {
        assetSelection.innerHTML = '<div>Loading assets...</div>';
        return;
    }

    const walletAddress = buyPointsState.walletAddress;
    const walletBalances = buyPointsState.walletBalances;
    const balancesLoading = buyPointsState.balancesLoading;

    // Wallet summary header
    const walletSummary = document.createElement('div');
    walletSummary.className = 'wallet-balance-summary';
    if (!walletAddress) {
        walletSummary.innerHTML = `
            <div>Please connect your wallet to view available payment assets.</div>
            <button class="connect-wallet-btn">Connect Wallet</button>
        `;
        assetSelection.appendChild(walletSummary);
        const connectBtn = walletSummary.querySelector('.connect-wallet-btn');
        if (connectBtn) {
            connectBtn.onclick = async () => {
                try {
                    await getUserWalletAddress();
                    await refreshWalletInfo();
                    await fetchWalletBalances();
                } catch (err) {
                    showError(err.message);
                }
            };
        }
        return;
    }

    if (balancesLoading || !walletBalances) {
        walletSummary.textContent = 'Checking wallet balances...';
        assetSelection.appendChild(walletSummary);
        return;
    }

    const nativeEntry = getBalanceEntryForAsset({ address: ZERO_ADDRESS, symbol: 'ETH' });
    walletSummary.innerHTML = `<div>ETH Balance: <strong>${nativeEntry ? `${nativeEntry.formatted} ETH` : '0 ETH'}</strong></div>`;
    assetSelection.appendChild(walletSummary);

    // Define tier order and asset order (native first)
    const tierOrder = ['native', 1, 2, 3];
    const tierAssets = {
        native: ['eth'],
        1: ['ms2', 'cult'],
        2: ['eth', 'weth', 'usdt', 'usdc'],
        3: ['pepe', 'mog', 'spx6900']
    };
    // Helper to find asset by symbol (case-insensitive)
    function findAssetBySymbol(symbol, assets) {
        return assets.find(a => (a.symbol || a.name || '').toLowerCase() === symbol.toLowerCase());
    }
    // Render tokens by tier
    const tokens = (buyPointsState.supportedAssets.tokens || []).filter(t => t && (t.symbol || t.name));
    const renderedAddresses = new Set();
    let renderedAnyAsset = false;

    tierOrder.forEach(tier => {
        const tierSymbols = tierAssets[tier];
        if (!tierSymbols) return;
        const tierTokens = tierSymbols
            .map(sym => findAssetBySymbol(sym, tokens))
            .filter(asset => asset && assetHasPositiveBalance(asset));
        if (tierTokens.length === 0) return;

        const tierDiv = document.createElement('div');
        tierDiv.className = 'asset-tier-group';
        const heading = tier === 'native' ? 'Native Assets' : `Tier ${tier}`;
        tierDiv.innerHTML = `<div class="asset-tier-heading">${heading}</div>`;
        tierTokens.forEach(asset => {
            const btn = document.createElement('button');
            btn.className = 'asset-btn';
            const iconSrc = asset.iconUrl || '/images/sandbox/components/placeholder.png';
            const balanceLabel = getBalanceLabel(asset);
            btn.innerHTML = `
                <div class="asset-btn-main">
                    <img src="${iconSrc}" alt="${asset.symbol || asset.name}" class="asset-icon">
                    <span>${asset.symbol || asset.name}</span>
                </div>
                ${balanceLabel ? `<div class="asset-balance-pill">Bal: ${balanceLabel}</div>` : ''}
            `;
            btn.onclick = () => {
                buyPointsState.selectedAsset = { ...asset, type: 'token' };
                goToStep(2);
            };
            tierDiv.appendChild(btn);
            renderedAddresses.add((asset.address || '').toLowerCase());
            renderedAnyAsset = true;
        });
        assetSelection.appendChild(tierDiv);
    });
    // Render any remaining tokens not in predefined tiers
    const remainingTokens = tokens
        .filter(t => !renderedAddresses.has((t.address||'').toLowerCase()))
        .filter(assetHasPositiveBalance);
    if (remainingTokens.length) {
        const otherDiv = document.createElement('div');
        otherDiv.className = 'asset-tier-group';
        otherDiv.innerHTML = '<div class="asset-tier-heading">Other</div>';
        remainingTokens.forEach(asset => {
            const btn = document.createElement('button');
            btn.className = 'asset-btn';
            const iconSrc = asset.iconUrl || '/images/sandbox/components/placeholder.png';
            const balanceLabel = getBalanceLabel(asset);
            btn.innerHTML = `
                <div class="asset-btn-main">
                    <img src="${iconSrc}" alt="${asset.symbol || asset.name}" class="asset-icon">
                    <span>${asset.symbol || asset.name}</span>
                </div>
                ${balanceLabel ? `<div class="asset-balance-pill">Bal: ${balanceLabel}</div>` : ''}
            `;
            btn.onclick = () => {
                buyPointsState.selectedAsset = { ...asset, type: 'token' };
                goToStep(2);
            };
            otherDiv.appendChild(btn);
        });
        assetSelection.appendChild(otherDiv);
        renderedAnyAsset = true;
    }
    // Render NFTs (after tokens)
    const nfts = (buyPointsState.supportedAssets.nfts || []).filter(n => n && n.name && assetHasPositiveBalance(n));
    if (nfts.length > 0) {
        const nftDiv = document.createElement('div');
        nftDiv.className = 'asset-tier-group';
        nftDiv.innerHTML = `<div class="asset-tier-heading">NFTs</div>`;
        nfts.forEach(asset => {
            const btn = document.createElement('button');
            btn.className = 'asset-btn';
            btn.innerHTML = `<img src="${asset.iconUrl || '/images/sandbox/components/placeholder.png'}" alt="${asset.name}" class="asset-icon"> ${asset.name}`;
            btn.onclick = () => {
                buyPointsState.selectedAsset = { ...asset, type: 'nft' };
                goToStep(2);
            };
            nftDiv.appendChild(btn);
        });
        assetSelection.appendChild(nftDiv);
        renderedAnyAsset = renderedAnyAsset || nfts.length > 0;
    }

    if (!renderedAnyAsset) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = 'No supported token balances detected. Deposit a supported asset to continue.';
        assetSelection.appendChild(emptyDiv);
    }

    // Custom coin logic
    if (customCoinBtn && customCoinInputContainer && customCoinAddress && customCoinSubmit) {
        customCoinBtn.onclick = () => {
            customCoinInputContainer.style.display = 'block';
        };
        customCoinSubmit.onclick = () => {
            showError('Custom coins not yet supported.');
        };
    }
}

function renderAmountStep() {
    if (!selectedAssetDisplay || !amountInput || !quoteDisplay) return;
    selectedAssetDisplay.textContent = buyPointsState.selectedAsset ? `Selected: ${buyPointsState.selectedAsset.symbol || buyPointsState.selectedAsset.name}` : '';
    amountInput.value = buyPointsState.amount;
    quoteDisplay.innerHTML = buyPointsState.quote ?
        `<div>Points: <b>${buyPointsState.quote.pointsCredited ?? '-'}</b><br>Funding Rate: ${buyPointsState.quote.fundingRate ?? '-'}<br>USD Value: $${safeToFixed(buyPointsState.quote.usdValue?.gross)}<br>Fees: $${safeToFixed(buyPointsState.quote.fees?.totalFeesUsd)}</div>`
        : '<div>Enter an amount to get a quote.</div>';

    // --- Donate Deal Banner ---
    let banner = document.getElementById('donate-deal-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'donate-deal-banner';
        banner.style = 'display:none;margin-top:10px;padding:10px;border-radius:6px;background:#263238;color:#fff;';
        quoteDisplay.parentNode.insertBefore(banner, quoteDisplay.nextSibling);
    }

    const isEligible = buyPointsState.mode === 'contribute' && buyPointsState.quote && buyPointsState.donateQuote && buyPointsState.donateQuote.pointsCredited > buyPointsState.quote.pointsCredited;

    if (isEligible) {
        const boost = buyPointsState.donateQuote.pointsCredited - buyPointsState.quote.pointsCredited;
        banner.innerHTML = `
            <span style="font-weight:bold;">Get +${boost} more points by donating </span>
            <span title="Donating is irreversible. You will not be able to withdraw your deposit." style="cursor:help;margin-left:4px;">ℹ︎</span>
            <button id="accept-donate-deal-btn" style="margin-left:10px;background:#4caf50;border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;">Accept Deal</button>
        `;
        banner.style.display = 'block';
        const acceptBtn = document.getElementById('accept-donate-deal-btn');
        acceptBtn.onclick = () => {
            buyPointsState.mode = 'donate';
            buyPointsState.quote = null;
            buyPointsState.donateQuote = null;
            render();
            fetchQuote(); // re-fetch in donate mode
        };
    } else {
        banner.style.display = 'none';
    }

    // Show network alert if on unsupported chain and not in donate mode
    if (!buyPointsState.donateQuote && buyPointsState.quote && buyPointsState.quote.fundingRate) {
        getCurrentChainId().then(currentChainId => {
            if (currentChainId && !SUPPORTED_CHAIN_IDS.includes(currentChainId)) {
                showNetworkAlert(currentChainId);
            }
        });
    }
}

function renderReviewStep() {
    if (!reviewSummary) return;
    if (!buyPointsState.quote) {
        reviewSummary.innerHTML = '<div>No quote available.</div>';
        return;
    }
    const q = buyPointsState.quote;
    const b = q.breakdown || {};
    const toNum = (val) => {
        if (typeof val === 'number') return val;
        const parsed = Number(val);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const estimatedGas = toNum(b.estimatedGasUsd ?? q.fees?.estimatedGasUsd);
    const showGasRow = buyPointsState.mode !== 'donate';

    let userReceivesValue = toNum(b.userReceivesUsd ?? q.userReceivesUsd ?? q.usdValue?.netAfterFundingRate ?? q.usdValue?.gross);
    if (!showGasRow && estimatedGas) {
        userReceivesValue += estimatedGas;
    }

    const gasRowHtml = showGasRow
        ? `<div>Estimated Gas Fee: <b>-$${safeToFixed(estimatedGas)}</b></div>`
        : `<div>Estimated Gas Fee: <b>$0 (covered for donations)</b></div>`;

    reviewSummary.innerHTML = `
        <div>Asset: ${buyPointsState.selectedAsset.symbol || buyPointsState.selectedAsset.name}</div>
        <div>Amount: ${buyPointsState.amount}</div>
        <div>Points: <b style="color:#4caf50;">${q.pointsCredited}</b>${buyPointsState.mode==='donate' ? ' <span style="font-size:14px;color:#90caf9;">(boosted)</span>' : ''}</div>
        <hr>
        <div>Gross USD: <b>$${safeToFixed(b.grossUsd ?? q.usdValue?.gross)}</b></div>
        <div>Funding Rate Deduction: <b>-$${safeToFixed(b.fundingRateDeduction ?? 0)}</b></div>
        <div>Net After Funding Rate: <b>$${safeToFixed(b.netAfterFundingRate ?? q.usdValue?.netAfterFundingRate)}</b></div>
        ${gasRowHtml}
        <div style="font-weight:bold; color:#4caf50;">User Receives: $${safeToFixed(userReceivesValue)}</div>
    `;

    // Update CTA text based on mode
    if (confirmPurchaseBtn) {
        confirmPurchaseBtn.textContent = buyPointsState.mode === 'donate' ? 'Donate & Buy Points' : 'Buy Points';
    }
}

function renderTxStatusStep() {
    if (!txStatusDisplay) return;
    if (!buyPointsState.txStatus) {
        txStatusDisplay.innerHTML = '<div>Waiting for transaction status...</div>';
        return;
    }
    const s = buyPointsState.txStatus;

    // Determine status display
    const statusColors = {
        'submitted': '#90caf9',
        'pending': '#ffc107',
        'confirming': '#ffc107',
        'confirmed': '#4caf50',
        'Success!': '#4caf50',
        'Failed': '#e74c3c'
    };
    const statusColor = statusColors[s.status] || '#90caf9';
    const isProcessing = ['submitted', 'pending', 'confirming'].includes(s.status);

    let html = `
        <div style="text-align:center;padding:20px 0;">
            ${isProcessing ? `
                <div class="processing-animation" style="margin-bottom:16px;">
                    <div style="width:60px;height:60px;margin:0 auto;border:3px solid #333;border-top-color:${statusColor};border-radius:50%;animation:spin 1s linear infinite;"></div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            ` : ''}
            <div style="font-size:22px;color:${statusColor};font-weight:bold;margin-bottom:8px;">
                ${s.status === 'submitted' ? 'Transaction Submitted' :
                  s.status === 'pending' ? 'Transaction Pending' :
                  s.status === 'confirming' ? 'Confirming...' :
                  s.status === 'confirmed' || s.status === 'Success!' ? 'Confirmed!' :
                  s.status === 'Failed' ? 'Transaction Failed' :
                  s.status || 'Processing'}
            </div>
            ${s.message ? `<p style="color:#aaa;font-size:17px;margin:8px 0;">${s.message}</p>` : ''}
        </div>
        <div style="background:#1a1a1a;padding:12px;border-radius:6px;margin-top:12px;">
            <div style="font-size:14px;color:#666;margin-bottom:4px;">Transaction Hash</div>
            <div style="font-family:monospace;font-size:16px;word-break:break-all;color:#90caf9;" class="copyable" title="Click to copy">${s.txHash}</div>
        </div>
    `;

    if (s.confirmationTxHash) {
        html += `
            <div style="background:#1a1a1a;padding:12px;border-radius:6px;margin-top:8px;">
                <div style="font-size:14px;color:#666;margin-bottom:4px;">Confirmation Tx</div>
                <div style="font-family:monospace;font-size:16px;word-break:break-all;color:#4caf50;" class="copyable" title="Click to copy">${s.confirmationTxHash}</div>
            </div>
        `;
    }

    if (s.failureReason) {
        html += `<div style="background:#3d1a1a;color:#e74c3c;padding:12px;border-radius:6px;margin-top:12px;">${s.failureReason}</div>`;
    }

    if (isProcessing) {
        html += `<p style="text-align:center;color:#666;font-size:14px;margin-top:16px;">This usually takes 15-60 seconds. You can close this modal - your points will be credited automatically.</p>`;
    }

    txStatusDisplay.innerHTML = html;
}

function renderReceiptStep() {
    if (!receiptDisplay) return;
    if (!buyPointsState.txStatus || !buyPointsState.txStatus.receipt) {
        receiptDisplay.innerHTML = '<div>No receipt available.</div>';
        return;
    }
    const s = buyPointsState.txStatus;
    const r = s.receipt;
    receiptDisplay.innerHTML = `
        <h2>Purchase Complete!</h2>
        <div>Points Credited: <b style="color: #4caf50;">+${r.points_credited}</b></div>
        <div>USD Credited: <b>$${safeToFixed(r.user_credited_usd)}</b></div>
        <hr>
        <div>Asset: ${buyPointsState.selectedAsset ? (buyPointsState.selectedAsset.symbol || buyPointsState.selectedAsset.name) : '-'}</div>
        <div>Amount: ${buyPointsState.amount}</div>
        <div>Your Tx Hash: <span class="copyable" title="Click to copy">${s.txHash}</span></div>
        <div>Confirmation Tx: <span class="copyable" title="Click to copy">${r.confirmation_tx_hash}</span></div>
    `;
}

// --- API Functions ---
const API_BASE_URL = '/api/v1/points';

// ---------------- Network / Chain Helpers -----------------
// This will be populated at runtime from backend
let SUPPORTED_CHAINS = {};
let SUPPORTED_CHAIN_IDS = [];
let PREFERRED_CHAIN_ID = '11155111'; // fallback

async function fetchSupportedChains() {
    try {
        const res = await fetch('/api/v1/points/supported-chains');
        const data = await res.json();
        if (data && Array.isArray(data.chains)) {
            SUPPORTED_CHAINS = {};
            data.chains.forEach(ch => {
                SUPPORTED_CHAINS[ch.chainId] = ch.name;
            });
            SUPPORTED_CHAIN_IDS = Object.keys(SUPPORTED_CHAINS);
            if (SUPPORTED_CHAIN_IDS.length && !SUPPORTED_CHAIN_IDS.includes(PREFERRED_CHAIN_ID)) {
                PREFERRED_CHAIN_ID = SUPPORTED_CHAIN_IDS[0];
            }
        }
    } catch (err) {
        console.warn('[BuyPointsModal] Failed to fetch supported chains:', err);
    }
}

function showNetworkAlert(currentId) {
    // Remove existing alert if any
    const existing = document.getElementById('network-alert');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'network-alert';
    overlay.style = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';

    const box = document.createElement('div');
    box.style = 'background:#121212;padding:24px;border-radius:8px;max-width:320px;text-align:center;color:#fff;';
    box.innerHTML = `<h3 style="margin-top:0">Unsupported network</h3><p>You are connected to chain ID ${currentId}.<br>Please switch to one of the supported networks:</p>`;

    Object.entries(SUPPORTED_CHAINS).forEach(([id, name]) => {
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.style = 'display:block;width:100%;margin:6px 0;padding:8px;border:none;border-radius:4px;background:#2196f3;color:#fff;cursor:pointer;';
        btn.onclick = async () => {
            if (window.ethereum && window.ethereum.request) {
                const hexChain = '0x' + parseInt(id).toString(16);
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: hexChain }]
                    });
                } catch (switchErr) {
                    // If chain not added to wallet (error 4902), try adding it
                    if (switchErr.code === 4902) {
                        try {
                            await window.ethereum.request({
                                method: 'wallet_addEthereumChain',
                                params: [{ chainId: hexChain, rpcUrls: [], chainName: SUPPORTED_CHAINS[id] }]
                            });
                        } catch (addErr) {
                            console.warn('[BuyPointsModal] addEthereumChain failed:', addErr);
                            return;
                        }
                    } else {
                        console.warn('[BuyPointsModal] wallet_switchEthereumChain error:', switchErr);
                        return;
                    }
                }
                overlay.remove();
                await refreshWalletInfo();
                // Refetch assets for new chain
                await fetchSupportedAssets();
            }
        };
        box.appendChild(btn);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style = 'margin-top:10px;padding:6px 12px;background:#555;border:none;border-radius:4px;color:#fff;cursor:pointer;';
    closeBtn.onclick = () => overlay.remove();
    box.appendChild(closeBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

async function getCurrentChainId() {
    if (!window.ethereum) return null;
    try {
        const hexId = await window.ethereum.request({ method: 'eth_chainId' });
        return parseInt(hexId, 16).toString();
    } catch {
        return null;
    }
}

async function fetchWalletBalances() {
    if (!window.ethereum || !buyPointsState.supportedAssets) return;
    try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (!accounts || !accounts.length) {
            buyPointsState.walletBalances = null;
            buyPointsState.walletAddress = null;
            buyPointsState.balancesLoading = false;
            render();
            return;
        }

        const address = accounts[0];
        buyPointsState.walletAddress = address;
        buyPointsState.balancesLoading = true;
        render();

        const balances = { tokens: {} };
        // Native ETH balance
        try {
            const ethHex = await window.ethereum.request({
                method: 'eth_getBalance',
                params: [address, 'latest']
            });
            const rawEth = BigInt(ethHex || '0x0');
            balances.tokens[normalizeAddress(ZERO_ADDRESS)] = {
                raw: rawEth,
                decimals: 18,
                formatted: formatBigIntBalance(rawEth, 18)
            };
        } catch (err) {
            console.warn('[BuyPointsModal] Failed to fetch ETH balance:', err);
        }

        const tokens = (buyPointsState.supportedAssets.tokens || []).filter(Boolean);
        const balanceOfSelector = '0x70a08231';
        const addrParam = address.toLowerCase().replace('0x', '').padStart(64, '0');

        for (const token of tokens) {
            const tokenAddress = normalizeAddress(token.address);
            if (!tokenAddress || tokenAddress === normalizeAddress(ZERO_ADDRESS)) continue;
            if (!isValidAddress(token.address)) {
                console.warn('[BuyPointsModal] Skipping invalid token address', token.symbol || token.address);
                continue;
            }
            try {
                const data = `${balanceOfSelector}${addrParam}`;
                const balanceHex = await window.ethereum.request({
                    method: 'eth_call',
                    params: [{ to: token.address, data }, 'latest']
                });
                const raw = hexToBigInt(balanceHex);
                balances.tokens[tokenAddress] = {
                    raw,
                    decimals: token.decimals || 18,
                    formatted: formatBigIntBalance(raw, token.decimals || 18)
                };
            } catch (err) {
                console.warn('[BuyPointsModal] Failed to read balance for token', token.symbol || token.address, err);
            }
        }

        const nftConfigs = (buyPointsState.supportedAssets.nfts || []).filter(Boolean);
        for (const nft of nftConfigs) {
            const nftAddress = normalizeAddress(nft.address);
            if (!nftAddress) continue;
            if (!isValidAddress(nft.address)) {
                console.warn('[BuyPointsModal] Skipping invalid NFT address', nft.name || nft.address);
                continue;
            }
            try {
                const data = `${balanceOfSelector}${addrParam}`;
                const balanceHex = await window.ethereum.request({
                    method: 'eth_call',
                    params: [{ to: nft.address, data }, 'latest']
                });
                const raw = hexToBigInt(balanceHex);
                balances.tokens[nftAddress] = {
                    raw,
                    decimals: 0,
                    formatted: formatBigIntBalance(raw, 0)
                };
            } catch (err) {
                console.warn('[BuyPointsModal] Failed to read balance for NFT', nft.name || nft.address, err);
            }
        }

        buyPointsState.walletBalances = balances;
        buyPointsState.balancesLoading = false;
        render();
    } catch (err) {
        console.warn('[BuyPointsModal] Wallet balance fetch failed:', err);
        buyPointsState.balancesLoading = false;
        render();
    }
}

async function ensureCorrectNetwork() {
    const chainId = await getCurrentChainId();
    if (!chainId || SUPPORTED_CHAIN_IDS.includes(chainId)) {
        return true; // supported
    }

    // Show custom alert with options
    showNetworkAlert(chainId);
    return false;
}
// --- Debounce Utility ---
let debounceTimer = null;
function debounce(fn, delay) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, delay);
}

async function fetchSupportedAssets() {
    try {
        const chainId = await getCurrentChainId() || PREFERRED_CHAIN_ID;
        const res = await fetch(`${API_BASE_URL}/supported-assets?chainId=${chainId}&t=${Date.now()}`, {
            credentials: 'include',
            headers: { 'Cache-Control': 'no-cache' }
        });
        if (!res.ok) throw new Error('Failed to fetch supported assets');
        const data = await res.json();
        console.log('[BuyPointsModal] Supported assets response:', data);
        buyPointsState.supportedAssets = data;
        render();
        fetchWalletBalances();
    } catch (err) {
        showError('Could not load supported assets.');
    }
}

// Utility to convert user input to smallest unit (wei, etc.)
function toSmallestUnit(amountStr, decimals) {
    // Handles both integer and decimal strings, returns string integer
    // e.g. toSmallestUnit('0.001', 18) => '1000000000000000'
    if (!amountStr || isNaN(amountStr)) return '0';
    const [whole, fraction = ''] = amountStr.split('.');
    let frac = fraction.padEnd(decimals, '0').slice(0, decimals);
    return (whole + frac).replace(/^0+/, '') || '0';
}

// Utility to get the user's wallet address via MetaMask
async function getUserWalletAddress() {
    if (window.ethereum) {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            return accounts[0];
        } catch (err) {
            throw new Error('Wallet connection rejected. Please connect your wallet to proceed.');
        }
    } else {
        throw new Error('No Ethereum wallet detected. Please install MetaMask or another wallet.');
    }
}

async function fetchQuote() {
    if (!buyPointsState.selectedAsset || !buyPointsState.amount) return;
    
    // Validate network before fetching quote
    const isCorrectNetwork = await ensureCorrectNetwork();
    if (!isCorrectNetwork) {
        showError('Please switch to a supported network to get a quote.');
        return;
    }
    
    // Cancel any in-flight quote request
    if (currentQuoteAbortController) {
        currentQuoteAbortController.abort();
    }
    currentQuoteAbortController = new AbortController();

    showLoader(true);
    buyPointsState.error = null; // Clear previous errors
    showStatus('Fetching current prices...');

    try {
        let amountToSend = buyPointsState.amount;
        if (buyPointsState.selectedAsset.type === 'token') {
            // Convert to smallest unit using decimals
            const decimals = buyPointsState.selectedAsset.decimals || 18;
            amountToSend = toSmallestUnit(buyPointsState.amount, decimals);
        }
        const body = {
            type: buyPointsState.selectedAsset.type,
            assetAddress: buyPointsState.selectedAsset.address,
            amount: amountToSend,
            mode: buyPointsState.mode
        };
        const token = await window.auth.ensureCsrfToken();

        // Fetch both quotes in parallel for better performance
        const fetchQuoteWithMode = async (quoteMode) => {
            const quoteBody = { ...body, mode: quoteMode };
            const response = await fetch(`${API_BASE_URL}/quote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': token
                },
                body: JSON.stringify(quoteBody),
                credentials: 'include',
                signal: currentQuoteAbortController.signal
            });
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = 'Could not fetch quote.';
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.message || errorMessage;
                } catch {}
                throw new Error(errorMessage);
            }
            return response.json();
        };

        // If contribute mode, fetch both quotes in parallel
        if (buyPointsState.mode === 'contribute') {
            const [contributeQuote, donateQuote] = await Promise.all([
                fetchQuoteWithMode('contribute'),
                fetchQuoteWithMode('donate').catch(e => {
                    if (e.name !== 'AbortError') {
                        console.warn('[BuyPointsModal] Failed to fetch donate quote:', e);
                    }
                    return null;
                })
            ]);
            buyPointsState.quote = contributeQuote;
            buyPointsState.donateQuote = donateQuote;
        } else {
            // Donate mode - just fetch donate quote
            buyPointsState.quote = await fetchQuoteWithMode('donate');
            buyPointsState.donateQuote = null;
        }
        showLoader(false);
        clearStatus();
        render();
    } catch (err) {
        // Don't show error if request was aborted (user changed amount)
        if (err.name === 'AbortError') {
            clearStatus();
            return;
        }
        showLoader(false);
        clearStatus();
        const errorMessage = err.message || 'Could not fetch quote. Please check your network connection and try again.';
        showError(errorMessage);
    } finally {
        currentQuoteAbortController = null;
    }
}

async function sendTransaction(tx) {
    // tx: { to, from, value, data }
    // value should be a hex string for ETH, or '0x0' for ERC20
    const params = [{
        from: tx.from,
        to: tx.to,
        value: tx.value && tx.value !== '0' ? '0x' + BigInt(tx.value).toString(16) : '0x0',
        data: tx.data
    }];
    return await window.ethereum.request({
        method: 'eth_sendTransaction',
        params
    });
}

/**
 * Wait for a transaction to be confirmed on-chain
 * @param {string} txHash - The transaction hash to wait for
 * @param {number} maxWaitMs - Maximum time to wait (default 120 seconds)
 * @param {number} pollIntervalMs - How often to check (default 2 seconds)
 * @returns {Promise<object>} The transaction receipt
 */
async function waitForTransactionConfirmation(txHash, maxWaitMs = 120000, pollIntervalMs = 2000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const receipt = await window.ethereum.request({
                method: 'eth_getTransactionReceipt',
                params: [txHash]
            });

            if (receipt && receipt.blockNumber) {
                // Transaction is confirmed
                const status = parseInt(receipt.status, 16);
                if (status === 0) {
                    throw new Error('Transaction reverted on-chain');
                }
                console.log(`[BuyPointsModal] Transaction ${txHash} confirmed in block ${parseInt(receipt.blockNumber, 16)}`);
                return receipt;
            }
        } catch (err) {
            // RPC error - log but continue polling
            console.warn('[BuyPointsModal] Error checking tx receipt:', err.message);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Transaction confirmation timeout after ${maxWaitMs / 1000} seconds`);
}

async function initiatePurchase() {
    if (!buyPointsState.quote) return;
    if (!(await ensureCorrectNetwork())) return;

    // Clear any previous errors and show initial status
    buyPointsState.error = null;
    showLoader(true);
    showStatus('Preparing your transaction...', 'preparing', 10);

    try {
        let amountToSend = buyPointsState.amount;
        if (buyPointsState.selectedAsset.type === 'token') {
            const decimals = buyPointsState.selectedAsset.decimals || 18;
            amountToSend = toSmallestUnit(buyPointsState.amount, decimals);
        }
        // Use cached wallet address if available, otherwise request it
        let userWalletAddress = buyPointsState.walletAddress;
        if (!userWalletAddress) {
            showStatus('Connecting to wallet...', 'preparing', 15);
            try {
                userWalletAddress = await getUserWalletAddress();
            } catch (walletErr) {
                console.error('[BuyPointsModal] Wallet connection error:', walletErr);
                showLoader(false);
                clearStatus();
                showError(walletErr.message || 'Could not connect wallet.');
                return;
            }
        }

        showStatus('Checking token allowance...', 'preparing', 20);

        const body = {
            quoteId: buyPointsState.quote.quoteId,
            type: buyPointsState.selectedAsset.type,
            assetAddress: buyPointsState.selectedAsset.address,
            amount: amountToSend,
            userWalletAddress,
            mode: buyPointsState.mode
        };
        console.log('[BuyPointsModal] Sending purchase payload:', body);
        const token = await window.auth.ensureCsrfToken();
        const res = await fetch(`${API_BASE_URL}/purchase`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify(body),
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Failed to initiate purchase');
        buyPointsState.purchase = await res.json();

        // --- Prompt user to sign transactions ---
        const { approvalRequired, approvalTx, depositTx, donationTx } = buyPointsState.purchase;
        let txHash;

        if (approvalRequired && approvalTx) {
            // APPROVAL PHASE
            showStatus('Please sign the APPROVAL in your wallet...', 'approval', 30);
            try {
                const approvalHash = await sendTransaction(approvalTx);
                console.log('[BuyPointsModal] Approval tx sent:', approvalHash);

                // Wait for approval to be confirmed on-chain
                showStatus('Approval submitted! Waiting for blockchain confirmation...', 'approving', 40);

                // Update progress while waiting
                let approvalProgress = 40;
                const progressInterval = setInterval(() => {
                    if (approvalProgress < 55) {
                        approvalProgress += 1;
                        showStatus('Waiting for approval confirmation...', 'approving', approvalProgress);
                    }
                }, 2000);

                try {
                    await waitForTransactionConfirmation(approvalHash, 120000, 2000);
                    clearInterval(progressInterval);
                    showStatus('Approval confirmed!', 'approving', 60);
                    console.log('[BuyPointsModal] Approval confirmed, proceeding with deposit');
                } catch (confirmErr) {
                    clearInterval(progressInterval);
                    throw confirmErr;
                }
            } catch (err) {
                showLoader(false);
                clearStatus();
                const errorMsg = err.message?.includes('reverted')
                    ? 'Approval transaction reverted on-chain.'
                    : err.message?.includes('timeout')
                    ? 'Approval confirmation timed out. Please try again.'
                    : 'Approval transaction was rejected or failed.';
                showError(errorMsg);
                return;
            }
        } else {
            showStatus('No approval needed, proceeding to deposit...', 'preparing', 60);
        }

        // DEPOSIT PHASE
        const finalTx = buyPointsState.mode === 'donate' ? donationTx || depositTx : depositTx;
        const actionLabel = buyPointsState.mode === 'donate' ? 'DONATION' : 'DEPOSIT';

        try {
            showStatus(`Please sign the ${actionLabel} in your wallet...`, 'deposit', 65);
            txHash = await sendTransaction(finalTx);
            console.log(`[BuyPointsModal] ${actionLabel} tx sent:`, txHash);

            showStatus('Transaction submitted! Processing...', 'confirming', 80);

            buyPointsState.txStatus = {
                status: 'submitted',
                txHash: txHash,
                message: 'Transaction submitted to the blockchain. Waiting for confirmation...'
            };
        } catch (err) {
            showLoader(false);
            clearStatus();
            showError('Transaction was rejected or failed.');
            return;
        }

        // Clear loader and status, move to step 4
        showLoader(false);
        clearStatus();
        goToStep(4); // Step 4: Waiting for confirmation

        // Subscribe to real-time transaction status updates via WebSocket
        subscribeToTransactionUpdates(txHash);
    } catch (err) {
        showLoader(false);
        clearStatus();
        showError(err.message || 'Could not initiate purchase.');
    }
}

// --- Add a manual refresh function ---
async function handleManualRefresh() {
    if (!buyPointsState.txStatus || !buyPointsState.txStatus.txHash) {
        showError('No transaction to refresh.');
        return;
    }
    
    showLoader(true);
    buyPointsState.error = null;
    
    try {
        const txHash = buyPointsState.txStatus.txHash;
        const res = await fetch(`${API_BASE_URL}/tx-status?txHash=${txHash}`, {
            credentials: 'include',
            headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (!res.ok) {
            throw new Error('Failed to fetch transaction status');
        }
        
        const statusData = await res.json();
        
        // Update txStatus with latest data
        buyPointsState.txStatus = {
            ...buyPointsState.txStatus,
            status: statusData.status,
            receipt: statusData.receipt,
            confirmationTxHash: statusData.receipt?.confirmation_tx_hash || statusData.receipt?.confirmationTxHash,
            failureReason: statusData.failureReason
        };
        
        // Advance to receipt step if confirmed
        if (statusData.status === 'CONFIRMED' && statusData.receipt) {
            goToStep(5);
        } else if (statusData.status === 'FAILED' || statusData.failureReason) {
            buyPointsState.txStatus.failureReason = statusData.failureReason || 'Transaction failed';
            showError(buyPointsState.txStatus.failureReason);
        }
        
        render();
        showLoader(false);
    } catch (err) {
        showLoader(false);
        showError(err.message || 'Failed to refresh transaction status. Please try again.');
    }
}

// --- Event Handlers ---
function handleAmountChange(e) {
    const newAmount = e.target.value;
    
    // Basic input validation: allow empty, numbers, and single decimal point
    if (newAmount !== '' && !/^\d*\.?\d*$/.test(newAmount)) {
        // Invalid input, don't update state
        return;
    }
    
    // Prevent negative numbers
    if (newAmount.startsWith('-')) {
        return;
    }
    
    buyPointsState.amount = newAmount;
    buyPointsState.quote = null;
    buyPointsState.error = null; // Clear errors when user changes input
    
    if (buyPointsState.amount && buyPointsState.selectedAsset) {
        debounce(() => fetchQuote(), 400);
    } else {
        render();
    }
}

function handlePointsDepositUpdate(event) {
    console.log('[BuyPointsModal] Received pointsDepositUpdate event:', event);
    const { status, reason, originalTxHashes, ...receiptData } = event;

    // Check if this update is relevant to the current modal transaction
    if (buyPointsState.step === 4 && buyPointsState.txStatus && originalTxHashes && originalTxHashes.includes(buyPointsState.txStatus.txHash)) {
        if (status === 'confirmed') {
            buyPointsState.txStatus.status = 'Success!';
            buyPointsState.txStatus.receipt = receiptData;
            buyPointsState.txStatus.confirmationTxHash = receiptData.confirmation_tx_hash;
            goToStep(5); // Go to receipt step
        } else if (status === 'failed') {
            buyPointsState.txStatus.status = 'Failed';
            buyPointsState.txStatus.failureReason = reason || 'The transaction failed during backend processing.';
            showError(buyPointsState.txStatus.failureReason); // Show error prominently
        }
        render(); // Re-render the current step (4 or 5) with new info
    }
}

function handleTransactionStatusUpdate(event) {
    console.log('[BuyPointsModal] Received transactionStatusUpdate event:', event);
    const { txHash, status, message, error, receipt, originalTxHashes } = event;

    // Only process updates for the current transaction
    if (!buyPointsState.txStatus || buyPointsState.txStatus.txHash !== txHash) {
        // Check if this is a confirmation tx hash for one of our original transactions
        if (originalTxHashes && buyPointsState.txStatus && originalTxHashes.includes(buyPointsState.txStatus.txHash)) {
            // This is an update for our transaction, but using the confirmation tx hash
            // Update the txStatus to track the confirmation transaction
            buyPointsState.txStatus.confirmationTxHash = txHash;
        } else {
            return; // Not our transaction
        }
    }

    // Update transaction status based on the event
    if (!buyPointsState.txStatus) {
        buyPointsState.txStatus = { txHash, status, message };
    } else {
        buyPointsState.txStatus.status = status;
        buyPointsState.txStatus.message = message || buyPointsState.txStatus.message;
    }

    // Handle different status updates
    switch (status) {
        case 'submitted':
            buyPointsState.txStatus.status = 'submitted';
            buyPointsState.txStatus.message = message || 'Transaction submitted to blockchain...';
            break;
        case 'pending':
            buyPointsState.txStatus.status = 'pending';
            buyPointsState.txStatus.message = message || 'Transaction is pending in mempool...';
            break;
        case 'confirming':
            buyPointsState.txStatus.status = 'confirming';
            buyPointsState.txStatus.message = message || 'Transaction is being confirmed...';
            break;
        case 'confirmed':
            buyPointsState.txStatus.status = 'confirmed';
            buyPointsState.txStatus.message = message || 'Transaction confirmed successfully!';
            if (receipt) {
                buyPointsState.txStatus.receipt = receipt;
            }
            // Still wait for pointsDepositUpdate for final confirmation
            break;
        case 'failed':
            buyPointsState.txStatus.status = 'Failed';
            buyPointsState.txStatus.failureReason = error || message || 'Transaction failed';
            showError(buyPointsState.txStatus.failureReason);
            break;
    }

    // Re-render to show updated status
    if (buyPointsState.step === 4) {
        render();
    }
}

function subscribeToTransactionUpdates(txHash) {
    if (!window.websocketClient) {
        console.warn('[BuyPointsModal] WebSocket client not available, cannot subscribe to transaction updates');
        return;
    }

    // Unsubscribe from previous transaction if any
    if (transactionStatusHandler && currentTxHash) {
        window.websocketClient.off('transactionStatusUpdate', transactionStatusHandler);
    }

    currentTxHash = txHash;
    transactionStatusHandler = handleTransactionStatusUpdate;
    window.websocketClient.on('transactionStatusUpdate', transactionStatusHandler);
    console.log(`[BuyPointsModal] Subscribed to transactionStatusUpdate events for tx ${txHash}`);
}

function handleReviewPurchase() {
    if (!buyPointsState.quote) {
        showError('No quote available.');
        return;
    }
    goToStep(3);
}

function handleConfirmPurchase() {
    initiatePurchase();
}

// Store WebSocket subscription references for cleanup
let websocketSubscriptionHandler = null;
let transactionStatusHandler = null;
let currentTxHash = null;

function closeModal() {
    // Cancel any in-flight requests
    if (currentQuoteAbortController) {
        currentQuoteAbortController.abort();
        currentQuoteAbortController = null;
    }
    
    // Clear polling interval
    if (buyPointsState.pollInterval) {
        clearInterval(buyPointsState.pollInterval);
    }
    
    // Unsubscribe from websocket events
    if (window.websocketClient) {
        if (websocketSubscriptionHandler) {
            window.websocketClient.off('pointsDepositUpdate', websocketSubscriptionHandler);
            websocketSubscriptionHandler = null;
        }
        if (transactionStatusHandler) {
            window.websocketClient.off('transactionStatusUpdate', transactionStatusHandler);
            transactionStatusHandler = null;
        }
    }
    currentTxHash = null;
    
    // Hide modal
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Reset all state including mode and donateQuote
    Object.assign(buyPointsState, {
        step: 1,
        supportedAssets: null,
        selectedAsset: null,
        amount: '',
        quote: null,
        purchase: null,
        txStatus: null,
        error: null,
        isLoading: false,
        pollInterval: null,
        mode: 'contribute',
        donateQuote: null,
        statusMessage: null,
        statusPhase: null,
        statusProgress: 0
    });
    
    // Remove modal from DOM
    if (modal && modal.parentNode) {
        modal.parentNode.removeChild(modal);
    }
}

// --- Modal HTML Template ---
const buyPointsModalHTML = `
<!-- Buy Points Modal -->
<div id="buy-points-modal" class="modal-overlay" style="display: none;">
    <div class="modal-content">
        <div id="wallet-info" style="font-size:14px;color:#90caf9;margin-bottom:6px;"></div>
        <button class="modal-close-btn">&times;</button>
        
        <!-- Step 1: Select Asset -->
        <div id="modal-step-1" class="modal-step">
            <h2>Buy Points</h2>
            <p>Select the asset you want to use to buy points.</p>
            <div id="asset-selection"></div>
            <div class="custom-coin-section">
                <button id="custom-coin-btn">Use Custom Coin</button>
                <div id="custom-coin-input-container" style="display:none;">
                    <input type="text" id="custom-coin-address" placeholder="Enter coin address or symbol">
                    <button id="custom-coin-submit">Go</button>
                </div>
            </div>
        </div>

        <!-- Step 2: Amount & Quote -->
        <div id="modal-step-2" class="modal-step" style="display: none;">
            <h2>Enter Amount</h2>
            <div id="selected-asset-display"></div>
            <input type="text" id="amount-input" placeholder="Amount to spend">
            <div id="quote-display"></div>
            <div class="modal-nav">
                <button class="modal-back-btn">Back</button>
                <button id="review-purchase-btn">Review Purchase</button>
            </div>
        </div>

        <!-- Step 3: Review & Confirm -->
        <div id="modal-step-3" class="modal-step" style="display: none;">
            <h2>Review Purchase</h2>
            <div id="review-summary"></div>
            <div class="modal-nav">
                <button class="modal-back-btn">Back</button>
                <button id="confirm-purchase-btn">Buy Points</button>
            </div>
        </div>
        
        <!-- Step 4: Transaction Status -->
        <div id="modal-step-4" class="modal-step" style="display: none;">
            <h2>Transaction Status</h2>
            <div id="tx-status-display"></div>
            <button id="manual-refresh-btn">Refresh</button>
        </div>

        <!-- Step 5: Receipt -->
        <div id="modal-step-5" class="modal-step" style="display: none;">
            <h2>Purchase Complete</h2>
            <div id="receipt-display"></div>
            <button class="modal-close-btn-bottom">Close</button>
        </div>
        
        <!-- Loading Spinner with Status -->
        <div id="modal-loader" style="display: none;">
            <div class="spinner"></div>
            <div id="loader-status" style="margin-top:12px;text-align:center;color:#90caf9;font-size:17px;"></div>
            <div id="loader-progress-container" style="display:none;margin-top:8px;width:100%;max-width:200px;">
                <div style="background:#333;border-radius:4px;height:6px;overflow:hidden;">
                    <div id="loader-progress-bar" style="background:#4caf50;height:100%;width:0%;transition:width 0.3s ease;"></div>
                </div>
                <div id="loader-phase" style="margin-top:4px;font-size:13px;color:#666;text-align:center;"></div>
            </div>
        </div>

        <!-- Error Display -->
        <div id="modal-error-display" style="display: none;"></div>
    </div>
</div>`;

// --- Initialization ---
async function initBuyPointsModal() {
    document.body.insertAdjacentHTML('beforeend', buyPointsModalHTML);
    modal = document.getElementById('buy-points-modal');
    modalContent = modal.querySelector('.modal-content');
    walletInfoDiv = document.getElementById('wallet-info');
    closeModalBtn = modal.querySelector('.modal-close-btn');
    closeModalBtnBottom = modal.querySelector('.modal-close-btn-bottom');
    step1 = document.getElementById('modal-step-1');
    step2 = document.getElementById('modal-step-2');
    step3 = document.getElementById('modal-step-3');
    step4 = document.getElementById('modal-step-4');
    step5 = document.getElementById('modal-step-5');
    loader = document.getElementById('modal-loader');
    errorDisplay = document.getElementById('modal-error-display');
    assetSelection = document.getElementById('asset-selection');
    customCoinBtn = document.getElementById('custom-coin-btn');
    customCoinInputContainer = document.getElementById('custom-coin-input-container');
    customCoinAddress = document.getElementById('custom-coin-address');
    customCoinSubmit = document.getElementById('custom-coin-submit');
    selectedAssetDisplay = document.getElementById('selected-asset-display');
    amountInput = document.getElementById('amount-input');
    quoteDisplay = document.getElementById('quote-display');
    reviewSummary = document.getElementById('review-summary');
    reviewPurchaseBtn = document.getElementById('review-purchase-btn');
    confirmPurchaseBtn = document.getElementById('confirm-purchase-btn');
    txStatusDisplay = document.getElementById('tx-status-display');
    receiptDisplay = document.getElementById('receipt-display');
    closeModalBtn.addEventListener('click', closeModal);
    if (closeModalBtnBottom) closeModalBtnBottom.addEventListener('click', closeModal);
    if (amountInput) amountInput.addEventListener('input', handleAmountChange);
    if (reviewPurchaseBtn) reviewPurchaseBtn.addEventListener('click', handleReviewPurchase);
    if (confirmPurchaseBtn) confirmPurchaseBtn.addEventListener('click', handleConfirmPurchase);
    Array.from(modal.querySelectorAll('.modal-back-btn')).forEach(function(btn) {
        btn.addEventListener('click', function() { goToStep(buyPointsState.step - 1); });
    });

    // Subscribe to websocket events (with guard to prevent duplicate subscriptions)
    if (window.websocketClient && !websocketSubscriptionHandler) {
        websocketSubscriptionHandler = handlePointsDepositUpdate;
        window.websocketClient.on('pointsDepositUpdate', websocketSubscriptionHandler);
        console.log('[BuyPointsModal] Subscribed to pointsDepositUpdate events.');
    } else if (websocketSubscriptionHandler) {
        console.warn('[BuyPointsModal] WebSocket already subscribed, skipping duplicate subscription.');
    }

    await fetchSupportedChains();
    modal.style.display = 'flex';
    refreshWalletInfo();
    // Immediately alert if on unsupported chain
    await ensureCorrectNetwork();
    goToStep(1);
    showLoader(true);
    await fetchSupportedAssets();
    showLoader(false);
    document.getElementById('manual-refresh-btn').addEventListener('click', handleManualRefresh);
}

window.openBuyPointsModal = initBuyPointsModal; 

// Listen for external chain changes and refresh banner/assets
if (window.ethereum && !window._buyPointsChainListener) {
    window._buyPointsChainListener = true;
    window.ethereum.on('chainChanged', async () => {
        await refreshWalletInfo();
        await fetchSupportedAssets();
    });
}

// ---------------- Wallet / Network Banner -----------------
async function refreshWalletInfo() {
    if (!walletInfoDiv) return;
    try {
        const chainId = await getCurrentChainId();
        let addr;
        if (window.ethereum) {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts && accounts.length) addr = accounts[0];
        }
        const shortAddr = addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : 'Not connected';
        const chainName = SUPPORTED_CHAINS[chainId] || `Chain ${chainId || '?'}`;
        walletInfoDiv.textContent = `${shortAddr} | ${chainName}`;
        buyPointsState.walletAddress = addr || null;
        buyPointsState.chainId = chainId;
        if (addr) {
            fetchWalletBalances();
        } else {
            buyPointsState.walletBalances = null;
            buyPointsState.balancesLoading = false;
            render();
        }
    } catch (err) {
        walletInfoDiv.textContent = 'Wallet not connected';
        buyPointsState.walletAddress = null;
        buyPointsState.walletBalances = null;
        buyPointsState.balancesLoading = false;
    }
}

// At various points after network switch / wallet connection, refreshWalletInfo() is invoked inside ensureCorrectNetwork and showNetworkAlert handlers. 
