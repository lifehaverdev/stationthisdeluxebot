# Training UI Update Proposals

## Overview

Based on the audit findings, here are specific UI updates needed to align the frontend with the new training system architecture.

## 1. Enhanced Training Form

### Current Form (ModsMenuModal.js lines 374-384)
```javascript
<form class="train-form">
  <label>Name:<br><input type="text" name="name" value="${formValues.name||''}" /></label><br>
  <label>Dataset:<br><select name="datasetId">${dsOptions}</select></label><br>
  <label>Base Model:<br><input name="baseModel" value="${formValues.baseModel||''}" /></label><br>
  <label>Offering ID:<br><input name="offeringId" value="${formValues.offeringId||''}" /></label><br>
  <button type="submit">Save</button>
</form>
```

### Proposed Enhanced Form
```javascript
<form class="train-form">
  <!-- Basic Information -->
  <div class="form-section">
    <h3>Basic Information</h3>
    <label>Training Name:<br><input type="text" name="name" value="${formValues.name||''}" required /></label><br>
    <label>Dataset:<br><select name="datasetId" required>${dsOptions}</select></label><br>
  </div>

  <!-- Model Configuration -->
  <div class="form-section">
    <h3>Model Configuration</h3>
    <label>Model Type:<br>
      <select name="modelType" required>
        <option value="SDXL" ${formValues.modelType==='SDXL'?'selected':''}>SDXL</option>
        <option value="FLUX" ${formValues.modelType==='FLUX'?'selected':''}>FLUX</option>
        <option value="WAN" ${formValues.modelType==='WAN'?'selected':''}>WAN</option>
      </select>
    </label><br>
    <label>Base Model:<br><input name="baseModel" value="${formValues.baseModel||'SDXL'}" readonly /></label><br>
    <label>Offering ID:<br><input name="offeringId" value="${formValues.offeringId||''}" /></label><br>
  </div>

  <!-- Training Parameters -->
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

  <!-- LoRA Configuration -->
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

  <!-- Cost Estimation -->
  <div class="form-section cost-section">
    <h3>Cost Estimation</h3>
    <div class="cost-display">
      <div class="cost-item">
        <span>Estimated Cost:</span>
        <span class="cost-value" id="estimated-cost">Calculating...</span>
      </div>
      <div class="cost-breakdown" id="cost-breakdown" style="display:none;">
        <div>GPU Time: <span id="gpu-cost">-</span></div>
        <div>Storage: <span id="storage-cost">-</span></div>
        <div>Processing: <span id="processing-cost">-</span></div>
      </div>
      <button type="button" id="calculate-cost-btn">Calculate Cost</button>
    </div>
  </div>

  <!-- Actions -->
  <div class="form-actions">
    <button type="submit" ${submitting?'disabled':''}>${submitting?'Creating Training...':'Create Training'}</button>
    <button type="button" class="cancel-btn">Cancel</button>
  </div>
</form>
```

## 2. Enhanced Dataset Form

### Current Dataset Form
```javascript
// Only has name and description fields
<label>Name:<br><input type="text" name="name" value="${formValues.name||''}" /></label><br>
<label>Description:<br><textarea name="description">${formValues.description||''}</textarea></label><br>
```

