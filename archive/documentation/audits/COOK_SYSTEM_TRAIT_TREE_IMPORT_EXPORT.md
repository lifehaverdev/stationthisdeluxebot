# Trait Tree JSON Import/Export Implementation Plan

**Date:** 2025-01-27  
**Feature:** Trait Tree JSON Download/Upload  
**Status:** Ready for Implementation  
**Priority:** HIGH

---

## Overview

Add the ability for users to download and upload trait tree JSON files directly from the CookMenuModal. This enables users to:
- Export trait trees for external editing
- Import edited trait trees from external editors
- Share trait trees with other users
- Version control trait trees

---

## Current Trait Tree Structure

Based on `TraitTreeEditor.js` and `TraitEngine.js`, the trait tree structure is:

```javascript
categories: [
  {
    name: "CategoryName",           // Required: string, non-empty
    mode: "manual" | "generated",  // Required: enum
    traits: [                       // Required if mode === "manual"
      {
        name: "TraitName",         // Required: string, non-empty, max 50 chars
        value: "trait value",       // Required: string, max 1000 chars
        rarity: 0.5                 // Optional: number, 0-100
      }
    ],
    generator: {                    // Required if mode === "generated"
      type: "range",                // Required: "range" (currently only option)
      start: 0,                     // Required: number
      end: 10,                      // Required: number, >= start
      step: 1,                      // Required: number, > 0
      zeroPad: 0,                   // Optional: number, >= 0
      uniqueAcrossCook: false,      // Optional: boolean
      shuffleSeed: null             // Optional: number | null
    }
  }
]
```

Stored in: `collection.config.traitTree`

---

## Implementation Plan

### Phase 1: Validation Function

**Location:** `CookMenuModal.js`

Create a comprehensive validation function that matches TraitEngine expectations:

```javascript
validateTraitTree(data) {
  const errors = [];
  
  // Root validation
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Root must be an object'] };
  }
  
  if (!Array.isArray(data.categories)) {
    return { valid: false, errors: ['categories must be an array'] };
  }
  
  // Validate each category
  data.categories.forEach((cat, catIdx) => {
    // Category name
    if (!cat.name || typeof cat.name !== 'string' || cat.name.trim().length === 0) {
      errors.push(`Category ${catIdx}: name is required and must be non-empty`);
    }
    
    // Category mode
    if (cat.mode !== 'manual' && cat.mode !== 'generated') {
      errors.push(`Category ${catIdx} (${cat.name}): mode must be "manual" or "generated"`);
      return; // Skip further validation for this category
    }
    
    // Manual mode validation
    if (cat.mode === 'manual') {
      if (!Array.isArray(cat.traits)) {
        errors.push(`Category ${catIdx} (${cat.name}): traits must be an array`);
      } else {
        cat.traits.forEach((trait, traitIdx) => {
          // Trait name
          if (!trait.name || typeof trait.name !== 'string' || trait.name.trim().length === 0) {
            errors.push(`Category ${catIdx} (${cat.name}), Trait ${traitIdx}: name is required`);
          } else if (trait.name.length > 50) {
            errors.push(`Category ${catIdx} (${cat.name}), Trait ${traitIdx}: name must be <= 50 characters`);
          }
          
          // Trait value
          if (trait.value === undefined || typeof trait.value !== 'string') {
            errors.push(`Category ${catIdx} (${cat.name}), Trait ${traitIdx}: value is required and must be a string`);
          } else if (trait.value.length > 1000) {
            errors.push(`Category ${catIdx} (${cat.name}), Trait ${traitIdx}: value must be <= 1000 characters`);
          }
          
          // Trait rarity
          if (trait.rarity !== undefined) {
            const rarity = Number(trait.rarity);
            if (isNaN(rarity) || rarity < 0 || rarity > 100) {
              errors.push(`Category ${catIdx} (${cat.name}), Trait ${traitIdx}: rarity must be between 0 and 100`);
            }
          }
        });
      }
    }
    
    // Generated mode validation
    if (cat.mode === 'generated') {
      if (!cat.generator || typeof cat.generator !== 'object') {
        errors.push(`Category ${catIdx} (${cat.name}): generator is required`);
      } else {
        const gen = cat.generator;
        
        // Generator type
        if (gen.type !== 'range') {
          errors.push(`Category ${catIdx} (${cat.name}): generator.type must be "range"`);
        }
        
        // Start
        if (!Number.isFinite(gen.start)) {
          errors.push(`Category ${catIdx} (${cat.name}): generator.start must be a number`);
        }
        
        // End
        if (!Number.isFinite(gen.end)) {
          errors.push(`Category ${catIdx} (${cat.name}): generator.end must be a number`);
        } else if (gen.end < gen.start) {
          errors.push(`Category ${catIdx} (${cat.name}): generator.end must be >= generator.start`);
        }
        
        // Step
        if (!Number.isFinite(gen.step) || gen.step <= 0) {
          errors.push(`Category ${catIdx} (${cat.name}): generator.step must be a positive number`);
        }
        
        // Zero pad (optional)
        if (gen.zeroPad !== undefined && (!Number.isFinite(gen.zeroPad) || gen.zeroPad < 0)) {
          errors.push(`Category ${catIdx} (${cat.name}): generator.zeroPad must be a non-negative number`);
        }
        
        // Unique across cook (optional)
        if (gen.uniqueAcrossCook !== undefined && typeof gen.uniqueAcrossCook !== 'boolean') {
          errors.push(`Category ${catIdx} (${cat.name}): generator.uniqueAcrossCook must be a boolean`);
        }
        
        // Shuffle seed (optional)
        if (gen.shuffleSeed !== undefined && gen.shuffleSeed !== null && !Number.isFinite(gen.shuffleSeed)) {
          errors.push(`Category ${catIdx} (${cat.name}): generator.shuffleSeed must be a number or null`);
        }
      }
    }
  });
  
  return { valid: errors.length === 0, errors };
}
```

