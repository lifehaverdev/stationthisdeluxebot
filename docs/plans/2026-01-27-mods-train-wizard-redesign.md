# ModsMenuModal Train Tab Redesign

## Problem

The current Train tab in ModsMenuModal shows datasets first, an empty captions section (only populated on dataset selection), and a noisy all-at-once training form that overwhelms users with too many inputs upfront.

## Design

### Train Tab Dashboard (Two-Section Layout)

**Top: "Active Trainings"**
- Shows RUNNING, QUEUED, PROVISIONING, FINALIZING trainings as prominent status cards
- Each card: name, status badge (color-coded), progress bar with step count, model type, trigger word, action buttons (Cancel/View Details), HuggingFace link when completed
- Empty state: "No active trainings" with prominent "+ New Training" button

**Bottom: Two Sub-Sections**
- **"Datasets"** -- Compact card grid with name, image count, caption count badge, buttons (Edit, Captions, Use for Training)
- **"History"** -- Completed/failed trainings as compact list. Name, status, date, actions (Delete, Retry for failed, HF link for completed)

Standalone "Captions" section removed from dashboard. Caption management lives on dataset cards and in the wizard.

### Training Wizard (4-Step Sequential)

Replaces the current monolithic form. State tracked via `wizardStep: 1|2|3|4`.

**Step 1 -- "Choose Dataset"**
- Selectable dataset card grid (click to select, highlighted border)
- Cards show: name, image count, caption status badge
- "+ New Dataset" card at end
- "Next" button disabled until selection made

**Step 2 -- "Choose Model"**
- Three large radio-card buttons: SDXL / FLUX / WAN
- Brief description under each with key defaults
- Auto-fills all parameters from getModelDefaults()
- "Back" and "Next" buttons

**Step 3 -- "Choose Captions"**
- Lists existing caption sets for selected dataset
- Model-type-based recommendation text at top
- Radio-style selection of caption set
- "Generate New Captions" button if no suitable sets exist (opens existing caption dialog)
- "Back" and "Next" buttons

**Step 4 -- "Name & Review"**
- Name input with hint: trigger word auto-derived from name for single subject/style LoRAs
- Trigger word auto-filled from name
- Description textarea (optional, auto-generated via AI if blank)
- Summary card: dataset, model type, caption set, all defaults
- "Advanced Parameters" toggle with all config values (pre-filled)
- Cost display: auto-calculated from defaults, shown prominently
- "Review & Start Training" button -> confirmation dialog before submit

### Key Principles
- User makes only 4 decisions: dataset, model type, caption set, name
- All parameters have smart defaults
- Cost visible before submission
- Confirmation step before committing