### Proposed Enhanced Dataset Form
```javascript
<form class="dataset-form">
  <!-- Basic Information -->
  <div class="form-section">
    <h3>Basic Information</h3>
    <label>Dataset Name:<br><input type="text" name="name" value="${formValues.name||''}" required /></label><br>
    <label>Description:<br><textarea name="description">${formValues.description||''}</textarea></label><br>
    <label>Tags:<br><input type="text" name="tags" value="${formValues.tags||''}" placeholder="comma,separated,tags" /></label><br>
  </div>

  <!-- Image Management -->
  <div class="form-section">
    <h3>Images</h3>
    <div class="image-upload">
      <label>Add Images (URLs):<br>
        <textarea name="imageUrls" placeholder="Enter image URLs, one per line or comma-separated"></textarea>
      </label>
      <button type="button" class="add-images-btn">Add Images</button>
    </div>
    
    <!-- Image Preview -->
    <div class="image-preview" id="image-preview">
      ${(formValues.images||[]).map(url => `
        <div class="image-item">
          <img src="${url}" class="thumb" />
          <button type="button" class="remove-image" data-url="${url}">×</button>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- Caption Generation -->
  <div class="form-section">
    <h3>Captions</h3>
    <div class="caption-options">
      <label><input type="checkbox" name="autoGenerateCaptions" ${formValues.autoGenerateCaptions?'checked':''} /> Auto-generate captions using AI</label>
      <label><input type="checkbox" name="manualCaptions" ${formValues.manualCaptions?'checked':''} /> I'll add captions manually</label>
    </div>
    <div class="caption-method" id="caption-method" style="display:none;">
      <select name="captionMethod">
        <option value="blip">BLIP (Recommended)</option>
        <option value="clip">CLIP</option>
        <option value="sd-captioner">SD Captioner</option>
      </select>
    </div>
  </div>

  <!-- Visibility Settings -->
  <div class="form-section">
    <h3>Visibility</h3>
    <label>Visibility:<br>
      <select name="visibility">
        <option value="private" ${formValues.visibility==='private'?'selected':''}>Private</option>
        <option value="unlisted" ${formValues.visibility==='unlisted'?'selected':''}>Unlisted</option>
        <option value="public" ${formValues.visibility==='public'?'selected':''}>Public</option>
      </select>
    </label><br>
  </div>

  <!-- Actions -->
  <div class="form-actions">
    <button type="submit" ${submitting?'disabled':''}>${submitting?'Saving Dataset...':'Save Dataset'}</button>
    <button type="button" class="cancel-btn">Cancel</button>
  </div>
</form>
```

## 3. Enhanced Training Dashboard

### Current Dashboard
```javascript
const trList = trainings.length ? 
  '<ul class="train-list">'+trainings.map(tr=>`
    <li class="train-item">${tr.name||'Training'} - <em>${tr.status||'draft'}</em></li>
  `).join('')+'</ul>' : 
  '<div class="empty-message">No trainings yet.</div>';
```

### Proposed Enhanced Dashboard
```javascript
const trList = trainings.length ? 
  '<div class="trainings-grid">'+trainings.map(tr=>`
    <div class="training-card" data-id="${tr._id}">
      <div class="training-header">
        <h4>${tr.name||'Unnamed Training'}</h4>
        <span class="status-badge status-${tr.status||'draft'}">${tr.status||'draft'}</span>
      </div>
      <div class="training-details">
        <div class="detail-item">
          <span class="label">Model:</span>
          <span class="value">${tr.baseModel||'Unknown'}</span>
        </div>
        <div class="detail-item">
          <span class="label">Dataset:</span>
          <span class="value">${tr.datasetName||'Unknown'}</span>
        </div>
        <div class="detail-item">
          <span class="label">Progress:</span>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${tr.progress||0}%"></div>
          </div>
          <span class="progress-text">${tr.progress||0}%</span>
        </div>
        <div class="detail-item">
          <span class="label">Cost:</span>
          <span class="value">${tr.costPoints||0} points</span>
        </div>
        <div class="detail-item">
          <span class="label">Created:</span>
          <span class="value">${new Date(tr.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="training-actions">
        <button class="btn-secondary view-details" data-id="${tr._id}">View Details</button>
        ${tr.status === 'QUEUED' ? '<button class="btn-danger cancel-training" data-id="${tr._id}">Cancel</button>' : ''}
        ${tr.status === 'FAILED' ? '<button class="btn-primary retry-training" data-id="${tr._id}">Retry</button>' : ''}
        ${tr.status === 'COMPLETED' ? '<button class="btn-success download-model" data-id="${tr._id}">Download</button>' : ''}
      </div>
    </div>
  `).join('')+'</div>' : 
  '<div class="empty-message">No trainings yet. Create your first training to get started!</div>';
```

## 4. Real-time Status Updates

### WebSocket Integration
```javascript
// Add to ModsMenuModal constructor
this.ws = window.websocketClient;

