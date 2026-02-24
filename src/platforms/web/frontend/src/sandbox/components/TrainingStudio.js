import { Component, h } from '@monygroupcorp/microact';
import { Loader, ModalError } from './Modal.js';
import { AsyncButton, EmptyState, Badge, ConfirmInline } from './ModalKit.js';
import { fetchJson, postWithCsrf, fetchWithCsrf } from '../../lib/api.js';
import { websocketClient } from '../ws.js';

const ACTIVE_STATUSES = ['QUEUED', 'PROVISIONING', 'RUNNING', 'FINALIZING'];
const DASH = { MAIN: 'main', DATASET_DETAIL: 'dsDetail', DATASET_FORM: 'dsForm', WIZARD: 'wizard', CAPTION_VIEWER: 'captionViewer', CONTROL_VIEWER: 'controlViewer' };

function normalizeId(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val.$oid) return val.$oid;
  if (typeof val.toString === 'function') return val.toString();
  return String(val);
}

/**
 * TrainingStudio — dashboard, dataset CRUD, training wizard, WS integration.
 *
 * Props:
 *   userId  — current user masterAccountId
 *   onClose — close handler for the parent modal
 */
export class TrainingStudio extends Component {
  constructor(props) {
    super(props);
    this.state = {
      view: DASH.MAIN,

      // Dashboard
      datasets: [],
      trainings: [],
      loading: true,
      error: null,

      // Dataset detail
      selectedDatasetId: null,
      captionSets: [],
      captionsLoading: false,
      captionsError: null,

      // Dataset form
      formMode: null, // 'new' | 'edit'
      formValues: {},
      formError: null,
      formSubmitting: false,
      uploadMethod: 'upload',
      uploading: false,
      uploadProgress: 0,

      // Caption viewer
      viewingCaptionSet: null,
      editingCaptionIdx: null,
      editingCaptionText: '',
      savingCaption: false,

      // Control viewer
      viewingControlSet: null,

      // Wizard
      wizardStep: 0,
      wizardDatasetId: null,
      wizardModelType: null,
      wizardTrainingMode: null,
      wizardCaptionSetId: null,
      wizardControlSetId: null,
      wizardFormValues: {},
      wizardCaptionSets: [],
      wizardControlSets: [],
      wizardLoadingCaptions: false,
      wizardLoadingControlSets: false,
      wizardSubmitting: false,
      estimatedCost: null,

      // Progress
      embellishmentTasks: {},
      captionTasks: {},

      // Embellishment pre-flight dialog
      embellishDialog: null,

      // Confirm
      confirmDeleteTraining: null,
    };
  }

  didMount() {
    this._fetchAll();
    this._setupWS();
    this.setInterval(() => this._pollTrainings(), 10000);
  }

  // ── WebSocket ──────────────────────────────────────────

  _setupWS() {
    const onTrainingUpdate = (data) => {
      const tr = this.state.trainings.find(t => t._id === data.trainingId);
      if (tr) {
        tr.status = data.status;
        tr.progress = data.progress;
        if (data.status === 'COMPLETED' || data.status === 'FAILED') tr.completedAt = new Date();
        this.setState({ trainings: [...this.state.trainings] });
      }
    };
    const onTrainingError = (data) => {
      const tr = this.state.trainings.find(t => t._id === data.trainingId);
      if (tr) { tr.error = data.error; tr.status = 'FAILED'; }
      this.setState({ trainings: [...this.state.trainings] });
    };
    const onCaptionProgress = (data) => {
      const dsId = normalizeId(data.datasetId);
      if (data.captionSetId && normalizeId(this.state.selectedDatasetId) === dsId) {
        this._fetchCaptionSets(data.datasetId);
      }
      if (this.state.wizardStep === 3 && normalizeId(this.state.wizardDatasetId) === dsId) {
        this._fetchWizardCaptionSets(this.state.wizardDatasetId);
      }
    };
    const onEmbellishmentProgress = (data) => {
      const { taskId, datasetId, embellishmentType, status, progress } = data;
      if (taskId) {
        const tasks = { ...this.state.embellishmentTasks };
        tasks[taskId] = {
          ...tasks[taskId],
          taskId, datasetId: normalizeId(datasetId), embellishmentType, status,
          total: progress?.total || tasks[taskId]?.total || 0,
          completedCount: progress?.completed || 0,
        };
        if (status === 'completed' || status === 'failed') tasks[taskId].completedAt = Date.now();
        this.setState({ embellishmentTasks: tasks });
      }
      const dsId = normalizeId(datasetId);
      if (embellishmentType === 'caption' && this.state.wizardStep === 3 && dsId === normalizeId(this.state.wizardDatasetId)) {
        this._fetchWizardCaptionSets(this.state.wizardDatasetId);
      }
      if (embellishmentType === 'control' && this.state.wizardStep === 3 && dsId === normalizeId(this.state.wizardDatasetId)) {
        this._fetchWizardControlSets(this.state.wizardDatasetId);
      }
      if (status === 'completed' || status === 'failed') {
        this._fetchDatasets();
      }
    };

    websocketClient.on('trainingUpdate', onTrainingUpdate);
    websocketClient.on('trainingError', onTrainingError);
    websocketClient.on('captionProgress', onCaptionProgress);
    websocketClient.on('embellishmentProgress', onEmbellishmentProgress);
    this.registerCleanup(() => {
      websocketClient.off('trainingUpdate', onTrainingUpdate);
      websocketClient.off('trainingError', onTrainingError);
      websocketClient.off('captionProgress', onCaptionProgress);
      websocketClient.off('embellishmentProgress', onEmbellishmentProgress);
    });
  }

  _pollTrainings() {
    const hasActive = this.state.trainings.some(t => ACTIVE_STATUSES.includes(t.status));
    if (hasActive) this._fetchTrainings();
  }

  // ── Data fetching ──────────────────────────────────────

  async _fetchAll() {
    this.setState({ loading: true });
    await Promise.all([this._fetchDatasets(), this._fetchTrainings()]);
    this.setState({ loading: false });
  }

  async _fetchDatasets() {
    const { userId } = this.props;
    if (!userId) { this.setState({ datasets: [] }); return; }
    try {
      const data = await fetchJson(`/api/v1/datasets/owner/${userId}`);
      this.setState({ datasets: data.data?.datasets || [] });
    } catch (err) {
      console.warn('[TrainingStudio] fetchDatasets error', err);
    }
  }

  async _fetchTrainings() {
    try {
      const data = await fetchJson('/api/v1/trainings');
      this.setState({ trainings: data.trainings || [] });
    } catch (err) {
      console.warn('[TrainingStudio] fetchTrainings error', err);
      this.setState({ error: 'Could not load trainings.' });
    }
  }

  async _fetchCaptionSets(datasetId) {
    if (!datasetId) return;
    this.setState({ captionsLoading: true, captionsError: null });
    try {
      const res = await fetchJson(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions`);
      const list = Array.isArray(res?.data) ? res.data : (res?.data?.captionSets || res?.captionSets || []);
      this.setState({ captionSets: Array.isArray(list) ? list : [], captionsLoading: false });
    } catch {
      this.setState({ captionsLoading: false, captionsError: 'Could not load caption sets.' });
    }
  }

  async _fetchWizardCaptionSets(datasetId) {
    if (!datasetId) return;
    this.setState({ wizardLoadingCaptions: true });
    try {
      const res = await fetchJson(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions`);
      const list = Array.isArray(res?.data) ? res.data : (res?.data?.captionSets || res?.captionSets || []);
      this.setState({ wizardCaptionSets: Array.isArray(list) ? list : [], wizardLoadingCaptions: false });
    } catch {
      this.setState({ wizardLoadingCaptions: false, wizardCaptionSets: [] });
    }
  }

  async _fetchWizardControlSets(datasetId) {
    if (!datasetId) return;
    this.setState({ wizardLoadingControlSets: true });
    try {
      const ds = this._getDataset(datasetId) || await fetchJson(`/api/v1/datasets/${encodeURIComponent(datasetId)}`).then(r => r?.data || r);
      const controlSets = (ds?.embellishments || []).filter(e => e.type === 'control' && e.status === 'completed');
      this.setState({ wizardControlSets: controlSets, wizardLoadingControlSets: false });
    } catch {
      this.setState({ wizardLoadingControlSets: false, wizardControlSets: [] });
    }
  }

  // ── Helpers ────────────────────────────────────────────

  _getDataset(id) {
    const target = normalizeId(id);
    return this.state.datasets.find(ds => normalizeId(ds._id) === target) || null;
  }

