// src/platforms/web/client/src/sandbox/components/ReferralVaultModal/referralVaultModal.js

// --- State Management ---
const vaultState = {
    step: 1,
    vaultName: '',
    isNameAvailable: false,
    isNameChecking: false,
    predictedAddress: null,
    error: null,
    isLoading: false,
};

// --- DOM Element References ---
let modal, step1, step2, step3, step4, loader, errorDisplay;
let vaultNameInput, vaultNameStatus, reviewDetails, deploymentStatus, receiptDisplay;
let nextBtn, confirmBtn, backBtn, closeBtn;

// --- Utility Functions ---
function goToStep(stepNumber) {
    vaultState.step = stepNumber;
    render();
}

function showLoader(show) {
    vaultState.isLoading = show;
    render();
}

function showError(message) {
    vaultState.error = message;
    render();
}

function render() {
    [step1, step2, step3, step4].forEach(step => step && (step.style.display = 'none'));
    if (loader) loader.style.display = vaultState.isLoading ? 'flex' : 'none';
    if (errorDisplay) {
        errorDisplay.style.display = vaultState.error ? 'block' : 'none';
        errorDisplay.textContent = vaultState.error || '';
    }

    switch (vaultState.step) {
        case 1: step1.style.display = 'block'; renderStep1(); break;
        case 2: step2.style.display = 'block'; renderStep2(); break;
        case 3: step3.style.display = 'block'; renderStep3(); break;
        case 4: step4.style.display = 'block'; renderStep4(); break;
    }
}

function renderStep1() {
    if (!vaultNameInput || !vaultNameStatus || !nextBtn) return;
    vaultNameInput.value = vaultState.vaultName;

    if (vaultState.isNameChecking) {
        vaultNameStatus.className = 'status-checking';
        vaultNameStatus.textContent = 'Checking...';
        nextBtn.disabled = true;
    } else if (vaultState.vaultName.length > 3) {
        if (vaultState.isNameAvailable) {
            vaultNameStatus.className = 'status-available';
            vaultNameStatus.textContent = `"${vaultState.vaultName}" is available!`;
            nextBtn.disabled = false;
        } else {
            vaultNameStatus.className = 'status-unavailable';
            vaultNameStatus.textContent = `"${vaultState.vaultName}" is unavailable or invalid.`;
            nextBtn.disabled = true;
        }
    } else {
        vaultNameStatus.textContent = 'Enter a name (4+ characters).';
        nextBtn.disabled = true;
    }
}

function renderStep2() {
    if (!reviewDetails) return;
    reviewDetails.innerHTML = `
        <p>You are about to create a referral vault with the following code name:</p>
        <p><strong>Code Name:</strong> <span>${vaultState.vaultName}</span></p>
        <p>This will deploy a new contract on your behalf. The address will be generated for you.</p>
    `;
}

function renderStep3() {
    if (!deploymentStatus) return;
    deploymentStatus.innerHTML = `
        <div class="spinner-container">
            <div class="spinner"></div>
            <p>Mining a valid salt... (this can take a moment)</p>
            <p>Your vault address must start with 0x1152.</p>
        </div>
    `;
    // In a real scenario, this would update as the process continues
    // e.g. "Deploying contract..."
}

function renderStep4() {
    if (!receiptDisplay) return;
    receiptDisplay.innerHTML = `
        <h2>Deployment Successful!</h2>
        <p>Your new referral vault is now active.</p>
        <p><strong>Vault Name:</strong> <span>${vaultState.vaultName}</span></p>
        <p><strong>Vault Address:</strong> <span class="copyable">${vaultState.predictedAddress}</span></p>
        <p>You can now share your referral link to earn rewards.</p>
    `;
}


// --- API Functions ---
async function checkVaultNameAvailability(name) {
    vaultState.isNameChecking = true;
    render();
    try {
        const token = await window.auth.ensureCsrfToken();
        const res = await fetch('/api/v1/referral-vault/check-name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify({ name }),
            credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error?.message || 'Failed to check name.');
        }
        vaultState.isNameAvailable = data.isAvailable;
    } catch (err) {
        showError(err.message);
        vaultState.isNameAvailable = false;
    } finally {
        vaultState.isNameChecking = false;
        render();
    }
}

async function createReferralVault() {
    goToStep(3); // Show mining/deployment progress
    showLoader(true);
    try {
        const token = await window.auth.ensureCsrfToken();
        const res = await fetch('/api/v1/referral-vault/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify({ name: vaultState.vaultName }),
            credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error?.message || 'Failed to create vault.');
        }
        vaultState.predictedAddress = data.vault_address;
        goToStep(4);
    } catch (err) {
        showError(err.message);
        // Optionally go back to a previous step on failure
        goToStep(2);
    } finally {
        showLoader(false);
    }
}

// --- Event Handlers ---
let debounceTimer;
function handleNameInputChange(e) {
    vaultState.vaultName = e.target.value.trim();
    vaultState.isNameAvailable = false;
    clearTimeout(debounceTimer);

    if (vaultState.vaultName.length > 3) {
        debounceTimer = setTimeout(() => {
            checkVaultNameAvailability(vaultState.vaultName);
        }, 400);
    }
    render();
}

function closeModal() {
    if (modal) {
        modal.remove();
    }
    // Reset state for next time
    Object.assign(vaultState, {
        step: 1, vaultName: '', isNameAvailable: false, isNameChecking: false,
        predictedAddress: null, error: null, isLoading: false,
    });
}