---

### Phase 2: Download Functionality

**Location:** `CookMenuModal.js`

Add download button and handler:

```javascript
downloadTraitTree() {
  const { selectedCollection } = this.state;
  if (!selectedCollection) {
    alert('No collection selected');
    return;
  }
  
  const traitTree = selectedCollection.config?.traitTree || [];
  const json = JSON.stringify({ categories: traitTree }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trait-tree-${selectedCollection.collectionId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // Show success feedback
  this.setState({ saveSuccess: true });
  setTimeout(() => this.setState({ saveSuccess: false }), 2000);
}
```

---

### Phase 3: Upload Functionality

**Location:** `CookMenuModal.js`

Add upload button, file input, and handler:

```javascript
async uploadTraitTree(file) {
  if (!file) return;
  
  try {
    this.setState({ loading: true, error: null });
    
    // Read file
    const text = await file.text();
    
    // Parse JSON
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON: ${e.message}`);
    }
    
    // Validate structure
    const validation = this.validateTraitTree(json);
    if (!validation.valid) {
      throw new Error(`Invalid trait tree structure:\n${validation.errors.join('\n')}`);
    }
    
    // Confirm overwrite
    const { selectedCollection } = this.state;
    const hasExisting = selectedCollection?.config?.traitTree?.length > 0;
    if (hasExisting) {
      const confirmed = confirm(
        'This will replace your existing trait tree. Are you sure?'
      );
      if (!confirmed) {
        this.setState({ loading: false });
        return;
      }
    }
    
    // Save trait tree
    await this.saveTraitTree(json.categories);
    
    // Show success feedback
    this.setState({ 
      loading: false, 
      saveSuccess: true,
      error: null 
    });
    setTimeout(() => this.setState({ saveSuccess: false }), 2000);
    
  } catch (err) {
    console.error('[CookMenuModal] uploadTraitTree error:', err);
    this.setState({
      loading: false,
      error: err.message || 'Failed to upload trait tree'
    });
  }
}
```

---

### Phase 4: UI Integration

**Location:** `CookMenuModal.js` - `renderDetailView()` and `attachDetailEvents()`

Add buttons to trait tree tab:

```javascript
// In renderDetailView(), when detailTab === 'traitTree':
if(detailTab==='traitTree'){
   body=`<div id="trait-tree-container"></div>
         <div class="trait-tree-actions" style="margin-top:12px;">
           <button class="download-trait-tree-btn">📥 Download JSON</button>
           <button class="upload-trait-tree-btn">📤 Upload JSON</button>
           <input type="file" accept=".json" id="trait-tree-file-input" style="display:none">
         </div>`;
}
```

Add event handlers:

```javascript
// In attachDetailEvents(), when detailTab === 'traitTree':
if(this.state.detailTab==='traitTree'){
  // ... existing TraitTreeEditor code ...
  
  // Download button
  const downloadBtn = this.modalElement.querySelector('.download-trait-tree-btn');
  if (downloadBtn) {
    downloadBtn.onclick = () => this.downloadTraitTree();
  }
  
  // Upload button
  const uploadBtn = this.modalElement.querySelector('.upload-trait-tree-btn');
  const fileInput = this.modalElement.querySelector('#trait-tree-file-input');
  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.uploadTraitTree(file);
        // Reset input so same file can be selected again
        e.target.value = '';
      }
    };
  }
}
```

---

## Validation Rules Summary

### Root Object
- ✅ Must be an object
- ✅ Must have `categories` array

### Category Object
- ✅ `name`: Required, string, non-empty
- ✅ `mode`: Required, "manual" or "generated"

### Manual Mode Category
- ✅ `traits`: Required, array
- ✅ Each trait:
  - `name`: Required, string, non-empty, max 50 chars
  - `value`: Required, string, max 1000 chars
  - `rarity`: Optional, number, 0-100

### Generated Mode Category
- ✅ `generator`: Required, object
- ✅ `generator.type`: Required, "range"
- ✅ `generator.start`: Required, number
- ✅ `generator.end`: Required, number, >= start
- ✅ `generator.step`: Required, number, > 0
- ✅ `generator.zeroPad`: Optional, number, >= 0
- ✅ `generator.uniqueAcrossCook`: Optional, boolean
- ✅ `generator.shuffleSeed`: Optional, number | null

---

## Error Handling

### JSON Parse Errors
- Show: "Invalid JSON: {error message}"
- Action: User must fix JSON syntax

### Structure Validation Errors
- Show: "Invalid trait tree structure:\n{list of errors}"
- Action: User must fix structure issues

### File Read Errors
- Show: "Failed to read file: {error message}"
- Action: User should try again

### Save Errors
- Show: "Failed to save trait tree: {error message}"
- Action: User should try again or check network

---

## UX Considerations

1. **File Naming**
   - Download: `trait-tree-{collectionId}.json`
   - Helps identify which collection the file belongs to

2. **Confirmation**
   - Ask for confirmation before overwriting existing trait tree
   - Only if existing trait tree has categories

3. **Feedback**
   - Show loading spinner during upload
   - Show success message after download/upload
   - Show error message with details on failure

4. **File Input**
   - Hidden file input triggered by button
   - Accept only `.json` files
   - Reset after selection to allow re-selecting same file

5. **Validation Feedback**
   - Show all validation errors at once
   - Format errors clearly with category/trait indices
   - Help users understand what needs to be fixed

---

## Testing Plan

### Unit Tests

1. **Validation Function**
   - Valid trait tree (manual)
   - Valid trait tree (generated)
   - Valid trait tree (mixed)
   - Invalid JSON structure
   - Missing required fields
   - Invalid field types
   - Invalid field values (negative rarity, end < start, etc.)
   - Empty trait tree

2. **Download Function**
   - Download with empty trait tree
   - Download with manual categories
   - Download with generated categories
   - Download with mixed categories
   - Verify file name format
   - Verify JSON structure

3. **Upload Function**
   - Upload valid JSON
   - Upload invalid JSON (syntax error)
   - Upload invalid structure
   - Upload empty trait tree
   - Upload very large trait tree
   - Upload with confirmation
   - Upload without confirmation (no existing tree)

### Integration Tests

1. **Download → Edit → Upload Workflow**
   - Download trait tree
   - Edit JSON externally
   - Upload edited JSON
   - Verify changes saved
   - Verify trait tree works in cook

2. **Upload → Start Cook**
   - Upload trait tree
   - Start cook
   - Verify traits are selected correctly
   - Verify trait values are applied correctly

---

## Implementation Checklist

- [ ] Add `validateTraitTree()` method to CookMenuModal
- [ ] Add `downloadTraitTree()` method to CookMenuModal
- [ ] Add `uploadTraitTree()` method to CookMenuModal
- [ ] Add download/upload buttons to trait tree tab UI
- [ ] Add file input element (hidden)
- [ ] Wire up event handlers
- [ ] Add error handling and user feedback
- [ ] Test with various trait tree structures
- [ ] Test error cases
- [ ] Test download → edit → upload workflow

---

## Benefits

1. **User Productivity**
   - Edit complex trait trees in external editors
   - Use find/replace, bulk editing tools
   - Version control trait trees

2. **Sharing & Collaboration**
   - Share trait trees between users
   - Reuse trait trees across collections
   - Template trait trees

3. **Error Prevention**
   - Validation catches errors before saving
   - Clear error messages help users fix issues
   - Prevents invalid data from entering system

4. **Developer Experience**
   - Easier to test trait trees
   - Easier to debug trait tree issues
   - Can create test fixtures

---

## Future Enhancements

1. **Trait Tree Templates**
   - Pre-built templates for common use cases
   - One-click import of templates

2. **Trait Tree Marketplace**
   - Share trait trees publicly
   - Browse community trait trees
   - Rate and review trait trees

3. **Trait Tree Versioning**
   - Track versions of trait trees
   - Rollback to previous versions
   - Compare versions

4. **Bulk Operations**
   - Import multiple trait trees at once
   - Export all collections' trait trees
   - Merge trait trees

---

## Notes

- No backend changes required - uses existing `saveTraitTree()` endpoint
- Pure frontend implementation
- Validation matches TraitEngine expectations
- File format is standard JSON - easy to edit in any editor
- Backward compatible - existing trait trees work as-is