  _getModelDefaults(modelType) {
    switch (modelType) {
      case 'SDXL': return { steps: 1000, learningRate: 0.0004, loraRank: 16, loraAlpha: 32, loraDropout: 0.1 };
      case 'FLUX': return { steps: 4000, learningRate: 0.0001, loraRank: 32, loraAlpha: 32, loraDropout: 0.05 };
      case 'KONTEXT': return { steps: 3000, learningRate: 0.0001, loraRank: 16, loraAlpha: 16, loraDropout: 0.05, resolution: '512,768' };
      default: return {};
    }
  }

  _statusVariant(status) {
    const s = (status || '').toLowerCase();
    if (s === 'completed') return 'success';
    if (s === 'failed') return 'warning';
    if (ACTIVE_STATUSES.map(x => x.toLowerCase()).includes(s)) return 'info';
    return 'default';
  }

  // ── Navigation ─────────────────────────────────────────

  _goDashboard() {
    this.setState({
      view: DASH.MAIN, selectedDatasetId: null, formMode: null, formValues: {},
      wizardStep: 0, wizardDatasetId: null, wizardModelType: null, wizardTrainingMode: null,
      wizardCaptionSetId: null, wizardControlSetId: null, wizardFormValues: {},
      viewingCaptionSet: null, viewingControlSet: null, confirmDeleteTraining: null,
    });
    this._fetchAll();
  }

  _openDatasetDetail(dsId) {
    this.setState({ view: DASH.DATASET_DETAIL, selectedDatasetId: dsId });
    this._fetchDatasets();
  }

  _openDatasetForm(ds) {
    if (ds) {
      this.setState({ view: DASH.DATASET_FORM, formMode: 'edit', formValues: { ...ds }, formError: null });
    } else {
      this.setState({ view: DASH.DATASET_FORM, formMode: 'new', formValues: { name: '', description: '', tags: '', images: [], visibility: 'private' }, formError: null });
    }
  }

  _openWizard(preselectedDatasetId) {
    this.setState({
      view: DASH.WIZARD, wizardStep: 1,
      wizardDatasetId: preselectedDatasetId || null,
      wizardModelType: null, wizardTrainingMode: null,
      wizardCaptionSetId: null, wizardControlSetId: null,
      wizardFormValues: {}, wizardCaptionSets: [], wizardControlSets: [],
      wizardLoadingCaptions: false, wizardLoadingControlSets: false,
      estimatedCost: null, wizardSubmitting: false,
    });
  }

  // ── Dataset CRUD ───────────────────────────────────────

  async _submitDatasetForm() {
    const { formMode, formValues } = this.state;
    const { userId } = this.props;
    if (!formValues.name?.trim()) { this.setState({ formError: 'Name is required.' }); return; }
    this.setState({ formSubmitting: true, formError: null });
    try {
      if (formMode === 'new') {
        const res = await postWithCsrf('/api/v1/datasets', { ...formValues, masterAccountId: userId });
        if (!res.ok) throw new Error('Create failed');
      } else {
        const res = await fetchWithCsrf(`/api/v1/datasets/${encodeURIComponent(formValues._id)}`, {
          method: 'PUT', body: { name: formValues.name, description: formValues.description, tags: formValues.tags, visibility: formValues.visibility },
        });
        if (!res.ok) throw new Error('Update failed');
      }
      this.setState({ formSubmitting: false });
      this._goDashboard();
    } catch (err) {
      this.setState({ formSubmitting: false, formError: err.message });
    }
  }

