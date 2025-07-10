// ----------------------------------------------------------------------------------
// ADMIN DASHBOARD: LEGACY ERRORED DEPOSITS RECOVERY (RECOMMENDATION)
//
// Many legacy deposits ended up with status ERROR due to double confirmation attempts
// (race conditions, duplicate webhooks, etc). In these cases, the first on-chain
// confirmation often succeeded, but a second (duplicate) attempt failed and overwrote
// the ledger entry with an error, leaving the user's points uncredited and trapped.
//
// RECOMMENDED IMPLEMENTATION FOR ADMIN RECOVERY:
//
// 1. Backend: Expose all ledger entries with status ERROR and a non-null confirmation_tx_hash
//    via an internal/admin API endpoint. Allow filtering by user, date, etc.
//
// 2. Backend: Provide a utility/API to check the on-chain status of a given confirmation_tx_hash
//    to determine if the deposit was actually confirmed and funds are under platform control.
//
// 3. Admin Dashboard UI:
//    - Add a section for "Errored Deposits Recovery".
//    - List all errored deposits with relevant info (user, amount, error, tx hash).
//    - For each, allow the admin to verify on-chain status (via API call).
//    - If confirmed on-chain, provide a button to "Mark as Confirmed & Credit Points".
//    - Support bulk actions for efficiency.
//
// 4. Backend: Admin override endpoint to update the ledger entry to CONFIRMED and credit points
//    after verifying on-chain status.
//
// 5. Log all admin overrides for auditability. Optionally, notify users when their points are recovered.
//
// This approach ensures that all users receive the points they are owed for real deposits, and that
// the ledger accurately reflects the true state of all deposits, even those affected by past bugs.
// ----------------------------------------------------------------------------------

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