# Cross-Platform User Identity Investigation

## Problem Statement

When a user first interacts with the bot on a new platform (e.g., Discord), the system creates a new user account via `/internal/v1/data/users/find-or-create`. However, the user may already exist on another platform (e.g., Telegram) and should be recognized as the same user across platforms.

**Current Behavior:**
- User exists on Telegram with `masterAccountId: ABC123`
- User uses Discord for the first time
- System creates NEW user with `masterAccountId: XYZ789`
- Result: Two separate accounts, no connection

**Desired Behavior:**
- User exists on Telegram with `masterAccountId: ABC123`
- User uses Discord for the first time
- System recognizes user (via wallet connection or other method)
- System merges/links Discord platform to existing `masterAccountId: ABC123`
- Result: Single unified account across platforms

## Investigation Findings

### 1. **Account Connection/Merging Mechanism**

**Question:** How does the system currently handle account merging when a user connects their wallet?

**Investigation Results:**
- ✅ Reviewed wallet connection flow (`/wallet` command implementation)
- ✅ Checked if wallet address is used as a unique identifier for account merging
- ✅ Examined `/internal/v1/data/users/find-or-create` endpoint logic
- ✅ Reviewed existing account merging/connection APIs
- ✅ Checked database schema for user/platform relationships

**Key Findings:**

1. **Current User Creation Flow:**
   - `POST /internal/v1/data/users/find-or-create` accepts `{ platform, platformId, platformContext }`
   - Implementation in `src/api/internal/users/userCoreApi.js` (lines 47-121)
   - Database method `findOrCreateByPlatformId()` in `src/core/services/db/userCoreDb.js` (lines 51-99)
   - **CRITICAL:** Only looks up by `platformIdentities.{platformName}` - does NOT check wallet addresses
   - Creates new user if platform+platformId combination doesn't exist

2. **Wallet Storage:**
   - Wallets stored in `wallets` array on user document: `[{ address, isPrimary, verified, addedAt }]`
   - Wallet addresses normalized to lowercase for storage
   - `addWallet()` method in `userCoreDb.js` (lines 231-283) checks if wallet exists on ANOTHER user
   - If wallet exists on different user, throws error: "Wallet address already exists"
   - **GAP:** No merging/linking logic when conflict detected

3. **Wallet Connection Flow:**
   - Telegram: `src/platforms/telegram/components/walletManager.js`
     - Uses magic-amount linking (send exact ETH amount to verify ownership)
     - Calls `/internal/v1/data/users/${masterAccountId}/wallets/requests/magic-amount`
   - Web: `src/api/external/auth/authApi.js` has `/web3/verify` endpoint
     - Uses `find-or-create-by-wallet` endpoint (line 124)
     - Creates user with wallet but sets `lastSeenPlatform: 'web'` (no platform identity)

4. **Platform Identity Storage:**
   - Stored in `platformIdentities` object: `{ telegram: "12345", discord: "67890" }`
   - Method `addPlatformIdentity()` exists (lines 220-223) but not used in wallet flow
   - No automatic platform linking when wallet is connected

**Files Reviewed:**
- ✅ `src/platforms/telegram/components/walletManager.js` - Wallet command handler
- ✅ `src/api/internal/users/userCoreApi.js` - User creation endpoint
- ✅ `src/core/services/db/userCoreDb.js` - Database operations
- ✅ `src/api/internal/auth/authApi.js` - Wallet-based auth endpoint
- ✅ `src/api/external/auth/authApi.js` - Web3 authentication

### 2. **Wallet Connection as Identity Bridge**

**Question:** When a user connects their wallet, can the system identify them as an existing user?

**Investigation Results:**

1. **Wallet Address Storage:**
   - ✅ Wallet addresses stored in `wallets` array: `[{ address: "0x...", isPrimary: true, verified: true, addedAt: Date }]`
   - ✅ Addresses normalized to lowercase: `walletData.address.toLowerCase()`
   - ✅ Method `findUserCoreByWalletAddress()` exists (lines 106-111) - queries `{ 'wallets.address': walletAddress }`
   - ✅ Wallet address IS indexed and searchable

