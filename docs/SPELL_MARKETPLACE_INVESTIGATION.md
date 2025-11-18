# Spell Marketplace Discovery & Public/Private Sharing - Investigation Report

**Date:** 2024  
**Status:** Investigation Complete  
**Author:** AI Assistant

## Executive Summary

This investigation reveals that **public spell discovery and casting via `/cast` command is broken** due to a critical gap in the spell lookup logic. While the infrastructure for public spells exists (database fields, API endpoints, frontend UI), the core casting service (`SpellsService.castSpell()`) does not search for public spells when resolving spell slugs.

### Key Findings

1. **CRITICAL:** `/cast` command cannot find public spells - lookup only searches user-owned spells
2. **INCOMPLETE:** Marketplace discovery UI exists but lacks search/filter capabilities
3. **PARTIAL:** Public spell sharing mechanism exists but has inconsistencies
4. **WORKING:** Permission system correctly handles public spells once found

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Code Flow Diagrams](#code-flow-diagrams)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Issues List](#issues-list)
5. [Recommendations](#recommendations)

---

## Current State Analysis

### What EXISTS and Works

#### Database Layer ✅

**File:** `src/core/services/db/spellsDb.js`

- `findPublicSpells(filter, options)` - Line 169-177
  - Finds spells with `visibility: 'public'` OR `isPublic: true`
  - Filters by moderation status (approved or no moderation)
  - Works correctly

- `findByPublicSlug(publicSlug)` - Line 131-135
  - Searches by `publicSlug`, `slug`, or `name` fields
  - Used by internal API endpoint `/internal/v1/data/spells/public/:publicSlug`
  - Works correctly

- `findBySlug(slug)` - Line 119-121
  - Simple query: `{ slug }`
  - **Does NOT filter by ownership** - searches globally
  - **BUT:** Only finds spells where `slug` matches exactly
  - **Problem:** Public spells may use `publicSlug` instead of `slug`

- `findSpellsByOwnerAndPartialSlug(userId, partialSlug)` - Line 153-161
  - Only searches spells owned by the user
  - Used for partial/fuzzy matching
  - **Problem:** Never searches public spells

#### API Endpoints ✅

**File:** `src/api/internal/spells/spellsApi.js`

- `GET /internal/v1/data/spells/public` - Line 25-33
  - Returns all public spells
  - Works correctly

- `GET /internal/v1/data/spells/public/:publicSlug` - Line 38-48
  - Returns single public spell by slug
  - Uses `findByPublicSlug()` correctly
  - Works correctly

- `GET /internal/v1/data/spells/:spellIdentifier` - Line 218-247
  - Tries `findBySlug()` first, then `findByPublicSlug()` as fallback
  - **This is the correct pattern!** But `SpellsService` doesn't use it

**File:** `src/api/external/spells/spellsApi.js`

- `GET /api/v1/spells/marketplace` - Line 15-38
  - Proxies to internal API
  - Returns formatted public spells list
  - Works correctly

- `GET /api/v1/spells/:slug` - Line 108-119
  - Proxies to `/internal/v1/data/spells/public/:slug`
  - Used by public spell page (`/spells/:slug`)
  - Works correctly

#### Frontend ✅

**File:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`

- Marketplace tab exists (line 194)
- Calls `/api/v1/spells/marketplace` (line 174)
- Displays public spells list (line 370-379)
- Public link generation exists (line 515)
- **Missing:** Search, filtering, spell details view, usage stats

#### Permission System ✅

**File:** `src/core/services/SpellsService.js` - `checkPermissions()` method (line 94-106)

```94:106:src/core/services/SpellsService.js
async checkPermissions(spell, masterAccountId) {
    if (spell.visibility === 'public') {
        return true;
    }
    if (spell.ownedBy.toString() === masterAccountId.toString()) {
        return true;
    }
    if (spell.permissionType === 'licensed') {
        const permission = await this.spellPermissionsDb.hasAccess(masterAccountId, spell._id);
        return !!permission;
    }
    return false;
}
```

- Correctly allows public spells
- Correctly checks ownership
- Correctly handles licensed spells
- **Works correctly once spell is found**

### What's BROKEN/INCOMPLETE

#### 1. CRITICAL: `/cast` Command Cannot Find Public Spells ❌

**File:** `src/core/services/SpellsService.js` - `castSpell()` method (line 16-92)

**The Problem:**

The spell lookup sequence in `castSpell()` is:

1. `findBySlug(slug)` - Line 20
2. `findByName(slug)` - Line 24 (fallback)
3. `findById(slug)` - Line 32 (if ObjectId format)
4. `findSpellsByOwnerAndPartialSlug(userId, slug)` - Line 41 (user-owned only)

**Missing:** No call to `findByPublicSlug()` or `findPublicSpells()`

**Why This Fails:**

- If a public spell has `publicSlug` different from `slug`, `findBySlug()` won't find it
- The partial match fallback (line 39-51) only searches user-owned spells
- Public spells are never searched

**Example Scenario:**

1. User creates spell "My Spell" → `slug: "my-spell-abc123"`
2. User makes it public → `publicSlug: "my-spell-abc123"` (same as slug)
3. Another user tries `/cast my-spell-abc123`
4. `findBySlug("my-spell-abc123")` finds it IF slug matches
5. BUT if `publicSlug` differs from `slug`, it fails
6. Partial match only searches user's own spells, so it fails

**Evidence:**

```20:56:src/core/services/SpellsService.js
// 1. Find the spell
let spell = await this.db.spells.findBySlug(slug);

// If not found try direct name match (names are unique & act as slug)
if(!spell){
    spell = await this.db.spells.findByName(slug);
    if(spell){
        this.logger.info(`[SpellsService] Found spell by unique name fallback: ${spell.name}`);
    }
}

// If not found try by ObjectId (support legacy callers sending _id)
if (!spell && require('mongodb').ObjectId.isValid(slug)) {
    spell = await this.db.spells.findById(slug);
    if (spell) {
        this.logger.info(`[SpellsService] Found spell by ObjectId fallback: ${spell.slug}`);
    }
}

// If still not found, try a partial match for spells owned by the user
if (!spell) {
    this.logger.info(`[SpellsService] Exact slug "${slug}" not found. Trying partial match for user ${context.masterAccountId}.`);
    const possibleSpells = await this.db.spells.findSpellsByOwnerAndPartialSlug(context.masterAccountId, slug);
    
    if (possibleSpells.length === 1) {
        spell = possibleSpells[0];
        this.logger.info(`[SpellsService] Found unique partial match: "${spell.slug}"`);
    } else if (possibleSpells.length > 1) {
        this.logger.warn(`[SpellsService] Ambiguous partial slug "${slug}" for user ${context.masterAccountId} matched ${possibleSpells.length} spells.`);
        const spellNames = possibleSpells.map(s => `• ${s.name} (\`${s.slug}\`)`).join('\\n');
        throw new Error(`Multiple spells found starting with "${slug}". Please be more specific:\n${spellNames}`);
    }
}

if (!spell) {
    this.logger.warn(`[SpellsService] Spell with slug "${slug}" not found for user ${context.masterAccountId}.`);
    throw new Error(`Spell "${slug}" not found.`);
}
```

**Notice:** No call to `findByPublicSlug()` or search in public spells!

#### 2. INCOMPLETE: Marketplace Discovery UI ❌

**File:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`

**What's Missing:**

- No search functionality
- No filtering by tags (API supports it, UI doesn't use it)
- No spell details view (can't preview before casting)
- No usage statistics display
- No popularity/sorting options
- Marketplace spells are displayed but not clickable/interactive

**Current Implementation:**

```370:379:src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js
} else if (view === 'marketplace') {
    if (!marketplaceSpells || marketplaceSpells.length === 0) {
        html += '<div class="empty-message">No public spells found.</div>';
    } else {
        html += '<ul class="spells-list">';
        for (const spell of marketplaceSpells) {
            html += `<li class="spell-item">${spell.name} <span class="spell-desc">${spell.description || ''}</span> <span class="spell-uses">${spell.uses} uses</span></li>`;
        }
        html += '</ul>';
    }
}
```

**Issues:**

- List items are not clickable (no `onclick` handler)
- No way to view spell details
- No way to cast spell from marketplace
- No search input field
- No tag filtering UI

#### 3. INCONSISTENT: Public Slug Handling ⚠️

**File:** `src/core/services/db/spellsDb.js`

**Issue:** `publicSlug` may not always be set correctly

**When Creating Spell:**

```102:108:src/core/services/db/spellsDb.js
visibility: spellData.visibility || (spellData.isPublic ? 'public' : 'private'),
permissionType: spellData.permissionType || (spellData.isPublic ? 'public' : 'private'),
isPublic: !!spellData.isPublic,
publicSlug: spellData.isPublic ? uniqueSlug : undefined,
createdAt: now,
updatedAt: now,
```

- If `isPublic: true`, `publicSlug` is set to `uniqueSlug` (same as `slug`)
- This is correct

**When Updating Spell:**

```191:197:src/core/services/db/spellsDb.js
// If toggling public and publicSlug missing, generate one
if (updateData.isPublic === true && !updateData.publicSlug) {
    const existing = await this.findById(spellId);
    if (existing && !existing.publicSlug) {
        dataToSet.publicSlug = existing.slug;
    }
}
```

- If making spell public, `publicSlug` defaults to `slug` if missing
- This is correct

**Potential Issue:**

- If a spell is created as private, then made public, `publicSlug` will be set to `slug`
- But if `slug` changes (unlikely but possible), `publicSlug` might become stale
- `findByPublicSlug()` searches both `publicSlug` and `slug`, so this should be safe

**Conclusion:** This is mostly fine, but could be more robust.

#### 4. PARTIAL: Public Spell Page ⚠️

**File:** `public/spell.html` and `public/js/spell_execute.js`

**What Works:**

- Page loads spell metadata from `/api/v1/spells/:slug`
- Displays spell name, description, author
- Renders input form for exposed inputs
- Fetches cost quote
- Can execute spell via `/api/v1/spells/cast`

**What's Missing:**

- No error handling for non-existent spells (shows "Spell not found" but no redirect)
- No way to share spell link (no share button)
- No spell preview/details before execution
- No usage statistics

---

## Code Flow Diagrams

### Current `/cast` Command Flow (BROKEN)

```
User types: /cast my-spell-slug
    │
    ▼
spellMenuManager.js:768 (command handler)
    │
    ▼
spellsService.castSpell("my-spell-slug", context)
    │
    ▼
SpellsService.castSpell() - Line 16
    │
    ├─► findBySlug("my-spell-slug") ──┐
    │                                   │
    ├─► findByName("my-spell-slug") ───┤
    │                                   │ Only searches
    ├─► findById("my-spell-slug") ────┤ user-owned
    │                                   │ spells
    └─► findSpellsByOwnerAndPartialSlug(userId, "my-spell-slug") ──┐
                                                                     │
                                                                     ▼
                                                              ❌ Spell not found
                                                              (if public spell)
```

**Missing Step:** Should call `findByPublicSlug()` or search public spells!

### Marketplace Discovery Flow (WORKS but INCOMPLETE)

```
User clicks "Discover Spells" tab
    │
    ▼
SpellsMenuModal.js:214 - fetchMarketplaceSpells()
    │
    ▼
GET /api/v1/spells/marketplace
    │
    ▼
external/spellsApi.js:15 - proxies to internal API
    │
    ▼
GET /internal/v1/data/spells/public
    │
    ▼
internal/spellsApi.js:27 - spellsDb.findPublicSpells()
    │
    ▼
✅ Returns public spells list
    │
    ▼
Frontend displays list (but no interaction possible)
```

**Issue:** List is displayed but spells can't be clicked or cast.

### Public Spell Sharing Flow (PARTIAL)

```
User makes spell public
    │
    ▼
Frontend: SpellsMenuModal.js:515
    │
    ▼
Generates link: /spells/${publicSlug || slug}
    │
    ▼
User shares link
    │
    ▼
Someone visits /spells/my-spell-slug
    │
    ▼
public/spell.html loads
    │
    ▼
spell_execute.js:49 - fetchMetadata()
    │
    ▼
GET /api/v1/spells/:slug
    │
    ▼
external/spellsApi.js:111 - proxies to internal API
    │
    ▼
GET /internal/v1/data/spells/public/:slug
    │
    ▼
internal/spellsApi.js:41 - spellsDb.findByPublicSlug()
    │
    ▼
✅ Spell found and displayed
    │
    ▼
User can execute spell via /api/v1/spells/cast
    │
    ▼
external/spellsApi.js:219 - proxies to internal API
    │
    ▼
POST /internal/v1/data/spells/cast
    │
    ▼
internal/spellsApi.js:70 - spellsService.castSpell()
    │
    ▼
❌ FAILS if spell not found (same issue as /cast command)
```

**Issue:** Public spell page works, but casting from it may fail if lookup doesn't find the spell.

---

## Root Cause Analysis

### Primary Root Cause: Missing Public Spell Lookup in `castSpell()`

**Location:** `src/core/services/SpellsService.js:16-56`

**Root Cause:**

The `castSpell()` method was designed to find user-owned spells only. When public spell functionality was added, the lookup logic was never updated to include public spells.

**Why It Wasn't Caught:**

1. Public spells can be accessed via the web UI (`/spells/:slug` page)
2. The internal API endpoint (`/internal/v1/data/spells/:spellIdentifier`) correctly searches public spells
3. But `SpellsService.castSpell()` is called directly by Telegram `/cast` command, bypassing the API endpoint's lookup logic
4. The API endpoint's lookup pattern (try `findBySlug()`, then `findByPublicSlug()`) was never replicated in `SpellsService`

**Evidence of Correct Pattern:**

The internal API endpoint shows the correct approach:

```218:229:src/api/internal/spells/spellsApi.js
router.get('/:spellIdentifier', async (req, res) => {
    const { spellIdentifier } = req.params;
    try {
      let spell;
      if (ObjectId.isValid(spellIdentifier)) {
        spell = await spellsDb.findById(spellIdentifier);
      } else {
        spell = await spellsDb.findBySlug(spellIdentifier);
        if(!spell){
           spell = await spellsDb.findByPublicSlug(spellIdentifier);
        }
      }
```

**This pattern should be replicated in `SpellsService.castSpell()`!**

### Secondary Issues

1. **Marketplace UI Incomplete:** Frontend displays list but doesn't allow interaction
2. **Inconsistent Slug Handling:** `publicSlug` vs `slug` confusion
3. **No Search/Filter:** Marketplace lacks discovery features

---

## Issues List

### Priority 1: CRITICAL - Must Fix Immediately

#### Issue #1: `/cast` Command Cannot Find Public Spells

**Severity:** CRITICAL  
**Impact:** Public spells cannot be cast via Telegram `/cast` command  
**Location:** `src/core/services/SpellsService.js:16-56`

**Description:**
The `castSpell()` method does not search for public spells. It only searches:
1. By exact `slug` match (global, but may not find public spells if `publicSlug` differs)
2. By `name` match (global)
3. By `_id` if ObjectId format
4. By partial `slug` match (user-owned only)

**Missing:** Search in public spells via `findByPublicSlug()` or `findPublicSpells()`

**Fix Required:**
Add public spell lookup to the spell resolution sequence in `castSpell()`.

**Code Reference:**
```20:56:src/core/services/SpellsService.js
// Current lookup sequence - missing public spell search
```

---

### Priority 2: HIGH - Should Fix Soon

#### Issue #2: Marketplace UI Not Interactive

**Severity:** HIGH  
**Impact:** Users can see public spells but cannot interact with them  
**Location:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js:370-379`

**Description:**
Marketplace spells are displayed as a simple list with no click handlers. Users cannot:
- View spell details
- Cast spell from marketplace
- Search/filter spells
- See usage statistics

**Fix Required:**
- Add click handlers to marketplace spell items
- Implement spell detail view for marketplace spells
- Add search input field
- Add tag filtering UI
- Add "Cast Spell" button in detail view

**Code Reference:**
```370:379:src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js
// Marketplace view - no interaction handlers
```

#### Issue #3: No Search/Filter in Marketplace

**Severity:** HIGH  
**Impact:** Users cannot discover spells efficiently  
**Location:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`

**Description:**
The marketplace API supports tag filtering (`?tag=...`), but the frontend doesn't use it. There's no search functionality.

**Fix Required:**
- Add search input field
- Add tag filter buttons/chips
- Implement search API call with query params
- Add sorting options (popularity, usage count, date)

---

### Priority 3: MEDIUM - Nice to Have

#### Issue #4: Public Spell Page Lacks Features

**Severity:** MEDIUM  
**Impact:** Public spell page is functional but basic  
**Location:** `public/js/spell_execute.js`

**Description:**
The public spell execution page works but lacks:
- Share button
- Usage statistics
- Spell preview/details
- Better error handling

**Fix Required:**
- Add share button with copy-to-clipboard
- Display usage count, rating, tags
- Add spell metadata display
- Improve error messages

#### Issue #5: Inconsistent Slug Field Usage

**Severity:** LOW  
**Impact:** Potential confusion between `slug` and `publicSlug`  
**Location:** `src/core/services/db/spellsDb.js`

**Description:**
The codebase uses both `slug` and `publicSlug` fields. While `findByPublicSlug()` searches both, there's potential for confusion.

**Fix Required:**
- Document when to use `slug` vs `publicSlug`
- Ensure `publicSlug` is always set for public spells
- Consider consolidating to single `slug` field

---

## Recommendations

### Immediate Fixes (Priority 1)

#### Fix #1: Add Public Spell Lookup to `castSpell()`

**File:** `src/core/services/SpellsService.js`

**Change Required:**

Add public spell lookup after the initial `findBySlug()` call, before the partial match fallback.

**Proposed Code:**

```javascript
async castSpell(slug, context, castsDb = null) {
    this.logger.info(`[SpellsService] Attempting to cast spell with slug: "${slug}" for MAID ${context.masterAccountId}`);

    // 1. Find the spell
    let spell = await this.db.spells.findBySlug(slug);

    // If not found try direct name match (names are unique & act as slug)
    if(!spell){
        spell = await this.db.spells.findByName(slug);
        if(spell){
            this.logger.info(`[SpellsService] Found spell by unique name fallback: ${spell.name}`);
        }
    }

    // If not found, try public slug lookup (for public spells)
    if (!spell) {
        spell = await this.db.spells.findByPublicSlug(slug);
        if (spell) {
            this.logger.info(`[SpellsService] Found spell by public slug: ${spell.slug || spell.publicSlug}`);
        }
    }

    // If not found try by ObjectId (support legacy callers sending _id)
    if (!spell && require('mongodb').ObjectId.isValid(slug)) {
        spell = await this.db.spells.findById(slug);
        if (spell) {
            this.logger.info(`[SpellsService] Found spell by ObjectId fallback: ${spell.slug}`);
        }
    }

    // If still not found, try a partial match for spells owned by the user
    if (!spell) {
        this.logger.info(`[SpellsService] Exact slug "${slug}" not found. Trying partial match for user ${context.masterAccountId}.`);
        const possibleSpells = await this.db.spells.findSpellsByOwnerAndPartialSlug(context.masterAccountId, slug);
        
        if (possibleSpells.length === 1) {
            spell = possibleSpells[0];
            this.logger.info(`[SpellsService] Found unique partial match: "${spell.slug}"`);
        } else if (possibleSpells.length > 1) {
            this.logger.warn(`[SpellsService] Ambiguous partial slug "${slug}" for user ${context.masterAccountId} matched ${possibleSpells.length} spells.`);
            const spellNames = possibleSpells.map(s => `• ${s.name} (\`${s.slug}\`)`).join('\\n');
            throw new Error(`Multiple spells found starting with "${slug}". Please be more specific:\n${spellNames}`);
        }
    }
    
    // ... rest of method unchanged
```

**Testing:**

1. Create a public spell
2. Try `/cast <spell-slug>` from Telegram (different user)
3. Verify spell is found and cast successfully
4. Test with `publicSlug` different from `slug` (if possible)

---

### Short-Term Fixes (Priority 2)

#### Fix #2: Make Marketplace Interactive

**File:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`

**Changes Required:**

1. Add click handler to marketplace spell items
2. Create marketplace spell detail view
3. Add "Cast Spell" button

**Proposed Code:**

```javascript
// In renderCurrentView(), update marketplace view:
} else if (view === 'marketplace') {
    if (!marketplaceSpells || marketplaceSpells.length === 0) {
        html += '<div class="empty-message">No public spells found.</div>';
    } else {
        html += '<ul class="spells-list">';
        for (const spell of marketplaceSpells) {
            html += `<li class="spell-item" data-spell-slug="${spell.slug}">
                <div class="spell-info">
                    <span class="spell-name">🪄 ${spell.name}</span>
                    <span class="spell-desc">${spell.description || ''}</span>
                    <span class="spell-uses">${spell.uses || 0} uses</span>
                </div>
                <button class="view-spell-btn" data-spell-slug="${spell.slug}">View</button>
            </li>`;
        }
        html += '</ul>';
    }
}

// Add event handlers in render():
if (this.state.view === 'marketplace') {
    const spellItems = this.modalElement.querySelectorAll('.spell-item');
    spellItems.forEach((item, idx) => {
        item.addEventListener('click', () => {
            const spell = this.state.marketplaceSpells[idx];
            this.setState({ view: 'marketDetail', selectedSpell: spell });
        });
    });
}
```

#### Fix #3: Add Search/Filter to Marketplace

**File:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`

**Changes Required:**

1. Add search input field
2. Add tag filter UI
3. Update `fetchMarketplaceSpells()` to accept query params

**Proposed Code:**

```javascript
async fetchMarketplaceSpells(tag = null) {
    this.setState({ loading: true, error: null });
    try {
        const url = tag ? `/api/v1/spells/marketplace?tag=${encodeURIComponent(tag)}` : '/api/v1/spells/marketplace';
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch marketplace spells');
        const marketplaceSpells = await res.json();
        this.setState({ marketplaceSpells, loading: false });
    } catch (err) {
        this.setState({ error: 'Failed to fetch marketplace spells.', loading: false });
    }
}
```

---

### Long-Term Improvements (Priority 3)

#### Improvement #1: Enhance Public Spell Page

**File:** `public/js/spell_execute.js`

**Add:**
- Share button with copy-to-clipboard
- Usage statistics display
- Spell tags display
- Better error handling

#### Improvement #2: Consolidate Slug Fields

**Consider:**
- Using single `slug` field for all spells
- Removing `publicSlug` field
- Updating all references

**Migration Required:**
- Update existing spells in database
- Update all code references
- Test thoroughly

---

## Testing Strategy

### Test Cases for Fix #1 (Public Spell Lookup)

1. **Test Case 1: Cast Public Spell by Slug**
   - Create public spell with slug "test-spell-123"
   - As different user, run `/cast test-spell-123`
   - **Expected:** Spell found and cast successfully

2. **Test Case 2: Cast Public Spell by PublicSlug**
   - Create public spell where `publicSlug` differs from `slug`
   - As different user, run `/cast <publicSlug>`
   - **Expected:** Spell found and cast successfully

3. **Test Case 3: Cast Own Spell (Regression)**
   - Create private spell
   - As owner, run `/cast <slug>`
   - **Expected:** Spell found and cast successfully (no regression)

4. **Test Case 4: Cast Non-Existent Spell**
   - Run `/cast non-existent-spell`
   - **Expected:** Error message "Spell not found"

5. **Test Case 5: Ambiguous Partial Match**
   - Create two user-owned spells starting with "test"
   - Run `/cast test`
   - **Expected:** Error listing both spells

### Test Cases for Fix #2 (Marketplace UI)

1. **Test Case 1: Click Marketplace Spell**
   - Open marketplace tab
   - Click on a spell
   - **Expected:** Spell detail view opens

2. **Test Case 2: Cast from Marketplace**
   - View marketplace spell detail
   - Click "Cast Spell"
   - **Expected:** Spell is cast successfully

3. **Test Case 3: Search Marketplace**
   - Enter search query
   - **Expected:** Filtered results displayed

---

## Migration Considerations

### Database Migration

**No migration required** for Fix #1 (public spell lookup).

**Potential migration** for slug consolidation (Improvement #2):
- Update all spells to ensure `publicSlug` is set for public spells
- Consider setting `publicSlug = slug` for all existing public spells

### Backward Compatibility

- Fix #1 is backward compatible (adds new lookup, doesn't remove existing)
- Fix #2 is UI-only, no breaking changes
- All fixes maintain existing functionality

---

## Conclusion

The primary issue preventing public spell casting via `/cast` is a **missing public spell lookup** in `SpellsService.castSpell()`. The fix is straightforward: add a call to `findByPublicSlug()` in the lookup sequence.

Secondary issues (marketplace UI, search/filter) are UI improvements that enhance discoverability but don't block core functionality.

**Recommended Action Plan:**

1. **Immediate:** Implement Fix #1 (public spell lookup)
2. **Short-term:** Implement Fix #2 and #3 (marketplace UI improvements)
3. **Long-term:** Consider improvements #1 and #2 (public page enhancements, slug consolidation)

---

## Appendix: Code References

### Key Files

- `src/core/services/SpellsService.js` - Spell casting logic
- `src/core/services/db/spellsDb.js` - Database queries
- `src/core/services/db/spellPermissionsDb.js` - Permission system
- `src/api/external/spells/spellsApi.js` - External API endpoints
- `src/api/internal/spells/spellsApi.js` - Internal API endpoints
- `src/platforms/telegram/components/spellMenuManager.js` - `/cast` command handler
- `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js` - Frontend marketplace UI
- `public/spell.html` - Public spell page template
- `public/js/spell_execute.js` - Public spell page logic

### Key Methods

- `SpellsService.castSpell()` - Main casting method (needs fix)
- `SpellsService.checkPermissions()` - Permission check (works correctly)
- `spellsDb.findBySlug()` - Find by slug (global search)
- `spellsDb.findByPublicSlug()` - Find by public slug (searches slug, publicSlug, name)
- `spellsDb.findPublicSpells()` - Find all public spells
- `spellsDb.findSpellsByOwnerAndPartialSlug()` - Partial match (user-owned only)

---

**End of Investigation Report**

