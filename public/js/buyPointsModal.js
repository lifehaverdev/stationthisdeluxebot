// Adapted BuyPointsModal for public spell page
// Based on sandbox/components/BuyPointsModal/buyPointsModal.js
// Adapted to work without window.auth dependency

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
    mode: 'donate', // Default to donate mode for better points per purchase and micro-transaction confirmation
    donateQuote: null,
    // Spell execution context (set when opened from insufficient points error)
    spellContext: null
};

// --- DOM Element References ---
let modal, modalContent, walletInfoDiv, closeModalBtn, closeModalBtnBottom, step1, step2, step3, step4, step5, loader, errorDisplay;
let assetSelection, amountInput, quoteDisplay, reviewSummary, txStatusDisplay, receiptDisplay;
let customCoinBtn, customCoinInputContainer, customCoinAddress, customCoinSubmit;
let selectedAssetDisplay, reviewPurchaseBtn, confirmPurchaseBtn;

// --- Utility Functions ---
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
    const tierOrder = [1, 2, 3];
    const tierAssets = {
        1: ['ms2', 'cult'],
        2: ['eth', 'weth', 'usdt', 'usdc'],
        3: ['pepe', 'mog', 'spx6900']
    };
    function findAssetBySymbol(symbol, assets) {
        return assets.find(a => (a.symbol || a.name || '').toLowerCase() === symbol.toLowerCase());
    }
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
}

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
        <div>Points: <b style="color:#4caf50;">${q.pointsCredited}</b></div>
        <hr>
        <div>Gross USD: <b>$${safeToFixed(b.grossUsd ?? q.usdValue?.gross)}</b></div>
        <div>Funding Rate Deduction: <b>-$${safeToFixed(b.fundingRateDeduction ?? 0)}</b></div>
        <div>Net After Funding Rate: <b>$${safeToFixed(b.netAfterFundingRate ?? q.usdValue?.netAfterFundingRate)}</b></div>
        <div>Estimated Gas Fee: <b>-$${safeToFixed(b.estimatedGasUsd ?? q.fees?.estimatedGasUsd)}</b></div>
        <div style="font-weight:bold; color:#4caf50;">User Receives: $${safeToFixed(b.userReceivesUsd ?? q.userReceivesUsd)}</div>
    `;
    if (confirmPurchaseBtn) {
        confirmPurchaseBtn.textContent = 'Buy Points';
    }
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
    
    let receiptHTML = `
        <h2>Purchase Complete!</h2>
        <div>Points Credited: <b style="color: #4caf50;">+${r.points_credited}</b></div>
        <div>USD Credited: <b>$${safeToFixed(r.user_credited_usd)}</b></div>
        <hr>
        <div>Asset: ${buyPointsState.selectedAsset ? (buyPointsState.selectedAsset.symbol || buyPointsState.selectedAsset.name) : '-'}</div>
        <div>Amount: ${buyPointsState.amount}</div>
        <div>Your Tx Hash: <span class="copyable" title="Click to copy">${s.txHash}</span></div>
        <div>Confirmation Tx: <span class="copyable" title="Click to copy">${r.confirmation_tx_hash}</span></div>
    `;
    
    // If spell context exists, show spell execution status
    if (buyPointsState.spellContext && buyPointsState.spellContext.executing) {
        receiptHTML += `<hr><div style="margin-top: 15px; padding: 10px; background: #263238; border-radius: 6px;"><div>✅ Spell execution started!</div><div style="font-size: 12px; margin-top: 5px;">Cast ID: ${buyPointsState.spellContext.castId || 'Pending...'}</div></div>`;
    } else if (buyPointsState.spellContext) {
        receiptHTML += `<hr><div style="margin-top: 15px;"><button id="execute-spell-btn" style="width: 100%; padding: 12px; background: #4caf50; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold;">Run Spell Now</button></div>`;
    }
    
    receiptDisplay.innerHTML = receiptHTML;
    
    // Attach spell execution handler if spell context exists
    if (buyPointsState.spellContext && !buyPointsState.spellContext.executing) {
        const executeBtn = document.getElementById('execute-spell-btn');
        if (executeBtn) {
            executeBtn.addEventListener('click', () => {
                executeSpellAfterPurchase();
            });
        }
        
        // Auto-execute spell when receipt step is shown (if not already executing)
        // This handles cases where websocket events might not fire
        if (!buyPointsState.spellContext.autoExecuted) {
            buyPointsState.spellContext.autoExecuted = true;
            // Small delay to let user see the receipt
            setTimeout(() => {
                if (!buyPointsState.spellContext.executing) {
                    executeSpellAfterPurchase();
                }
            }, 1500);
        }
    }
}

// --- API Functions ---
const API_BASE_URL = '/api/v1/points';

let SUPPORTED_CHAINS = {};
let SUPPORTED_CHAIN_IDS = [];
let PREFERRED_CHAIN_ID = '11155111';

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

async function getCurrentChainId() {
    if (!window.ethereum) return null;
    try {
        const hexId = await window.ethereum.request({ method: 'eth_chainId' });
        return parseInt(hexId, 16).toString();
    } catch {
        return null;
    }
}

function toSmallestUnit(amountStr, decimals) {
    if (!amountStr || isNaN(amountStr)) return '0';
    const [whole, fraction = ''] = amountStr.split('.');
    let frac = fraction.padEnd(decimals, '0').slice(0, decimals);
    return (whole + frac).replace(/^0+/, '') || '0';
}

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

// Get CSRF token (adapted for public page)
let cachedCsrfToken = null;
async function getCsrfToken() {
    if (cachedCsrfToken) return cachedCsrfToken;
    try {
        const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            cachedCsrfToken = data.csrfToken || data.token || data._csrf || null;
        }
    } catch (e) {
        console.warn('Failed to fetch CSRF token:', e);
    }
    return cachedCsrfToken;
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
        buyPointsState.supportedAssets = data;
        render();
    } catch (err) {
        showError('Could not load supported assets.');
    }
}

let debounceTimer = null;
function debounce(fn, delay) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, delay);
}

async function fetchQuote() {
    if (!buyPointsState.selectedAsset || !buyPointsState.amount) return;
    showLoader(true);
    try {
        let amountToSend = buyPointsState.amount;
        if (buyPointsState.selectedAsset.type === 'token') {
            const decimals = buyPointsState.selectedAsset.decimals || 18;
            amountToSend = toSmallestUnit(buyPointsState.amount, decimals);
        }
        const body = {
            type: buyPointsState.selectedAsset.type,
            assetAddress: buyPointsState.selectedAsset.address,
            amount: amountToSend,
            mode: buyPointsState.mode
        };
        const token = await getCsrfToken();
        const res = await fetch(`${API_BASE_URL}/quote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token || ''
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
    showLoader(true);
    try {
        let amountToSend = buyPointsState.amount;
        if (buyPointsState.selectedAsset.type === 'token') {
            const decimals = buyPointsState.selectedAsset.decimals || 18;
            amountToSend = toSmallestUnit(buyPointsState.amount, decimals);
        }
        let userWalletAddress;
        try {
            userWalletAddress = await getUserWalletAddress();
        } catch (walletErr) {
            showLoader(false);
            showError(walletErr.message || 'Could not connect wallet.');
            return;
        }
        const body = {
            quoteId: buyPointsState.quote.quoteId,
            type: buyPointsState.selectedAsset.type,
            assetAddress: buyPointsState.selectedAsset.address,
            amount: amountToSend,
            userWalletAddress,
            mode: buyPointsState.mode
        };
        const token = await getCsrfToken();
        const res = await fetch(`${API_BASE_URL}/purchase`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token || ''
            },
            body: JSON.stringify(body),
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Failed to initiate purchase');
        buyPointsState.purchase = await res.json();
        showLoader(false);
        const { approvalRequired, approvalTx, depositTx } = buyPointsState.purchase;
        let txHash;
        if (approvalRequired && approvalTx) {
            try {
                showLoader(true);
                showError('Please sign the approval transaction in your wallet.');
                await sendTransaction(approvalTx);
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
            buyPointsState.txStatus = { 
                status: 'submitted', 
                txHash: txHash, 
                message: 'Waiting for blockchain confirmation and backend processing...' 
            };
        } catch (err) {
            showLoader(false);
            showError('Transaction was rejected or failed.');
            return;
        }
        showLoader(false);
        goToStep(4);
        
        // Poll for purchase confirmation and auto-execute spell if context exists
        if (buyPointsState.spellContext) {
            pollForPurchaseConfirmation(txHash);
        }
    } catch (err) {
        showLoader(false);
        showError(err.message || 'Could not initiate purchase.');
    }
}

