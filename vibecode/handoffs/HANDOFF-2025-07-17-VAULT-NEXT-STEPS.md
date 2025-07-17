# HANDOFF: 2025-07-17 VAULT-NEXT-STEPS

## Work Completed
- Backend salt mining, vault creation, and transaction flow is working and confirmed on-chain.
- Vault records are created in the database with `status: "PENDING_DEPLOYMENT"` and are updated to `"ACTIVE"` when finalized.
- Users can create more than one referral vault (limit removed or to be removed).
- Frontend modal (`ReferralVaultModal`) allows users to create a vault and see the result.

## Current State
- The backend creates vaults and records them in the DB, but the dashboard and user API only return the first vault.
- The frontend only displays a single referral vault in the account dropdown.
- There is no vault dashboard modal for users to view all their vaults, referral links, or vault stats.

## Next Tasks

### Backend
- **Update `/dashboard` API in `userApi.js` to return all vaults:**
  ```js
  // Before:
  referralVault = vaults.length > 0 ? vaults[0] : null;
  // After:
  referralVaults = vaults;
  // ...
  res.status(200).json({
    // ...other fields...
    referralVaults: vaults,
    // ...other fields...
  });
  ```
- **Remove or increase vault limit in `creditService.js` if not already done:**
  ```js
  // Remove or comment out:
  const MAX_VAULTS_PER_USER = 3;
  if (existingVaults.length >= MAX_VAULTS_PER_USER) {
      throw new Error(...);
  }
  ```

### Frontend
- **Update `accountDropdown.js` to display all vaults:**
  - Loop over `data.referralVaults` and render each vault with:
    - Vault name
    - Vault address (shortened)
    - Referral link (e.g., `/referral/${vault.vault_name}`)
    - Button to open a dashboard modal for each vault
  - Example:
    ```js
    const referralVaults = data && Array.isArray(data.referralVaults) ? data.referralVaults : [];
    const vaultListHtml = referralVaults.length
      ? referralVaults.map(vault => `
          <div class="dropdown-item">
            <b>${vault.vault_name}</b><br>
            <span class="vault-address">${this.shortenWallet(vault.vault_address)}</span><br>
            <a href="/referral/${vault.vault_name}" target="_blank">Referral Link</a>
            <button class="vault-dashboard-btn" data-vault="${vault.vault_address}">Dashboard</button>
          </div>
        `).join('')
      : `<div class="dropdown-item">No referral vaults yet.</div>`;
    ```
- **Implement a `VaultDashboardModal.js` component:**
  - Shows vault stats: name, address, referral link, referral volume, rewards, funds available, withdraw button.
  - Opens when user clicks the dashboard button for a vault.

## Changes to Plan
- The system will now support multiple referral vaults per user, both in backend API and frontend UI.
- The dashboard and dropdown will reflect all vaults, not just the first.

## Open Questions & Answers

**Should there be a soft or hard limit on the number of vaults per user?**
- There is no enforced hard limit. Vaults cost gas to create and to collect from, so the only incentive to create many is to reserve referral link names. Users can create as many vaults as they want, but each vault requires credit (paid up front, with a platform cut). In the future, vaults may be sold/transferred, and the platform may facilitate this, but not yet. Users should be warned of the risks of creating many vaults.

**What additional stats or actions should be available in the vault dashboard modal?**
- The dashboard modal should show:
  - Referral fees collected and withdrawable by the owner
  - Total deposits and escrow in the vault
  - The referral link (clickable)
  - A withdraw button to claim referral rewards
  - A clear call to action for others to use the referral vault instead of the root vault
  - (Future) Ownership transfer/sale features

**Should vaults be sortable or filterable in the UI?**
- Yes. Vaults should be sortable by:
  - Date created
  - Alphabetical referral code
  - Native token holdings (address(0)) 

  ### Vaults & Referral System Progress (2025-07-17)

#### Backend
- /dashboard API now returns all referral vaults for the user as an array.
- Vault-per-user limit removed.
- Fixed ObjectId vs string bug in vault lookup (see `findReferralVaultsByMasterAccount`).
- **TODO:** Standardize all user ID storage/querying to use a single type (string or ObjectId).

#### Frontend
- Account dropdown lists all referral vaults with name, address, referral link, and dashboard button.
- Improved styling for vault list.
- **TODO:** Update vault address abbreviation to show more of the unique part after the fixed prefix.
- **TODO:** Decide on and update referral link format (e.g., `/r/milady` or `/ref?code=milady`).

#### Next Steps
- Update address abbreviation and referral link format.
- Implement Vault Dashboard modal for per-vault stats and actions.

Work Completed
Backend
/dashboard API now returns all referral vaults for the user as an array (referralVaults).
Vault-per-user limit removed; users can create unlimited vaults.
Fixed ObjectId vs string bug in vault lookup (findReferralVaultsByMasterAccount now matches both).
All changes documented for future standardization of user ID storage/querying.
Frontend
Account dropdown lists all referral vaults with name, address (improved abbreviation), referral link, and dashboard button.
Vault address abbreviation now shows more of the unique part after the fixed prefix (e.g., 0x1152d699...1E02).
Referral link logic is earmarked for a future decision (currently /referral/:vault_name).
Vault Dashboard modal scaffolded as a standalone component:
Accepts a vault object, displays vault info, stats (placeholder), and withdraw button.
Modal is styled and structured consistently with other modals.
Account dropdown attempts to dynamically load and display the Vault Dashboard modal when the dashboard button is clicked (dynamic script loading pattern established, but static file serving issue remains).
Current State
Users can create and view multiple referral vaults.
Vaults are correctly returned from the backend and displayed in the frontend dropdown.
Clicking the dashboard button attempts to load and display the Vault Dashboard modal, but static file serving for the modal JS is not yet working (404 error).
Modal UI/UX patterns are consistent and ready for further integration.
Next Tasks
Fix static file serving for vaultDashboardModal.js so it can be dynamically loaded by the frontend.
Integrate real API calls for vault stats and withdrawal in the dashboard modal.
Finalize referral link format and update all relevant UI/logic.
(Optional) Standardize all user ID storage/querying to use a single type (string or ObjectId).
Implement Playwright or equivalent UI test for the full referral vault flow.
Changes to Plan
No major deviations; all changes align with the North Star and Genius Plan.
Referral link format decision deferred for higher-level review.
Open Questions
What is the final, canonical format for referral links (e.g., /referral/:name, /r/:name, /ref?code=name)?
Should we standardize all user ID storage/querying to strings or ObjectIds, and when?
Are there additional stats or actions needed in the Vault Dashboard modal for MVP?