2. **Current Lookup Behavior:**
   - ❌ `find-or-create` endpoint does NOT check wallet addresses
   - ❌ Only checks `platformIdentities.{platform}` for existing user
   - ✅ `find-or-create-by-wallet` endpoint exists but creates users WITHOUT platform identities
   - ✅ When adding wallet via `addWallet()`, system detects if wallet exists on another user

3. **Current Conflict Handling:**
   - When User A (Telegram, masterAccountId: ABC123) has wallet `0x123...`
   - When User B (Discord, masterAccountId: XYZ789) tries to add same wallet `0x123...`
   - **Current behavior:** `addWallet()` throws error "Wallet address already exists" (line 245)
   - **GAP:** No merging or platform linking occurs

4. **Expected vs Actual Flow:**
   ```
   EXPECTED:
   1. User connects wallet on Telegram → wallet stored with masterAccountId: ABC123
   2. User connects same wallet on Discord → system finds existing wallet → links Discord to ABC123
   
   ACTUAL:
   1. User connects wallet on Telegram → wallet stored with masterAccountId: ABC123 ✅
   2. User uses Discord → creates NEW user masterAccountId: XYZ789 ❌
   3. User tries to connect wallet on Discord → ERROR: "Wallet address already exists" ❌
   4. No platform linking occurs ❌
   ```

### 3. **Platform Linking Strategy**

**Question:** Should we require wallet connection before allowing platform usage, or support multiple linking methods?

**Recommendation: Option B - Progressive Linking (RECOMMENDED)**

**Rationale:**
- Current system already allows platform usage without wallet (low friction)
- Wallet connection is optional but encouraged for advanced features
- Matches existing user experience patterns
- Can merge accounts when wallet is connected without breaking existing flows

**Implementation Strategy:**

**Phase 1: Wallet-Based Linking (Immediate)**
- When wallet is connected, check if wallet exists on another user
- If found, offer to merge/link platforms instead of error
- Link new platform to existing `masterAccountId`
- Preserve all user data (points, generations, settings)

**Phase 1b: Approval-Based Linking (NEW - User Requested)**
- User on Platform A (e.g., Telegram) can request to link to account by providing wallet address
- Instead of magic amount verification, user opts for approval flow
- System finds Platform B user (e.g., Discord) by wallet address
- Sends approval request message to Platform B user
- Platform B user approves/rejects via inline buttons
- If approved, link Platform A to Platform B's `masterAccountId`
- Notify both users of successful linking

**Phase 2: Enhanced find-or-create (Future)**
- Optionally accept `walletAddress` in `find-or-create` request
- If provided, check wallet first before platform lookup
- Link platform to wallet's existing user if found

**Option A: Wallet-Required Approach**
- ❌ Too much friction for new users
- ❌ Breaks existing user flows
- ❌ Not recommended

**Option C: Multi-Factor Identity**
- ⚠️ More complex, can be added later
- ⚠️ Email/phone verification requires additional infrastructure
- ✅ Can be implemented as Phase 3 enhancement

**Option D: Approval-Based Linking (NEW)**
- ✅ No wallet connection required (lower friction)
- ✅ User-initiated linking request
- ✅ Cross-platform approval flow
- ✅ More user-friendly than magic amount
- ✅ Can be combined with wallet-based linking
- ⚠️ Requires request storage and expiration
- ⚠️ Requires notification system for cross-platform messaging

### 4. **Account Merging Implementation**

**Question:** How should account merging work technically?

**Investigation Results:**

1. **Existing Merging Logic:**
   - ❌ No account merging logic currently exists
   - ✅ `addPlatformIdentity()` method exists but not used in merge scenarios
   - ✅ Database supports multiple platforms in `platformIdentities` object

2. **Data Consolidation Needs:**
   - ✅ Points balance: Stored in `creditLedger` collection, keyed by `masterAccountId`
   - ✅ Generation history: Stored in `generationOutputs` collection, keyed by `masterAccountId`
   - ✅ Settings/preferences: Stored in `userPreferences` collection, keyed by `masterAccountId`
   - ✅ Collections/models: Need to verify storage location
   - **Key Insight:** Most data is already keyed by `masterAccountId`, so merging platforms is simpler than merging accounts

