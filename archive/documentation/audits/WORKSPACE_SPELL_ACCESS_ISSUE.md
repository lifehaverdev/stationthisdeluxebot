# Workspace System - Private Spell Access Issue

**Date:** 2025-01-27  
**Status:** 🔴 OPEN  
**Priority:** Medium  
**Related:** Workspace System Audit

---

## Issue Summary

When loading a workspace that contains a spell window referencing a private spell, the workspace loads successfully but the spell details fail to load with a 403 error. This causes:

1. Console errors/warnings
2. Incomplete workspace reconstruction
3. Poor user experience (spell window may appear broken)

---

## Symptoms

### Logs Show:
```
WARN: GET /registry/691bbaf85cc59775633be37b - 403
AxiosError: Request failed with status code 403
data: { error: 'You do not have permission to view this private spell.' }
```

### User Experience:
- Workspace loads successfully
- Spell window may appear but without details
- Console shows 403 errors
- No clear indication to user why spell isn't loading

---

## Root Cause

**Location:** `src/platforms/web/client/src/sandbox/index.js:610-629`

When reconstructing workspace windows, the code attempts to create spell windows without first checking if the user has permission to access the spell. The `createSpellWindow()` function or the spell loading logic tries to fetch spell details, which fails with 403 for private spells.

**Current Code:**
```javascript
if (win.isSpell && win.spell) {
    try {
        createSpellWindow(...);
    } catch (e) {
        console.error(`[Sandbox] Failed to recreate spell window ${win.id}:`, e);
        missingSpells.push(win.spell.name || win.spell._id);
    }
}
```

**Problem:**
- No pre-check for spell accessibility
- Error only caught if `createSpellWindow()` throws synchronously
- 403 errors happen during async spell detail fetching
- No user-facing indication of the issue

---

## Expected Behavior

1. **Before Loading Spell Window:**
   - Check if user has permission to access the spell
   - If private and user doesn't have access, show placeholder window
   - If accessible, load normally

2. **Placeholder Window Should:**
   - Show clear message: "Private Spell - You don't have permission to view this spell"
   - Display spell ID for reference
   - Be visually distinct (maybe grayed out or with lock icon)
   - Allow user to understand why it's not loading

3. **Error Handling:**
   - No console errors for expected 403s
   - User-friendly message in UI
   - Workspace still loads successfully

---

## Proposed Solution

### Option 1: Pre-check Spell Access (Recommended)

Before creating spell window, check if spell is accessible:

```javascript
// In __reloadSandboxState()
if (win.isSpell && win.spell) {
    try {
        // Check if spell is accessible before creating window
        const spellAccessible = await checkSpellAccess(win.spell._id);
        if (!spellAccessible) {
            // Create placeholder window
            createSpellPlaceholderWindow(win);
            missingSpells.push(win.spell.name || win.spell._id);
            return;
        }
        // Spell is accessible, create normally
        createSpellWindow(...);
    } catch (e) {
        // Handle other errors
        console.error(`[Sandbox] Failed to recreate spell window ${win.id}:`, e);
        createSpellPlaceholderWindow(win);
        missingSpells.push(win.spell.name || win.spell._id);
    }
}
```

### Option 2: Handle 403 in Spell Window Creation

Modify `createSpellWindow()` or `SpellWindow` class to handle 403 errors gracefully:

```javascript
// In SpellWindow class or createSpellWindow helper
async function createSpellWindow(...) {
    try {
        // Attempt to load spell details
        const spellDetails = await fetchSpellDetails(spell._id);
        // Create window with details
    } catch (e) {
        if (e.response?.status === 403) {
            // Create placeholder instead
            return createSpellPlaceholderWindow(...);
        }
        throw e; // Re-throw other errors
    }
}
```

### Option 3: Filter Private Spells from Workspace Snapshot

When saving workspace, check spell accessibility and mark private spells:

```javascript
// In buildSnapshot()
if (w.isSpell) {
    const spellAccessible = checkSpellAccessSync(w.spell._id); // Would need sync check
    return {
        ...base,
        isSpell: true,
        spell: { _id: w.spell._id, name: w.spell.name },
        spellAccessible: spellAccessible // Mark accessibility
    };
}
```

Then during load, check this flag before creating window.

---

## Implementation Details

### Helper Functions Needed

1. **`checkSpellAccess(spellId)`**
   - Async function to check if current user can access spell
   - Returns boolean
   - Handles errors gracefully

2. **`createSpellPlaceholderWindow(win)`**
   - Creates a placeholder window for inaccessible spells
   - Shows user-friendly message
   - Maintains window position and ID for workspace integrity

### Files to Modify

1. `src/platforms/web/client/src/sandbox/index.js`
   - Add spell access check before window creation
   - Add placeholder window creation

2. `src/platforms/web/client/src/sandbox/window/SpellWindow.js` (if needed)
   - Handle 403 errors gracefully
   - Show placeholder state

3. `src/platforms/web/client/src/sandbox/utils/spellAccess.js` (new)
   - Helper function to check spell access
   - Cache results to avoid repeated API calls

---

## Testing Scenarios

### Test Case 1: Private Spell in Workspace
1. User A creates workspace with private spell
2. User B loads workspace
3. ✅ Placeholder window appears
4. ✅ No console errors
5. ✅ User sees clear message

### Test Case 2: Spell Becomes Private
1. User creates workspace with public spell
2. Spell owner makes spell private
3. User loads workspace
4. ✅ Placeholder window appears
5. ✅ No console errors

### Test Case 3: User Owns Private Spell
1. User creates workspace with their own private spell
2. User loads workspace
3. ✅ Spell window loads normally
4. ✅ No placeholder needed

### Test Case 4: Multiple Private Spells
1. Workspace contains 3 private spells user can't access
2. User loads workspace
3. ✅ All 3 show placeholders
4. ✅ Other windows load normally
5. ✅ No console spam

---

## Related Issues

- Workspace system handles missing tools gracefully ✅
- Workspace system handles missing collections (not yet implemented)
- Spell access errors are expected but should be handled gracefully

---

## Acceptance Criteria

- [ ] No console errors when loading workspace with private spell
- [ ] Placeholder window appears for inaccessible spells
- [ ] User sees clear message about why spell isn't loading
- [ ] Workspace still loads successfully
- [ ] Other windows unaffected
- [ ] Performance not degraded (access check should be fast/cached)

---

## Notes

- This is a **user experience** issue, not a critical bug
- Workspace system functions correctly (saves/loads work)
- The issue is in the **spell window reconstruction** phase
- Current placeholder implementation exists but may not be triggered correctly

---

## Priority Justification

**Medium Priority** because:
- ✅ Workspace system works (saves/loads successfully)
- ⚠️ User experience degraded (console errors, unclear state)
- ⚠️ Not blocking core functionality
- ⚠️ Affects users who share workspaces with private spells

---

## Next Steps

1. **Investigate** current spell access checking mechanisms
2. **Design** placeholder window UI/UX
3. **Implement** spell access check before window creation
4. **Test** with various spell access scenarios
5. **Document** behavior for users

---

**Assigned To:** [Agent/Developer]  
**Estimated Effort:** 2-4 hours  
**Dependencies:** None

