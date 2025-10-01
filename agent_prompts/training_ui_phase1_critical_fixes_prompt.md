# Training UI Phase 1: Critical Fixes - Agent Prompt

## Objective
Implement the most critical missing features in the training UI to align with the backend TrainingDB schema and new training system architecture.

## Context
The current training UI in `ModsMenuModal.js` only captures 4 basic fields but the backend expects 20+ fields including model type selection, training parameters, and cost calculation. This phase focuses on the essential features needed for basic training functionality.

## Files to Modify
- `src/platforms/web/client/src/sandbox/components/ModsMenuModal.js` (main training UI)
- `src/platforms/web/client/src/sandbox/components/modsMenuModal.css` (styling)
- `src/api/internal/trainingsApi.js` (backend API updates if needed)

## Tasks

### 1. Add Model Type Selection (HIGH PRIORITY)
**Current State**: Training form has a basic text input for `baseModel`
**Required**: Dropdown selection for SDXL/FLUX/WAN model types

**Implementation**:
- Replace the `baseModel` input with a dropdown
- Options: SDXL, FLUX, WAN
- Auto-populate `baseModel` field based on selection
- Add validation to ensure a model type is selected

**Code Location**: Lines 377-378 in ModsMenuModal.js
```javascript
// Current:
<label>Base Model:<br><input name="baseModel" value="${formValues.baseModel||''}" /></label><br>

// Replace with:
<label>Model Type:<br>
  <select name="modelType" required onchange="updateBaseModel(this.value)">
    <option value="">Select Model Type</option>
    <option value="SDXL" ${formValues.modelType==='SDXL'?'selected':''}>SDXL</option>
    <option value="FLUX" ${formValues.modelType==='FLUX'?'selected':''}>FLUX</option>
    <option value="WAN" ${formValues.modelType==='WAN'?'selected':''}>WAN</option>
  </select>
</label><br>
<input type="hidden" name="baseModel" value="${formValues.baseModel||''}" />
```

### 2. Add Basic Training Parameters (HIGH PRIORITY)
**Current State**: No training parameter inputs
**Required**: Steps, learning rate, batch size, resolution inputs

**Implementation**:
- Add a new "Training Parameters" section to the form
- Include inputs for: steps, learning rate, batch size, resolution
- Add validation and default values based on model type
- Use the default values from the training recipes (SDXLRecipe.js, FLUXRecipe.js, WANRecipe.js)

**Code Location**: After line 379 in ModsMenuModal.js
```javascript
// Add after the offeringId field:
<div class="form-section">
  <h3>Training Parameters</h3>
  <div class="param-row">
    <label>Steps:<br><input type="number" name="steps" value="${formValues.steps||''}" min="100" max="5000" /></label>
    <label>Learning Rate:<br><input type="number" name="learningRate" value="${formValues.learningRate||''}" step="0.0001" min="0.0001" max="0.01" /></label>
  </div>
  <div class="param-row">
    <label>Batch Size:<br><input type="number" name="batchSize" value="${formValues.batchSize||1}" min="1" max="8" /></label>
    <label>Resolution:<br><input type="text" name="resolution" value="${formValues.resolution||'1024,1024'}" placeholder="width,height" /></label>
  </div>
</div>
```

### 3. Add LoRA Configuration (HIGH PRIORITY)
**Current State**: No LoRA parameter inputs
**Required**: LoRA rank, alpha, dropout, trigger words

**Implementation**:
- Add LoRA configuration section
- Include inputs for: loraRank, loraAlpha, loraDropout, triggerWords
- Use default values from training recipes
- Trigger words are critical for LoRA training

**Code Location**: After the training parameters section
```javascript
<div class="form-section">
  <h3>LoRA Configuration</h3>
  <div class="param-row">
    <label>LoRA Rank:<br><input type="number" name="loraRank" value="${formValues.loraRank||16}" min="4" max="128" /></label>
    <label>LoRA Alpha:<br><input type="number" name="loraAlpha" value="${formValues.loraAlpha||32}" min="4" max="256" /></label>
  </div>
  <div class="param-row">
    <label>LoRA Dropout:<br><input type="number" name="loraDropout" value="${formValues.loraDropout||0.1}" step="0.01" min="0" max="0.5" /></label>
    <label>Trigger Words:<br><input type="text" name="triggerWords" value="${formValues.triggerWords||''}" placeholder="comma,separated,words" /></label>
  </div>
</div>
```

### 4. Add Cost Calculation (HIGH PRIORITY)
**Current State**: No cost display or calculation
**Required**: Cost estimation before training submission

**Implementation**:
- Add cost calculation section to the form
- Display estimated cost in points
- Add "Calculate Cost" button
- Show cost confirmation before submission
- Integrate with existing points system

**Code Location**: Before the submit button
```javascript
<div class="form-section cost-section">
  <h3>Cost Estimation</h3>
  <div class="cost-display">
    <div class="cost-item">
      <span>Estimated Cost:</span>
      <span class="cost-value" id="estimated-cost">Click Calculate</span>
    </div>
    <button type="button" id="calculate-cost-btn">Calculate Cost</button>
  </div>
</div>
```

### 5. Update Form Submission Logic
**Current State**: Basic form submission without validation
**Required**: Enhanced validation and cost confirmation

**Implementation**:
- Add form validation for required fields
- Implement cost calculation before submission
- Add confirmation dialog for cost
- Update API call to include all new fields

**Code Location**: `submitForm()` method around line 546
```javascript
async submitForm() {
  const { formMode, formValues } = this.state;
  
  // Validate required fields
  if (formMode === 'new-training') {
    if (!formValues.modelType || !formValues.datasetId || !formValues.triggerWords) {
      this.setState({ formError: 'Please fill in all required fields' });
      return;
    }
    
    // Calculate and confirm cost
    const cost = await this.calculateTrainingCost(formValues);
    const confirmed = confirm(`Training will cost ${cost} points. Continue?`);
    if (!confirmed) return;
  }
  
  // Proceed with submission...
}
```

## CSS Styling Requirements
Add the following styles to `modsMenuModal.css`:

```css
/* Form Sections */
.form-section {
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid #333;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}

.form-section h3 {
  margin: 0 0 15px 0;
  color: #90caf9;
  font-size: 16px;
}

.param-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  margin-bottom: 10px;
}

.cost-section {
  background: rgba(255, 215, 0, 0.1);
  border-color: #ffd700;
}

.cost-display {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cost-item {
  display: flex;
  justify-content: space-between;
  font-weight: bold;
  font-size: 18px;
}

.cost-value {
  color: #ffd700;
}
```

## Success Criteria
- [ ] Model type dropdown with SDXL/FLUX/WAN options
- [ ] Training parameters section with steps, learning rate, batch size, resolution
- [ ] LoRA configuration with rank, alpha, dropout, trigger words
- [ ] Cost calculation and confirmation before submission
- [ ] Form validation for all required fields
- [ ] Updated API integration with all new fields
- [ ] Responsive CSS styling for new components

## Testing
1. Test form validation with missing required fields
2. Test model type selection updates baseModel field
3. Test cost calculation with different parameter combinations
4. Test form submission includes all new fields in API call
5. Test responsive design on mobile devices

## Notes
- Use default values from the training recipes (SDXLRecipe.js, FLUXRecipe.js, WANRecipe.js)
- Ensure all new fields are included in the API payload
- Maintain backward compatibility with existing functionality
- Follow the existing code style and patterns in ModsMenuModal.js