// Add event listeners
if (this.ws) {
  this.ws.on('trainingUpdate', (data) => {
    this.updateTrainingStatus(data.trainingId, data.status, data.progress);
    this.render(); // Re-render to show updates
  });
  
  this.ws.on('trainingError', (data) => {
    this.showTrainingError(data.trainingId, data.error);
  });
}

// Update method
updateTrainingStatus(trainingId, status, progress) {
  const training = this.state.trainings.find(t => t._id === trainingId);
  if (training) {
    training.status = status;
    training.progress = progress;
    if (status === 'COMPLETED' || status === 'FAILED') {
      training.completedAt = new Date();
    }
  }
}
```

## 5. Cost Calculation Service

### Cost Calculation Integration
```javascript
// Add to ModsMenuModal
async calculateTrainingCost(formData) {
  try {
    const response = await fetch('/api/v1/training/calculate-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    const costData = await response.json();
    this.setState({ 
      estimatedCost: costData.totalCost,
      costBreakdown: costData.breakdown 
    });
  } catch (error) {
    console.error('Failed to calculate cost:', error);
  }
}

// Add to form submission
async submitForm() {
  const { formMode, formValues } = this.state;
  
  // Calculate cost before submission
  if (formMode === 'new-training') {
    await this.calculateTrainingCost(formValues);
    
    // Show cost confirmation
    const confirmed = confirm(`Training will cost ${this.state.estimatedCost} points. Continue?`);
    if (!confirmed) return;
  }
  
  // Proceed with submission...
}
```

## 6. CSS Styling Updates

### Add to modsMenuModal.css
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

/* Parameter Rows */
.param-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  margin-bottom: 10px;
}

.param-row label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

/* Cost Section */
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

.cost-breakdown {
  font-size: 14px;
  color: #ccc;
}

/* Training Cards */
.trainings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.training-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 15px;
  transition: all 0.3s ease;
}

.training-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: #90caf9;
}

.training-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
}

.status-queued { background: #ffa726; color: #000; }
.status-running { background: #42a5f5; color: #fff; }
.status-completed { background: #66bb6a; color: #fff; }
.status-failed { background: #ef5350; color: #fff; }

.training-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 15px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.label {
  color: #ccc;
  font-size: 14px;
}

.value {
  color: #fff;
  font-weight: 500;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
  margin: 0 10px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #42a5f5, #66bb6a);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: #ccc;
  min-width: 35px;
}

.training-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-secondary, .btn-danger, .btn-primary, .btn-success {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-secondary { background: #666; color: #fff; }
.btn-danger { background: #ef5350; color: #fff; }
.btn-primary { background: #42a5f5; color: #fff; }
.btn-success { background: #66bb6a; color: #fff; }

.btn-secondary:hover { background: #777; }
.btn-danger:hover { background: #f44336; }
.btn-primary:hover { background: #2196f3; }
.btn-success:hover { background: #4caf50; }

/* Image Preview */
.image-preview {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.image-item {
  position: relative;
  border-radius: 4px;
  overflow: hidden;
}

.image-item img {
  width: 100%;
  height: 80px;
  object-fit: cover;
}

.remove-image {
  position: absolute;
  top: 2px;
  right: 2px;
  background: rgba(239, 83, 80, 0.8);
  color: white;
  border: none;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Responsive Design */
@media (max-width: 768px) {
  .param-row {
    grid-template-columns: 1fr;
  }
  
  .trainings-grid {
    grid-template-columns: 1fr;
  }
  
  .training-actions {
    flex-direction: column;
  }
}
```

## Implementation Priority

1. **Phase 1 (Critical)**: Enhanced training form with model selection and cost calculation
2. **Phase 2 (Important)**: Enhanced dataset form with caption generation
3. **Phase 3 (Nice to have)**: Real-time updates and advanced dashboard features

## Next Steps

1. Update `ModsMenuModal.js` with enhanced forms
2. Add CSS styling for new components
3. Implement cost calculation service integration
4. Add WebSocket real-time updates
5. Test with backend API endpoints
