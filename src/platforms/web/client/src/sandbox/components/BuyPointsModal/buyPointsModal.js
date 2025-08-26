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
    pollInterval: null
};

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

function goToStep(stepNumber) {
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

function render() {
    [step1, step2, step3, step4, step5].forEach(step => step && (step.style.display = 'none'));
    if (loader) loader.style.display = buyPointsState.isLoading ? 'flex' : 'none';
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
    // Define tier order and asset order
    const tierOrder = [1, 2, 3];
    const tierAssets = {
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
    tierOrder.forEach(tier => {
        const tierSymbols = tierAssets[tier];
        const tierTokens = tierSymbols
            .map(sym => findAssetBySymbol(sym, tokens))
            .filter(Boolean);
        if (tierTokens.length > 0) {
            const tierDiv = document.createElement('div');
            tierDiv.className = 'asset-tier-group';
            tierDiv.innerHTML = `<div class="asset-tier-heading">Tier ${tier}</div>`;
            tierTokens.forEach(asset => {
                const btn = document.createElement('button');
                btn.className = 'asset-btn';
                const iconSrc = asset.iconUrl || '/images/sandbox/components/placeholder.png';
                btn.innerHTML = `<img src="${iconSrc}" alt="${asset.symbol || asset.name}" class="asset-icon"> ${asset.symbol || asset.name}`;
                btn.onclick = () => {
                    buyPointsState.selectedAsset = { ...asset, type: 'token' };
                    goToStep(2);
                };
                tierDiv.appendChild(btn);
                renderedAddresses.add(asset.address.toLowerCase());
            });
            assetSelection.appendChild(tierDiv);
        }
    });
    // Render any remaining tokens not in predefined tiers
    const remainingTokens = tokens.filter(t => !renderedAddresses.has((t.address||'').toLowerCase()));
    if (remainingTokens.length) {
        const otherDiv = document.createElement('div');
        otherDiv.className = 'asset-tier-group';
        otherDiv.innerHTML = '<div class="asset-tier-heading">Other</div>';
        remainingTokens.forEach(asset => {
            const btn = document.createElement('button');
            btn.className = 'asset-btn';
            const iconSrc = asset.iconUrl || '/images/sandbox/components/placeholder.png';
            btn.innerHTML = `<img src="${iconSrc}" alt="${asset.symbol || asset.name}" class="asset-icon"> ${asset.symbol || asset.name}`;
            btn.onclick = () => {
                buyPointsState.selectedAsset = { ...asset, type: 'token' };
                goToStep(2);
            };
            otherDiv.appendChild(btn);
        });
        assetSelection.appendChild(otherDiv);
    }
    // Render NFTs (after tokens)
    const nfts = (buyPointsState.supportedAssets.nfts || []).filter(n => n && n.name);
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

// Add CSS for .asset-icon if not present
(function ensureAssetIconCss() {
    if (!document.getElementById('asset-icon-style')) {
        const style = document.createElement('style');
        style.id = 'asset-icon-style';
        style.textContent = `.asset-icon { width: 24px; height: 24px; vertical-align: middle; margin-right: 8px; border-radius: 50%; background: #222; } .asset-tier-heading { font-weight: bold; margin: 12px 0 6px 0; color: #90caf9; } .asset-tier-group { margin-bottom: 10px; }`;
        document.head.appendChild(style);
    }
})();

function renderAmountStep() {
    if (!selectedAssetDisplay || !amountInput || !quoteDisplay) return;
    selectedAssetDisplay.textContent = buyPointsState.selectedAsset ? `Selected: ${buyPointsState.selectedAsset.symbol || buyPointsState.selectedAsset.name}` : '';
    amountInput.value = buyPointsState.amount;
    quoteDisplay.innerHTML = buyPointsState.quote ?
        `<div>Points: <b>${buyPointsState.quote.pointsCredited ?? '-'}</b><br>Funding Rate: ${buyPointsState.quote.fundingRate ?? '-'}<br>USD Value: $${safeToFixed(buyPointsState.quote.usdValue?.gross)}<br>Fees: $${safeToFixed(buyPointsState.quote.fees?.totalFeesUsd)}</div>`
        : '<div>Enter an amount to get a quote.</div>';
}

function renderReviewStep() {
    if (!reviewSummary) return;
    if (!buyPointsState.quote) {
        reviewSummary.innerHTML = '<div>No quote available.</div>';
        return;
    }
    const q = buyPointsState.quote;
    const b = q.breakdown || {};
    reviewSummary.innerHTML = `
        <div>Asset: ${buyPointsState.selectedAsset.symbol || buyPointsState.selectedAsset.name}</div>
        <div>Amount: ${buyPointsState.amount}</div>
        <div>Points: <b>${q.pointsCredited}</b></div>
        <hr>
        <div>Gross USD: <b>$${safeToFixed(b.grossUsd ?? q.usdValue?.gross)}</b></div>
        <div>Funding Rate Deduction: <b>-$${safeToFixed(b.fundingRateDeduction ?? 0)}</b></div>
        <div>Net After Funding Rate: <b>$${safeToFixed(b.netAfterFundingRate ?? q.usdValue?.netAfterFundingRate)}</b></div>
        <div>Estimated Gas Fee: <b>-$${safeToFixed(b.estimatedGasUsd ?? q.fees?.estimatedGasUsd)}</b></div>
        <div style="font-weight:bold; color:#4caf50;">User Receives: $${safeToFixed(b.userReceivesUsd ?? q.userReceivesUsd)}</div>
    `;
}

function renderTxStatusStep() {
    if (!txStatusDisplay) return;
    if (!buyPointsState.txStatus) {
        txStatusDisplay.innerHTML = '<div>Waiting for transaction status...</div>';
        return;
    }
    const s = buyPointsState.txStatus;
    let html = `
        <div>Status: <b>${s.status || 'Submitted'}</b></div>
        <div>Your Tx Hash: <span class="copyable" title="Click to copy">${s.txHash}</span></div>
    `;
    if (s.message) {
        html += `<p style="margin-top: 10px;">${s.message}</p>`;
    }
    if (s.confirmationTxHash) {
        html += `<div>Confirmation Tx: <span class="copyable" title="Click to copy">${s.confirmationTxHash}</span></div>`;
    }
    if (s.failureReason) {
        html += `<div style="color: #e74c3c; margin-top: 10px;">Error: ${s.failureReason}</div>`;
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
    if (!(await ensureCorrectNetwork())) return;
    showLoader(true);
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
            amount: amountToSend
        };
        const token = await window.auth.ensureCsrfToken();
        const res = await fetch(`${API_BASE_URL}/quote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify(body),
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Failed to fetch quote');
        buyPointsState.quote = await res.json();
        showLoader(false);
        render();
    } catch (err) {
        showLoader(false);
        showError('Could not fetch quote.');
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

async function initiatePurchase() {
    if (!buyPointsState.quote) return;
    if (!(await ensureCorrectNetwork())) return;
    showLoader(true);
    try {
        let amountToSend = buyPointsState.amount;
        if (buyPointsState.selectedAsset.type === 'token') {
            const decimals = buyPointsState.selectedAsset.decimals || 18;
            amountToSend = toSmallestUnit(buyPointsState.amount, decimals);
        }
        // Get wallet address
        let userWalletAddress;
        try {
            userWalletAddress = await getUserWalletAddress();
            console.log('[BuyPointsModal] Wallet address obtained:', userWalletAddress);
        } catch (walletErr) {
            console.error('[BuyPointsModal] Wallet connection error:', walletErr);
            showLoader(false);
            showError(walletErr.message || 'Could not connect wallet.');
            return;
        }
        const body = {
            quoteId: buyPointsState.quote.quoteId,
            type: buyPointsState.selectedAsset.type,
            assetAddress: buyPointsState.selectedAsset.address,
            amount: amountToSend,
            userWalletAddress
            // userId should be filled by backend session if needed
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
        showLoader(false);
        // --- Prompt user to sign transactions ---
        const { approvalRequired, approvalTx, depositTx } = buyPointsState.purchase;
        let txHash;
        if (approvalRequired && approvalTx) {
            try {
                showLoader(true);
                showError('Please sign the approval transaction in your wallet.');
                const approvalHash = await sendTransaction(approvalTx);
                console.log('[BuyPointsModal] Approval tx sent:', approvalHash);
                // Optionally, wait for confirmation before proceeding
            } catch (err) {
                showLoader(false);
                showError('Approval transaction was rejected or failed.');
                return;
            }
        }
        try {
            showLoader(true);
            showError('Please sign the deposit transaction in your wallet.');
            txHash = await sendTransaction(depositTx);
            console.log('[BuyPointsModal] Deposit tx sent:', txHash);
            buyPointsState.txStatus = { 
                status: 'submitted', 
                txHash: txHash, 
                message: 'Waiting for blockchain confirmation and backend processing...' 
            };
        } catch (err) {
            showLoader(false);
            showError('Deposit transaction was rejected or failed.');
            return;
        }
        showLoader(false);
        goToStep(4); // Step 4: Waiting for confirmation
        // User can click 'Refresh' to update their account info
        // TODO: Integrate notification/event-driven updates for real-time status
    } catch (err) {
        showLoader(false);
        showError(err.message || 'Could not initiate purchase.');
    }
}

// --- Add a manual refresh function ---
async function handleManualRefresh() {
    showLoader(true);
    try {
        // Fetch latest user/account info (implement as needed)
        // Example: await fetchUserAccountInfo();
        // Optionally, update buyPointsState with new info
        showLoader(false);
        // Optionally, advance to receipt step if confirmed
        // goToStep(5);
    } catch (err) {
        showLoader(false);
        showError('Failed to refresh account info.');
    }
}

// --- Event Handlers ---
function handleAmountChange(e) {
    buyPointsState.amount = e.target.value;
    buyPointsState.quote = null;
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

function closeModal() {
    if (buyPointsState.pollInterval) {
        clearInterval(buyPointsState.pollInterval);
    }
    modal.style.display = 'none';
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
        pollInterval: null
    });
    modal.parentNode.removeChild(modal);
    // Unsubscribe from websocket events
    if (window.websocketClient) {
        window.websocketClient.off('pointsDepositUpdate', handlePointsDepositUpdate);
    }
}

// --- Modal HTML Template ---
const buyPointsModalHTML = `
<!-- Buy Points Modal -->
<div id="buy-points-modal" class="modal-overlay" style="display: none;">
    <div class="modal-content">
        <div id="wallet-info" style="font-size:12px;color:#90caf9;margin-bottom:6px;"></div>
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
        
        <!-- Loading Spinner -->
        <div id="modal-loader" style="display: none;">
            <div class="spinner"></div>
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

    // Subscribe to websocket events
    if (window.websocketClient) {
        window.websocketClient.on('pointsDepositUpdate', handlePointsDepositUpdate);
        console.log('[BuyPointsModal] Subscribed to pointsDepositUpdate events.');
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
    } catch (err) {
        walletInfoDiv.textContent = 'Wallet not connected';
    }
}

// At various points after network switch / wallet connection, refreshWalletInfo() is invoked inside ensureCorrectNetwork and showNetworkAlert handlers. 