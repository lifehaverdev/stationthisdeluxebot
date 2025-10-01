# Training UI Phase 3: Advanced Features - Agent Prompt

## Objective
Implement advanced features for production-ready training UI including advanced parameters, marketplace features, and batch operations.

## Context
Phase 1 and 2 provided the essential training functionality. Phase 3 adds sophisticated features for power users, marketplace integration, and enterprise-level functionality.

## Files to Modify
- `src/platforms/web/client/src/sandbox/components/ModsMenuModal.js` (main training UI)
- `src/platforms/web/client/src/sandbox/components/modsMenuModal.css` (styling)
- `src/api/internal/trainingsApi.js` (training API updates)
- `src/api/internal/datasetsApi.js` (dataset API updates)
- `src/api/internal/marketplaceApi.js` (marketplace API - may need creation)

## Tasks

### 1. Advanced Training Parameters (LOW PRIORITY)
**Current State**: Basic training parameters (steps, learning rate, batch size)
**Required**: Advanced LoRA parameters, validation settings, optimization options

**Implementation**:
- Add advanced LoRA configuration section
- Add validation settings (validation steps, validation images)
- Add optimization settings (optimizer, scheduler, warmup steps)
- Add output configuration (save steps, save last N steps)
- Add advanced model-specific parameters

**Code Location**: Add after basic LoRA configuration
```javascript
<div class="form-section advanced-params">
  <h3>Advanced Parameters</h3>
  <div class="advanced-toggle">
    <label><input type="checkbox" id="show-advanced" /> Show Advanced Parameters</label>
  </div>
  
  <div class="advanced-content" id="advanced-content" style="display:none;">
    <div class="param-group">
      <h4>Validation Settings</h4>
      <div class="param-row">
        <label>Validation Steps:<br><input type="number" name="validationSteps" value="${formValues.validationSteps||100}" min="50" max="1000" /></label>
        <label>Validation Images:<br><input type="number" name="validationImages" value="${formValues.validationImages||4}" min="1" max="20" /></label>
      </div>
    </div>
    
    <div class="param-group">
      <h4>Optimization</h4>
      <div class="param-row">
        <label>Optimizer:<br>
          <select name="optimizer">
            <option value="AdamW8bit" ${formValues.optimizer==='AdamW8bit'?'selected':''}>AdamW8bit</option>
            <option value="AdamW" ${formValues.optimizer==='AdamW'?'selected':''}>AdamW</option>
            <option value="SGD" ${formValues.optimizer==='SGD'?'selected':''}>SGD</option>
          </select>
        </label>
        <label>Scheduler:<br>
          <select name="scheduler">
            <option value="cosine" ${formValues.scheduler==='cosine'?'selected':''}>Cosine</option>
            <option value="linear" ${formValues.scheduler==='linear'?'selected':''}>Linear</option>
            <option value="constant" ${formValues.scheduler==='constant'?'selected':''}>Constant</option>
          </select>
        </label>
      </div>
      <div class="param-row">
        <label>Warmup Steps:<br><input type="number" name="warmupSteps" value="${formValues.warmupSteps||100}" min="0" max="1000" /></label>
        <label>Save Steps:<br><input type="number" name="saveSteps" value="${formValues.saveSteps||500}" min="100" max="5000" /></label>
      </div>
    </div>
    
    <div class="param-group">
      <h4>Output Configuration</h4>
      <div class="param-row">
        <label>Save Last N Steps:<br><input type="number" name="saveLastNSteps" value="${formValues.saveLastNSteps||3}" min="1" max="10" /></label>
        <label>Model Name Suffix:<br><input type="text" name="modelSuffix" value="${formValues.modelSuffix||''}" placeholder="optional" /></label>
      </div>
    </div>
  </div>
</div>
```

### 2. Dataset Organization and Management (LOW PRIORITY)
**Current State**: Basic dataset list
**Required**: Collections, search, filtering, batch operations

**Implementation**:
- Add dataset collections for organization
- Add search and filtering capabilities
- Add batch operations (delete, move, export)
- Add dataset statistics and analytics
- Add dataset sharing and collaboration features

