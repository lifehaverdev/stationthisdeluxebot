# Spell Marketplace Fix Plan

**Date:** 2024  
**Status:** Ready for Implementation  
**Related:** [SPELL_MARKETPLACE_INVESTIGATION.md](./SPELL_MARKETPLACE_INVESTIGATION.md)

## Overview

This document provides a detailed implementation plan to fix the spell marketplace discovery and public/private sharing issues identified in the investigation report.

---

## Fix Priority Summary

| Priority | Issue | Impact | Effort | Status |
|----------|-------|--------|--------|--------|
| P1 | Public spell lookup in `/cast` | CRITICAL | Low | Ready |
| P2 | Marketplace UI interactivity | HIGH | Medium | Ready |
| P2 | Search/filter in marketplace | HIGH | Medium | Ready |
| P3 | Public spell page enhancements | MEDIUM | Low | Optional |
| P3 | Slug field consolidation | LOW | High | Optional |

---

## Fix #1: Add Public Spell Lookup to `castSpell()` (P1 - CRITICAL)

### Problem

The `/cast` command cannot find public spells because `SpellsService.castSpell()` doesn't search public spells.

### Solution

Add a call to `findByPublicSlug()` in the spell lookup sequence, after `findByName()` and before `findById()`.

### Implementation Steps

1. **File:** `src/core/services/SpellsService.js`
2. **Method:** `castSpell()` (line 16-92)
3. **Change:** Insert public spell lookup after name lookup

### Code Changes

**Location:** `src/core/services/SpellsService.js:23-36`

**Before:**

```javascript
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
```

**After:**

```javascript
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
```

### Testing

**Test Script:**

```javascript
// Test Case 1: Cast public spell by slug
// 1. Create public spell: POST /api/v1/spells { name: "Test Spell", isPublic: true }
// 2. Get slug from response
// 3. As different user: /cast <slug>
// Expected: Spell found and cast successfully

// Test Case 2: Cast public spell by publicSlug (if different)
// 1. Create public spell
// 2. Update publicSlug to different value
// 3. As different user: /cast <publicSlug>
// Expected: Spell found and cast successfully

// Test Case 3: Regression - cast own spell
// 1. Create private spell
// 2. As owner: /cast <slug>
// Expected: Spell found and cast successfully (no regression)

// Test Case 4: Non-existent spell
// 1. /cast non-existent-spell-xyz
// Expected: Error "Spell not found"
```

**Manual Testing:**

1. Create a public spell via web UI
2. Note the spell slug
3. Open Telegram bot
4. Run `/cast <slug>` as a different user
5. Verify spell executes successfully

### Rollback Plan

If issues occur, revert the change by removing the `findByPublicSlug()` call. This is a non-breaking change (additive only).

### Estimated Effort

- **Development:** 15 minutes
- **Testing:** 30 minutes
- **Total:** 45 minutes

---

## Fix #2: Make Marketplace Interactive (P2 - HIGH)

### Problem

Marketplace spells are displayed but not clickable. Users cannot view details or cast spells from marketplace.

### Solution

1. Add click handlers to marketplace spell items
2. Create marketplace spell detail view
3. Add "Cast Spell" button in detail view

### Implementation Steps

1. **File:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`
2. **Methods to modify:**
   - `renderCurrentView()` - Add click handlers
   - `renderSpellDetailView()` - Support marketplace spells
   - Add new method: `renderMarketplaceSpellDetailView()`

### Code Changes

**Change 1: Update Marketplace View Rendering**

**Location:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js:370-379`

**Before:**

```javascript
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

**After:**

```javascript
} else if (view === 'marketplace') {
    if (!marketplaceSpells || marketplaceSpells.length === 0) {
        html += '<div class="empty-message">No public spells found.</div>';
    } else {
        html += '<ul class="spells-list">';
        for (const spell of marketplaceSpells) {
            const slug = spell.slug || spell.spellId || spell._id;
            html += `<li class="spell-item marketplace-spell-item" data-spell-slug="${slug}">
                <div class="spell-info">
                    <span class="spell-name">🪄 ${spell.name}</span>
                    <span class="spell-desc">${spell.description || ''}</span>
                    <span class="spell-uses">${spell.uses || 0} uses</span>
                </div>
                <button class="view-spell-btn" data-spell-slug="${slug}">View</button>
            </li>`;
        }
        html += '</ul>';
    }
} else if (view === 'marketDetail' && this.state.selectedSpell) {
    html += this.renderMarketplaceSpellDetailView();
}
```

**Change 2: Add Event Handlers**

**Location:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js:render()` method, after marketplace view rendering

**Add:**