  async _uploadFiles(files) {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!imageFiles.length) return;
    this.setState({ uploading: true });
    try {
      const urls = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const csrfRes = await fetchJson('/api/v1/csrf-token');
        const token = csrfRes.csrfToken;
        const signRes = await fetch('/api/v1/storage/uploads/sign', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({ fileName: file.name, contentType: file.type, bucketName: 'datasets' }),
        });
        if (!signRes.ok) throw new Error('Failed to get signed URL');
        const { signedUrl, permanentUrl } = await signRes.json();
        const raw = await file.arrayBuffer();
        await fetch(signedUrl, { method: 'PUT', body: raw });
        urls.push(permanentUrl);
        this.setState({ uploadProgress: ((i + 1) / imageFiles.length) });
      }
      const current = this.state.formValues.images || [];
      this.setState({
        formValues: { ...this.state.formValues, images: [...current, ...urls] },
        uploading: false, uploadProgress: 0,
      });
    } catch (err) {
      this.setState({ uploading: false, formError: 'Upload failed: ' + err.message });
    }
  }

  _addImageUrls(text) {
    const urls = text.split(/[\n,]/).map(u => u.trim()).filter(u => u.startsWith('http'));
    if (!urls.length) return;
    const current = this.state.formValues.images || [];
    this.setState({ formValues: { ...this.state.formValues, images: [...current, ...urls] } });
  }

  _removeImage(url) {
    const current = this.state.formValues.images || [];
    this.setState({ formValues: { ...this.state.formValues, images: current.filter(u => u !== url) } });
  }

  // ── Caption management ─────────────────────────────────

  async _generateCaptionSet(datasetId) {
    let spells = [];
    try {
      const data = await fetchJson('/api/v1/datasets/embellishment-spells?type=caption');
      spells = data.data || [];
    } catch { /* ignore */ }

    if (!spells.length) {
      this._createManualCaptions(datasetId);
      return;
    }

    // Open pre-flight dialog so user can pick spell and enter trigger word
    this.setState({
      embellishDialog: {
        type: 'caption',
        datasetId,
        spells,
        selectedSpellSlug: spells[0].slug,
        triggerWord: '',
        submitting: false,
        error: null,
      },
    });
  }

  async _createManualCaptions(datasetId) {
    const { userId } = this.props;
    try {
      const res = await postWithCsrf(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellishments/manual`, {
        masterAccountId: userId, type: 'caption',
      });
      if (!res.ok) throw new Error('Failed');
      this._fetchCaptionSets(datasetId);
    } catch (err) {
      console.warn('[TrainingStudio] createManualCaptions error', err);
    }
  }

  async _embellishDataset(datasetId, spellSlug, type, parameterOverrides) {
    const { userId } = this.props;
    const res = await postWithCsrf(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellish`, {
      spellSlug, masterAccountId: userId, parameterOverrides: parameterOverrides || {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409) throw new Error('A task is already running for this dataset. Please wait for it to complete.');
      throw new Error(data?.error?.message || 'Failed to start embellishment task');
    }
    this._fetchDatasets();
  }

  async _generateControlImages(datasetId) {
    let spells = [];
    try {
      const data = await fetchJson('/api/v1/datasets/embellishment-spells?type=control');
      spells = data.data || [];
    } catch { /* ignore */ }
    if (!spells.length) return;

    // Open pre-flight dialog so user can pick spell and enter prompt
    this.setState({
      embellishDialog: {
        type: 'control',
        datasetId,
        spells,
        selectedSpellSlug: spells[0].slug,
        prompt: '',
        submitting: false,
        error: null,
      },
    });
  }

  async _deleteCaptionSet(datasetId, captionSetId) {
    try {
      await fetchWithCsrf(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions/${encodeURIComponent(captionSetId)}`, { method: 'DELETE' });
      this._fetchCaptionSets(datasetId);
    } catch (err) {
      console.warn('[TrainingStudio] deleteCaptionSet error', err);
    }
  }

  async _setDefaultCaptionSet(datasetId, captionSetId) {
    try {
      await postWithCsrf(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions/${encodeURIComponent(captionSetId)}/default`, {});
      this._fetchCaptionSets(datasetId);
    } catch (err) {
      console.warn('[TrainingStudio] setDefault error', err);
    }
  }

  async _saveCaptionEdit(datasetId, captionSetId, idx, text) {
    this.setState({ savingCaption: true });
    try {
      await fetchWithCsrf(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions/${encodeURIComponent(captionSetId)}/entries/${idx}`, {
        method: 'PATCH', body: { text },
      });
      this.setState({ savingCaption: false, editingCaptionIdx: null });
      this._fetchCaptionSets(datasetId);
    } catch {
      this.setState({ savingCaption: false });
    }
  }

  async _downloadCaptionSetZip(captionSet) {
    const entries = captionSet.captions || captionSet.results || [];
    if (!entries.length) return;
    const files = entries.map((e, i) => ({
      name: `image-${String(i + 1).padStart(3, '0')}.txt`,
      content: e?.text || e?.value || '',
    }));
    // Simple text download (one at a time). For a full ZIP, a library would be needed,
    // but we keep it lightweight by concatenating.
    const blob = new Blob([files.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `captions-${normalizeId(captionSet._id)}.txt`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // ── Training actions ───────────────────────────────────

  async _cancelTraining(id) {
    try {
      await postWithCsrf(`/api/v1/trainings/${id}/cancel`, {});
      this._fetchTrainings();
    } catch (err) {
      console.warn('[TrainingStudio] cancelTraining error', err);
    }
  }

  async _deleteTraining(id) {
    try {
      await fetchWithCsrf(`/api/v1/trainings/${id}`, { method: 'DELETE' });
      this.setState({ confirmDeleteTraining: null });
      this._fetchTrainings();
    } catch (err) {
      console.warn('[TrainingStudio] deleteTraining error', err);
    }
  }

  async _retryTraining(id) {
    try {
      await postWithCsrf(`/api/v1/trainings/${id}/retry`, {});
      this._fetchTrainings();
    } catch (err) {
      console.warn('[TrainingStudio] retryTraining error', err);
    }
  }

  // ── Wizard lifecycle ───────────────────────────────────

  _wizardNext() {
    const { wizardStep, wizardDatasetId, wizardModelType, wizardTrainingMode, wizardCaptionSetId, wizardControlSetId } = this.state;
    if (wizardStep === 1) {
      if (!wizardDatasetId) return;
      this._fetchWizardCaptionSets(wizardDatasetId);
      this.setState({ wizardStep: 2 });
    } else if (wizardStep === 2) {
      if (!wizardModelType) return;
      if (wizardModelType === 'KONTEXT' && !wizardTrainingMode) return;
      const defaults = this._getModelDefaults(wizardModelType);
      if (wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept') {
        this._fetchWizardControlSets(wizardDatasetId);
      }
      this.setState({
        wizardStep: 3,
        wizardFormValues: { ...this.state.wizardFormValues, modelType: wizardModelType, baseModel: wizardModelType, trainingMode: wizardTrainingMode, ...defaults },
      });
    } else if (wizardStep === 3) {
      const isKC = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';
      if (isKC && !wizardControlSetId) return;
      if (!isKC && !wizardCaptionSetId) return;
      this.setState({ wizardStep: 4 });
      this._calculateWizardCost();
    }
  }

  _wizardBack() {
    if (this.state.wizardStep > 1) this.setState({ wizardStep: this.state.wizardStep - 1 });
  }

  async _calculateWizardCost() {
    const fv = this.state.wizardFormValues;
    try {
      const res = await postWithCsrf('/api/v1/trainings/calculate-cost', fv);
      if (res.ok) {
        const data = await res.json();
        this.setState({ estimatedCost: data.totalCost });
      }
    } catch {
      // Fallback
      const base = { SDXL: 100, FLUX: 200, KONTEXT: 150 }[fv.modelType] || 100;
      this.setState({ estimatedCost: Math.round(base * Math.max(1, (parseInt(fv.steps) || 1000) / 1000)) });
    }
  }

  async _submitWizard() {
    const { wizardDatasetId, wizardModelType, wizardTrainingMode, wizardCaptionSetId, wizardControlSetId, wizardFormValues, estimatedCost } = this.state;
    const name = (wizardFormValues.name || '').trim();
    if (!name) return;

    const isKC = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';
    const payload = {
      name, description: wizardFormValues.description || '',
      datasetId: wizardDatasetId, modelType: wizardModelType, baseModel: wizardModelType,
      captionSetId: isKC ? null : wizardCaptionSetId,
      triggerWords: name,
      steps: wizardFormValues.steps, learningRate: wizardFormValues.learningRate,
      batchSize: wizardFormValues.batchSize || 1, resolution: wizardFormValues.resolution || '1024,1024',
      loraRank: wizardFormValues.loraRank, loraAlpha: wizardFormValues.loraAlpha, loraDropout: wizardFormValues.loraDropout,
      costPoints: estimatedCost,
    };
    if (wizardModelType === 'KONTEXT') {
      payload.trainingMode = wizardTrainingMode;
      if (isKC) payload.controlSetId = wizardControlSetId;
    }

    this.setState({ wizardSubmitting: true });
    try {
      const res = await postWithCsrf('/api/v1/trainings', payload);
      if (!res.ok) throw new Error('Training failed');
      this.setState({ wizardSubmitting: false });
      this._goDashboard();
    } catch {
      this.setState({ wizardSubmitting: false });
    }
  }

  // ── Render: Dashboard ──────────────────────────────────

  _renderDashboard() {
    const { datasets, trainings, loading, error, confirmDeleteTraining } = this.state;

    if (loading) return h(Loader, { message: 'Loading...' });
    if (error) return h('div', null, ModalError({ message: error }));

    const active = trainings.filter(t => ACTIVE_STATUSES.includes(t.status));
    const history = trainings.filter(t => !ACTIVE_STATUSES.includes(t.status));

    return h('div', null,
      // Header bar
      h('div', { className: 'ts-header-bar' },
        h('h3', null, 'Training Studio'),
        h('div', { className: 'ts-header-actions' },
          h(AsyncButton, { onclick: this.bind(() => this._openWizard()), label: '+ New Training' }),
          h(AsyncButton, { variant: 'secondary', onclick: this.bind(() => this._openDatasetForm()), label: '+ New Dataset' })
        )
      ),

      // Active trainings
      active.length > 0 ? h('div', { className: 'ts-section' },
        h('div', { className: 'ts-section-head' },
          h('h4', null, 'Active Trainings'),
          h(Badge, { label: String(active.length), variant: 'info' })
        ),
        ...active.map(tr => this._renderTrainingCard(tr, true))
      ) : null,

      // Datasets grid
      h('div', { className: 'ts-section' },
        h('div', { className: 'ts-section-head' },
          h('h4', null, 'Datasets'),
          h(Badge, { label: String(datasets.length), variant: 'default' })
        ),
        datasets.length === 0
          ? h(EmptyState, { message: 'No datasets yet.', action: '+ New Dataset', onAction: this.bind(() => this._openDatasetForm()) })
          : h('div', { className: 'ts-ds-grid' },
            ...datasets.map(ds => {
              const dsId = normalizeId(ds._id);
              const imgCount = (ds.images || []).length;
              return h('div', { className: 'ts-ds-card', key: dsId },
                h('div', { className: 'ts-ds-preview' },
                  ...(ds.images || []).slice(0, 2).map(img => h('img', { src: img, className: 'ts-ds-thumb' }))
                ),
                h('div', { className: 'ts-ds-info' },
                  h('h4', null, ds.name || 'Unnamed'),
                  h('span', { className: 'ts-ds-meta' }, `${imgCount} image${imgCount !== 1 ? 's' : ''}`)
                ),
                h('div', { className: 'ts-ds-actions' },
                  h(AsyncButton, { variant: 'secondary', onclick: () => this._openDatasetDetail(dsId), label: 'View' }),
                  h(AsyncButton, { variant: 'secondary', onclick: () => this._openDatasetForm(ds), label: 'Edit' }),
                  h(AsyncButton, { onclick: () => this._openWizard(dsId), label: 'Train' })
                )
              );
            })
          )
      ),

      // History
      h('div', { className: 'ts-section' },
        h('div', { className: 'ts-section-head' },
          h('h4', null, 'History'),
          h(Badge, { label: String(history.length), variant: 'default' })
        ),
        history.length === 0
          ? h('div', { className: 'ts-empty' }, 'No training history yet.')
          : h('div', null, ...history.map(tr => this._renderTrainingCard(tr, false)))
      ),

      // Delete confirmation
      confirmDeleteTraining ? h(ConfirmInline, {
        message: `Delete this training? This cannot be undone.`,
        onConfirm: () => this._deleteTraining(confirmDeleteTraining),
        onCancel: () => this.setState({ confirmDeleteTraining: null }),
      }) : null
    );
  }

  _renderTrainingCard(tr, isActive) {
    const sLower = (tr.status || 'draft').toLowerCase();
    const progressText = tr.currentStep && tr.totalSteps
      ? `${tr.currentStep}/${tr.totalSteps} (${tr.progress || 0}%)`
      : `${tr.progress || 0}%`;
    const date = tr.completedAt ? new Date(tr.completedAt).toLocaleDateString() : '';

    return h('div', { className: 'ts-training-card', key: tr._id },
      h('div', { className: 'ts-training-top' },
        h('span', { className: 'ts-training-name' }, tr.name || 'Unnamed'),
        h(Badge, { label: tr.status || 'DRAFT', variant: this._statusVariant(tr.status) })
      ),
      h('div', { className: 'ts-training-meta' },
        h('span', null, tr.baseModel || ''),
        date ? h('span', null, date) : null
      ),
      isActive ? h('div', { className: 'ts-progress' },
        h('div', { className: 'ts-progress-bar' },
          h('div', { className: 'ts-progress-fill', style: `width:${tr.progress || 0}%` })
        ),
        h('span', { className: 'ts-progress-text' }, progressText)
      ) : null,
      h('div', { className: 'ts-training-actions' },
        isActive && tr.status === 'QUEUED'
          ? h(AsyncButton, { variant: 'danger', onclick: () => this._cancelTraining(tr._id), label: 'Cancel' }) : null,
        !isActive && tr.status === 'FAILED'
          ? h(AsyncButton, { variant: 'secondary', onclick: () => this._retryTraining(tr._id), label: 'Retry' }) : null,
        !isActive
          ? h(AsyncButton, { variant: 'danger', onclick: () => this.setState({ confirmDeleteTraining: tr._id }), label: 'Delete' }) : null
      )
    );
  }

  // ── Render: Dataset Detail ─────────────────────────────

  _renderDatasetDetail() {
    const { selectedDatasetId, embellishmentTasks } = this.state;
    const ds = this._getDataset(selectedDatasetId);
    if (!ds) return h('div', null, ModalError({ message: 'Dataset not found.' }));

    const images = ds.images || [];
    const dsIdStr = normalizeId(selectedDatasetId);
    const embellishments = ds.embellishments || [];

    // Captions from embellishments (the authoritative system)
    const captionSets = embellishments.filter(e => e.type === 'caption');
    const inProgressCaptionSets = captionSets.filter(cs => cs.status === 'processing' || cs.status === 'pending');
    const doneCaptionSets = captionSets.filter(cs => cs.status !== 'processing' && cs.status !== 'pending');

    // WS tasks for captions not yet persisted as embellishment records
    const captionActiveTasks = Object.values(embellishmentTasks).filter(t =>
      normalizeId(t.datasetId) === dsIdStr &&
      t.embellishmentType === 'caption' &&
      t.status !== 'completed' && t.status !== 'failed'
    );

    const controlSets = embellishments.filter(e => e.type === 'control');
    const controlActiveTasks = Object.values(embellishmentTasks).filter(t =>
      normalizeId(t.datasetId) === dsIdStr &&
      t.embellishmentType === 'control' &&
      t.status !== 'completed' && t.status !== 'failed'
    );

    const totalCaptionCount = doneCaptionSets.length + inProgressCaptionSets.length + captionActiveTasks.length;

    const renderProgressCard = (task, label) => {
      const pct = task.total > 0 ? Math.round((task.completedCount / task.total) * 100) : null;
      const metaText = task.total > 0 ? `${task.completedCount} / ${task.total}` : 'Starting…';
      return h('div', { className: 'ts-caption-card ts-caption-card--running', key: task.taskId },
        h('div', { className: 'ts-caption-info' },
          h('span', { className: 'ts-caption-method' }, label),
          h(Badge, { label: 'In Progress', variant: 'info' }),
          h('span', { className: 'ts-caption-meta' }, metaText),
        ),
        h('div', { className: 'ts-progress', style: 'margin-top:8px' },
          h('div', { className: 'ts-progress-bar' },
            h('div', { className: 'ts-progress-fill', style: `width:${pct ?? 0}%` })
          ),
          pct !== null ? h('span', { className: 'ts-progress-text' }, `${pct}%`) : null,
        ),
      );
    };

    return h('div', null,
      h('div', { className: 'ts-detail-header' },
        h('button', { className: 'ts-back', onclick: this.bind(this._goDashboard) }, '\u2190 Back'),
        h('h3', { className: 'ts-page-title', style: 'margin:0' }, ds.name || 'Unnamed'),
        h('div', { className: 'ts-detail-btns' },
          h(AsyncButton, { variant: 'secondary', onclick: () => this._openDatasetForm(ds), label: 'Edit' }),
          h(AsyncButton, { onclick: () => this._openWizard(selectedDatasetId), label: 'Train' })
        )
      ),
      ds.description ? h('p', { className: 'ts-intro', style: 'margin:8px 0' }, ds.description) : null,

      // Images gallery
      h('div', { className: 'ts-section' },
        h('h4', null, `Images (${images.length})`),
        images.length > 0
          ? h('div', { className: 'ts-img-gallery' },
            ...images.map(url => h('img', { src: url, className: 'ts-gallery-thumb' }))
          )
          : h('div', { className: 'ts-empty' }, 'No images.')
      ),

      // Caption sets (from ds.embellishments)
      h('div', { className: 'ts-section' },
        h('div', { className: 'ts-section-head' },
          h('h4', null, `Caption Sets (${totalCaptionCount})`),
          h(AsyncButton, { onclick: () => this._generateCaptionSet(selectedDatasetId), label: 'Generate Captions' })
        ),

        // WS tasks not yet persisted as embellishment records
        ...captionActiveTasks
          .filter(t => !inProgressCaptionSets.some(cs => cs.taskId === t.taskId))
          .map(t => renderProgressCard(t, 'Generating captions…')),

        // In-progress embellishment records (already in ds.embellishments)
        ...inProgressCaptionSets.map(cs => {
          const taskId = cs.taskId || normalizeId(cs._id);
          const wsTask = embellishmentTasks[taskId] || {};
          return renderProgressCard(
            { taskId, total: wsTask.total || 0, completedCount: wsTask.completedCount || 0 },
            cs.spellSlug || 'Generating captions…',
          );
        }),

        // Completed caption sets
        totalCaptionCount === 0
          ? h('div', { className: 'ts-empty' }, 'No caption sets yet.')
          : null,
        ...doneCaptionSets.map(cs => {
          const csId = normalizeId(cs._id);
          const count = (cs.captions || cs.results || []).length;
          const date = cs.createdAt ? new Date(cs.createdAt).toLocaleDateString() : '';
          return h('div', { className: 'ts-caption-card', key: csId },
            h('div', { className: 'ts-caption-info' },
              h('span', { className: 'ts-caption-method' }, cs.method || cs.spellSlug || 'Unknown'),
              cs.isDefault ? h(Badge, { label: 'Default', variant: 'success' }) : null,
              h('span', { className: 'ts-caption-meta' }, `${count} captions \u00B7 ${date}`)
            ),
            h('div', { className: 'ts-caption-actions' },
              h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ view: DASH.CAPTION_VIEWER, viewingCaptionSet: cs }), label: 'Inspect' }),
              h(AsyncButton, { variant: 'secondary', onclick: () => this._downloadCaptionSetZip(cs), label: 'Download' }),
              !cs.isDefault ? h(AsyncButton, { variant: 'secondary', onclick: () => this._setDefaultCaptionSet(selectedDatasetId, csId), label: 'Set Default' }) : null,
              h(AsyncButton, { variant: 'danger', onclick: () => this._deleteCaptionSet(selectedDatasetId, csId), label: 'Delete' })
            )
          );
        })
      ),

      // Control sets
      h('div', { className: 'ts-section' },
        h('div', { className: 'ts-section-head' },
          h('h4', null, `Control Images (${controlSets.length})`),
          h(AsyncButton, { onclick: () => this._generateControlImages(selectedDatasetId), label: 'Generate Control' })
        ),

        // In-progress control tasks from WS
        ...controlActiveTasks
          .filter(t => !controlSets.some(cs => cs.taskId === t.taskId || (cs.status === 'processing' && normalizeId(cs.datasetId) === dsIdStr)))
          .map(t => renderProgressCard(t, 'Generating control images…')),

        controlSets.length === 0 && controlActiveTasks.length === 0
          ? h('div', { className: 'ts-empty' }, 'No control sets yet.')
          : null,
        ...controlSets.map(cs => {
          const csId = normalizeId(cs._id);
          const count = (cs.results || []).filter(r => r && r.value).length;
          const isRunning = cs.status === 'processing' || cs.status === 'pending';
          if (isRunning) {
            const wsTask = Object.values(embellishmentTasks).find(t => t.taskId === cs.taskId) || {};
            return renderProgressCard(
              { taskId: cs.taskId || csId, total: wsTask.total || 0, completedCount: wsTask.completedCount || 0 },
              cs.spellSlug || 'Generating control images…',
            );
          }
          return h('div', { className: 'ts-caption-card', key: csId },
            h('div', { className: 'ts-caption-info' },
              h('span', { className: 'ts-caption-method' }, cs.method || cs.spellSlug || 'Control'),
              h('span', { className: 'ts-caption-meta' }, `${count} images \u00B7 ${cs.status || ''}`)
            ),
            h('div', { className: 'ts-caption-actions' },
              h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ view: DASH.CONTROL_VIEWER, viewingControlSet: cs }), label: 'Inspect' })
            )
          );
        })
      )
    );
  }

  // ── Render: Caption Viewer ─────────────────────────────

  _renderCaptionViewer() {
    const { viewingCaptionSet, editingCaptionIdx, editingCaptionText, savingCaption, selectedDatasetId } = this.state;
    if (!viewingCaptionSet) return h('div', { style: 'display:none' });

    const entries = viewingCaptionSet.captions || viewingCaptionSet.results || [];
    const csId = normalizeId(viewingCaptionSet._id);
    const ds = this._getDataset(selectedDatasetId);
    const images = ds?.images || [];

    return h('div', null,
      h('button', { className: 'ts-back', onclick: () => this.setState({ view: DASH.DATASET_DETAIL, viewingCaptionSet: null, editingCaptionIdx: null }) }, '\u2190 Back'),
      h('h3', { className: 'ts-page-title' }, viewingCaptionSet.method || 'Caption Set'),
      h('div', { className: 'ts-caption-viewer-list' },
        ...entries.map((entry, idx) => {
          const text = entry?.text || entry?.value || '';
          const imgUrl = images[idx] || entry?.imageUrl || '';
          const isEditing = editingCaptionIdx === idx;
          return h('div', { className: 'ts-cv-row', key: idx },
            imgUrl ? h('img', { src: imgUrl, className: 'ts-cv-img' }) : h('div', { className: 'ts-cv-placeholder' }, `#${idx + 1}`),
            h('div', { className: 'ts-cv-text-block' },
              isEditing
                ? h('div', null,
                  h('textarea', {
                    className: 'ts-cv-textarea',
                    value: editingCaptionText,
                    oninput: (e) => this.setState({ editingCaptionText: e.target.value }),
                  }),
                  h('div', { className: 'ts-cv-edit-actions' },
                    h(AsyncButton, { loading: savingCaption, onclick: () => this._saveCaptionEdit(selectedDatasetId, csId, idx, editingCaptionText), label: 'Save' }),
                    h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ editingCaptionIdx: null }), label: 'Cancel' })
                  )
                )
                : h('div', null,
                  h('div', { className: 'ts-cv-caption' }, text || '(empty)'),
                  h('button', {
                    className: 'ts-cv-edit-btn',
                    onclick: () => this.setState({ editingCaptionIdx: idx, editingCaptionText: text }),
                  }, 'Edit')
                )
            )
          );
        })
      )
    );
  }

  // ── Render: Control Viewer ─────────────────────────────

  _renderControlViewer() {
    const { viewingControlSet, selectedDatasetId } = this.state;
    if (!viewingControlSet) return h('div', { style: 'display:none' });

    const ds = this._getDataset(selectedDatasetId);
    const images = ds?.images || [];
    const results = viewingControlSet.results || [];

    return h('div', null,
      h('button', { className: 'ts-back', onclick: () => this.setState({ view: DASH.DATASET_DETAIL, viewingControlSet: null }) }, '\u2190 Back'),
      h('h3', { className: 'ts-page-title' }, viewingControlSet.method || 'Control Set'),
      h('div', { className: 'ts-control-grid' },
        ...images.map((imgUrl, idx) => {
          const result = results[idx];
          const controlUrl = result?.value || '';
          return h('div', { className: 'ts-control-pair', key: idx },
            h('div', null,
              h('div', { className: 'ts-control-label' }, 'Original'),
              h('img', { src: imgUrl, className: 'ts-control-img' })
            ),
            h('div', null,
              h('div', { className: 'ts-control-label' }, 'Control'),
              controlUrl
                ? h('img', { src: controlUrl, className: 'ts-control-img' })
                : h('div', { className: 'ts-control-placeholder' }, 'Pending')
            )
          );
        })
      )
    );
  }

  // ── Render: Dataset Form ───────────────────────────────

  _renderDatasetForm() {
    const { formMode, formValues, formError, formSubmitting, uploading, uploadProgress, uploadMethod } = this.state;
    const isEdit = formMode === 'edit';
    const images = formValues.images || [];

    return h('div', null,
      h('button', { className: 'ts-back', onclick: this.bind(this._goDashboard) }, '\u2190 Back'),
      h('h3', { className: 'ts-page-title' }, isEdit ? 'Edit Dataset' : 'New Dataset'),
      formError ? ModalError({ message: formError }) : null,

      h('div', { className: 'ts-form-group' },
        h('label', null, 'Name *'),
        h('input', {
          className: 'ts-input', value: formValues.name || '',
          oninput: (e) => this.setState({ formValues: { ...formValues, name: e.target.value } }),
        })
      ),
      h('div', { className: 'ts-form-group' },
        h('label', null, 'Description'),
        h('textarea', {
          className: 'ts-textarea', value: formValues.description || '',
          oninput: (e) => this.setState({ formValues: { ...formValues, description: e.target.value } }),
        })
      ),
      h('div', { className: 'ts-form-group' },
        h('label', null, 'Tags'),
        h('input', {
          className: 'ts-input', placeholder: 'comma,separated,tags', value: formValues.tags || '',
          oninput: (e) => this.setState({ formValues: { ...formValues, tags: e.target.value } }),
        })
      ),

      // Upload tabs
      h('div', { className: 'ts-upload-tabs' },
        h('button', { className: `ts-upload-tab${uploadMethod === 'upload' ? ' ts-upload-tab--active' : ''}`, onclick: () => this.setState({ uploadMethod: 'upload' }) }, 'Upload Files'),
        h('button', { className: `ts-upload-tab${uploadMethod === 'urls' ? ' ts-upload-tab--active' : ''}`, onclick: () => this.setState({ uploadMethod: 'urls' }) }, 'Image URLs'),
      ),
      uploadMethod === 'upload' ? h('div', { className: 'ts-upload-area' },
        h('input', {
          type: 'file', multiple: true, accept: 'image/*',
          onchange: (e) => this._uploadFiles(e.target.files),
        }),
        uploading ? h(Loader, { message: 'Uploading...', progress: uploadProgress }) : null
      ) : null,
      uploadMethod === 'urls' ? h('div', { className: 'ts-url-area' },
        h('textarea', { className: 'ts-textarea', placeholder: 'Paste image URLs, one per line', id: 'ts-url-input' }),
        h(AsyncButton, {
          variant: 'secondary', label: 'Add URLs',
          onclick: () => {
            const el = document.getElementById('ts-url-input');
            if (el) { this._addImageUrls(el.value); el.value = ''; }
          },
        })
      ) : null,

      // Image preview
      images.length > 0 ? h('div', { className: 'ts-image-preview' },
        ...images.map(url => h('div', { className: 'ts-image-item', key: url },
          h('img', { src: url, className: 'ts-preview-thumb' }),
          h('button', { className: 'ts-remove-img', onclick: () => this._removeImage(url) }, '\u00D7')
        ))
      ) : null,

      h('div', { className: 'ts-form-actions' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._goDashboard), label: 'Cancel' }),
        h(AsyncButton, { loading: formSubmitting, onclick: this.bind(this._submitDatasetForm), label: 'Save' })
      )
    );
  }

  // ── Render: Wizard ─────────────────────────────────────

  _renderWizard() {
    const { wizardStep } = this.state;
    const steps = ['Dataset', 'Model', 'Captions', 'Review'];

    return h('div', null,
      // Step bar
      h('div', { className: 'ts-wizard-bar' },
        ...steps.map((label, i) => {
          const num = i + 1;
          const cls = num === wizardStep ? 'ts-step--active' : num < wizardStep ? 'ts-step--done' : '';
          return h('div', { className: `ts-step ${cls}`, key: label },
            h('span', { className: 'ts-step-num' }, num < wizardStep ? '\u2713' : String(num)),
            h('span', { className: 'ts-step-label' }, label)
          );
        })
      ),

      // Step content
      wizardStep === 1 ? this._renderWizardStep1() : null,
      wizardStep === 2 ? this._renderWizardStep2() : null,
      wizardStep === 3 ? this._renderWizardStep3() : null,
      wizardStep === 4 ? this._renderWizardStep4() : null,

      // Footer
      h('div', { className: 'ts-wizard-footer' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._goDashboard), label: 'Cancel' }),
        h('div', { className: 'ts-wizard-nav' },
          wizardStep > 1 ? h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._wizardBack), label: 'Back' }) : null,
          wizardStep < 4
            ? h(AsyncButton, { onclick: this.bind(this._wizardNext), label: 'Next' })
            : h(AsyncButton, { loading: this.state.wizardSubmitting, onclick: this.bind(this._submitWizard), label: 'Start Training' })
        )
      )
    );
  }

  _renderWizardStep1() {
    const { datasets, wizardDatasetId } = this.state;
    return h('div', null,
      h('h4', { className: 'ts-section-title' }, 'Select a Dataset'),
      h('p', { className: 'ts-intro' }, 'Choose the dataset of images you want to train on.'),
      h('div', { className: 'ts-wiz-grid' },
        ...datasets.map(ds => {
          const dsId = normalizeId(ds._id);
          const sel = normalizeId(wizardDatasetId) === dsId;
          const imgCount = (ds.images || []).length;
          return h('div', {
            className: `ts-wiz-card${sel ? ' ts-wiz-card--sel' : ''}`,
            key: dsId, onclick: () => this.setState({ wizardDatasetId: dsId }),
          },
            h('div', { className: 'ts-ds-preview' },
              ...(ds.images || []).slice(0, 4).map(img => h('img', { src: img, className: 'ts-ds-thumb' }))
            ),
            h('h4', null, ds.name || 'Unnamed'),
            h('span', { className: 'ts-ds-meta' }, `${imgCount} image${imgCount !== 1 ? 's' : ''}`)
          );
        }),
        h('div', {
          className: 'ts-wiz-card ts-wiz-card--new',
          onclick: () => { this._openDatasetForm(); },
        },
          h('div', { className: 'ts-wiz-new-icon' }, '+'),
          h('h4', null, 'New Dataset')
        )
      )
    );
  }

  _renderWizardStep2() {
    const { wizardModelType, wizardTrainingMode } = this.state;
    const models = [
      { type: 'SDXL', name: 'SDXL', desc: 'Stable Diffusion XL -- fast, great for stylized art.' },
      { type: 'FLUX', name: 'FLUX', desc: 'High-fidelity realism, photorealistic detail.' },
      { type: 'KONTEXT', name: 'KONTEXT', desc: 'Style/subject LoRAs or concept transformations.' },
    ];
    const kontextModes = [
      { mode: 'style_subject', name: 'Style / Subject', desc: 'Train on a single dataset for style or subject.' },
      { mode: 'concept', name: 'Concept', desc: 'Train on paired before/after for transformations.' },
    ];

    return h('div', null,
      h('h4', { className: 'ts-section-title' }, 'Choose Model Type'),
      h('div', { className: 'ts-wiz-grid' },
        ...models.map(m => h('div', {
          className: `ts-wiz-card${wizardModelType === m.type ? ' ts-wiz-card--sel' : ''}`,
          key: m.type, onclick: () => this.setState({ wizardModelType: m.type, wizardTrainingMode: null }),
        },
          h('div', { className: 'ts-wiz-card-name' }, m.name),
          h('div', { className: 'ts-wiz-card-desc' }, m.desc)
        ))
      ),
      wizardModelType === 'KONTEXT' ? h('div', { style: 'margin-top:16px' },
        h('h4', { className: 'ts-section-title' }, 'Training Mode'),
        h('div', { className: 'ts-wiz-grid' },
          ...kontextModes.map(m => h('div', {
            className: `ts-wiz-card${wizardTrainingMode === m.mode ? ' ts-wiz-card--sel' : ''}`,
            key: m.mode, onclick: () => this.setState({ wizardTrainingMode: m.mode }),
          },
            h('div', { className: 'ts-wiz-card-name' }, m.name),
            h('div', { className: 'ts-wiz-card-desc' }, m.desc)
          ))
        )
      ) : null
    );
  }

  _renderWizardStep3() {
    const { wizardModelType, wizardTrainingMode, wizardCaptionSets, wizardCaptionSetId, wizardLoadingCaptions,
      wizardControlSets, wizardControlSetId, wizardLoadingControlSets, wizardDatasetId } = this.state;
    const isKC = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';

    if (isKC) {
      if (wizardLoadingControlSets) return h(Loader, { message: 'Loading control sets...' });
      return h('div', null,
        h('h4', { className: 'ts-section-title' }, 'Select Control Set'),
        wizardControlSets.length > 0
          ? h('div', { className: 'ts-wiz-grid' },
            ...wizardControlSets.map(cs => {
              const csId = normalizeId(cs._id);
              const sel = normalizeId(wizardControlSetId) === csId;
              const count = (cs.results || []).filter(r => r && r.value).length;
              return h('div', {
                className: `ts-wiz-card${sel ? ' ts-wiz-card--sel' : ''}`,
                key: csId, onclick: () => this.setState({ wizardControlSetId: csId }),
              },
                h('div', { className: 'ts-wiz-card-name' }, cs.method || 'Control'),
                h('div', { className: 'ts-wiz-card-desc' }, `${count} images`)
              );
            })
          )
          : h(EmptyState, { message: 'No control sets. Generate control images first.' }),
        h('div', { style: 'margin-top:12px' },
          h(AsyncButton, { onclick: () => this._generateControlImages(normalizeId(wizardDatasetId)), label: 'Generate Control Images' })
        )
      );
    }

    // Caption selection
    if (wizardLoadingCaptions) return h(Loader, { message: 'Loading caption sets...' });
    const rec = wizardModelType === 'FLUX'
      ? 'FLUX works best with detailed natural language captions.'
      : wizardModelType === 'KONTEXT'
        ? 'KONTEXT works well with detailed captions.'
        : 'SDXL works well with tag-style and short captions.';

    return h('div', null,
      h('h4', { className: 'ts-section-title' }, 'Select Caption Set'),
      h('p', { className: 'ts-intro' }, rec),
      wizardCaptionSets.length > 0
        ? h('div', { className: 'ts-wiz-grid' },
          ...wizardCaptionSets.map(cs => {
            const csId = normalizeId(cs._id);
            const sel = normalizeId(wizardCaptionSetId) === csId;
            const count = cs.captions?.length || 0;
            const date = cs.createdAt ? new Date(cs.createdAt).toLocaleDateString() : '';
            return h('div', {
              className: `ts-wiz-card${sel ? ' ts-wiz-card--sel' : ''}`,
              key: csId, onclick: () => this.setState({ wizardCaptionSetId: csId }),
            },
              h('div', { className: 'ts-wiz-card-name' }, cs.method || 'Unknown'),
              h('div', { className: 'ts-wiz-card-desc' }, `${count} captions \u00B7 ${date}${cs.isDefault ? ' \u00B7 Default' : ''}`)
            );
          })
        )
        : h(EmptyState, { message: 'No caption sets found.' }),
      h('div', { style: 'margin-top:12px' },
        h(AsyncButton, { onclick: () => this._generateCaptionSet(normalizeId(wizardDatasetId)), label: 'Generate Captions' })
      )
    );
  }

  _renderWizardStep4() {
    const { wizardFormValues, wizardDatasetId, wizardModelType, wizardTrainingMode, wizardCaptionSetId, wizardControlSetId, estimatedCost } = this.state;
    const ds = this._getDataset(wizardDatasetId);
    const captionSet = this.state.wizardCaptionSets.find(cs => normalizeId(cs._id) === normalizeId(wizardCaptionSetId));
    const controlSet = this.state.wizardControlSets.find(cs => normalizeId(cs._id) === normalizeId(wizardControlSetId));
    const fv = wizardFormValues;
    const isKC = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';

    return h('div', null,
      h('h4', { className: 'ts-section-title' }, 'Review & Start Training'),

      // Summary
      h('div', { className: 'ts-summary' },
        h('div', { className: 'ts-summary-row' }, h('span', null, 'Dataset:'), h('span', null, `${ds?.name || 'Unknown'} (${(ds?.images || []).length} images)`)),
        h('div', { className: 'ts-summary-row' }, h('span', null, 'Model:'), h('span', null, wizardModelType)),
        wizardTrainingMode ? h('div', { className: 'ts-summary-row' }, h('span', null, 'Mode:'), h('span', null, wizardTrainingMode === 'style_subject' ? 'Style/Subject' : 'Concept')) : null,
        isKC && controlSet
          ? h('div', { className: 'ts-summary-row' }, h('span', null, 'Control Set:'), h('span', null, `${controlSet.method || 'Control'} (${(controlSet.results || []).filter(r => r?.value).length} images)`))
          : captionSet ? h('div', { className: 'ts-summary-row' }, h('span', null, 'Captions:'), h('span', null, `${captionSet.method || 'Unknown'} (${captionSet.captions?.length || 0})`)) : null,
        h('div', { className: 'ts-summary-row' }, h('span', null, 'Steps:'), h('span', null, fv.steps || '\u2014')),
        h('div', { className: 'ts-summary-row' }, h('span', null, 'Learning Rate:'), h('span', null, fv.learningRate || '\u2014')),
        h('div', { className: 'ts-summary-row' }, h('span', null, 'LoRA Rank:'), h('span', null, fv.loraRank || '\u2014')),
        h('div', { className: 'ts-summary-row' }, h('span', null, 'Cost:'), h('span', null, estimatedCost != null ? `${estimatedCost} points` : 'Calculating...')),
      ),

      // Name / description
      h('div', { className: 'ts-form-group' },
        h('label', null, 'Training Name (becomes trigger word) *'),
        h('input', {
          className: 'ts-input', value: fv.name || '', placeholder: 'e.g. mystyle',
          oninput: (e) => this.setState({ wizardFormValues: { ...fv, name: e.target.value } }),
        })
      ),
      h('div', { className: 'ts-form-group' },
        h('label', null, 'Description (optional)'),
        h('textarea', {
          className: 'ts-textarea', value: fv.description || '', placeholder: 'What does this LoRA do?',
          oninput: (e) => this.setState({ wizardFormValues: { ...fv, description: e.target.value } }),
        })
      ),

      // Advanced params
      h('details', { className: 'ts-advanced' },
        h('summary', null, 'Advanced Parameters'),
        h('div', { className: 'ts-param-grid' },
          this._paramField('Steps', 'steps', 'number', fv, 100, 5000),
          this._paramField('Learning Rate', 'learningRate', 'number', fv, 0.0001, 0.01, 0.0001),
          this._paramField('Batch Size', 'batchSize', 'number', fv, 1, 8),
          this._paramField('Resolution', 'resolution', 'text', fv),
          this._paramField('LoRA Rank', 'loraRank', 'number', fv, 4, 128),
          this._paramField('LoRA Alpha', 'loraAlpha', 'number', fv, 4, 256),
          this._paramField('LoRA Dropout', 'loraDropout', 'number', fv, 0, 0.5, 0.01),
        )
      )
    );
  }

  _paramField(label, key, type, fv, min, max, step) {
    return h('div', { className: 'ts-param' },
      h('label', null, label),
      h('input', {
        className: 'ts-input', type, value: fv[key] || '', min, max, step,
        oninput: (e) => this.setState({ wizardFormValues: { ...fv, [key]: e.target.value } }),
      })
    );
  }

  // ── Embellishment pre-flight dialog ────────────────────

  _renderEmbellishDialog() {
    const d = this.state.embellishDialog;
    if (!d) return null;

    const isCaption = d.type === 'caption';
    const title = isCaption ? 'Generate Captions' : 'Generate Control Images';
    const update = (patch) => this.setState({ embellishDialog: { ...d, ...patch } });
    const close = () => this.setState({ embellishDialog: null });

    const onSubmit = async () => {
      update({ submitting: true, error: null });
      const overrides = isCaption
        ? { triggerWord: d.triggerWord }
        : { prompt: d.prompt };
      try {
        await this._embellishDataset(d.datasetId, d.selectedSpellSlug, d.type, overrides);
        this.setState({ embellishDialog: null });
      } catch (err) {
        update({ submitting: false, error: err.message });
      }
    };

    const selectedSpell = d.spells.find(s => s.slug === d.selectedSpellSlug) || d.spells[0];

    return h('div', { className: 'ts-dialog-overlay', onclick: (e) => { if (e.target.classList.contains('ts-dialog-overlay')) close(); } },
      h('div', { className: 'ts-dialog', onclick: (e) => e.stopPropagation() },
        h('div', { className: 'ts-dialog-header' },
          h('h3', null, title),
          h('button', { className: 'ts-dialog-close', onclick: close }, '×'),
        ),

        // Spell picker (shown when multiple spells available)
        d.spells.length > 1 && h('div', { className: 'ts-form-group' },
          h('label', null, 'Method'),
          h('div', { className: 'ts-spell-list' },
            ...d.spells.map(spell =>
              h('div', {
                key: spell.slug,
                className: `ts-spell-card${d.selectedSpellSlug === spell.slug ? ' ts-spell-card--selected' : ''}`,
                onclick: () => update({ selectedSpellSlug: spell.slug }),
              },
                h('strong', null, spell.name),
                spell.description && h('p', null, spell.description),
              )
            ),
          ),
        ),

        // Description when only one spell
        d.spells.length === 1 && selectedSpell?.description && h('div', { className: 'ts-spell-desc' },
          h('p', null, selectedSpell.description),
        ),

        // Caption: trigger word input
        isCaption && h('div', { className: 'ts-form-group' },
          h('label', null, 'Trigger Word'),
          h('input', {
            className: 'ts-input',
            type: 'text',
            placeholder: 'e.g. mystyle, mychar',
            value: d.triggerWord,
            oninput: (e) => update({ triggerWord: e.target.value }),
          }),
          h('p', { className: 'ts-field-hint' }, 'This word is embedded in every caption so the model learns to associate it with your concept.'),
        ),

        // Control: prompt input
        !isCaption && h('div', { className: 'ts-form-group' },
          h('label', null, 'Base Prompt'),
          h('input', {
            className: 'ts-input',
            type: 'text',
            placeholder: 'e.g. portrait photo of a person',
            value: d.prompt,
            oninput: (e) => update({ prompt: e.target.value }),
          }),
          h('p', { className: 'ts-field-hint' }, 'A short description of the subject. Used to guide the control image generation spell.'),
        ),

        d.error && h('p', { className: 'ts-dialog-error' }, d.error),

        h('div', { className: 'ts-form-actions' },
          h('button', { className: 'ts-btn-ghost', onclick: close, disabled: d.submitting }, 'Cancel'),
          h(AsyncButton, { onclick: onSubmit, label: d.submitting ? 'Starting…' : 'Start', disabled: d.submitting }),
        ),
      ),
    );
  }

  // ── Styles ─────────────────────────────────────────────

  static get styles() {
    return `
      .ts-back {
        background: none; border: none;
        color: var(--accent);
        cursor: pointer;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 0; margin-bottom: 8px; display: block;
        transition: color var(--dur-micro) var(--ease);
      }
      .ts-back:hover { color: var(--text-secondary); }

      .ts-header-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px; }
      .ts-header-actions { display:flex; gap:8px; }
      .ts-header-bar h3 {
        margin: 0;
        font-family: var(--ff-display);
        font-size: var(--fs-xl);
        font-weight: var(--fw-semibold);
        letter-spacing: var(--ls-tight);
        color: var(--text-primary);
      }

      .ts-page-title {
        font-family: var(--ff-display);
        font-size: var(--fs-xl);
        font-weight: var(--fw-semibold);
        letter-spacing: var(--ls-tight);
        color: var(--text-primary);
        margin: 0 0 12px;
      }
      .ts-section-title {
        font-family: var(--ff-display);
        font-size: var(--fs-lg);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
        margin: 0 0 8px;
      }
      .ts-intro {
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        color: var(--text-secondary);
        margin: 0 0 12px;
        line-height: 1.5;
      }

      .ts-section { margin-bottom:20px; }
      .ts-section-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
      .ts-section-head h4 {
        margin: 0;
        font-family: var(--ff-display);
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
      }
      .ts-empty {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        color: var(--text-label);
        text-align: center; padding: 16px 0;
      }

      /* Datasets grid */
      .ts-ds-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; }
      .ts-ds-card {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 12px;
      }
      .ts-ds-preview { display:flex; gap:4px; margin-bottom:8px; }
      .ts-ds-thumb { width:40px; height:40px; object-fit:cover; }
      .ts-ds-info h4 {
        margin: 0;
        font-family: var(--ff-display);
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
      }
      .ts-ds-meta {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
      }
      .ts-ds-actions { display:flex; gap:4px; margin-top:8px; flex-wrap:wrap; }

      /* Training cards */
      .ts-training-card {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 12px; margin-bottom: 8px;
      }
      .ts-training-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
      .ts-training-name {
        font-family: var(--ff-display);
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
      }
      .ts-training-meta {
        display:flex; gap:12px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        margin-bottom: 6px;
      }
      .ts-training-actions { display:flex; gap:4px; margin-top:8px; }

      .ts-progress { margin:8px 0; }
      .ts-progress-bar { height:4px; background: var(--surface-3); overflow:hidden; }
      .ts-progress-fill { height:100%; background: var(--accent); transition:width 0.3s; }
      .ts-progress-text {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        margin-top: 4px;
      }

      /* Detail */
      .ts-detail-header { display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
      .ts-detail-btns { margin-left:auto; display:flex; gap:6px; }

      .ts-img-gallery { display:flex; gap:4px; flex-wrap:wrap; }
      .ts-gallery-thumb { width:60px; height:60px; object-fit:cover; }

      /* Caption cards */
      .ts-caption-card {
        display:flex; justify-content:space-between; align-items:center;
        padding: 10px 12px;
        border-bottom: var(--border-width) solid var(--border);
        flex-wrap:wrap; gap:8px;
      }
      .ts-caption-info { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .ts-caption-method {
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        font-weight: var(--fw-medium);
        color: var(--text-primary);
      }
      .ts-caption-meta {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
      }
      .ts-caption-actions { display:flex; gap:4px; flex-wrap:wrap; }

      /* Caption viewer */
      .ts-caption-viewer-list { max-height:400px; overflow-y:auto; }
      .ts-cv-row { display:flex; gap:12px; padding:8px 0; border-bottom: var(--border-width) solid var(--border); }
      .ts-cv-img { width:60px; height:60px; object-fit:cover; flex-shrink:0; }
      .ts-cv-placeholder {
        width:60px; height:60px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        display:flex; align-items:center; justify-content:center;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        flex-shrink:0;
      }
      .ts-cv-text-block { flex:1; min-width:0; }
      .ts-cv-caption {
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        color: var(--text-secondary);
        line-height: 1.4;
      }
      .ts-cv-edit-btn {
        background: none; border: none;
        color: var(--accent);
        cursor: pointer;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 2px 0;
        transition: color var(--dur-micro) var(--ease);
      }
      .ts-cv-edit-btn:hover { color: var(--text-secondary); }
      .ts-cv-textarea {
        width:100%; padding:6px;
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        min-height:40px; resize:vertical; box-sizing:border-box; outline: none;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .ts-cv-textarea:focus { border-color: var(--accent-border); }
      .ts-cv-edit-actions { display:flex; gap:6px; margin-top:6px; }

      /* Control viewer */
      .ts-control-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      .ts-control-pair { display:flex; gap:8px; }
      .ts-control-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        color: var(--text-label);
        margin-bottom: 4px;
      }
      .ts-control-img { width:100%; max-width:200px; }
      .ts-control-placeholder {
        width:100px; height:100px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        display:flex; align-items:center; justify-content:center;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
      }

      /* Form */
      .ts-form-group { margin-bottom:14px; }
      .ts-form-group label {
        display:block; margin-bottom:6px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        color: var(--text-label);
      }
      .ts-input {
        width:100%; padding:8px 12px;
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        box-sizing:border-box; outline: none;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .ts-input:focus { border-color: var(--accent-border); }
      .ts-textarea {
        width:100%; padding:8px 12px;
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        min-height:60px; resize:vertical; box-sizing:border-box; outline: none;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .ts-textarea:focus { border-color: var(--accent-border); }
      .ts-form-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; }

      /* Upload */
      .ts-upload-tabs { display:flex; border-bottom: var(--border-width) solid var(--border); margin-bottom:0; }
      .ts-upload-tab {
        background: none; border: none; border-bottom: 2px solid transparent;
        color: var(--text-label);
        padding: 8px 16px;
        font-family: var(--ff-condensed);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        cursor: pointer;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .ts-upload-tab:hover { color: var(--text-secondary); }
      .ts-upload-tab--active { color: var(--text-primary); border-bottom-color: var(--accent); }
      .ts-upload-area { margin-top:12px; margin-bottom:12px; }
      .ts-url-area { display:flex; gap:8px; align-items:flex-start; margin-top:12px; margin-bottom:12px; }
      .ts-url-area textarea { flex:1; }

      .ts-image-preview { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
      .ts-image-item { position:relative; }
      .ts-preview-thumb { width:60px; height:60px; object-fit:cover; }
      .ts-remove-img {
        position:absolute; top:-4px; right:-4px;
        background: var(--surface-3);
        border: var(--border-width) solid var(--border);
        color: var(--danger);
        width:18px; height:18px; border-radius:50%;
        cursor:pointer; font-size:14px; line-height:1; padding:0;
      }

      /* Wizard */
      .ts-wizard-bar { display:flex; align-items:center; gap:8px; margin-bottom:20px; }
      .ts-step { display:flex; align-items:center; gap:4px; }
      .ts-step-num {
        width:24px; height:24px; border-radius:50%;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        display:flex; align-items:center; justify-content:center;
      }
      .ts-step--active .ts-step-num { background: var(--accent); color: var(--canvas-bg); border-color: var(--accent); }
      .ts-step--done .ts-step-num { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
      .ts-step-label {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        color: var(--text-label);
      }
      .ts-step--active .ts-step-label { color: var(--text-primary); }

      .ts-wizard-footer { display:flex; justify-content:space-between; margin-top:20px; }
      .ts-wizard-nav { display:flex; gap:8px; }

      .ts-wiz-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:8px; margin-top:12px; }
      .ts-wiz-card {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 14px; cursor: pointer;
        transition: border-color var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease);
      }
      .ts-wiz-card:hover { border-color: var(--border-hover); }
      .ts-wiz-card--sel { border-color: var(--accent-border); background: var(--accent-dim); }
      .ts-wiz-card--new { border-style:dashed; text-align:center; }
      .ts-wiz-new-icon { font-size:29px; color: var(--text-label); margin-bottom:4px; }
      .ts-wiz-card h4 {
        margin: 4px 0 0;
        font-family: var(--ff-display);
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
      }
      .ts-wiz-card-name {
        font-family: var(--ff-display);
        font-size: var(--fs-lg);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
        margin-bottom: 4px;
      }
      .ts-wiz-card-desc {
        font-family: var(--ff-sans);
        font-size: var(--fs-sm);
        color: var(--text-secondary);
        line-height: 1.4;
      }

      /* Summary */
      .ts-summary {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 14px; margin-bottom: 16px;
      }
      .ts-summary-row { display:flex; justify-content:space-between; padding:4px 0; border-bottom: var(--border-width) solid var(--border); }
      .ts-summary-row:last-child { border-bottom: none; }
      .ts-summary-row span:first-child {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        color: var(--text-label);
      }
      .ts-summary-row span:last-child {
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        color: var(--text-secondary);
      }

      /* Advanced */
      .ts-advanced { margin-top:12px; }
      .ts-advanced summary {
        cursor: pointer;
        color: var(--accent);
        font-family: var(--ff-condensed);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
      }
      .ts-param-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
      .ts-param label {
        display:block; margin-bottom:4px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        color: var(--text-label);
      }

      /* Embellishment pre-flight dialog */
      .ts-dialog-overlay {
        position:absolute; inset:0; background: rgba(0,0,0,0.65);
        display:flex; align-items:center; justify-content:center;
        z-index:100;
      }
      .ts-dialog {
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        padding:24px; width:460px; max-width:92%; max-height:80vh; overflow-y:auto;
      }
      .ts-dialog-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
      .ts-dialog-header h3 {
        margin: 0;
        font-family: var(--ff-display);
        font-size: var(--fs-xl);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
      }
      .ts-dialog-close {
        background: none;
        border: var(--border-width) solid transparent;
        color: var(--text-label);
        font-size: 24px; cursor: pointer; padding: 0 4px; line-height: 1;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .ts-dialog-close:hover { color: var(--danger); border-color: var(--danger); }
      .ts-spell-list { display:flex; flex-direction:column; gap:8px; margin-top:6px; }
      .ts-spell-card {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding:12px 14px; cursor:pointer;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .ts-spell-card:hover { border-color: var(--accent-border); }
      .ts-spell-card--selected { border-color: var(--accent-border); background: var(--accent-dim); }
      .ts-spell-card strong {
        font-family: var(--ff-display);
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--text-primary);
        display:block;
      }
      .ts-spell-card p {
        margin:4px 0 0;
        font-family: var(--ff-sans);
        font-size: var(--fs-sm);
        color: var(--text-secondary);
      }
      .ts-spell-desc { margin-bottom:16px; }
      .ts-spell-desc p {
        font-family: var(--ff-sans);
        font-size: var(--fs-sm);
        color: var(--text-secondary);
        margin:0;
      }
      .ts-field-hint {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
        margin:4px 0 0;
      }
      .ts-dialog-error {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        color: var(--danger);
        margin:8px 0 0;
      }
      .ts-btn-ghost {
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        padding: 8px 16px; cursor: pointer;
        font-family: var(--ff-condensed);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        transition: border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .ts-btn-ghost:hover:not(:disabled) { border-color: var(--accent-border); color: var(--accent); }
      .ts-btn-ghost:disabled { opacity:0.35; cursor:not-allowed; }
    `;
  }

  // ── Main render ────────────────────────────────────────

  render() {
    const { view, embellishDialog } = this.state;
    let content;
    switch (view) {
      case DASH.MAIN:           content = this._renderDashboard(); break;
      case DASH.DATASET_DETAIL: content = this._renderDatasetDetail(); break;
      case DASH.DATASET_FORM:   content = this._renderDatasetForm(); break;
      case DASH.WIZARD:         content = this._renderWizard(); break;
      case DASH.CAPTION_VIEWER: content = this._renderCaptionViewer(); break;
      case DASH.CONTROL_VIEWER: content = this._renderControlViewer(); break;
      default: content = h('div', { style: 'display:none' });
    }
    if (!embellishDialog) return content;
    return h('div', { style: 'position:relative' }, content, this._renderEmbellishDialog());
  }
}