// Poll for purchase confirmation and auto-execute spell
async function pollForPurchaseConfirmation(txHash) {
    const maxAttempts = 300; // 5 minutes
    let attempts = 0;
    
    const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(pollInterval);
            return;
        }
        
        try {
            // Check if purchase is confirmed by polling user balance or transaction status
            // For now, we'll rely on websocket events or manual refresh
            // The receipt step will show the "Run Spell Now" button
        } catch (err) {
            console.warn('[BuyPointsModal] Poll error:', err);
        }
    }, 2000);
    
    buyPointsState.pollInterval = pollInterval;
}

function handlePointsDepositUpdate(event) {
    const { status, reason, originalTxHashes, ...receiptData } = event;
    
    // Check if this update is relevant to the current modal transaction
    if (buyPointsState.step === 4 && buyPointsState.txStatus && originalTxHashes && originalTxHashes.includes(buyPointsState.txStatus.txHash)) {
        if (status === 'confirmed') {
            buyPointsState.txStatus.status = 'Success!';
            buyPointsState.txStatus.receipt = receiptData;
            buyPointsState.txStatus.confirmationTxHash = receiptData.confirmation_tx_hash;
            goToStep(5); // Go to receipt step
            
            // Auto-execute spell if context exists (mark as auto-executed to prevent double execution)
            if (buyPointsState.spellContext && !buyPointsState.spellContext.executing && !buyPointsState.spellContext.autoExecuted) {
                buyPointsState.spellContext.autoExecuted = true;
                setTimeout(() => {
                    executeSpellAfterPurchase();
                }, 1000); // Small delay to show receipt first
            }
        } else if (status === 'failed') {
            buyPointsState.txStatus.status = 'Failed';
            buyPointsState.txStatus.failureReason = reason || 'The transaction failed during backend processing.';
            showError(buyPointsState.txStatus.failureReason);
        }
        render();
    }
}