```javascript
// Marketplace spell click handlers
if (this.state.view === 'marketplace') {
    const spellItems = this.modalElement.querySelectorAll('.marketplace-spell-item');
    spellItems.forEach((item, idx) => {
        const viewBtn = item.querySelector('.view-spell-btn');
        if (viewBtn) {
            viewBtn.onclick = (e) => {
                e.stopPropagation();
                const spell = this.state.marketplaceSpells[idx];
                this.setState({ view: 'marketDetail', selectedSpell: spell });
            };
        }
        // Also allow clicking the item itself
        item.addEventListener('click', (e) => {
            if (e.target.closest('.view-spell-btn')) return;
            const spell = this.state.marketplaceSpells[idx];
            this.setState({ view: 'marketDetail', selectedSpell: spell });
        });
    });
}
```

**Change 3: Add Marketplace Spell Detail View**

**Location:** Add new method after `renderSpellDetailView()`

**Add:**

```javascript
renderMarketplaceSpellDetailView() {
    const { selectedSpell } = this.state;
    if (!selectedSpell) return '<div class="error-message">Spell not found.</div>';
    
    const slug = selectedSpell.slug || selectedSpell.spellId || selectedSpell._id;
    
    let stepsHtml = '';
    if (selectedSpell.steps && selectedSpell.steps.length > 0) {
        stepsHtml = `
            <div class="spell-detail-steps">
                <strong>Steps:</strong>
                <ul>
                    ${selectedSpell.steps.map(step => `<li>${step.toolIdentifier || step.toolId || 'Unknown tool'}</li>`).join('')}
                </ul>
            </div>
        `;
    }
    
    return `
        <div class="spell-detail-view marketplace-spell-detail">
            <h2>${selectedSpell.name}</h2>
            <p class="spell-description">${selectedSpell.description || 'No description available.'}</p>
            <div class="spell-meta">
                <span class="spell-uses">${selectedSpell.uses || 0} uses</span>
                ${selectedSpell.tags && selectedSpell.tags.length > 0 ? `<div class="spell-tags">Tags: ${selectedSpell.tags.join(', ')}</div>` : ''}
            </div>
            ${stepsHtml}
            <div class="spell-detail-actions">
                <button class="cast-spell-btn" data-spell-slug="${slug}">Cast Spell</button>
                <button class="back-to-marketplace-btn">Back to Marketplace</button>
            </div>
        </div>
    `;
}
```

**Change 4: Add Event Handlers for Detail View**

**Location:** `render()` method, add after marketplace detail view check

**Add:**

```javascript
// Marketplace detail view actions
if (this.state.view === 'marketDetail' && this.state.selectedSpell) {
    const castBtn = this.modalElement.querySelector('.cast-spell-btn');
    const backBtn = this.modalElement.querySelector('.back-to-marketplace-btn');
    
    if (castBtn) {
        castBtn.onclick = () => {
            const spell = this.state.selectedSpell;
            const slug = spell.slug || spell.spellId || spell._id;
            this.handleCastMarketplaceSpell(slug);
        };
    }
    
    if (backBtn) {
        backBtn.onclick = () => {
            this.setState({ view: 'marketplace', selectedSpell: null });
            this.fetchMarketplaceSpells();
        };
    }
}
```

**Change 5: Add Cast Method**

**Location:** Add new method after `handleAddSpellToCanvas()`

**Add:**

```javascript
async handleCastMarketplaceSpell(slug) {
    if (!slug) return;
    
    this.setState({ loading: true, error: null });
    
    try {
        const csrfRes = await fetch('/api/v1/csrf-token');
        const { csrfToken } = await csrfRes.json();
        
        const res = await fetch('/api/v1/spells/cast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': csrfToken
            },
            credentials: 'include',
            body: JSON.stringify({
                slug,
                context: {
                    parameterOverrides: {},
                    platform: 'web-sandbox'
                }
            })
        });
        
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error?.message || 'Failed to cast spell');
        }
        
        const result = await res.json();
        
        // Close modal and show success message
        this.hide();
        alert(`Spell "${slug}" cast successfully!`);
        
    } catch (err) {
        this.setState({ error: err.message || 'Failed to cast spell.', loading: false });
    }
}
```

**Change 6: Update State Initialization**

**Location:** `constructor()` method, update `view` options

**Change:**

```javascript
this.state = {
    view: 'main', // 'main', 'spellDetail', 'toolSelect', 'paramEdit', 'marketplace', 'marketDetail', 'create'
    // ... rest unchanged
};
```

### Testing

**Test Cases:**

1. **Click Marketplace Spell**
   - Open marketplace tab
   - Click on a spell item
   - **Expected:** Detail view opens

2. **Cast from Marketplace**
   - View marketplace spell detail
   - Click "Cast Spell"
   - **Expected:** Spell executes successfully

3. **Back Button**
   - In marketplace detail view
   - Click "Back to Marketplace"
   - **Expected:** Returns to marketplace list

### Estimated Effort