**Code Location**: Enhanced dataset dashboard
```javascript
// Enhanced dataset dashboard
const dsList = datasets.length ? `
  <div class="datasets-header">
    <div class="search-filter">
      <input type="text" id="dataset-search" placeholder="Search datasets..." />
      <select id="dataset-filter">
        <option value="all">All Datasets</option>
        <option value="private">Private</option>
        <option value="public">Public</option>
        <option value="unlisted">Unlisted</option>
      </select>
    </div>
    <div class="batch-actions">
      <button class="btn-secondary" id="select-all">Select All</button>
      <button class="btn-danger" id="delete-selected" disabled>Delete Selected</button>
      <button class="btn-primary" id="export-selected" disabled>Export Selected</button>
    </div>
  </div>
  <div class="datasets-grid">${datasets.map(ds=>`
    <div class="dataset-card" data-id="${ds._id}">
      <div class="dataset-header">
        <input type="checkbox" class="dataset-select" data-id="${ds._id}" />
        <h4>${ds.name||'Unnamed Dataset'}</h4>
        <span class="visibility-badge visibility-${ds.visibility||'private'}">${ds.visibility||'private'}</span>
      </div>
      <div class="dataset-preview">
        ${(ds.images||[]).slice(0,4).map(img=>`<img src="${img}" class="preview-thumb" />`).join('')}
        ${(ds.images||[]).length > 4 ? `<div class="more-count">+${(ds.images||[]).length - 4}</div>` : ''}
      </div>
      <div class="dataset-stats">
        <div class="stat-item">
          <span class="label">Images:</span>
          <span class="value">${(ds.images||[]).length}</span>
        </div>
        <div class="stat-item">
          <span class="label">Used:</span>
          <span class="value">${ds.usageCount||0} times</span>
        </div>
        <div class="stat-item">
          <span class="label">Size:</span>
          <span class="value">${this.formatBytes(ds.sizeBytes||0)}</span>
        </div>
      </div>
      <div class="dataset-actions">
        <button class="btn-secondary edit-dataset" data-id="${ds._id}">Edit</button>
        <button class="btn-primary use-dataset" data-id="${ds._id}">Use for Training</button>
        <button class="btn-danger delete-dataset" data-id="${ds._id}">Delete</button>
      </div>
    </div>
  `).join('')}</div>
` : '<div class="empty-message">No datasets yet. Create your first dataset to get started!</div>';
```

### 3. Marketplace Integration (LOW PRIORITY)
**Current State**: No marketplace features
**Required**: Pricing, licensing, sharing, monetization

**Implementation**:
- Add pricing and licensing options for datasets
- Add marketplace listing for trained models
- Add revenue sharing and monetization features
- Add licensing and usage tracking
- Add marketplace discovery and browsing

**Code Location**: Add marketplace sections
```javascript
// Dataset marketplace section
<div class="form-section marketplace-section">
  <h3>Marketplace Settings</h3>
  <div class="marketplace-options">
    <label><input type="checkbox" name="enableMarketplace" ${formValues.enableMarketplace?'checked':''} /> Enable marketplace listing</label>
    <div class="marketplace-details" id="marketplace-details" style="display:none;">
      <div class="param-row">
        <label>Price (USD):<br><input type="number" name="priceUSD" value="${formValues.priceUSD||0}" min="0" step="0.01" /></label>
        <label>License Type:<br>
          <select name="licenseType">
            <option value="commercial">Commercial Use</option>
            <option value="personal">Personal Use Only</option>
            <option value="creative-commons">Creative Commons</option>
          </select>
        </label>
      </div>
      <div class="param-row">
        <label>License Terms:<br><textarea name="licenseTerms" placeholder="Describe usage terms...">${formValues.licenseTerms||''}</textarea></label>
      </div>
    </div>
  </div>
</div>

// Training marketplace section
<div class="form-section marketplace-section">
  <h3>Model Marketplace</h3>
  <div class="marketplace-options">
    <label><input type="checkbox" name="publishModel" ${formValues.publishModel?'checked':''} /> Publish trained model to marketplace</label>
    <div class="publish-details" id="publish-details" style="display:none;">
      <div class="param-row">
        <label>Model Price (USD):<br><input type="number" name="modelPriceUSD" value="${formValues.modelPriceUSD||0}" min="0" step="0.01" /></label>
        <label>Rental Option:<br><input type="checkbox" name="enableRental" ${formValues.enableRental?'checked':''} /> Enable hourly rental</label>
      </div>
      <div class="param-row">
        <label>Rental Price (USD/hour):<br><input type="number" name="rentalPriceUSD" value="${formValues.rentalPriceUSD||0}" min="0" step="0.01" disabled /></label>
        <label>Rental Duration (hours):<br><input type="number" name="rentalDuration" value="${formValues.rentalDuration||24}" min="1" max="168" disabled /></label>
      </div>
    </div>
  </div>
</div>
```

