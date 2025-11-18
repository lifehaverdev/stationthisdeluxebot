# Spell Creation Menu Investigation: Parameter Mappings & UI Improvements

## Problem Statement

The spell creation menu has critical issues with how it handles parameter mappings, particularly for exposed inputs. When creating a spell, parameter values that should be left open for user interpretation are being saved as static values, causing them to be "baked in" to the spell instance. Additionally, the UI styling and user experience could be significantly improved.

### Core Issues

1. **Parameter Mappings Being Saved Incorrectly**: When a parameter is marked as an "exposed input" (should be user-provided), its current value from the tool window is being saved as a static value in the spell definition. This prevents users from providing their own values when using the spell.

2. **Values Stuck in Instances**: Once a spell is created with static values, those values persist even when they should be user-provided inputs. This breaks the intended workflow where exposed inputs should be left open.

3. **UI/UX Issues**: The spell creation menu styling and user experience could be improved for better clarity and usability.

## Expected Behavior

### Exposed Inputs
- **Exposed inputs** are parameters that should be left open for users to provide when they use the spell
- These should NOT have static values saved in the spell's `parameterMappings`
- When a spell is loaded, exposed inputs should show empty/default values, ready for user input

### Non-Exposed Parameters
- Parameters that are NOT exposed should have their static values saved
- These represent internal configuration that shouldn't change between spell uses
- Values from node connections (`nodeOutput` type) should be preserved

## Current Implementation Analysis

### Key Files

1. **`src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`**
   - Line 833: `parameterMappings: n.parameterMappings` - **PROBLEM**: Saves ALL parameterMappings, including exposed inputs
   - Line 818-823: Extracts `exposedInputs` correctly, but doesn't filter parameterMappings
   - Line 518-629: `renderCreateView()` - UI rendering for spell creation

2. **`src/platforms/web/client/src/sandbox/window/SpellWindow.js`**
   - Line 123-124: Creates default mappings with empty string values for exposed inputs
   - This is correct behavior for loading a spell, but the issue is upstream in creation

3. **`src/platforms/web/client/src/sandbox/logic/spellExecution.js`**
   - Line 33-42: Reads `parameterMappings` from spell window to get user-provided values
   - Expects exposed inputs to be in `parameterMappings` with `type: 'static'` and user-provided `value`

4. **`src/core/services/workflow/execution/ParameterResolver.js`**
   - Line 20-54: Resolves parameter mappings during spell execution
   - Handles `static` and `nodeOutput` types correctly

### Data Flow

**Spell Creation Flow:**
1. User selects nodes in canvas → `subgraph.nodes` contains nodes with `parameterMappings`
2. User marks some parameters as "exposed inputs" via checkboxes
3. `handleCreateSpell()` extracts `exposedInputs` array (line 818-823)
4. **BUG**: Line 833 saves ALL `n.parameterMappings` without filtering exposed inputs
5. Spell is saved to database with static values for exposed inputs

**Spell Usage Flow:**
1. Spell is loaded → `SpellWindow` creates default empty mappings for exposed inputs (line 123-124)
2. User fills in exposed input values
3. `executeSpell()` reads from `parameterMappings` and sends as `parameterOverrides`
4. Backend uses `parameterOverrides` to override step `parameterMappings`

**The Problem:**
- Step `parameterMappings` in the spell definition contain static values for exposed inputs
- These static values might override or conflict with user-provided `parameterOverrides`
- The intended behavior is: exposed inputs should have NO static value in step `parameterMappings`

## Investigation Tasks

### Task 1: Understand Parameter Mapping Structure

**Questions to Answer:**
1. What is the exact structure of `parameterMappings` in a node?
2. How are exposed inputs identified? (via `exposedInputs` array with `{ nodeId, paramKey }`)
3. What happens if a parameter is both:
   - Connected to another node (`type: 'nodeOutput'`)
   - Marked as exposed input
4. Should exposed inputs that are connected be allowed? Or should they be disconnected?

**Files to Examine:**
- `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js` - Line 556-604 (exposed inputs detection)
- `src/platforms/web/client/src/sandbox/node/parameterInputs.js` - How mappings are structured
- `src/platforms/web/client/src/sandbox/state.js` - How nodes store parameterMappings