3. **Recommended Approach: Platform Linking (Not Full Merge)**
   - **Preferred:** Link platforms to existing `masterAccountId` rather than merging accounts
   - **Why:** Most data already keyed by `masterAccountId`, so linking platforms preserves all data
   - **When:** When wallet conflict detected, link new platform to wallet's existing user
   - **Result:** Single `masterAccountId` with multiple platforms in `platformIdentities`

4. **Technical Implementation:**
   ```javascript
   // Pseudo-code for wallet conflict resolution
   if (walletExistsOnAnotherUser) {
     const existingUser = await findUserByWallet(walletAddress);
     // Link platform to existing user
     await addPlatformIdentity(existingUser._id, newPlatform, newPlatformId);
     // Transfer wallet to existing user (if not already there)
     // Delete or mark old user account as merged
     return existingUser;
   }
   ```

5. **Conflict Handling:**
   - Settings/preferences: Merge with platform-specific overrides
   - Points balance: Already unified (single `masterAccountId`)
   - Generation history: Already unified
   - **Edge Case:** What if user has different preferences on each platform?
     - Solution: Use platform-specific preference keys: `preferences.{platform}.{key}`

6. **Technical Considerations:**
   - ✅ Atomicity: Use MongoDB transactions for multi-step operations
   - ✅ Concurrent merges: Use optimistic locking or database-level locks
   - ✅ Rollback: Transaction rollback on failure
   - ✅ Audit trail: Log merge events in `userEvents` collection
   - ✅ Notification: Send message to user on both platforms about merge

### 5. **User Experience Flow**

**Question:** What should the user experience be for cross-platform users?

**Recommended UX Flow:**

**Scenario 1: New Platform User, No Wallet Yet**
```
1. User uses Discord for first time
2. System creates account via find-or-create (normal flow)
3. User can use bot normally
4. When user tries advanced feature requiring wallet:
   - Prompt: "Connect wallet to unlock advanced features"
   - If wallet already exists on another platform → auto-link platforms
   - Show: "Your Telegram account has been linked!"
```

**Scenario 2: Wallet Connection Detects Existing Account**
```
1. User on Discord tries to connect wallet
2. System detects wallet exists on Telegram account
3. Show confirmation prompt:
   "This wallet is already connected to your Telegram account.
    Link your Discord account to that account? [Yes] [No]"
4. If Yes:
   - Link Discord platform to existing masterAccountId
   - Show: "Accounts linked! Your balance and history are now shared."
5. If No:
   - Show: "Wallet connection cancelled. You can link accounts later."
```

**Scenario 3: Post-Link Experience**
```
1. User sees unified balance/stats across platforms
2. Platform-specific preferences maintained separately
3. User can see linked platforms in settings
4. User can unlink platforms (with confirmation)
```

**Implementation Notes:**
- Use existing notification system to inform user on both platforms
- Store merge/link events in `userEvents` for audit trail
- Provide `/wallet` command to show linked platforms

### 6. **API Endpoint Analysis**

**Question:** What endpoints exist or need to be created for account management?

**Investigation Results:**

**Existing Endpoints:**
- ✅ `POST /internal/v1/data/users/find-or-create`
  - Current: Only checks `platformIdentities.{platform}`
  - Enhancement needed: Optionally check wallet address
  - Location: `src/api/internal/users/userCoreApi.js:47`
  
- ✅ `POST /internal/v1/data/auth/find-or-create-by-wallet`
  - Current: Creates user with wallet, sets `lastSeenPlatform: 'web'`
  - Gap: Doesn't link platform identities
  - Location: `src/api/internal/auth/authApi.js:71`

- ✅ `PUT /internal/v1/data/users/:masterAccountId/wallets/:address`
  - Current: Updates wallet properties (isPrimary, verified)
  - Location: Wallet API (mounted at `/:masterAccountId/wallets`)

- ✅ `GET /internal/v1/data/users/:masterAccountId`
  - Returns full user document including `platformIdentities`
  - Can be used to check linked platforms