### 4. Batch Operations (LOW PRIORITY)
**Current State**: Single-item operations only
**Required**: Multi-select, batch operations, bulk management

**Implementation**:
- Add multi-select checkboxes for datasets and trainings
- Add batch delete, move, and export operations
- Add bulk parameter updates
- Add batch cost calculation
- Add progress tracking for batch operations

**Code Location**: Add batch operation methods
```javascript
// Batch operation methods
selectAllItems(type) {
  const checkboxes = this.modalElement.querySelectorAll(`.${type}-select`);
  checkboxes.forEach(cb => cb.checked = true);
  this.updateBatchActions();
}

updateBatchActions() {
  const selectedDatasets = this.modalElement.querySelectorAll('.dataset-select:checked');
  const selectedTrainings = this.modalElement.querySelectorAll('.training-select:checked');
  
  const deleteBtn = this.modalElement.querySelector('#delete-selected');
  const exportBtn = this.modalElement.querySelector('#export-selected');
  
  if (selectedDatasets.length > 0 || selectedTrainings.length > 0) {
    deleteBtn.disabled = false;
    exportBtn.disabled = false;
  } else {
    deleteBtn.disabled = true;
    exportBtn.disabled = true;
  }
}

async batchDelete(type) {
  const selected = this.modalElement.querySelectorAll(`.${type}-select:checked`);
  const ids = Array.from(selected).map(cb => cb.dataset.id);
  
  if (ids.length === 0) return;
  
  const confirmed = confirm(`Delete ${ids.length} ${type}? This action cannot be undone.`);
  if (!confirmed) return;
  
  try {
    const response = await fetch(`/api/v1/${type}/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    
    if (response.ok) {
      this.fetchDatasets();
      this.fetchTrainings();
    }
  } catch (error) {
    console.error('Batch delete failed:', error);
  }
}
```

### 5. Advanced Analytics and Reporting (LOW PRIORITY)
**Current State**: Basic usage counts
**Required**: Detailed analytics, cost tracking, performance metrics

**Implementation**:
- Add detailed cost tracking and reporting
- Add training performance analytics
- Add usage statistics and trends
- Add export capabilities for reports
- Add predictive cost estimation

**Code Location**: Add analytics dashboard
```javascript
// Analytics dashboard
const analyticsContent = `
  <div class="analytics-dashboard">
    <div class="analytics-header">
      <h3>Training Analytics</h3>
      <div class="date-range">
        <input type="date" id="start-date" />
        <input type="date" id="end-date" />
        <button id="update-analytics">Update</button>
      </div>
    </div>
    
    <div class="analytics-grid">
      <div class="analytics-card">
        <h4>Total Cost</h4>
        <div class="metric-value">${analytics.totalCost} points</div>
        <div class="metric-change ${analytics.costChange >= 0 ? 'positive' : 'negative'}">
          ${analytics.costChange >= 0 ? '+' : ''}${analytics.costChange}%
        </div>
      </div>
      
      <div class="analytics-card">
        <h4>Training Success Rate</h4>
        <div class="metric-value">${analytics.successRate}%</div>
        <div class="metric-change ${analytics.successChange >= 0 ? 'positive' : 'negative'}">
          ${analytics.successChange >= 0 ? '+' : ''}${analytics.successChange}%
        </div>
      </div>
      
      <div class="analytics-card">
        <h4>Average Training Time</h4>
        <div class="metric-value">${analytics.avgTrainingTime}</div>
        <div class="metric-change ${analytics.timeChange >= 0 ? 'positive' : 'negative'}">
          ${analytics.timeChange >= 0 ? '+' : ''}${analytics.timeChange}%
        </div>
      </div>
      
      <div class="analytics-card">
        <h4>Models Created</h4>
        <div class="metric-value">${analytics.modelsCreated}</div>
        <div class="metric-change ${analytics.modelsChange >= 0 ? 'positive' : 'negative'}">
          ${analytics.modelsChange >= 0 ? '+' : ''}${analytics.modelsChange}%
        </div>
      </div>
    </div>
    
    <div class="analytics-charts">
      <div class="chart-container">
        <h4>Cost Over Time</h4>
        <canvas id="cost-chart"></canvas>
      </div>
      <div class="chart-container">
        <h4>Training Status Distribution</h4>
        <canvas id="status-chart"></canvas>
      </div>
    </div>
  </div>
`;
```

## CSS Styling Requirements
Add comprehensive styling for advanced features:

```css
/* Advanced Parameters */
.advanced-params {
  border: 1px solid #666;
  background: rgba(255, 255, 255, 0.02);
}

