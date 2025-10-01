# Training UI Debug Context - Quick Reference

## Current State
The training UI in `ModsMenuModal.js` has significant gaps compared to the backend TrainingDB schema. Only 4 basic fields are captured but the backend expects 20+ fields.

## Key Files
- **Frontend**: `src/platforms/web/client/src/sandbox/components/ModsMenuModal.js` (lines 374-384 for training form)
- **Backend API**: `src/api/internal/trainingsApi.js` 
- **Database Schemas**: `src/core/services/db/trainingDb.js`, `datasetDb.js`, `loRAModelDb.js`
- **Training System**: `src/core/services/training/` (orchestrator, recipes, etc.)

## Critical Missing Features
1. **Model Type Selection**: No dropdown for SDXL/FLUX/WAN (currently just text input)
2. **Training Parameters**: Missing steps, learning rate, batch size, resolution inputs
3. **LoRA Configuration**: Missing rank, alpha, dropout, trigger words
4. **Cost Calculation**: No cost display or confirmation before training
5. **Real-time Updates**: No WebSocket integration for progress tracking

## Current Form Fields (ModsMenuModal.js:374-384)
```javascript
<form class="train-form">
  <label>Name:<br><input type="text" name="name" /></label><br>
  <label>Dataset:<br><select name="datasetId">${dsOptions}</select></label><br>
  <label>Base Model:<br><input name="baseModel" /></label><br>
  <label>Offering ID:<br><input name="offeringId" /></label><br>
  <button type="submit">Save</button>
</form>
```

## Backend Schema Requirements (TrainingDB)
```javascript
{
  datasetId: ObjectId,           // ✅ Mapped
  ownerAccountId: ObjectId,      // ❌ Missing (auto-populated)
  offeringId: string,            // ✅ Mapped  
  baseModel: string,             // ✅ Mapped
  status: 'QUEUED'|'RUNNING'|'FAILED'|'COMPLETED', // ❌ Missing
  progress?: number,             // ❌ Missing
  costPoints?: number,           // ❌ Missing (critical)
  triggerWords?: [string],       // ❌ Missing (required for LoRA)
  // ... 15+ more fields
}
```

## Common Issues
1. **Form Submission**: Missing validation for required fields
2. **API Integration**: Frontend calls `/api/v1/trainings` but backend expects different payload
3. **Cost Management**: No cost calculation or points deduction
4. **Error Handling**: Basic error display only
5. **Progress Tracking**: Static status, no real-time updates

## Quick Fixes Needed
1. Add model type dropdown (SDXL/FLUX/WAN)
2. Add training parameters section (steps, learning rate, batch size)
3. Add LoRA configuration (rank, alpha, dropout, trigger words)
4. Add cost calculation before submission
5. Add form validation for required fields

## API Endpoints
- `POST /api/v1/trainings` - Create training (needs enhancement)
- `GET /api/v1/trainings/owner/:masterAccountId` - List trainings
- `POST /api/v1/trainings/calculate-cost` - Calculate cost (needs creation)
- `POST /api/v1/datasets` - Create dataset (needs creation)

## WebSocket Events
- `trainingUpdate` - Real-time progress updates
- `trainingError` - Training failure notifications

## Testing
- Unit tests: `tests/training-ui/unit/`
- Integration tests: `tests/training-ui/integration/`
- E2E tests: `tests/training-ui/e2e/`

## Priority Order
1. **HIGH**: Model selection, basic parameters, cost calculation
2. **MEDIUM**: Real-time updates, enhanced error handling
3. **LOW**: Advanced features, marketplace integration

## Related Documents
- `TRAINING_UI_AUDIT_REPORT.md` - Detailed analysis
- `TRAINING_UI_UPDATE_PROPOSALS.md` - Implementation guide
- `agent_prompts/training_ui_phase1_critical_fixes_prompt.md` - Phase 1 details
