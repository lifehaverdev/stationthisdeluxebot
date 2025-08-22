> Imported from vibecode/handoffs/HANDOFF-2025-07-03-account-dropdown-next.md on 2025-08-21

# HANDOFF: 2025-07-03 — Account Dropdown Next Phase

## Goal
Design and implement a best-in-class account dropdown/menu for the sandbox web app, supporting all critical user actions and integrations for a modern, multi-platform, web3-enabled product.

---

## Features & UX Priorities

### 1. **Buy Points**
- Prominent button/modal for purchasing points.
- Support multiple currencies (crypto, ERC20, etc.) and payment flows.
- Show real-time conversion rates, fees, and estimated points received.
- Guide user through wallet approval, deposit, and confirmation (smart wallet integration).
- Success/failure feedback and instant balance update.

### 2. **Referral & Vault**
- Show referral code/link, stats, and sharing options.
- Vault setup and status (create, connect, or view existing).
- Withdraw rewards to connected wallet (with confirmation and history).
- Clear, actionable UI for both new and returning users.

### 3. **Linked Accounts**
- Connect Telegram, Discord, API keys, and additional wallets.
- Code-based linking (send code to bot) and OAuth where possible.
- Show linked status, allow unlinking, and manage multiple wallets.
- Copyable addresses, clear primary/secondary status.

### 4. **Settings**
- Profile picture, banner, username, password, API key management.
- In-place editing, modals for sensitive actions (password/API key).
- Avatar/banner previews and upload.

### 5. **Header Enhancements**
- Wallet address and points balance always visible, copyable, and up-to-date.
- Responsive and accessible design.

---

## Best Practices & UX Considerations
- Use modals for multi-step flows (Buy Points, Withdraw, Link Account).
- Provide clear feedback for all actions (success, error, pending).
- Make all addresses and codes copyable with one click.
- Use tooltips and status indicators for linked accounts and wallets.
- Ensure all flows are mobile-friendly and keyboard accessible.
- For Buy Points, show a summary/confirmation before finalizing.
- For linking, provide clear instructions and fallback options.

---

## Open Questions
- What is the optimal flow for buying points with multiple currencies and smart wallet approval?
- Should we allow users to set a default withdrawal wallet?
- How should we handle account linking for users with existing Telegram/Discord accounts?
- What additional quick actions or notifications would improve the dropdown?
- Should we support custom user avatars and banners at launch, or defer?

---

## Next Steps
- Finalize menu structure and naming for all actions.
- Design wireframes/mockups for each modal and menu.
- Define backend endpoints and flows for Buy Points, Vault, Linking, and Settings.
- Implement and test each feature, prioritizing Buy Points and Referral/Vault.

---

## Addendum: Modal Implementation Plan (2025-07-03)

### Modal List & Flows

| Modal Name                | Purpose/Flow                                                                                 |
|---------------------------|---------------------------------------------------------------------------------------------|
| **BuyPointsModal**        | Buy points with various currencies, wallet approval, confirmation, feedback                 |
| **ReferralModal**         | Show/copy referral code, stats, sharing options                                             |
| **VaultModal**            | Vault setup, connect, view, withdraw, see reward history                                   |
| **LinkedAccountsModal**   | Link/unlink Telegram, Discord, API keys, wallets; show/copy status; manage multiple wallets |
| **SettingsModal**         | Edit profile info, change password, manage API keys, upload avatar/banner                  |
| **AvatarUploadModal**     | Upload and preview avatar/banner (may be part of SettingsModal)                             |
| **WithdrawModal**         | Withdraw rewards/points to wallet, confirmation, feedback                                  |
| **ConfirmationModal**     | Generic confirmation for sensitive actions (logout, unlink, withdraw, etc.)                |

---

### Plan of Attack

**Step 1: Finalize Menu Structure**
- Define which actions open which modal.
- Ensure all actions are accessible from the dropdown.

**Step 2: Design Wireframes/Mockups**
- Sketch out each modal's UI and flow (can be rough at first).
- Prioritize Buy Points and Referral/Vault.

**Step 3: Modal Component Boilerplate**
- Create a base modal class/component (if not already).
- Each modal should be self-contained, reusable, and accessible.

**Step 4: Implement Modals One by One**
- **BuyPointsModal**: Multi-step, wallet integration, real-time rates.
- **ReferralModal**: Show code, stats, sharing.
- **VaultModal**: Setup/connect/view, withdraw, history.
- **LinkedAccountsModal**: Link/unlink, show status, copy, manage.
- **SettingsModal**: Edit info, upload avatar/banner, manage API keys.
- **WithdrawModal**: Withdraw points/rewards, confirmation.
- **ConfirmationModal**: For sensitive actions.

**Step 5: Backend Integration**
- Define/implement API endpoints for each action (buy, link, withdraw, etc.).
- Ensure modals provide real-time feedback and error handling.

**Step 6: UX Polish**
- Tooltips, copy-to-clipboard, status indicators.
- Mobile and keyboard accessibility.
- Responsive design.

---

### Next Steps

1. Confirm the above modal list and flows. (Done)
2. Decide on the order of implementation (BuyPointsModal → ReferralModal → VaultModal → LinkedAccountsModal → SettingsModal).
3. Start with wireframes/mockups for BuyPointsModal and ReferralModal.
4. Create a base modal utility if needed.
5. Implement and test each modal, integrating with backend as needed.

---

This addendum provides a clear, actionable roadmap for building out the account dropdown's modal-driven user flows, starting with Buy Points.

This handoff sets the direction for the next phase of account menu development, ensuring a seamless, powerful, and user-friendly experience for all users and agents on the platform. 