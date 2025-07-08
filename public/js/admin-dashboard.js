import { setupWalletGate, adminVerified, onAdminStatusChange } from './wallet-gate.js';

setupWalletGate();

function showAdminContent() {
    const placeholder = document.querySelector('.admin-content-placeholder');
    if (placeholder) {
        placeholder.textContent = 'Welcome, Admin! Future features will appear here.';
        placeholder.style.color = '#222';
    }
}

onAdminStatusChange((isAdmin) => {
    if (isAdmin) {
        showAdminContent();
    }
}); 