**Expected Output:**
- Clear understanding of mapping structure
- Decision on whether connected exposed inputs should be allowed
- Documentation of edge cases

### Task 2: Trace Parameter Mapping Flow During Creation

**Steps to Trace:**
1. When user selects nodes for spell creation, what `parameterMappings` exist?
2. When user checks "expose input" checkbox, what happens?
3. When `handleCreateSpell()` runs, what data is in `subgraph.nodes[].parameterMappings`?
4. What should be filtered out before saving?

**Code to Examine:**
```javascript
// SpellsMenuModal.js line 833
steps: subgraph ? subgraph.nodes.map(n => ({ 
    id: n.id, 
    toolIdentifier: n.toolId, 
    displayName: n.displayName, 
    parameterMappings: n.parameterMappings  // ⚠️ PROBLEM HERE
})) : [],
```

**Expected Fix:**
```javascript
// Filter out exposed inputs from parameterMappings
steps: subgraph ? subgraph.nodes.map(n => {
    const stepMappings = { ...n.parameterMappings };
    
    // Remove any parameters that are marked as exposed inputs
    exposedInputs.forEach(exposed => {
        if (exposed.nodeId === n.id) {
            // Remove this parameter from mappings
            delete stepMappings[exposed.paramKey];
        }
    });
    
    return {
        id: n.id,
        toolIdentifier: n.toolId,
        displayName: n.displayName,
        parameterMappings: stepMappings
    };
}) : [],
```

### Task 3: Verify Backend Handling

**Questions:**
1. Does the backend properly handle missing `parameterMappings` for exposed inputs?
2. Does `ParameterResolver` correctly prioritize `parameterOverrides` over step `parameterMappings`?
3. Are there any validation errors if a step has missing `parameterMappings`?

**Files to Check:**
- `src/core/services/workflow/execution/ParameterResolver.js`
- `src/core/services/workflow/execution/StepExecutor.js`
- `src/api/internal/spells/spellsApi.js` - Spell creation endpoint

**Test Cases:**
- Create spell with exposed input (no static value in step)
- Cast spell with user-provided value for exposed input
- Verify value flows correctly through execution

### Task 4: Handle Edge Cases

**Edge Cases to Consider:**

1. **Connected Exposed Inputs:**
   - What if a parameter is both connected (`type: 'nodeOutput'`) AND marked as exposed?
   - Should we:
     - Disallow this combination (show error)?
     - Disconnect it automatically when exposed?
     - Allow it (user can override connection with their own value)?

2. **Empty vs Missing Values:**
   - Difference between `parameterMappings: {}` (no mappings)
   - vs `parameterMappings: { param: { type: 'static', value: '' } }` (empty string)
   - Which should exposed inputs use?

3. **Default Values:**
   - If a tool parameter has a default value, should exposed inputs use that default?
   - Or should they always start empty?

4. **Existing Spells:**
   - How to handle spells that were already created with incorrect static values?
   - Should we add migration logic?
   - Or fix on-the-fly when loading?

### Task 5: UI/UX Improvements

**Current UI Issues:**
1. Spell creation form could be more visually organized
2. Exposed inputs selection could be clearer
3. Step reordering UI could be improved
4. Visual feedback for what will be exposed vs internal

**Improvements to Consider:**

1. **Visual Organization:**
   - Group related fields together
   - Clear sections for: Basic Info, Steps, Exposed Inputs
   - Better spacing and typography