- **Development:** 2 hours
- **Testing:** 1 hour
- **Total:** 3 hours

---

## Fix #3: Add Search/Filter to Marketplace (P2 - HIGH)

### Problem

Marketplace lacks search and filtering capabilities, making it hard to discover spells.

### Solution

1. Add search input field
2. Add tag filter UI
3. Update `fetchMarketplaceSpells()` to accept query params
4. Add sorting options

### Implementation Steps

1. **File:** `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`
2. **Methods to modify:**
   - `fetchMarketplaceSpells()` - Add query params
   - `renderCurrentView()` - Add search/filter UI
   - Add new state fields: `marketplaceSearchQuery`, `marketplaceSelectedTag`

### Code Changes

**Change 1: Update State**

**Location:** `constructor()` method

**Add:**

```javascript
this.state = {
    // ... existing fields
    marketplaceSpells: [],
    marketplaceSearchQuery: '',
    marketplaceSelectedTag: null,
    marketplaceTags: [], // Will be populated from API
};
```

**Change 2: Update `fetchMarketplaceSpells()`**

**Location:** `fetchMarketplaceSpells()` method

**Before:**

```javascript
async fetchMarketplaceSpells() {
    this.setState({ loading: true, error: null });
    try {
        const res = await fetch('/api/v1/spells/marketplace');
        if (!res.ok) throw new Error('Failed to fetch marketplace spells');
        const marketplaceSpells = await res.json();
        this.setState({ marketplaceSpells, loading: false });
    } catch (err) {
        this.setState({ error: 'Failed to fetch marketplace spells.', loading: false });
    }
}
```

**After:**

