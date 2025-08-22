> Imported from vibecode/handoffs/HANDOFF-2025-07-02-account-dropdown.md on 2025-08-21

# HANDOFF: 2025-07-02 (Update)

## Work Completed
- Implemented a modular Account/Profile dropdown component for the sandbox web app.
- Integrated the dropdown into the header, replacing the old "Account" text with a profile icon and interactive menu.
- Connected the dropdown to the backend via `/api/v1/user/dashboard`, securely fetching and displaying live user data (username, wallet, level, EXP, points, rewards).
- Ensured the dropdown is styled for a modern, clean look and is operational in the current sandbox environment.
- Resolved CSRF/auth issues to allow seamless login and data fetching for both authenticated users and API key agents.
- **Header now displays the user's wallet address (shortened, copyable) and points balance to the left of the profile button, dynamically updated after login.**

## Current State
- The dropdown appears in the top right of the sandbox header.
- User data is fetched and displayed dynamically.
- The component is modular, with separate JS and CSS, and is ready for further feature expansion.
- Wallet and points are visible and interactive in the header.

## Next Tasks
- Implement the dropdown menu actions:
  - **Buy Points**: Prominent button/modal for purchasing points with multiple currencies and payment flows.
  - **Referral & Vault**: Referral code, vault setup, withdraw, and stats.
  - **Linked Accounts**: Connect Telegram, Discord, API keys, and additional wallets.
  - **Settings**: Profile, password, avatar/banner, API key management.
  - **Logout**: Log the user out and clear session.
- Add accessibility features (keyboard navigation, ARIA roles).
- Add mobile responsiveness and touch support.
- Optionally, add support for user avatars (default and custom uploads).
- Consider auto-closing the dropdown on outside click or ESC.

## Implementation Plan for Menus
- Each menu action will be implemented as a button or link within the dropdown.
- Actions will be connected to their respective handlers in the component JS:
  - For navigation, use `window.location` or SPA router.
  - For modals, trigger modal open/close logic.
  - For logout, call the backend logout endpoint and refresh the UI.
- Menu items will be styled for clarity and accessibility, with hover/focus states.
- Future-proofing: Menu structure will allow easy addition/removal of actions.

## Open Questions
- Should we support custom user avatars now or defer?
- What additional quick actions or links would be valuable in the dropdown?
- Should we show notifications or status badges in the menu?
- What is the best UX for the Buy Points modal, considering multiple currencies and smart wallet flows?

---

This handoff documents the successful implementation of the account dropdown and header enhancements, and provides a clear roadmap for completing the menu actions and further UI polish. The component is now a robust foundation for user account interactions in the sandbox web app. 