# Training Frontend UI Audit Report

## Executive Summary

The current training UI in `ModsMenuModal.js` has significant gaps when compared to the backend TrainingDB schema and new training system architecture. The frontend only captures basic fields and lacks critical training parameters, cost calculation, and proper model type selection.

## Current Frontend Form Fields

### Dataset Form
- ✅ `name` (string) - Maps to DatasetDB.name
- ✅ `description` (string) - Maps to DatasetDB.description  
- ✅ Image upload via URLs - Maps to DatasetDB.images array

### Training Form
- ✅ `name` (string) - Maps to TrainingDB (but missing from schema)
- ✅ `datasetId` (ObjectId) - Maps to TrainingDB.datasetId
- ✅ `baseModel` (string) - Maps to TrainingDB.baseModel
- ✅ `offeringId` (string) - Maps to TrainingDB.offeringId

## Backend Schema Requirements

### TrainingDB Schema (Required Fields)
```javascript
{
  _id: ObjectId,
  datasetId: ObjectId,           // ✅ Mapped
  ownerAccountId: ObjectId,      // ❌ Missing (should be auto-populated)
  offeringId: string,            // ✅ Mapped
  baseModel: string,             // ✅ Mapped
  status: 'QUEUED'|'RUNNING'|'FAILED'|'COMPLETED', // ❌ Missing (auto-set)
  progress?: number,             // ❌ Missing (auto-tracked)
  failureReason?: string,        // ❌ Missing (auto-tracked)
  createdAt: Date,               // ❌ Missing (auto-set)
  updatedAt: Date,               // ❌ Missing (auto-set)
  startedAt?: Date,              // ❌ Missing (auto-set)
  completedAt?: Date,            // ❌ Missing (auto-set)
  costPoints?: number,           // ❌ Missing (critical for billing)
  paidAt?: Date,                 // ❌ Missing (auto-set)
  loraModelId?: ObjectId,        // ❌ Missing (auto-generated)
  modelRepoUrl?: string,         // ❌ Missing (auto-generated)
  triggerWords?: [string],       // ❌ Missing (user input needed)
  previewImages?: [string]       // ❌ Missing (auto-generated)
}
```

### DatasetDB Schema (Required Fields)
```javascript
{
  _id: ObjectId,
  name: string,                  // ✅ Mapped
  description?: string,          // ✅ Mapped
  ownerAccountId: ObjectId,      // ❌ Missing (should be auto-populated)
  createdAt: Date,               // ❌ Missing (auto-set)
  updatedAt: Date,               // ❌ Missing (auto-set)
  images: [string],              // ✅ Mapped (via URL input)
  normalizationImages?: [string], // ❌ Missing
  captionSets: [Object],         // ❌ Missing (critical for training)
  tags?: [string],               // ❌ Missing
  sizeBytes?: number,            // ❌ Missing (auto-calculated)
  usageCount: number,            // ❌ Missing (auto-tracked)
  visibility: 'public'|'private'|'unlisted', // ❌ Missing
  accessControl?: [ObjectId],    // ❌ Missing
  monetization?: Object,         // ❌ Missing
  trainingIds?: [ObjectId],      // ❌ Missing (auto-tracked)
  publishedTo?: Object,          // ❌ Missing
  status: 'draft'|'ready'|'locked'|'archived' // ❌ Missing (auto-set)
}
```

## Critical Missing Fields

### 1. Training Parameters (High Priority)
- **Model Type Selection**: No dropdown for SDXL/FLUX/WAN
- **Training Steps**: No input for training steps (defaults in recipes)
- **Learning Rate**: No input for learning rate (defaults in recipes)
- **Batch Size**: No input for batch size (defaults in recipes)
- **Resolution**: No input for image resolution (defaults in recipes)
- **LoRA Parameters**: No inputs for rank, alpha, dropout
- **Trigger Words**: No input for LoRA trigger words
- **Validation Settings**: No inputs for validation steps/images

### 2. Cost Management (High Priority)
- **Cost Calculation**: No display of estimated training cost
- **Points Deduction**: No confirmation of points charge
- **Cost Breakdown**: No breakdown by model type/complexity

### 3. Dataset Management (Medium Priority)
- **Caption Generation**: No option to generate captions automatically
- **Image Validation**: No validation of image URLs/format
- **Dataset Status**: No status management (draft/ready/locked)
- **Tags**: No tagging system for organization

### 4. Job Management (Medium Priority)
- **Job Status Display**: Basic status only, no progress tracking
- **Error Handling**: No detailed error display
- **Job History**: No historical job tracking
- **Cancel/Retry**: No job control options

## Compatibility Matrix

| Frontend Field | Backend Schema | Status | Notes |
|----------------|----------------|--------|-------|
| `name` (dataset) | DatasetDB.name | ✅ | Direct mapping |
| `description` (dataset) | DatasetDB.description | ✅ | Direct mapping |
| Image URLs | DatasetDB.images | ✅ | Array mapping |
| `name` (training) | TrainingDB (missing) | ⚠️ | Not in schema but used |
| `datasetId` | TrainingDB.datasetId | ✅ | ObjectId mapping |
| `baseModel` | TrainingDB.baseModel | ✅ | String mapping |
| `offeringId` | TrainingDB.offeringId | ✅ | String mapping |
| Model type selection | TrainingDB.baseModel | ❌ | Missing UI dropdown |
| Training parameters | Recipe config | ❌ | Missing all training params |
| Cost calculation | TrainingDB.costPoints | ❌ | Missing cost UI |
| Trigger words | TrainingDB.triggerWords | ❌ | Missing input |
| Caption generation | DatasetDB.captionSets | ❌ | Missing functionality |
| Job status/progress | TrainingDB.status/progress | ❌ | Missing real-time updates |

## Recommendations

### Phase 1: Critical Fixes (Immediate)
1. **Add Model Type Selection**: Dropdown for SDXL/FLUX/WAN
2. **Add Cost Calculation**: Display estimated cost before training
3. **Add Training Parameters**: Basic parameters (steps, learning rate, batch size)
4. **Add Trigger Words Input**: Required for LoRA training
5. **Fix API Endpoints**: Ensure frontend calls correct training APIs

### Phase 2: Enhanced Features (Next Sprint)
1. **Add Caption Generation**: Auto-generate captions for datasets
2. **Add Progress Tracking**: Real-time job status updates
3. **Add Error Handling**: Detailed error messages and retry options
4. **Add Dataset Validation**: Image format and URL validation
5. **Add Job Management**: Cancel, retry, and history features

### Phase 3: Advanced Features (Future)
1. **Add Advanced Parameters**: LoRA rank, alpha, dropout settings
2. **Add Validation Settings**: Custom validation steps and images
3. **Add Dataset Organization**: Tags, collections, search
4. **Add Marketplace Features**: Pricing, licensing, sharing
5. **Add Batch Operations**: Multiple dataset/training management

## Implementation Priority

1. **HIGH**: Model type selection, cost calculation, basic training parameters
2. **MEDIUM**: Caption generation, progress tracking, error handling
3. **LOW**: Advanced parameters, marketplace features, batch operations

## Next Steps

1. Update frontend form to include missing critical fields
2. Implement cost calculation service integration
3. Add proper API endpoint mapping
4. Create real-time status update system
5. Add comprehensive error handling and validation