```javascript
async fetchMarketplaceSpells(tag = null, searchQuery = null) {
    this.setState({ loading: true, error: null });
    try {
        const params = new URLSearchParams();
        if (tag) params.append('tag', tag);
        if (searchQuery) params.append('search', searchQuery);
        
        const url = `/api/v1/spells/marketplace${params.toString() ? '?' + params.toString() : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch marketplace spells');
        const marketplaceSpells = await res.json();
        
        // Extract unique tags from spells for filter UI
        const allTags = new Set();
        marketplaceSpells.forEach(spell => {
            if (spell.tags && Array.isArray(spell.tags)) {
                spell.tags.forEach(tag => allTags.add(tag));
            }
        });
        
        this.setState({ 
            marketplaceSpells, 
            marketplaceTags: Array.from(allTags).sort(),
            loading: false 
        });
    } catch (err) {
        this.setState({ error: 'Failed to fetch marketplace spells.', loading: false });
    }
}
```

**Change 3: Add Search/Filter UI**

**Location:** `renderCurrentView()` method, marketplace view section

**Before:**

```javascript
} else if (view === 'marketplace') {
    if (!marketplaceSpells || marketplaceSpells.length === 0) {
        html += '<div class="empty-message">No public spells found.</div>';
    } else {
        // ... spell list
    }
}
```

**After:**

```javascript
} else if (view === 'marketplace') {
    // Search and filter UI
    html += `
        <div class="marketplace-controls">
            <div class="search-box">
                <input type="text" 
                       class="marketplace-search-input" 
                       placeholder="Search spells..." 
                       value="${this.state.marketplaceSearchQuery || ''}" />
                <button class="marketplace-search-btn">Search</button>
            </div>
            ${this.state.marketplaceTags.length > 0 ? `
                <div class="tag-filters">
                    <button class="tag-filter-btn ${!this.state.marketplaceSelectedTag ? 'active' : ''}" 
                            data-tag="">All</button>
                    ${this.state.marketplaceTags.map(tag => `
                        <button class="tag-filter-btn ${this.state.marketplaceSelectedTag === tag ? 'active' : ''}" 
                                data-tag="${tag}">${tag}</button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
    
    if (!marketplaceSpells || marketplaceSpells.length === 0) {
        html += '<div class="empty-message">No public spells found.</div>';
    } else {
        // ... spell list (unchanged)
    }
}
```

**Change 4: Add Event Handlers**

**Location:** `render()` method, after marketplace view rendering

**Add:**

```javascript
// Marketplace search and filter handlers
if (this.state.view === 'marketplace') {
    const searchInput = this.modalElement.querySelector('.marketplace-search-input');
    const searchBtn = this.modalElement.querySelector('.marketplace-search-btn');
    const tagBtns = this.modalElement.querySelectorAll('.tag-filter-btn');
    
    if (searchInput) {
        searchInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                this.setState({ marketplaceSearchQuery: query });
                this.fetchMarketplaceSpells(this.state.marketplaceSelectedTag, query);
            }
        };
    }
    
    if (searchBtn) {
        searchBtn.onclick = () => {
            const query = searchInput.value.trim();
            this.setState({ marketplaceSearchQuery: query });
            this.fetchMarketplaceSpells(this.state.marketplaceSelectedTag, query);
        };
    }
    
    tagBtns.forEach(btn => {
        btn.onclick = () => {
            const tag = btn.dataset.tag || null;
            this.setState({ marketplaceSelectedTag: tag });
            this.fetchMarketplaceSpells(tag, this.state.marketplaceSearchQuery);
        };
    });
}
```

**Change 5: Update API Endpoint (Backend)**

**Note:** The backend API may need to support `search` query parameter. Check if it's already supported.

**File:** `src/api/external/spells/spellsApi.js:15-38`

**Current:**

```javascript
router.get('/marketplace', async (req, res) => {
    try {
        const { tag } = req.query;
        const url = tag ? `/internal/v1/data/spells/public?tag=${encodeURIComponent(tag)}` : '/internal/v1/data/spells/public';
        // ... rest
    }
});
```

**Update to:**

```javascript
router.get('/marketplace', async (req, res) => {
    try {
        const { tag, search } = req.query;
        const params = new URLSearchParams();
        if (tag) params.append('tag', tag);
        if (search) params.append('search', search);
        
        const url = `/internal/v1/data/spells/public${params.toString() ? '?' + params.toString() : ''}`;
        const response = await internalApiClient.get(url);
        // ... rest unchanged
    }
});
```

**Then update internal API to support search:**

**File:** `src/api/internal/spells/spellsApi.js:25-33`

**Update:**

```javascript
router.get('/public', async (req, res) => {
  try {
    const { tag, search } = req.query;
    let filter = {};
    
    if (tag) filter.tags = tag;
    if (search) {
      // Search in name and description
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    const spells = await spellsDb.findPublicSpells(filter);
    return res.status(200).json({ spells });
  } catch (err) {
    logger.error('[spellsApi] GET /public list error', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
```

### Testing

**Test Cases:**

1. **Search Functionality**
   - Enter search query
   - Click "Search" or press Enter
   - **Expected:** Filtered results displayed

2. **Tag Filtering**
   - Click tag filter button
   - **Expected:** Only spells with that tag displayed

3. **Combined Search + Tag**
   - Select tag filter
   - Enter search query
   - **Expected:** Results filtered by both

### Estimated Effort

- **Development:** 3 hours
- **Testing:** 1 hour
- **Total:** 4 hours

---

## Implementation Timeline

### Phase 1: Critical Fix (Week 1)

- [ ] Fix #1: Add public spell lookup to `castSpell()`
- [ ] Test Fix #1
- [ ] Deploy Fix #1

**Estimated Time:** 1 day

### Phase 2: Marketplace Improvements (Week 2)

- [ ] Fix #2: Make marketplace interactive
- [ ] Fix #3: Add search/filter
- [ ] Test Fixes #2 and #3
- [ ] Deploy Fixes #2 and #3

**Estimated Time:** 2 days

### Phase 3: Optional Enhancements (Week 3+)

- [ ] Public spell page enhancements
- [ ] Slug field consolidation (if needed)

**Estimated Time:** TBD

---

## Risk Assessment

### Fix #1 (Public Spell Lookup)

**Risk Level:** LOW

- Additive change only (doesn't remove existing functionality)
- Simple code addition
- Easy to test and verify
- Easy to rollback if needed

### Fix #2 (Marketplace UI)

**Risk Level:** LOW-MEDIUM

- UI-only changes
- No breaking changes
- May require CSS styling adjustments
- Easy to test

### Fix #3 (Search/Filter)

**Risk Level:** MEDIUM

- Requires backend API changes
- Need to ensure search performance
- May require database indexing
- More complex to test

---

## Success Criteria

### Fix #1

✅ Public spells can be cast via `/cast` command  
✅ No regression in existing functionality  
✅ All test cases pass

### Fix #2

✅ Marketplace spells are clickable  
✅ Spell detail view works  
✅ Casting from marketplace works

### Fix #3

✅ Search functionality works  
✅ Tag filtering works  
✅ Combined search + tag works  
✅ Performance is acceptable (< 500ms response time)

---

## Rollback Procedures

### Fix #1

1. Revert `SpellsService.js` changes
2. Deploy
3. Verify `/cast` still works for user-owned spells

### Fix #2

1. Revert `SpellsMenuModal.js` changes
2. Deploy
3. Verify marketplace still displays (even if not interactive)

### Fix #3

1. Revert frontend and backend changes
2. Deploy
3. Verify marketplace still works without search/filter

---

## Post-Implementation

### Monitoring

- Monitor error logs for spell lookup failures
- Track marketplace usage metrics
- Monitor search query performance

### Metrics to Track

- Number of public spells cast via `/cast`
- Marketplace page views
- Search queries executed
- Spell discovery success rate

---

**End of Fix Plan**