// --- Modal HTML Template ---
const referralVaultModalHTML = `
<div id="referral-vault-modal" class="modal-overlay">
    <div class="modal-content">
        <button class="modal-close-btn">&times;</button>

        <!-- Step 1: Name -->
        <div id="modal-step-1" class="modal-step">
            <h2>Set Up Your Referral Vault</h2>
            <p>Create a unique code name for your vault. This name will be public and part of your referral link.</p>
            <div class="form-group">
                <label for="vault-name-input">Vault Code Name</label>
                <input type="text" id="vault-name-input" placeholder="e.g., 'crypto-king'">
                <div id="vault-name-status"></div>
            </div>
            <div class="modal-nav">
                <button id="next-btn" disabled>Next</button>
            </div>
        </div>

        <!-- Step 2: Review -->
        <div id="modal-step-2" class="modal-step" style="display: none;">
            <h2>Review Details</h2>
            <div id="review-details"></div>
            <div class="modal-nav">
                <button class="modal-back-btn">Back</button>
                <button id="confirm-btn">Confirm & Deploy</button>
            </div>
        </div>

        <!-- Step 3: Deploying -->
        <div id="modal-step-3" class="modal-step" style="display: none;">
            <h2>Deploying Vault</h2>
            <div id="deployment-status"></div>
        </div>

        <!-- Step 4: Receipt -->
        <div id="modal-step-4" class="modal-step" style="display: none;">
            <div id="receipt-display"></div>
            <div class="modal-nav">
                <button class="modal-close-btn-bottom">Done</button>
            </div>
        </div>

        <div id="modal-loader" style="display: none;"></div>
        <div id="modal-error-display" style="display: none;"></div>
    </div>
</div>`;


// --- Initialization ---
function initReferralVaultModal() {
    // Inject CSS
    if (!document.getElementById('referral-vault-modal-styles')) {
        const style = document.createElement('style');
        style.id = 'referral-vault-modal-styles';
        // This is a placeholder. In a real app, you'd link the CSS file.
        style.textContent = `
/* Pasted from referralVaultModal.css for simplicity */
.modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000}.modal-content{background:#1e1e1e;padding:2rem;border-radius:8px;width:90%;max-width:500px;position:relative;border:1px solid #444;box-shadow:0 5px 15px rgba(0,0,0,0.5)}.modal-close-btn{position:absolute;top:10px;right:15px;background:none;border:none;font-size:1.8rem;color:#aaa;cursor:pointer}.modal-step h2{margin-top:0;color:#e0e0e0}.modal-step p{color:#b0b0b0;line-height:1.6}.form-group{margin:1.5rem 0}.form-group label{display:block;margin-bottom:8px;color:#c0c0c0;font-weight:bold}.form-group input{width:100%;padding:12px;background:#2a2a2a;border:1px solid #555;border-radius:4px;color:#f0f0f0;font-size:1rem}#vault-name-status{font-size:.9rem;margin-top:8px;height:1.2em}.status-checking{color:#f39c12}.status-available{color:#2ecc71}.status-unavailable{color:#e74c3c}.modal-nav{display:flex;justify-content:flex-end;margin-top:2rem}.modal-nav button{padding:10px 20px;border:none;border-radius:4px;cursor:pointer;background-color:#3f51b5;color:#fff;font-size:1rem;margin-left:10px}.modal-nav button:disabled{background-color:#555;cursor:not-allowed}#review-details,#deployment-status,#receipt-display{background:#2a2a2a;border-radius:4px;padding:1rem;margin-top:1rem;color:#c0c0c0}#review-details span{color:#90caf9;font-weight:bold}.spinner-container{text-align:center;padding:2rem}.spinner{border:4px solid hsla(0,0%,100%,.3);border-radius:50%;border-top:4px solid #90caf9;width:40px;height:40px;animation:spin 1s linear infinite;margin:0 auto 1rem}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        `;
        document.head.appendChild(style);
    }
    
    document.body.insertAdjacentHTML('beforeend', referralVaultModalHTML);

    // Assign DOM elements
    modal = document.getElementById('referral-vault-modal');
    step1 = document.getElementById('modal-step-1');
    step2 = document.getElementById('modal-step-2');
    step3 = document.getElementById('modal-step-3');
    step4 = document.getElementById('modal-step-4');
    loader = document.getElementById('modal-loader');
    errorDisplay = document.getElementById('modal-error-display');
    vaultNameInput = document.getElementById('vault-name-input');
    vaultNameStatus = document.getElementById('vault-name-status');
    reviewDetails = document.getElementById('review-details');
    deploymentStatus = document.getElementById('deployment-status');
    receiptDisplay = document.getElementById('receipt-display');
    nextBtn = document.getElementById('next-btn');
    confirmBtn = document.getElementById('confirm-btn');
    closeBtn = modal.querySelector('.modal-close-btn');

    // Attach events
    vaultNameInput.addEventListener('input', handleNameInputChange);
    nextBtn.addEventListener('click', () => goToStep(2));
    confirmBtn.addEventListener('click', createReferralVault);
    closeBtn.addEventListener('click', closeModal);
    modal.querySelector('.modal-close-btn-bottom').addEventListener('click', closeModal);
    modal.querySelector('.modal-back-btn').addEventListener('click', () => goToStep(1));

    modal.style.display = 'flex';
    goToStep(1);
}

// Expose to global scope
window.openReferralVaultModal = initReferralVaultModal; 