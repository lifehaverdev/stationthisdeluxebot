# HANDOFF: 2023-10-27

## Work Completed

### LoRA Store - Phase 1: Browsing & Viewing

1.  **Main Menu Integration**:
    *   Added a "🛍️ LoRA Store" button to the main LoRA menu (`src/platforms/telegram/components/loraMenuManager.js`).
    *   Callback: `lora_store:main_menu`.

2.  **LoRA Store Main Menu**:
    *   Implemented `displayLoraStoreMainMenu` function (`loraMenuManager.js`) to show store categories (e.g., By Price, By Tag, Popular, Newest, My Listed LoRAs, My Purchases).
    *   Handled `lora_store:main_menu` callback in `handleLoraCallback` (`loraMenuManager.js`).
    *   Updated main callback router in `src/platforms/telegram/bot.js` to correctly route `lora_store:` prefixed callbacks to `handleLoraMenuCallback`.

3.  **Store Category Listing**:
    *   Implemented `displayStoreLorasByFilterScreen` function (`loraMenuManager.js`) for when a user selects a category.
    *   Handles `lora_store:category:<filterType>:<checkpoint>:<page>` callbacks.
    *   This function now calls the new backend API to fetch LoRAs.

4.  **Backend API for Store Listings**:
    *   Created new API endpoint `GET /loras/store/list` in `src/api/internal/lorasApi.js`.
    *   This endpoint fetches LoRAs based on:
        *   `monetization.forSale: true`
        *   `visibility: 'private'` (configurable if other visibilities are to be included)
        *   `ownedBy: { $ne: masterAccountId }` (browsing user doesn't see their own items for sale)
    *   Supports filtering by `storeFilterType` (recent, price_asc, price_desc, popular, tag), `checkpoint`, and pagination.
    *   Uses `loRAModelsDb.findMany` and `loRAModelsDb.count`.
    *   Includes an `isPurchased` flag in the response by checking `loRAPermissionsDb.listAccessibleLoRAs()` for the browsing user.

5.  **Store LoRA Detail View**:
    *   Implemented `displayStoreLoraDetailScreen` function (`loraMenuManager.js`).
    *   Handles `lora_store:detail:<loraIdentifier>:<backFilter>:<backCheckpoint>:<backPage>` callbacks.
    *   Fetches LoRA details using the existing `GET /loras/:loraIdentifier` API endpoint.
    *   Displays LoRA information: name, preview, description, price (from `lora.monetization.priceUSD`).
    *   **Ownership Check**: Uses `loRAPermissionsDb.hasAccess()` (via dependency injection) to determine if the viewing user already owns the LoRA.
    *   Displays a "💰 Buy for X points" button if the LoRA is for sale and not owned by the user. Callback: `lora_store:purchase_confirm:...`.
    *   Displays "✅ You own this LoRA!" if already purchased.
    *   Includes a "⇱ Back to Store Listings" button.

6.  **Purchase Confirmation (Placeholder)**:
    *   Added a handler for `lora_store:purchase_confirm:<loraId>:<price>:<...>`.
    *   Currently shows a Telegram alert: "CONFIRM: Buy [LoRA] for [Price] points? (Not Implemented)".

7.  **Dependency Management**:
    *   Ensured `loRAPermissionsDb` is correctly instantiated in `bot.js` and passed as a dependency through `handleLoraMenuCallback` to `displayStoreLoraDetailScreen`.

## Current State

*   **Functionality**: Users can navigate into the LoRA store, browse categories (e.g., "Newest", "By Price"), view lists of LoRAs for sale (fetched from the live API, assuming correctly configured data in the `loraModels` DB), and view the detail page for each store LoRA. The detail page correctly indicates price and whether the user owns the item.
*   **Demonstrable Flow**:
    1.  User sends `/loras` command.
    2.  User clicks "🛍️ LoRA Store" button.
    3.  User sees store categories (e.g., "💰 By Price", "🆕 Newest").
    4.  User clicks a category (e.g., "🆕 Newest").
        *   `displayStoreLorasByFilterScreen` is called.
        *   API `GET /loras/store/list` is invoked.
        *   A list of LoRAs (name and price) is displayed. (Requires LoRAs in DB with `visibility: 'private'`, `monetization.forSale: true`, and a `monetization.priceUSD`).
    5.  User clicks on a LoRA from the list.
        *   `displayStoreLoraDetailScreen` is called.
        *   API `GET /loras/:loraIdentifier` is invoked.
        *   LoRA details (image, description, price) are shown.
        *   If not owned: "💰 Buy for X points" button appears.
        *   If owned (requires entry in `lora_permissions` for the user and LoRA): "✅ You own this LoRA!" status appears.
    6.  Clicking "💰 Buy for X points" shows a "CONFIRM: Buy... (Not Implemented)" alert.
*   **Limitations**:
    *   Actual purchase functionality is not implemented.
    *   Point balance checks are not implemented.
    *   Seller crediting is not implemented.
    *   "My Listed LoRAs" and "My Purchases" are placeholder menu items.
    *   Mechanism for users to list their LoRAs for sale is not yet designed/implemented.
    *   The "Popular" filter in the store currently uses general `usageCount` as a placeholder.
    *   "By Tag" filter requires a sub-menu for tag selection.

## Next Tasks

1.  **Implement Purchase Flow**:
    *   Design and implement a final confirmation step/UI after the current `lora_store:purchase_confirm` alert.
    *   Create a new backend API endpoint (e.g., `POST /loras/store/purchase/:loraId`).
    *   Implement the API logic:
        *   Verify buyer's point balance (requires `pointsService` integration).
        *   Deduct points from buyer.
        *   Add an entry to `lora_permissions` for the buyer and LoRA ID, marking it as a 'purchase'.
        *   (Future) Credit points to the LoRA's owner (`loraModel.ownedBy`).
        *   Return a clear success or failure response.
    *   Update the Telegram UI (`displayStoreLoraDetailScreen`) to reflect a successful purchase (e.g., change "Buy" button to "✅ Owned" status) without requiring a full menu reload if possible.

2.  **User-Facing Sale Management**:
    *   Design UI/commands for users to list their trained LoRAs in the store.
    *   Allow users to set a price, sale description, and toggle `monetization.forSale`.
    *   Implement "My Listed LoRAs" view (`lora_store:my_listed` callback and corresponding display function/API).

3.  **User Purchase History**:
    *   Implement "My Purchases" view (`lora_store:my_purchases` callback and display function/API). This would query `loRAPermissionsDb` for the user.

4.  **Store Feature Refinements**:
    *   Implement a true "Popular" sort for the store (e.g., based on purchase count from `lora_permissions` or a dedicated counter on the LoRA model).
    *   Implement the "By Tag" filter with a sub-menu for selecting tags.

5.  **Points System Integration**:
    *   Integrate `pointsService` to check balances before purchase.
    *   Display user's current point balance in relevant menus.

## Changes to Plan
*   No major deviations from the overall goal of implementing a LoRA store. Work has proceeded by building out the browsing and viewing aspects first.

## Open Questions

*   What is the preferred method for tracking store popularity (e.g., count `lora_permissions` entries vs. a dedicated `purchaseCount` field on `loraModels`)?
*   What are the detailed requirements for the user flow when they list their own LoRA for sale (e.g., where do they set the price, description, etc.)?
*   How should point transactions (deduction from buyer, credit to seller) be robustly logged for auditing and potential dispute resolution?
*   Should the `GET /loras/:loraIdentifier` endpoint be enhanced to explicitly return an `isPurchased` flag when queried with a `userId` in a store context, or is the current separate check in `displayStoreLoraDetailScreen` sufficient?