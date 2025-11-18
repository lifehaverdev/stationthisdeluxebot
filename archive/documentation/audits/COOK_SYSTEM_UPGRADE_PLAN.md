# Cook System Upgrade Plan

**Date:** 2025-01-27  
**Status:** Planning

---

## Overview

This document outlines planned improvements to the cook system beyond the critical fixes already implemented.

---

## Planned Features

### 1. Trait Tree JSON Import/Export ✅ PLANNED

**Priority:** HIGH  
**Status:** Ready for Implementation  
**Documentation:** See `COOK_SYSTEM_TRAIT_TREE_IMPORT_EXPORT.md` for detailed implementation plan

#### Feature Description

Allow users to download and upload trait tree JSON files directly from the CookMenuModal. This enables:
- **Export**: Download trait tree as JSON for external editing, version control, or sharing
- **Import**: Upload edited JSON files to quickly update trait trees
- **Workflow**: Edit complex trait trees in external editors (VS Code, etc.) and re-import

#### User Story

As a user creating NFT collections, I want to:
1. Download my trait tree as a JSON file
2. Edit it in my preferred text editor
3. Upload the edited JSON file to update my collection
4. Share trait trees with other users

#### Implementation Plan

**Frontend Changes (CookMenuModal.js):**

1. **Add Download Button**
   - Location: Trait Tree tab, near "Save Changes" button
   - Action: Download `trait-tree.json` file with current trait tree data
   - Format: Pretty-printed JSON with proper structure

2. **Add Upload Button**
   - Location: Trait Tree tab, next to download button
   - Action: Trigger file input, parse JSON, validate, and save
   - Validation: Check structure matches expected trait tree schema
   - Error Handling: Show clear errors for invalid JSON or structure

3. **UI Elements**
   ```html
   <div class="trait-tree-actions">
     <button class="download-trait-tree-btn">📥 Download JSON</button>
     <button class="upload-trait-tree-btn">📤 Upload JSON</button>
     <input type="file" accept=".json" id="trait-tree-file-input" style="display:none">
   </div>
   ```

**Backend Changes:**

1. **Validation Function**
   - Validate trait tree structure matches expected schema
   - Check required fields (name, mode, traits/generator)
   - Validate trait fields (name, value, rarity)
   - Validate generator fields (type, start, end, step, etc.)

2. **Error Handling**
   - Return clear error messages for invalid JSON
   - Return clear error messages for invalid structure
   - Preserve existing trait tree on validation failure

**Data Structure:**

The trait tree JSON structure:
```json
{
  "categories": [
    {
      "name": "Animal",
      "mode": "manual",
      "traits": [
        {
          "name": "Cat",
          "value": "a cute cat",
          "rarity": 20
        },
        {
          "name": "Dog",
          "value": "a fluffy dog",
          "rarity": 20
        }
      ]
    },
    {
      "name": "Number",
      "mode": "generated",
      "generator": {
        "type": "range",
        "start": 1,
        "end": 100,
        "step": 1,
        "zeroPad": 3,
        "uniqueAcrossCook": true,
        "shuffleSeed": 42
      }
    }
  ]
}
```

**Validation Rules:**

1. **Root Object**
   - Must have `categories` array
   - `categories` must be array

2. **Category Object**
   - Must have `name` (string, non-empty)
   - Must have `mode` ("manual" or "generated")
   - If `mode === "manual"`: must have `traits` array
   - If `mode === "generated"`: must have `generator` object

3. **Trait Object** (for manual mode)
   - Must have `name` (string, non-empty, max 50 chars)
   - Must have `value` (string, max 1000 chars)
   - `rarity` optional (number, 0-100)

4. **Generator Object** (for generated mode)
   - Must have `type` ("range" currently)
   - Must have `start` (number)
   - Must have `end` (number, >= start)
   - Must have `step` (number, > 0)
   - `zeroPad` optional (number, >= 0)
   - `uniqueAcrossCook` optional (boolean)
   - `shuffleSeed` optional (number or null)

**Implementation Steps:**

1. **Add Download Functionality**
   ```javascript
   downloadTraitTree() {
     const traitTree = this.state.selectedCollection?.config?.traitTree || [];
     const json = JSON.stringify({ categories: traitTree }, null, 2);
     const blob = new Blob([json], { type: 'application/json' });
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.href = url;
     a.download = `trait-tree-${this.state.selectedCollection.collectionId}.json`;
     a.click();
     URL.revokeObjectURL(url);
   }
   ```

2. **Add Upload Functionality**
   ```javascript
   async uploadTraitTree(file) {
     try {
       const text = await file.text();
       const json = JSON.parse(text);
       
       // Validate structure
       const validation = this.validateTraitTree(json);
       if (!validation.valid) {
         throw new Error(`Invalid trait tree: ${validation.errors.join(', ')}`);
       }
       
       // Save to collection
       await this.saveTraitTree(json.categories);
     } catch (err) {
       alert(`Failed to upload trait tree: ${err.message}`);
     }
   }
   ```

3. **Add Validation Function**
   ```javascript
   validateTraitTree(data) {
     const errors = [];
     
     if (!data || typeof data !== 'object') {
       errors.push('Root must be an object');
       return { valid: false, errors };
     }
     
     if (!Array.isArray(data.categories)) {
       errors.push('categories must be an array');
       return { valid: false, errors };
     }
     
     // Validate each category
     data.categories.forEach((cat, idx) => {
       // ... validation logic ...
     });
     
     return { valid: errors.length === 0, errors };
   }
   ```

**UX Considerations:**

1. **File Naming**: Download as `trait-tree-{collectionId}.json` for easy identification
2. **Feedback**: Show success message after upload
3. **Confirmation**: Ask for confirmation before overwriting existing trait tree
4. **Preview**: Optionally show preview of uploaded data before saving
5. **Error Messages**: Clear, actionable error messages

**Testing:**

1. **Download Tests**
   - Download empty trait tree
   - Download trait tree with manual categories
   - Download trait tree with generated categories
   - Download trait tree with mixed categories
   - Verify JSON structure is correct

2. **Upload Tests**
   - Upload valid JSON
   - Upload invalid JSON (syntax error)
   - Upload JSON with invalid structure
   - Upload JSON with missing required fields
   - Upload JSON with invalid values (negative rarity, etc.)
   - Upload empty trait tree
   - Upload very large trait tree

3. **Integration Tests**
   - Download → Edit → Upload workflow
   - Upload → Start Cook → Verify traits work correctly
   - Upload → Save → Reload → Verify persistence

---

## Future Enhancements

### 2. Trait Tree Templates

**Priority:** MEDIUM  
**Status:** Future

Pre-built trait tree templates for common use cases:
- Character attributes (hair, eyes, clothing)
- Number sequences
- Color palettes
- Style variations

### 3. Trait Tree Versioning

**Priority:** LOW  
**Status:** Future

Track trait tree versions and allow rollback to previous versions.

### 4. Trait Tree Sharing

**Priority:** LOW  
**Status:** Future

Share trait trees between users or make them public.

---

## Implementation Priority

1. ✅ **Critical Fixes** - COMPLETE
2. 🔄 **Trait Tree JSON Import/Export** - IN PROGRESS
3. ⏳ **Deprecated Component Cleanup** - PENDING
4. ⏳ **Error Handling Improvements** - PENDING
5. ⏳ **Configuration Options** - PENDING

---

## Notes

- Trait tree JSON import/export is a high-value, low-risk feature
- No backend API changes required (uses existing saveTraitTree endpoint)
- Pure frontend implementation
- Significantly improves UX for power users