function handleAmountChange(e) {
    buyPointsState.amount = e.target.value;
    buyPointsState.quote = null;
    if (buyPointsState.amount && buyPointsState.selectedAsset) {
        debounce(() => fetchQuote(), 400);
    } else {
        render();
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

// Execute spell after successful purchase
async function executeSpellAfterPurchase() {
    if (!buyPointsState.spellContext) return;
    
    const { slug, inputs, quote } = buyPointsState.spellContext;
    buyPointsState.spellContext.executing = true;
    render(); // Re-render to show executing state
    
    try {
        const csrfToken = await getCsrfToken();
        const execRes = await fetch('/api/v1/spells/cast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': csrfToken || ''
            },
            credentials: 'include',
            body: JSON.stringify({
                slug,
                context: {
                    parameterOverrides: inputs || {},
                    quote: quote || null,
                    chargeUpfront: true
                }
            })
        });
        
        if (!execRes.ok) {
            const errorData = await execRes.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || 'Spell execution failed';
            showError(`Spell execution failed: ${errorMsg}`);
            buyPointsState.spellContext.executing = false;
            render();
            return;
        }
        
        const execResult = await execRes.json();
        buyPointsState.spellContext.castId = execResult.castId;
        render(); // Update receipt to show cast ID
        
        // Close modal after a short delay and trigger spell execution event
        setTimeout(() => {
            closeModal();
            // Dispatch event for spell_execute.js to handle
            window.dispatchEvent(new CustomEvent('spellExecuted', {
                detail: { castId: execResult.castId, slug }
            }));
        }, 2000);
    } catch (err) {
        showError(`Failed to execute spell: ${err.message}`);
        buyPointsState.spellContext.executing = false;
        render();
    }
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
        pollInterval: null,
        spellContext: null // Clear spell context on close
    });
}

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

// --- Modal HTML Template ---
const buyPointsModalHTML = `
<div id="buy-points-modal" class="modal-overlay" style="display: none;">
    <div class="modal-content">
        <div id="wallet-info" style="font-size:12px;color:#90caf9;margin-bottom:6px;"></div>
        <button class="modal-close-btn">&times;</button>
        
        <div id="modal-step-1" class="modal-step">
            <h2>Buy Points</h2>
            <p>Select the asset you want to use to buy points.</p>
            <div id="asset-selection"></div>
        </div>

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

        <div id="modal-step-3" class="modal-step" style="display: none;">
            <h2>Review Purchase</h2>
            <div id="review-summary"></div>
            <div class="modal-nav">
                <button class="modal-back-btn">Back</button>
                <button id="confirm-purchase-btn">Buy Points</button>
            </div>
        </div>
        
        <div id="modal-step-4" class="modal-step" style="display: none;">
            <h2>Transaction Status</h2>
            <div id="tx-status-display"></div>
            <button id="manual-refresh-btn">Refresh</button>
        </div>

        <div id="modal-step-5" class="modal-step" style="display: none;">
            <h2>Purchase Complete</h2>
            <div id="receipt-display"></div>
            <button class="modal-close-btn-bottom">Close</button>
        </div>
        
        <div id="modal-loader" style="display: none;">
            <div class="spinner"></div>
        </div>
        
        <div id="modal-error-display" style="display: none;"></div>
    </div>
</div>`;

// --- Initialization ---
async function initBuyPointsModal(spellContext = null) {
    // Store spell context if provided (when opened from insufficient points error)
    if (spellContext) {
        buyPointsState.spellContext = spellContext;
    }
    
    // Ensure mode is set to 'donate' for spell execution purchases (better for micro-transactions)
    if (spellContext) {
        buyPointsState.mode = 'donate';
    }
    
    if (document.getElementById('buy-points-modal')) {
        // Modal already exists, just show it
        modal = document.getElementById('buy-points-modal');
        modal.style.display = 'flex';
        goToStep(1);
        return;
    }
    
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

    // Listen for websocket events for purchase confirmation
    if (window.websocketClient) {
        window.websocketClient.on('pointsDepositUpdate', handlePointsDepositUpdate);
    }

    await fetchSupportedChains();
    modal.style.display = 'flex';
    refreshWalletInfo();
    goToStep(1);
    showLoader(true);
    await fetchSupportedAssets();
    showLoader(false);
}

window.openBuyPointsModal = initBuyPointsModal;