.advanced-toggle {
  margin-bottom: 15px;
}

.advanced-content {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #333;
}

.param-group {
  margin-bottom: 20px;
}

.param-group h4 {
  color: #90caf9;
  margin-bottom: 10px;
  font-size: 14px;
}

/* Dataset Grid */
.datasets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 15px;
  margin-top: 15px;
}

.dataset-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 15px;
  transition: all 0.3s ease;
}

.dataset-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: #90caf9;
}

.dataset-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.dataset-preview {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 5px;
  margin-bottom: 10px;
}

.preview-thumb {
  width: 100%;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
}

.more-count {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border-radius: 4px;
  font-size: 12px;
}

.dataset-stats {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.stat-item .label {
  color: #ccc;
}

.stat-item .value {
  color: #fff;
  font-weight: 500;
}

/* Marketplace */
.marketplace-section {
  background: rgba(255, 215, 0, 0.05);
  border-color: #ffd700;
}

.marketplace-details, .publish-details {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #333;
}

/* Analytics */
.analytics-dashboard {
  padding: 20px;
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.date-range {
  display: flex;
  gap: 10px;
  align-items: center;
}

.analytics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 30px;
}

.analytics-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 15px;
  text-align: center;
}

.analytics-card h4 {
  color: #90caf9;
  margin-bottom: 10px;
  font-size: 14px;
}

.metric-value {
  font-size: 24px;
  font-weight: bold;
  color: #fff;
  margin-bottom: 5px;
}

.metric-change {
  font-size: 12px;
  font-weight: 500;
}

.metric-change.positive {
  color: #66bb6a;
}

.metric-change.negative {
  color: #ef5350;
}

.analytics-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.chart-container {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 15px;
}

.chart-container h4 {
  color: #90caf9;
  margin-bottom: 15px;
  font-size: 14px;
}

.chart-container canvas {
  width: 100%;
  height: 200px;
}

/* Responsive Design */
@media (max-width: 768px) {
  .datasets-grid {
    grid-template-columns: 1fr;
  }
  
  .analytics-grid {
    grid-template-columns: 1fr;
  }
  
  .analytics-charts {
    grid-template-columns: 1fr;
  }
}
```

## Success Criteria
- [ ] Advanced training parameters with collapsible sections
- [ ] Enhanced dataset management with collections and search
- [ ] Marketplace integration with pricing and licensing
- [ ] Batch operations for datasets and trainings
- [ ] Analytics dashboard with cost tracking and performance metrics
- [ ] Responsive design for all advanced features
- [ ] Export capabilities for reports and data

## Testing
1. Test advanced parameter validation and defaults
2. Test dataset search and filtering functionality
3. Test marketplace pricing and licensing features
4. Test batch operations with multiple selections
5. Test analytics dashboard with real data
6. Test responsive design on mobile devices
7. Test export functionality for reports

## Notes
- Advanced features should be opt-in to avoid overwhelming basic users
- Ensure all new features integrate with existing API endpoints
- Add proper loading states for all async operations
- Implement proper error handling for batch operations
- Follow existing code patterns and maintain consistency
- Add proper accessibility attributes for all new components
