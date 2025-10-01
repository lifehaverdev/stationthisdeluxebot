# Training UI Phase 2: Enhanced Features - Agent Prompt

## Objective
Implement enhanced features for dataset management, real-time updates, and improved user experience in the training UI.

## Context
Phase 1 focused on critical missing fields. Phase 2 adds sophisticated features like caption generation, real-time progress tracking, and enhanced dataset management to provide a production-ready training experience.

## Files to Modify
- `src/platforms/web/client/src/sandbox/components/ModsMenuModal.js` (main training UI)
- `src/platforms/web/client/src/sandbox/components/modsMenuModal.css` (styling)
- `src/api/internal/datasetsApi.js` (dataset API - may need creation)
- `src/api/internal/trainingsApi.js` (training API updates)

## Tasks

### 1. Enhanced Dataset Form (MEDIUM PRIORITY)
**Current State**: Basic dataset form with only name and description
**Required**: Image management, caption generation, validation, tags

**Implementation**:
- Add image upload/management section with preview
- Add caption generation options (auto-generate vs manual)
- Add tags input for organization
- Add visibility settings (private/unlisted/public)
- Add image validation and error handling

**Code Location**: Dataset form section around line 376
```javascript
// Enhanced dataset form
<form class="dataset-form">
  <div class="form-section">
    <h3>Basic Information</h3>
    <label>Dataset Name:<br><input type="text" name="name" value="${formValues.name||''}" required /></label><br>
    <label>Description:<br><textarea name="description">${formValues.description||''}</textarea></label><br>
    <label>Tags:<br><input type="text" name="tags" value="${formValues.tags||''}" placeholder="comma,separated,tags" /></label><br>
  </div>

  <div class="form-section">
    <h3>Images</h3>
    <div class="image-upload">
      <label>Add Images (URLs):<br>
        <textarea name="imageUrls" placeholder="Enter image URLs, one per line or comma-separated"></textarea>
      </label>
      <button type="button" class="add-images-btn">Add Images</button>
    </div>
    
    <div class="image-preview" id="image-preview">
      ${(formValues.images||[]).map(url => `
        <div class="image-item">
          <img src="${url}" class="thumb" />
          <button type="button" class="remove-image" data-url="${url}">×</button>
        </div>
      `).join('')}
    </div>
  </div>

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
</form>
```

### 2. Real-time Progress Tracking (MEDIUM PRIORITY)
**Current State**: Static status display
**Required**: Live progress updates, WebSocket integration

**Implementation**:
- Add WebSocket event listeners for training updates
- Update training cards with real-time progress
- Add progress bars and status indicators
- Handle training completion and error states

**Code Location**: Add to ModsMenuModal constructor and methods
```javascript
// Add to constructor
this.ws = window.websocketClient;

// Add event listeners
if (this.ws) {
  this.ws.on('trainingUpdate', (data) => {
    this.updateTrainingStatus(data.trainingId, data.status, data.progress);
    this.render();
  });
  
  this.ws.on('trainingError', (data) => {
    this.showTrainingError(data.trainingId, data.error);
  });
}

// Add update method
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

### 3. Enhanced Training Dashboard (MEDIUM PRIORITY)
**Current State**: Simple list of trainings
**Required**: Card-based layout with detailed information and actions

**Implementation**:
- Replace simple list with training cards
- Add progress bars, cost display, and status badges
- Add action buttons (view details, cancel, retry, download)
- Add filtering and sorting options

**Code Location**: Training dashboard section around line 390
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

### 4. Cost Calculation Service Integration (MEDIUM PRIORITY)
**Current State**: No cost calculation
**Required**: Real-time cost calculation based on parameters

**Implementation**:
- Add cost calculation API integration
- Calculate cost based on model type, steps, and other parameters
- Display cost breakdown (GPU time, storage, processing)
- Add cost confirmation before training submission

**Code Location**: Add cost calculation methods
```javascript
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
    return costData.totalCost;
  } catch (error) {
    console.error('Failed to calculate cost:', error);
    return 0;
  }
}

// Add to form submission
async submitForm() {
  const { formMode, formValues } = this.state;
  
  if (formMode === 'new-training') {
    const cost = await this.calculateTrainingCost(formValues);
    const confirmed = confirm(`Training will cost ${cost} points. Continue?`);
    if (!confirmed) return;
  }
  
  // Proceed with submission...
}
```

### 5. Error Handling and Validation (MEDIUM PRIORITY)
**Current State**: Basic error display
**Required**: Comprehensive error handling and user feedback

**Implementation**:
- Add detailed error messages for different failure types
- Add input validation with helpful error messages
- Add retry mechanisms for failed operations
- Add loading states and progress indicators

**Code Location**: Add error handling methods
```javascript
showTrainingError(trainingId, error) {
  const training = this.state.trainings.find(t => t._id === trainingId);
  if (training) {
    training.error = error;
    training.status = 'FAILED';
  }
  this.render();
}

validateForm(formData, formMode) {
  const errors = [];
  
  if (formMode === 'new-training') {
    if (!formData.modelType) errors.push('Model type is required');
    if (!formData.datasetId) errors.push('Dataset is required');
    if (!formData.triggerWords) errors.push('Trigger words are required');
    if (formData.steps && (formData.steps < 100 || formData.steps > 5000)) {
      errors.push('Steps must be between 100 and 5000');
    }
  }
  
  if (formMode === 'new-dataset') {
    if (!formData.name) errors.push('Dataset name is required');
    if (!formData.images || formData.images.length === 0) {
      errors.push('At least one image is required');
    }
  }
  
  return errors;
}
```

## CSS Styling Requirements
Add comprehensive styling for new components:

```css
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

/* Action Buttons */
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

/* Responsive Design */
@media (max-width: 768px) {
  .trainings-grid {
    grid-template-columns: 1fr;
  }
  
  .training-actions {
    flex-direction: column;
  }
}
```

## Success Criteria
- [ ] Enhanced dataset form with image management and caption generation
- [ ] Real-time progress tracking with WebSocket integration
- [ ] Card-based training dashboard with detailed information
- [ ] Cost calculation service integration
- [ ] Comprehensive error handling and validation
- [ ] Responsive design for all new components
- [ ] Action buttons for training management (cancel, retry, download)

## Testing
1. Test image upload and preview functionality
2. Test caption generation with different methods
3. Test real-time progress updates via WebSocket
4. Test cost calculation with various parameter combinations
5. Test error handling and validation messages
6. Test responsive design on mobile devices
7. Test training action buttons (cancel, retry, download)

## Notes
- Ensure WebSocket integration works with existing websocketClient
- Add proper loading states for all async operations
- Implement proper error boundaries for failed operations
- Follow existing code patterns and maintain consistency
- Add proper accessibility attributes for screen readers