**Missing Endpoints (Need to Create):**
- ❌ `GET /internal/v1/data/users/:masterAccountId/platforms`
  - **Status:** Does NOT exist
  - **Purpose:** List all linked platforms for a user
  - **Implementation:** Extract `platformIdentities` from user document

- ❌ `POST /internal/v1/data/users/:masterAccountId/link-platform`
  - **Status:** Does NOT exist
  - **Purpose:** Link a new platform to existing user
  - **Implementation:** Use `addPlatformIdentity()` method

- ❌ `POST /internal/v1/data/users/link-by-wallet`
  - **Status:** Does NOT exist (RECOMMENDED)
  - **Purpose:** Link platform when wallet conflict detected
  - **Body:** `{ platform, platformId, walletAddress }`
  - **Logic:** Find user by wallet, link platform, return user

- ❌ `POST /internal/v1/data/users/request-platform-link`
  - **Status:** Does NOT exist (NEW - User Requested)
  - **Purpose:** Request to link platform via wallet address (approval flow)
  - **Body:** `{ requestingPlatform, requestingPlatformId, walletAddress, linkMethod: 'approval' }`
  - **Logic:** Find user by wallet, create link request, send approval message to target platform
  - **Returns:** `{ requestId, status: 'pending', expiresAt }`

- ❌ `POST /internal/v1/data/users/link-requests/:requestId/approve`
  - **Status:** Does NOT exist (NEW - User Requested)
  - **Purpose:** Approve a platform linking request
  - **Body:** `{ masterAccountId }` (approver's account)
  - **Logic:** Verify request is valid, link platforms, notify both users

- ❌ `POST /internal/v1/data/users/link-requests/:requestId/reject`
  - **Status:** Does NOT exist (NEW - User Requested)
  - **Purpose:** Reject a platform linking request
  - **Body:** `{ masterAccountId }` (rejector's account)
  - **Logic:** Mark request as rejected, notify requester

- ❌ `DELETE /internal/v1/data/users/:masterAccountId/platforms/:platform`
  - **Status:** Does NOT exist
  - **Purpose:** Unlink a platform (with safeguards)

### 7. **Database Schema Review**

**Question:** How is user/platform data structured in the database?

**Investigation Results:**

**User Document Structure (`userCore` collection):**
```javascript
{
  _id: ObjectId,                    // masterAccountId
  platformIdentities: {            // ✅ Platform linking storage
    telegram: "12345",
    discord: "67890",
    web: "uuid-or-jwt-sub"
  },
  wallets: [                        // ✅ Wallet storage
    {
      address: "0x...",             // lowercase normalized
      isPrimary: true,
      verified: true,
      addedAt: Date
    }
  ],
  apiKeys: [...],
  awards: [...],
  profile: {...},
  status: "active",
  userCreationTimestamp: Date,
  lastLoginTimestamp: Date,
  lastSeenPlatform: "telegram",
  updatedAt: Date
}
```

**Key Findings:**
- ✅ Platform linking: Stored as object `platformIdentities.{platform}`
- ✅ Wallet storage: Array `wallets[]` with address, isPrimary, verified
- ✅ Wallet indexing: Query `{ 'wallets.address': address }` works (line 110)
- ✅ No separate platform collection needed
- ✅ No junction table needed
- ✅ Schema already supports multiple platforms per user

**Indexes Needed:**
- ✅ `platformIdentities.{platform}` - Already queryable
- ✅ `wallets.address` - Already queryable (verify index exists)
- ⚠️ Consider compound index: `{ 'wallets.address': 1, 'platformIdentities': 1 }`

**Migration Needs:**
- ✅ No schema changes required for basic platform linking
- ⚠️ May need migration script for existing users with wallets but no platform identities
- ⚠️ Consider adding `mergedFrom` field for audit trail if full account merging is implemented

## Implementation Recommendations

### Phase 1: Core Platform Linking (IMMEDIATE PRIORITY)
1. **Enhance Wallet Connection Flow**
   - Modify `addWallet()` in `userCoreDb.js` to detect conflicts
   - When wallet exists on another user, offer platform linking instead of error
   - Create `linkPlatformByWallet()` method
   - Update wallet API endpoints to support linking

2. **Create Platform Linking Endpoint**
   - `POST /internal/v1/data/users/link-by-wallet`
   - Accepts: `{ platform, platformId, walletAddress }`
   - Finds user by wallet, links platform, returns user
   - Handles edge cases (wallet not found, platform already linked)

3. **Update Wallet Manager Components**
   - Telegram: `src/platforms/telegram/components/walletManager.js`
   - Discord: Create similar component if needed
   - Show linking confirmation when conflict detected
   - Notify user on both platforms after linking

### Phase 1b: Approval-Based Linking (NEW - User Requested)
1. **Create Link Request Storage**
   - New collection: `platformLinkRequests` (or add to existing collection)
   - Store: `{ requestId, requestingPlatform, requestingPlatformId, targetWalletAddress, targetMasterAccountId, status, createdAt, expiresAt }`
   - Expiration: 24-48 hours for security

2. **Create Link Request Endpoint**
   - `POST /internal/v1/data/users/request-platform-link`
   - Accepts: `{ requestingPlatform, requestingPlatformId, walletAddress, linkMethod: 'approval' }`
   - Finds user by wallet address
   - Creates pending link request
   - Sends approval message to target platform user
   - Returns request details

3. **Create Approval/Rejection Endpoints**
   - `POST /internal/v1/data/users/link-requests/:requestId/approve`
   - `POST /internal/v1/data/users/link-requests/:requestId/reject`
   - Verify request is valid and not expired
   - Link platforms on approval
   - Notify both users of result

4. **Update Platform Components**
   - Add `/link` command to Telegram/Discord
   - Show approval/rejection buttons in messages
   - Handle callback queries for approval/rejection
   - Display link request status

### Phase 2: Enhanced find-or-create (FUTURE ENHANCEMENT)
1. **Enhance `find-or-create` Endpoint**
   - Add optional `walletAddress` parameter
   - If provided, check wallet first before platform lookup
   - If wallet found, link platform to existing user
   - Maintain backward compatibility (wallet optional)

2. **Platform Management Endpoints**
   - `GET /internal/v1/data/users/:masterAccountId/platforms` - List linked platforms
   - `DELETE /internal/v1/data/users/:masterAccountId/platforms/:platform` - Unlink platform
   - Add safeguards (e.g., require at least one platform, require wallet if unlinking last platform)

3. **Audit & Logging**
   - Log platform linking events in `userEvents` collection
   - Track merge/link history for debugging
   - Add admin endpoint to view link history

### Phase 3: User Experience Enhancements
1. **First-Time User Flow**
   - Add optional prompt: "Do you have an account on another platform?"
   - Guide users to connect wallet for cross-platform linking
   - Show unified account status in `/wallet` command

2. **Cross-Platform Features**
   - Show unified balance/stats across platforms
   - Platform-specific preferences (already supported)
   - Display linked platforms in user profile/settings
   - Add `/platforms` command to show linked platforms

3. **Notifications**
   - Notify user on both platforms when accounts are linked
   - Show confirmation messages with account details
   - Provide unlink option with clear warnings

## Testing Scenarios

### Scenario 1: New User, No Wallet (Current Flow Works)
```
1. User uses Discord → creates account ABC123 ✅
2. User connects wallet → wallet stored with ABC123 ✅
3. User uses Telegram → creates NEW account XYZ789 ❌
   EXPECTED: Should prompt to link via wallet
   ACTUAL: Creates separate account
```

### Scenario 2: Existing User, New Platform (NEEDS FIX)
```
1. User exists on Telegram with wallet → ABC123 ✅
2. User uses Discord → creates NEW account XYZ789 ❌
3. User tries to connect wallet on Discord → ERROR ❌
   EXPECTED: Should detect wallet → link Discord to ABC123
   ACTUAL: Error "Wallet address already exists"
```

### Scenario 3: Wallet Conflict Resolution (IMPLEMENTATION NEEDED)
```
1. User A on Telegram → wallet 0x123 → ABC123 ✅
2. User B on Discord (no wallet) → XYZ789 ✅
3. User B tries to connect wallet 0x123 → CONFLICT DETECTED
   EXPECTED: 
   - Detect wallet exists on ABC123
   - Prompt: "Link Discord to your Telegram account?"
   - If Yes: Link platform, merge accounts
   - If No: Cancel wallet connection
   ACTUAL: Error thrown, no linking option
```

### Scenario 4: Wallet Change (Edge Case)
```
1. User has account ABC123 with wallet 0x123 ✅
2. User removes wallet 0x123 ✅
3. User adds new wallet 0x456 ✅
4. Another user has wallet 0x456 → conflict detected ✅
   EXPECTED: Same conflict resolution as Scenario 3
   ACTUAL: Error thrown
```

### Scenario 5: Multiple Platforms, Same Wallet (Target State)
```
1. User connects wallet 0x123 on Telegram → ABC123 ✅
2. User connects same wallet on Discord → links to ABC123 ✅
3. User connects same wallet on Web → links to ABC123 ✅
4. Result: Single masterAccountId with 3 platforms ✅
5. All data unified (points, generations, etc.) ✅
```

### Scenario 6: Approval-Based Linking (NEW - User Requested)
```
1. User on Telegram (no wallet) → masterAccountId: ABC123 ✅
2. User on Discord (has wallet 0x123) → masterAccountId: XYZ789 ✅
3. Telegram user runs `/link 0x123` → chooses "Request Approval" ✅
4. System finds Discord user by wallet → creates link request ✅
5. Discord user receives message:
   "Telegram user @username wants to link accounts.
    Wallet: 0x123... [Approve] [Reject]" ✅
6. Discord user clicks [Approve] ✅
7. System links Telegram platform to Discord's masterAccountId (XYZ789) ✅
8. Both users notified: "Accounts linked successfully!" ✅
9. Result: Single masterAccountId (XYZ789) with 2 platforms ✅
```

### Scenario 7: Approval Request Expiration
```
1. Telegram user requests link to Discord account ✅
2. Discord user doesn't respond within 48 hours ✅
3. Request expires automatically ✅
4. Telegram user notified: "Link request expired. Please try again." ✅
5. Discord user can still manually approve if they see the message ✅
```

## Success Criteria

- [ ] Users can link accounts across platforms via wallet
- [ ] **NEW:** Users can request platform linking via approval flow (no wallet connection required)
- [ ] **NEW:** Cross-platform approval/rejection flow works seamlessly
- [ ] **NEW:** Link requests expire after 48 hours with proper notifications
- [ ] No duplicate accounts created for same wallet
- [ ] Platform linking preserves all user data (points, generations, settings)
- [ ] Clear user experience for linking (confirmation prompts, notifications)
- [ ] System handles edge cases (conflicts, errors, concurrent requests, expired requests)
- [ ] Backward compatible with existing users
- [ ] Audit trail for platform linking events (including approval-based links)
- [ ] Users can view linked platforms via API/commands
- [ ] Users can view pending link requests (sent and received)

## Implementation Priority

**HIGH PRIORITY (Immediate):**
1. ✅ Platform linking when wallet conflict detected
2. ✅ Create `link-by-wallet` endpoint
3. ✅ Update wallet connection flow to offer linking instead of error
4. ✅ **NEW:** Approval-based linking system (user requested)
5. ✅ **NEW:** Link request storage and management
6. ✅ **NEW:** Cross-platform approval/rejection flow

**MEDIUM PRIORITY (Next Sprint):**
1. ⚠️ Enhanced `find-or-create` with optional wallet lookup
2. ⚠️ Platform management endpoints (list, unlink)
3. ⚠️ User notifications for platform linking

**LOW PRIORITY (Future):**
1. ⚠️ Multi-factor identity linking (email, phone)
2. ⚠️ Manual account linking codes
3. ⚠️ Admin tools for account merging

## Deliverables

1. **Investigation Report**
   - Current system analysis
   - Gap analysis
   - Recommended solution

2. **Technical Design Document**
   - API specifications
   - Database schema changes
   - Algorithm design
   - Error handling

3. **Implementation Plan**
   - Phased approach
   - Testing strategy
   - Migration plan

4. **User Experience Design**
   - Flow diagrams
   - UI/UX mockups
   - Error messages

---

**Priority:** HIGH - This affects user experience and data integrity across platforms.

**Estimated Investigation Time:** 2-4 hours

**Next Steps:** 
1. ✅ Review current wallet connection implementation
2. ✅ Analyze `/find-or-create` endpoint
3. ✅ Design account linking strategy
4. ✅ Create implementation plan
5. **IMPLEMENT:** Platform linking when wallet conflict detected
6. **IMPLEMENT:** `link-by-wallet` endpoint
7. **TEST:** All scenarios above
8. **DEPLOY:** Phase 1 implementation

---

## Detailed Implementation Plan

### Step 1: Create Platform Linking Method
**File:** `src/core/services/db/userCoreDb.js`
**Method:** `linkPlatformByWallet(walletAddress, platformName, platformId)`
**Logic:**
1. Find user by wallet address
2. If found, add platform identity
3. Return user document
4. If not found, throw error

### Step 2: Create Link-by-Wallet Endpoint
**File:** `src/api/internal/users/userCoreApi.js`
**Endpoint:** `POST /internal/v1/data/users/link-by-wallet`
**Body:** `{ platform, platformId, walletAddress }`
**Logic:**
1. Normalize wallet address
2. Find user by wallet
3. If found, link platform
4. Return user with updated platformIdentities
5. Handle errors (wallet not found, platform already linked)

### Step 3: Update Wallet Connection Flow
**File:** `src/core/services/db/userCoreDb.js` - `addWallet()` method
**Change:** When wallet conflict detected, return conflict info instead of throwing error
**New Flow:**
1. Check if wallet exists on another user
2. If conflict: Return `{ conflict: true, existingUserId, existingPlatforms }`
3. If no conflict: Add wallet normally
4. Caller handles conflict (offer linking)

### Step 4: Update Wallet API
**File:** Wallet API endpoints (mounted at `/:masterAccountId/wallets`)
**Change:** Handle conflict response from `addWallet()`
**New Flow:**
1. Call `addWallet()`
2. If conflict detected:
   - Call `link-by-wallet` endpoint
   - Link platform to existing user
   - Return success with linking info
3. If no conflict: Add wallet normally

### Step 5: Update Platform Components
**Files:**
- `src/platforms/telegram/components/walletManager.js`
- Discord wallet manager (if exists)
**Change:** Show linking confirmation when conflict detected
**UX:**
- "This wallet is connected to another account. Link this platform? [Yes] [No]"
- If Yes: Call link-by-wallet endpoint
- Show success message with linked platforms

---

## Approval-Based Linking Implementation Plan (NEW)

### Step 1: Create Link Request Database Model
**File:** `src/core/services/db/platformLinkRequestsDb.js` (new file)
**Collection:** `platformLinkRequests`
**Schema:**
```javascript
{
  _id: ObjectId,
  requestId: String,                    // Unique request ID
  requestingPlatform: String,           // 'telegram', 'discord', etc.
  requestingPlatformId: String,          // Platform-specific user ID
  requestingMasterAccountId: ObjectId,  // Requester's masterAccountId
  targetWalletAddress: String,           // Wallet address to link to
  targetMasterAccountId: ObjectId,       // Target user's masterAccountId
  status: String,                        // 'pending', 'approved', 'rejected', 'expired'
  createdAt: Date,
  expiresAt: Date,                      // 48 hours from creation
  approvedAt: Date,                      // If approved
  rejectedAt: Date,                      // If rejected
  rejectionReason: String                // Optional
}
```

### Step 2: Create Link Request API Endpoints
**File:** `src/api/internal/users/userCoreApi.js`
**Endpoints:**

**POST /internal/v1/data/users/request-platform-link**
- Body: `{ requestingPlatform, requestingPlatformId, walletAddress, linkMethod: 'approval' }`
- Logic:
  1. Find or create requesting user
  2. Normalize wallet address
  3. Find user by wallet address
  4. If not found: Return error "No account found with this wallet"
  5. If found: Check if platform already linked
  6. Create link request document
  7. Send approval message to target platform user
  8. Return request details

**POST /internal/v1/data/users/link-requests/:requestId/approve**
- Body: `{ masterAccountId }` (approver's account)
- Logic:
  1. Find link request by requestId
  2. Verify request is pending and not expired
  3. Verify masterAccountId matches target user
  4. Link platform using `addPlatformIdentity()`
  5. Update request status to 'approved'
  6. Notify both users of successful linking
  7. Return success

**POST /internal/v1/data/users/link-requests/:requestId/reject**
- Body: `{ masterAccountId, reason? }` (rejector's account)
- Logic:
  1. Find link request by requestId
  2. Verify request is pending and not expired
  3. Verify masterAccountId matches target user
  4. Update request status to 'rejected'
  5. Notify requester of rejection
  6. Return success

**GET /internal/v1/data/users/:masterAccountId/link-requests**
- Query params: `?status=pending` (optional filter)
- Returns: List of link requests for user (both sent and received)

### Step 3: Create Link Command Handler
**File:** `src/platforms/telegram/components/linkManager.js` (new file)
**Command:** `/link <walletAddress>`
**Flow:**
1. User runs `/link 0x123...`
2. Show options:
   - "Link via Magic Amount" (existing flow)
   - "Request Approval" (new flow)
3. If "Request Approval":
   - Call `request-platform-link` endpoint
   - Show: "Link request sent! Waiting for approval..."
   - Show request status

### Step 4: Create Approval Message Handler
**File:** `src/platforms/telegram/components/linkManager.js`
**File:** `src/platforms/discord/components/linkManager.js` (new file)
**Flow:**
1. When link request created, send message to target platform:
   ```
   "🔗 Account Link Request
   
   User @username on Telegram wants to link accounts.
   Wallet: 0x123...
   
   This will merge your accounts and share:
   - Points balance
   - Generation history
   - Settings (platform-specific)
   
   [Approve] [Reject]"
   ```
2. Handle callback queries:
   - `link:approve:${requestId}` → Call approve endpoint
   - `link:reject:${requestId}` → Call reject endpoint
3. Show confirmation messages

### Step 5: Add Request Expiration Job
**File:** `src/core/services/linkRequestExpirationService.js` (new file)
**Logic:**
- Periodic job (every hour) to check for expired requests
- Update status to 'expired' for requests past `expiresAt`
- Notify requester of expiration
- Clean up old requests (optional: archive after 30 days)

### Step 6: Update Notification System
**Files:**
- `src/core/services/notificationDispatcher.js`
- Platform-specific notifiers
**Enhancement:**
- Add support for link request notifications
- Cross-platform message sending
- Button/callback support for approval/rejection

### Step 7: Add Link Status Command
**Command:** `/link-status` or `/link-requests`
**Shows:**
- Pending link requests (sent and received)
- Recent link history
- Linked platforms

---

## User Experience Flow: Approval-Based Linking

### Telegram User Initiates Link Request
```
User: /link 0x1234567890abcdef1234567890abcdef12345678

Bot: "How would you like to verify account ownership?"
     [Magic Amount] [Request Approval]

User: [Request Approval]

Bot: "Searching for account with wallet 0x1234...5678..."
     "Found Discord account! Sending link request..."
     "✅ Link request sent! The Discord user will receive an approval message."
     "Request expires in 48 hours."
```

### Discord User Receives Approval Request
```
Bot: "🔗 Account Link Request
     
     Telegram user @username wants to link accounts.
     Wallet: 0x1234...5678
     
     This will merge your accounts and share:
     • Points balance
     • Generation history  
     • Settings (platform-specific)
     
     [Approve] [Reject]"

User: [Approve]

Bot: "✅ Accounts linked successfully!
     Your Telegram account is now linked.
     Your balance and history are now shared across platforms."
```

### Both Users Notified
```
Telegram User:
Bot: "✅ Your link request was approved!
     Your Discord account is now linked.
     Your balance and history are now shared."

Discord User:
Bot: "✅ Accounts linked successfully!
     Your Telegram account is now linked."
```

### Request Expiration
```
Telegram User (after 48 hours):
Bot: "⏰ Your link request to Discord account has expired.
     Please try again with /link <walletAddress>"
```