2. **Exposed Inputs UI:**
   - Show which parameters are already connected (can't be exposed)
   - Visual indicator for exposed vs internal parameters
   - Preview of what users will see when using the spell

3. **Step Management:**
   - Better drag-and-drop visual feedback
   - Step numbers that update dynamically
   - Preview of step order

4. **Validation & Feedback:**
   - Real-time validation (e.g., spell name required)
   - Clear error messages
   - Success feedback after creation

5. **Styling:**
   - Modern, clean design
   - Consistent with rest of application
   - Responsive layout
   - Accessible (keyboard navigation, screen readers)

**Files to Modify:**
- `src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js` - Main UI
- CSS/styling files (find where modal styles are defined)

## Implementation Plan

### Phase 1: Fix Parameter Mapping Logic

1. **Modify `handleCreateSpell()` in `SpellsMenuModal.js`:**
   - Filter out exposed inputs from `parameterMappings` before saving
   - Ensure connected parameters are handled correctly
   - Add validation to prevent invalid combinations

2. **Test Parameter Flow:**
   - Create spell with exposed inputs
   - Verify exposed inputs have no static values in saved spell
   - Load spell and verify exposed inputs are empty/default
   - Cast spell with user-provided values
   - Verify values flow correctly

### Phase 2: Handle Edge Cases

1. **Connected Exposed Inputs:**
   - Decide on behavior (disallow vs allow vs auto-disconnect)
   - Implement chosen behavior
   - Add UI feedback

2. **Default Values:**
   - Decide if exposed inputs should use tool defaults
   - Implement consistently

3. **Migration (if needed):**
   - Check if existing spells need fixing
   - Create migration script or on-the-fly fix

### Phase 3: UI/UX Improvements

1. **Reorganize UI:**
   - Better visual hierarchy
   - Clear sections
   - Improved spacing

2. **Enhance Exposed Inputs Selection:**
   - Visual indicators
   - Better labeling
   - Preview functionality

3. **Improve Step Management:**
   - Better drag-and-drop
   - Visual feedback
   - Step preview

4. **Add Validation & Feedback:**
   - Real-time validation
   - Clear error messages
   - Success states

5. **Polish Styling:**
   - Modern design
   - Consistent theming
   - Responsive layout

## Testing Checklist

### Functional Tests
- [ ] Create spell with exposed input (no static value)
- [ ] Create spell with non-exposed parameter (static value saved)
- [ ] Create spell with connected parameter (nodeOutput preserved)
- [ ] Try to expose connected parameter (verify behavior)
- [ ] Load created spell and verify exposed inputs are empty
- [ ] Cast spell with user-provided exposed input values
- [ ] Verify values flow correctly through execution
- [ ] Test with multiple exposed inputs
- [ ] Test with no exposed inputs
- [ ] Test with all parameters exposed

### Edge Case Tests
- [ ] Exposed input that's also connected (if allowed)
- [ ] Exposed input with tool default value
- [ ] Empty string vs missing parameter mapping
- [ ] Existing spells with incorrect static values (if migration needed)

### UI/UX Tests
- [ ] Spell creation form is visually organized
- [ ] Exposed inputs selection is clear
- [ ] Step reordering works smoothly
- [ ] Validation messages are clear
- [ ] Success feedback appears after creation
- [ ] Responsive on different screen sizes
- [ ] Keyboard navigation works
- [ ] Accessible to screen readers

## Files to Modify

### Core Logic Changes
1. **`src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js`**
   - `handleCreateSpell()` - Filter exposed inputs from parameterMappings
   - `renderCreateView()` - UI improvements
   - Add validation logic

### Supporting Changes
2. **`src/platforms/web/client/src/sandbox/window/SpellWindow.js`**
   - Verify exposed input initialization (should already be correct)
   - May need minor adjustments

3. **CSS/Styling Files**
   - Find and update modal styles
   - Improve visual design

### Testing Files
4. **Add/Update Tests**
   - Unit tests for parameter mapping filtering
   - Integration tests for spell creation flow
   - UI tests for exposed inputs selection

## Success Criteria

1. ✅ **Exposed inputs have no static values** in saved spell definitions
2. ✅ **Users can provide values** for exposed inputs when using spells
3. ✅ **Non-exposed parameters** retain their static values correctly
4. ✅ **Connected parameters** are handled correctly (preserved or handled based on decision)
5. ✅ **UI is improved** with better organization, clarity, and visual design
6. ✅ **Validation works** with clear error messages
7. ✅ **No regressions** - existing spells still work correctly
8. ✅ **Edge cases handled** gracefully with appropriate user feedback

## Related Documentation

- `roadmap/_historical/maps/3-parameter-mapping.md` - Parameter mapping design philosophy
- `src/platforms/web/client/src/sandbox/logic/spellExecution.js` - How spells are executed
- `src/core/services/workflow/execution/ParameterResolver.js` - How parameters are resolved

## Notes

- The core issue is in `SpellsMenuModal.js` line 833 where ALL `parameterMappings` are saved
- Exposed inputs should be filtered out before saving
- UI improvements can be done incrementally, but fixing the parameter mapping bug is critical
- Consider backward compatibility with existing spells that may have incorrect static values

