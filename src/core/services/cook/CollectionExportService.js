const archiver = require('archiver');
const { PassThrough, Readable } = require('stream');
const { ObjectId } = require('mongodb');
const { PRIORITY } = require('../db/utils/queue');

const fetch = (...args) => import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));

const WORKER_STATE_KEY = 'collection_export_worker_state';
const WORKER_HEARTBEAT_KEY = 'collection_export_worker_heartbeat';

class CollectionExportService {
  constructor({
    logger,
    cookCollectionsDb,
    generationOutputsDb,
    collectionExportsDb,
    storageService,
    systemStateDb,
    processingEnabled = process.env.COLLECTION_EXPORT_PROCESSING_ENABLED !== 'false',
    autoPollIntervalMs = Number(process.env.COLLECTION_EXPORT_AUTO_POLL_MS || 15000),
    stateSyncIntervalMs = Number(process.env.COLLECTION_EXPORT_STATE_SYNC_MS || 5000)
  }) {
    this.logger = (logger && logger.child) ? logger.child({ service: 'CollectionExport' }) : (logger || console);
    this.cookCollectionsDb = cookCollectionsDb;
    this.generationOutputsDb = generationOutputsDb;
    this.collectionExportsDb = collectionExportsDb;
    this.storageService = storageService;
    this.systemStateDb = systemStateDb || null;
    this.processingEnabled = processingEnabled !== false;
    this.processing = false;
    this.queueCheckScheduled = false;
    this.downloadTimeoutMs = Number(process.env.COLLECTION_EXPORT_FETCH_TIMEOUT_MS || 60000);
    this.activeJobId = null;
    this.abortedJobs = new Set();
    this._currentJob = null;
    this.workerState = {
      paused: false,
      pauseReason: null,
      pausedAt: null,
      updatedAt: new Date(),
      lastHeartbeat: null
    };
    this.stateSyncIntervalMs = stateSyncIntervalMs;
    this._lastStateSync = 0;
    this._stateLoaded = false;
    this._stateLoadPromise = this._loadPersistentState()
      .catch(err => {
        this.logger.error('[CollectionExportService] unable to load worker state', err);
      })
      .finally(() => {
        this._stateLoaded = true;
        this._stateLoadPromise = null;
        if (this.processingEnabled) {
          this._recoverStuckJobs().catch(err => this.logger.error('[CollectionExportService] failed to recover jobs on start', err));
          this._scheduleQueueProcessing();
          this._startQueuePolling(autoPollIntervalMs);
        }
      });
    this.heartbeatIntervalMs = Number(process.env.COLLECTION_EXPORT_HEARTBEAT_INTERVAL_MS || 30000);
    this._heartbeatTimer = null;
    if (this.heartbeatIntervalMs > 0 && this.systemStateDb) {
      this._startHeartbeat();
    }
    this._queuePollTimer = null;
  }

  async requestExport({ userId, collectionId, metadataOptions = {} }) {
    if (!this.collectionExportsDb || !this.cookCollectionsDb || !this.generationOutputsDb || !this.storageService) {
      throw new Error('export-service-unavailable');
    }

    const collection = await this.cookCollectionsDb.findById(collectionId);
    if (!collection) {
      throw new Error('collection-not-found');
    }
    if (collection.userId !== userId) {
      throw new Error('unauthorized');
    }

    const approvedCount = await this._countApprovedPieces(collectionId, userId);
    if (!approvedCount) {
      throw new Error('no-approved-pieces');
    }

    const activeJob = await this.collectionExportsDb.findActiveForCollection(collectionId, userId);
    if (activeJob) {
      return this._formatJob(activeJob);
    }

    const sanitizedOptions = this._sanitizeMetadataOptions(metadataOptions, collection);
    const jobDoc = await this.collectionExportsDb.createJob({
      userId,
      collectionId,
      collectionName: collection.name || 'Collection',
      totalSupply: collection.totalSupply || collection.config?.totalSupply || 0,
      status: 'pending',
      progress: { stage: 'queued', current: 0, total: 0 },
      metadataOptions: sanitizedOptions,
      jobType: 'archive'
    });

    this._scheduleQueueProcessing();
    return this._formatJob(jobDoc);
  }

  async requestPublish({ userId, collectionId, metadataOptions = {} }) {
    if (!this.collectionExportsDb || !this.cookCollectionsDb || !this.generationOutputsDb || !this.storageService) {
      throw new Error('export-service-unavailable');
    }

    const collection = await this.cookCollectionsDb.findById(collectionId);
    if (!collection) {
      throw new Error('collection-not-found');
    }
    if (collection.userId !== userId) {
      throw new Error('unauthorized');
    }

    if (collection.publishedGallery?.publishedAt && process.env.COLLECTION_PUBLISH_ALLOW_REPUBLISH !== 'true') {
      throw new Error('already-published');
    }

    const approvedCount = await this._countApprovedPieces(collectionId, userId);
    if (!approvedCount) {
      throw new Error('no-approved-pieces');
    }

    const activeJob = await this.collectionExportsDb.findActiveForCollection(collectionId, userId);
    if (activeJob) {
      return this._formatJob(activeJob);
    }

    const sanitizedOptions = this._sanitizeMetadataOptions(metadataOptions, collection);
    const jobDoc = await this.collectionExportsDb.createJob({
      userId,
      collectionId,
      collectionName: collection.name || 'Collection',
      totalSupply: collection.totalSupply || collection.config?.totalSupply || 0,
      status: 'pending',
      progress: { stage: 'queued', current: 0, total: 0 },
      metadataOptions: sanitizedOptions,
      jobType: 'gallery'
    });

    this._scheduleQueueProcessing();
    return this._formatJob(jobDoc);
  }

  async getLatestJob({ userId, collectionId, jobType = null }) {
    if (!this.collectionExportsDb) return null;
    const job = await this.collectionExportsDb.findLatestForCollection(collectionId, userId, { jobType });
    return job ? this._formatJob(job) : null;
  }

  async getJobById(exportId) {
    if (!this.collectionExportsDb || !exportId) return null;
    const job = await this.collectionExportsDb.findById(exportId);
    return job ? this._formatJob(job) : null;
  }

  _scheduleQueueProcessing() {
    if (!this.processingEnabled) return;
    if (!this._stateLoaded && this._stateLoadPromise) {
      this._stateLoadPromise.then(() => this._scheduleQueueProcessing()).catch(err => {
        this.logger.error('[CollectionExportService] queue scheduling after state load failed', err);
      });
      return;
    }
    if (this.processing || this.queueCheckScheduled || this._isPaused()) return;
    this.queueCheckScheduled = true;
    setImmediate(() => {
      this.queueCheckScheduled = false;
      this._processQueue().catch(err => {
        this.logger.error('[CollectionExportService] queue processing error', err);
      });
    });
  }

  async _processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      await this._syncWorkerStateFromStore(true);
      await this._recoverStuckJobs();
      while (!this._isPaused()) {
        await this._syncWorkerStateFromStore();
        const nextJob = await this.collectionExportsDb.findNextPending();
        if (!nextJob) break;
        await this._runJob(nextJob);
        if (this._isPaused()) break;
      }
    } finally {
      this.processing = false;
    }
  }

  async _runJob(jobDoc) {
    const jobId = jobDoc._id;
    const latestDoc = await this.collectionExportsDb.findById(jobId);
    if (!latestDoc || latestDoc.status === 'cancelled') {
      return;
    }
    this.activeJobId = String(jobId);
    this._currentJob = jobDoc;
    this.abortedJobs.delete(this.activeJobId);
    await this._recordHeartbeat();
    await this.collectionExportsDb.updateOne(
      { _id: jobId },
      {
        status: 'running',
        startedAt: new Date(),
        updatedAt: new Date(),
        progress: { stage: 'preparing', current: 0, total: 0 }
      },
      {},
      false,
      PRIORITY.LOW
    );

    let lastError = null;
    try {
      const jobType = jobDoc.jobType || 'archive';
      if (jobType === 'gallery') {
        const { publishResult, totalCount, skipped = [] } = await this._publishToGallery(jobDoc);
        await this.collectionExportsDb.updateOne(
          { _id: jobId },
          {
            status: skipped.length ? 'completed_with_skips' : 'completed',
            finishedAt: new Date(),
            updatedAt: new Date(),
            progress: { stage: skipped.length ? 'completed_with_skips' : 'completed', current: totalCount - skipped.length, total: totalCount },
            publishResult,
            skipped
          },
          {},
          false,
          PRIORITY.LOW
        );
        this.logger.info(`[CollectionExportService] publish complete for collection ${jobDoc.collectionId}${skipped.length ? ` (skipped ${skipped.length})` : ''}`);
      } else {
        const { archiveUrl, expiresAt, totalCount, skipped = [] } = await this._buildArchive(jobDoc);
        await this.collectionExportsDb.updateOne(
          { _id: jobId },
          {
            status: skipped.length ? 'completed_with_skips' : 'completed',
            finishedAt: new Date(),
            updatedAt: new Date(),
            downloadUrl: archiveUrl,
            expiresAt,
            progress: { stage: skipped.length ? 'completed_with_skips' : 'completed', current: totalCount, total: totalCount },
            skipped
          },
          {},
          false,
          PRIORITY.LOW
        );
        this.logger.info(`[CollectionExportService] export complete for collection ${jobDoc.collectionId}${skipped.length ? ` (skipped ${skipped.length})` : ''}`);
      }
    } catch (err) {
      lastError = err;
      const cancelled = err && err.message === 'export-cancelled';
      const status = cancelled ? 'cancelled' : 'failed';
      const stage = cancelled ? 'cancelled' : 'failed';
      const errorMessage = cancelled ? 'export-cancelled' : (err.message || 'export-failed');
      if (cancelled) {
        this.logger.warn(`[CollectionExportService] export cancelled for collection ${jobDoc.collectionId}`);
      } else {
        this.logger.error(`[CollectionExportService] export failed for collection ${jobDoc.collectionId}`, err);
      }
      await this.collectionExportsDb.updateOne(
        { _id: jobId },
        {
          status,
          finishedAt: new Date(),
          updatedAt: new Date(),
          error: errorMessage,
          progress: { stage, current: 0, total: 0 }
        },
        {},
        false,
        PRIORITY.LOW
      );
    }
    this.activeJobId = null;
    this._currentJob = null;
    await this._recordHeartbeat();
    return lastError;
  }

  _prepareOrderedEntries({ generations, collection, metadataOptions, respectCanonical = true }) {
    const orderedEntries = [];
    const canonical = respectCanonical ? collection?.publishedGallery?.canonicalOrder : null;
    const canonicalMap = new Map();
    let maxCanonical = 0;
    if (Array.isArray(canonical)) {
      canonical.forEach(entry => {
        if (!entry) return;
        const genId = entry.generationId || entry.id;
        const seq = Number(entry.number || entry.sequence || entry.tokenId || entry.index);
        if (!genId || !Number.isFinite(seq)) return;
        canonicalMap.set(String(genId), seq);
        if (seq > maxCanonical) {
          maxCanonical = seq;
        }
      });
    }

    if (canonicalMap.size > 0) {
      const remainder = [];
      for (const generation of generations) {
        const genId = String(generation._id);
        if (canonicalMap.has(genId)) {
          orderedEntries.push({ generation, sequenceNumber: canonicalMap.get(genId) });
        } else {
          remainder.push(generation);
        }
      }
      orderedEntries.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      let nextNumber = maxCanonical + 1;
      remainder.forEach(gen => {
        orderedEntries.push({ generation: gen, sequenceNumber: nextNumber });
        nextNumber += 1;
      });
    } else {
      let baseOrder = generations.slice();
      if (metadataOptions?.shuffleOrder) {
        baseOrder = this._shuffleArray(baseOrder);
      }
      baseOrder.forEach((generation, idx) => {
        orderedEntries.push({ generation, sequenceNumber: idx + 1 });
      });
    }

    const maxSequence = orderedEntries.reduce((max, entry) => Math.max(max, entry.sequenceNumber), 0);
    return { orderedEntries, canonicalApplied: canonicalMap.size > 0, maxSequence };
  }

  async _buildArchive(jobDoc) {
    const { collectionId, userId } = jobDoc;
    const collection = await this.cookCollectionsDb.findById(collectionId);
    if (!collection) {
      throw new Error('collection-not-found');
    }

    const approvedGenerations = await this._fetchApprovedGenerations({ collectionId, userId });
    const totalCount = approvedGenerations.length;
    if (!totalCount) {
      throw new Error('no-approved-pieces');
    }

    const metadataOptions = jobDoc.metadataOptions || this._sanitizeMetadataOptions({}, collection);
    const ordering = this._prepareOrderedEntries({
      generations: approvedGenerations,
      collection,
      metadataOptions,
      respectCanonical: true
    });

    await this.collectionExportsDb.updateOne(
      { _id: jobDoc._id },
      {
        progress: { stage: 'collecting', current: 0, total: totalCount }
      },
      {},
      false,
      PRIORITY.LOW
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    const passThrough = new PassThrough();
    const exportKey = this._buildExportKey(userId, collectionId);
    const uploadPromise = this.storageService.uploadFromStream(passThrough, exportKey, 'application/zip', this.storageService.getBucketName('exports'));
    archive.pipe(passThrough);

    const skipped = [];
    const manifest = {
      collection: {
        id: collectionId,
        name: collection.name || 'Collection',
        totalSupply: collection.totalSupply || collection.config?.totalSupply || 0,
        description: collection.description || ''
      },
      generatedAt: new Date().toISOString(),
      items: []
    };

    let processed = 0;
    const padLength = String(Math.max(ordering.maxSequence || ordering.orderedEntries.length, totalCount)).length;
    const metadataEntries = [];

    for (let idx = 0; idx < ordering.orderedEntries.length; idx++) {
      const { generation, sequenceNumber } = ordering.orderedEntries[idx];
      if (this.abortedJobs.has(String(jobDoc._id))) {
        throw new Error('export-cancelled');
      }
      const paddedNumber = String(sequenceNumber).padStart(padLength, '0');
      const imageBasePath = `images/${paddedNumber}`;
      try {
        const downloadResult = await this._fetchWithRetry(() => this._appendGenerationImages(archive, generation, imageBasePath));
        const { entryName, urlUsed } = downloadResult;
        const metadataEntry = this._buildMetadataEntry(generation, entryName, metadataOptions, sequenceNumber);
        metadataEntries.push(metadataEntry);
        archive.append(JSON.stringify(metadataEntry, null, 2), { name: `metadata/${paddedNumber}.json` });
        processed += 1;
      } catch (err) {
        skipped.push({
          generationId: String(generation._id),
          error: err.message || 'download-failed'
        });
        continue;
      }
      await this.collectionExportsDb.updateOne(
        { _id: jobDoc._id },
        {
          progress: { stage: 'collecting', current: processed, total: totalCount },
          updatedAt: new Date()
        },
        {},
        false,
        PRIORITY.LOW
      );
    }

    manifest.items = metadataEntries;
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(JSON.stringify(metadataEntries, null, 2), { name: 'metadata.json' });
    await archive.finalize();

    await this.collectionExportsDb.updateOne(
      { _id: jobDoc._id },
      {
        progress: { stage: 'uploading', current: processed, total: totalCount },
        updatedAt: new Date()
      },
      {},
      false,
      PRIORITY.LOW
    );

    const { permanentUrl } = await uploadPromise;
    const expiresAt = new Date(Date.now() + (process.env.EXPORT_DOWNLOAD_TTL_MS ? Number(process.env.EXPORT_DOWNLOAD_TTL_MS) : 24 * 60 * 60 * 1000));

    return { archiveUrl: permanentUrl, expiresAt, totalCount, skipped };
  }

  async _publishToGallery(jobDoc) {
    const { collectionId, userId } = jobDoc;
    const collection = await this.cookCollectionsDb.findById(collectionId);
    if (!collection) {
      throw new Error('collection-not-found');
    }
    if (collection.publishedGallery?.publishedAt && process.env.COLLECTION_PUBLISH_ALLOW_REPUBLISH !== 'true') {
      throw new Error('already-published');
    }

    const approvedGenerations = await this._fetchApprovedGenerations({ collectionId, userId });
    const totalCount = approvedGenerations.length;
    if (!totalCount) {
      throw new Error('no-approved-pieces');
    }

    const metadataOptions = jobDoc.metadataOptions || this._sanitizeMetadataOptions({}, collection);
    const ordering = this._prepareOrderedEntries({
      generations: approvedGenerations,
      collection,
      metadataOptions,
      respectCanonical: false
    });

    await this.collectionExportsDb.updateOne(
      { _id: jobDoc._id },
      {
        progress: { stage: 'publishing_images', current: 0, total: totalCount }
      },
      {},
      false,
      PRIORITY.LOW
    );

    const bucketAlias = 'gallery';
    const keyPrefix = this._buildGalleryKeyPrefix(collectionId);
    const baseRoot = (this.storageService.getPublicBaseUrl && this.storageService.getPublicBaseUrl(bucketAlias)) || '';
    const normalizedBase = baseRoot ? baseRoot.replace(/\/$/, '') : '';
    const baseUrl = normalizedBase && keyPrefix ? `${normalizedBase}/${keyPrefix}` : (normalizedBase || '');

    const skipped = [];
    const metadataEntries = [];
    const canonicalOrder = [];
    let processed = 0;

    for (const entry of ordering.orderedEntries) {
      if (this.abortedJobs.has(String(jobDoc._id))) {
        throw new Error('export-cancelled');
      }
      const { generation, sequenceNumber } = entry;
      const fileStem = String(sequenceNumber);
      try {
        const downloadResult = await this._fetchWithRetry(() => this._downloadPrimaryImage(generation));
        const imageKey = keyPrefix ? `${keyPrefix}/${fileStem}.${downloadResult.extension}` : `${fileStem}.${downloadResult.extension}`;
        const upload = await this.storageService.uploadFromStream(
          downloadResult.stream,
          imageKey,
          downloadResult.contentType || this._mimeFromExtension(downloadResult.extension),
          bucketAlias
        );
        const imageUrl = upload.permanentUrl;
        const metadataEntry = this._buildMetadataEntry(generation, imageUrl, metadataOptions, sequenceNumber);
        metadataEntry.image = imageUrl;
        metadataEntries.push(metadataEntry);
        canonicalOrder.push({ generationId: String(generation._id), number: sequenceNumber });
        const metadataKey = keyPrefix ? `${keyPrefix}/${fileStem}.json` : `${fileStem}.json`;
        await this._uploadJsonAsset(metadataKey, metadataEntry, bucketAlias);
        processed += 1;
      } catch (err) {
        skipped.push({ generationId: String(generation._id), error: err.message || 'publish-failed' });
        continue;
      }

      await this.collectionExportsDb.updateOne(
        { _id: jobDoc._id },
        {
          progress: { stage: 'publishing_images', current: processed, total: totalCount },
          updatedAt: new Date()
        },
        {},
        false,
        PRIORITY.LOW
      );
    }

    await this.collectionExportsDb.updateOne(
      { _id: jobDoc._id },
      {
        progress: { stage: 'publishing_metadata', current: processed, total: totalCount },
        updatedAt: new Date()
      },
      {},
      false,
      PRIORITY.LOW
    );

    const manifest = {
      collection: {
        id: collectionId,
        name: collection.name || 'Collection',
        totalSupply: collection.totalSupply || collection.config?.totalSupply || 0,
        description: collection.description || ''
      },
      generatedAt: new Date().toISOString(),
      baseUrl,
      items: metadataEntries
    };

    const manifestKey = keyPrefix ? `${keyPrefix}/manifest.json` : 'manifest.json';
    const metadataIndexKey = keyPrefix ? `${keyPrefix}/metadata.json` : 'metadata.json';
    const manifestUpload = await this._uploadJsonAsset(manifestKey, manifest, bucketAlias);
    const metadataUpload = await this._uploadJsonAsset(metadataIndexKey, metadataEntries, bucketAlias);

    await this.collectionExportsDb.updateOne(
      { _id: jobDoc._id },
      {
        progress: { stage: 'finalizing_publish', current: processed, total: totalCount },
        updatedAt: new Date()
      },
      {},
      false,
      PRIORITY.LOW
    );

    const publishResult = {
      baseUrl,
      manifestUrl: manifestUpload?.permanentUrl || null,
      metadataUrl: metadataUpload?.permanentUrl || null,
      keyPrefix,
      itemCount: metadataEntries.length
    };

    await this.cookCollectionsDb.updateCollection(collectionId, {
      publishedGallery: {
        ...publishResult,
        canonicalOrder,
        metadataOptions,
        publishedAt: new Date(),
        jobId: String(jobDoc._id)
      }
    });

    return { publishResult, totalCount, skipped };
  }

  async _fetchApprovedGenerations({ collectionId, userId }) {
    const match = this._buildApprovedMatch(collectionId, userId);

    const docs = await this.generationOutputsDb.findGenerations(match, {
      projection: {
        responsePayload: 1,
        artifactUrls: 1,
        metadata: 1,
        requestPayload: 1,
        request: 1,
        costUsd: 1,
        durationMs: 1,
        requestTimestamp: 1,
        responseTimestamp: 1,
        createdAt: 1
      },
      sort: { requestTimestamp: 1 }
    });

    return Array.isArray(docs) ? docs : [];
  }

  async _appendGenerationImages(archive, generation, basePath) {
    const urls = this._extractImageUrls(generation);
    if (!urls.length) {
      throw new Error(`generation-${generation._id}-missing-images`);
    }

    const primaryUrl = urls[0];
    const response = await this._fetchWithTimeout(primaryUrl);
    if (!response.ok || !response.body) {
      throw new Error(`failed-to-fetch-image:${primaryUrl}`);
    }

    const ext = this._inferExtension(primaryUrl, response.headers.get('content-type'));
    const normalizedBase = basePath.replace(/\.\w+$/, '');
    const entryName = `${normalizedBase}.${ext}`;
    archive.append(response.body, { name: entryName });
    return { entryName, urlUsed: primaryUrl };
  }

  _extractImageUrls(generation) {
    const urls = [];
    const payload = generation.responsePayload;
    if (Array.isArray(payload)) {
      payload.forEach(item => {
        const images = item?.data?.images;
        if (Array.isArray(images)) {
          images.forEach(img => {
            if (img?.url) urls.push(img.url);
          });
        }
      });
    }
    if (Array.isArray(generation.artifactUrls)) {
      generation.artifactUrls.forEach(artifact => {
        if (artifact?.url) urls.push(artifact.url);
      });
    }
    return urls;
  }

  _inferExtension(url, contentType) {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop();
      if (ext && ext.length <= 5) return ext;
    } catch (_) {
      // ignore
    }
    if (contentType) {
      if (contentType.includes('png')) return 'png';
      if (contentType.includes('jpeg')) return 'jpg';
      if (contentType.includes('webp')) return 'webp';
    }
    return 'png';
  }

  _buildExportKey(userId, collectionId) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `exports/${userId}/${collectionId}/${stamp}.zip`;
  }

  _buildGalleryKeyPrefix(collectionId) {
    return `${collectionId}`;
  }

  _applyNameTemplate(template, number) {
    if (!template) return `Piece #${number}`;
    return template.replace(/\{\{\s*number\s*\}\}/gi, number);
  }

  async _uploadJsonAsset(key, payload, bucketAlias = 'gallery') {
    const buffer = Buffer.from(JSON.stringify(payload, null, 2));
    return this.storageService.uploadFromStream(Readable.from(buffer), key, 'application/json', bucketAlias);
  }

  async _downloadPrimaryImage(generation) {
    const urls = this._extractImageUrls(generation);
    if (!urls.length) {
      throw new Error(`generation-${generation._id}-missing-images`);
    }
    const primaryUrl = urls[0];
    const response = await this._fetchWithTimeout(primaryUrl);
    if (!response.ok || !response.body) {
      throw new Error(`failed-to-fetch-image:${primaryUrl}`);
    }
    const contentType = response.headers.get('content-type');
    const ext = this._inferExtension(primaryUrl, contentType);
    return {
      stream: response.body,
      extension: ext || 'png',
      contentType: contentType || this._mimeFromExtension(ext || 'png')
    };
  }

  _mimeFromExtension(ext = '') {
    const normalized = (ext || '').toLowerCase();
    if (normalized === 'png') return 'image/png';
    if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
    if (normalized === 'webp') return 'image/webp';
    if (normalized === 'gif') return 'image/gif';
    return 'application/octet-stream';
  }

  async _fetchWithRetry(fn, attempts = Number(process.env.EXPORT_DOWNLOAD_RETRIES || 3)) {
    let lastError = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
          continue;
        }
      }
    }
    throw lastError || new Error('download-failed');
  }

  _normalizeTraitValue(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'object') {
      if (typeof val.name === 'string') return val.name;
      if (val.value) {
        if (typeof val.value === 'string') return val.value;
        if (typeof val.value?.name === 'string') return val.value.name;
      }
      if (typeof val.label === 'string') return val.label;
    }
    return String(val);
  }

  _sanitizeMetadataOptions(options = {}, collection) {
    const fallbackTemplate = `${collection?.name || 'Collection Piece'} #{{number}}`;
    const fallbackDescription = collection?.description || '';
    const lockedMetadata = collection?.publishedGallery?.metadataOptions;
    const lockedOrder = Array.isArray(collection?.publishedGallery?.canonicalOrder) && collection.publishedGallery.canonicalOrder.length > 0;
    const resolvedName = (lockedMetadata?.nameTemplate && lockedMetadata.nameTemplate.trim().length)
      ? lockedMetadata.nameTemplate.trim()
      : (typeof options.nameTemplate === 'string' && options.nameTemplate.trim().length
        ? options.nameTemplate.trim()
        : fallbackTemplate);
    const resolvedDescription = (lockedMetadata && typeof lockedMetadata.description === 'string')
      ? lockedMetadata.description
      : (typeof options.description === 'string'
        ? options.description
        : fallbackDescription);
    return {
      nameTemplate: resolvedName,
      description: resolvedDescription,
      shuffleOrder: lockedOrder ? false : !!options.shuffleOrder
    };
  }

  _shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  _buildMetadataEntry(generation, entryName, options, sequenceNumber) {
    const traitsObj = generation.metadata?.selectedTraits || generation.metadata?.traitSel || {};
    const traitList = Object.keys(traitsObj).map(key => ({
      trait_type: key,
      value: this._normalizeTraitValue(traitsObj[key])
    }));
    const appliedTraits = Array.isArray(generation.metadata?.appliedTraits)
      ? generation.metadata.appliedTraits.map(item => ({
          trait_type: item.category || item.group || item.type || 'trait',
          value: this._normalizeTraitValue(item.name || item.value || item.slug || item.label)
        }))
      : [];

    const attributes = [...traitList, ...appliedTraits];
    const promptValue = this._extractPromptValue(generation);
    if (promptValue) {
      attributes.push({
        trait_type: 'prompt',
        value: promptValue
      });
    }
    const nameTemplate = options?.nameTemplate || `${generation.metadata?.name || 'Piece'} #{{number}}`;
    const description = (options && typeof options.description === 'string')
      ? options.description
      : (generation.metadata?.description || '');

    return {
      name: this._applyNameTemplate(nameTemplate, sequenceNumber),
      description,
      image: entryName,
      attributes
    };
  }

  async cancelJob({ collectionId, userId }) {
    if (!collectionId || !userId || !this.collectionExportsDb) return null;
    const latest = await this.collectionExportsDb.findActiveForCollection(collectionId, userId);
    if (!latest) return null;
    const jobId = String(latest._id);

    if (this.activeJobId === jobId) {
      this.abortedJobs.add(jobId);
    }

    await this.collectionExportsDb.updateOne(
      { _id: latest._id },
      {
        status: 'cancelled',
        finishedAt: new Date(),
        updatedAt: new Date(),
        progress: { stage: 'cancelled', current: latest.progress?.current || 0, total: latest.progress?.total || 0 },
        error: 'export-cancelled'
      },
      {},
      false,
      PRIORITY.LOW
    );
    return this._formatJob(await this.collectionExportsDb.findById(latest._id));
  }

  async pauseProcessing({ reason = 'manual' } = {}) {
    await this._ensureStateLoaded();
    if (this.workerState.paused) {
      return this.getWorkerStatus();
    }
    this.workerState.paused = true;
    this.workerState.pauseReason = reason || 'manual';
    this.workerState.pausedAt = new Date();
    this.workerState.updatedAt = new Date();
    await this._persistState();
    return this.getWorkerStatus();
  }

  async resumeProcessing() {
    await this._ensureStateLoaded();
    if (!this.workerState.paused) {
      return this.getWorkerStatus();
    }
    this.workerState.paused = false;
    this.workerState.pauseReason = null;
    this.workerState.pausedAt = null;
    this.workerState.updatedAt = new Date();
    await this._persistState();
    this._scheduleQueueProcessing();
    return this.getWorkerStatus();
  }

  async getWorkerStatus({ includeQueueSize = true } = {}) {
    await this._ensureStateLoaded();
    await this._syncWorkerStateFromStore(true);
    const pendingCount = includeQueueSize && this.collectionExportsDb && this.collectionExportsDb.countPending
      ? await this.collectionExportsDb.countPending()
      : null;
    const status = this._isPaused()
      ? 'paused'
      : (this.activeJobId ? 'busy' : 'idle');
    return {
      status,
      paused: this.workerState.paused,
      pauseReason: this.workerState.pauseReason,
      activeJobId: this.activeJobId,
      currentCollectionId: this._currentJob?.collectionId || null,
      queueDepth: typeof pendingCount === 'number' ? pendingCount : null,
      processing: this.processing,
      lastHeartbeat: this.workerState.lastHeartbeat || null,
      updatedAt: this.workerState.updatedAt || null
    };
  }

  async _fetchWithTimeout(url, timeoutMs = this.downloadTimeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`download-timeout:${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  _formatJob(job) {
    return {
      id: job._id ? String(job._id) : undefined,
      collectionId: job.collectionId,
      userId: job.userId,
      jobType: job.jobType || 'archive',
      status: job.status,
      progress: job.progress || {},
      downloadUrl: job.downloadUrl || null,
      expiresAt: job.expiresAt || null,
      error: job.error || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      metadataOptions: job.metadataOptions || null,
      skipped: job.skipped || [],
      publishResult: job.publishResult || null
    };
  }

  async _countApprovedPieces(collectionId, userId) {
    const match = this._buildApprovedMatch(collectionId, userId);
    if (typeof this.generationOutputsDb.count === 'function') {
      return this.generationOutputsDb.count(match, PRIORITY.LOW);
    }
    const docs = await this._fetchApprovedGenerations({ collectionId, userId });
    return docs.length;
  }

  _buildApprovedMatch(collectionId, userId) {
    const clauses = [
      {
        $or: [
          { 'metadata.collectionId': collectionId },
          { collectionId }
        ]
      },
      {
        $or: [
          ...(ObjectId.isValid(userId) ? [{ masterAccountId: new ObjectId(userId) }] : []),
          { masterAccountId: userId }
        ]
      },
      { status: 'completed' },
      { deliveryStrategy: { $ne: 'spell_step' } },
      {
        $or: [
          { 'metadata.reviewOutcome': { $in: ['accepted', 'approved'] } },
          { reviewOutcome: { $in: ['accepted', 'approved'] } }
        ]
      }
    ];
    return { $and: clauses };
  }

  async _ensureStateLoaded() {
    if (this._stateLoaded || !this._stateLoadPromise) return;
    try {
      await this._stateLoadPromise;
    } catch (err) {
      this.logger.error('[CollectionExportService] failed to load worker state', err);
    }
  }

  async _loadPersistentState() {
    if (!this.systemStateDb) return;
    const saved = await this.systemStateDb.getValue(WORKER_STATE_KEY, null);
    if (saved && typeof saved === 'object') {
      this.workerState = {
        ...this.workerState,
        ...saved,
        lastHeartbeat: saved.lastHeartbeat ? new Date(saved.lastHeartbeat) : null
      };
      this._lastStateSync = Date.now();
    }
  }

  async _persistState() {
    if (!this.systemStateDb) return;
    const payload = {
      paused: !!this.workerState.paused,
      pauseReason: this.workerState.pauseReason || null,
      pausedAt: this.workerState.pausedAt || null,
      updatedAt: new Date()
    };
    this.workerState.updatedAt = payload.updatedAt;
    try {
      await this.systemStateDb.setValue(WORKER_STATE_KEY, payload);
    } catch (err) {
      this.logger.error('[CollectionExportService] failed to persist worker state', err);
    }
  }

  async _recordHeartbeat() {
    if (!this.systemStateDb) return;
    const payload = {
      timestamp: new Date(),
      paused: this.workerState.paused,
      pauseReason: this.workerState.pauseReason || null,
      activeJobId: this.activeJobId,
      currentCollectionId: this._currentJob?.collectionId || null,
      processing: this.processing
    };
    this.workerState.lastHeartbeat = payload.timestamp;
    try {
      await this.systemStateDb.setValue(WORKER_HEARTBEAT_KEY, payload);
    } catch (err) {
      this.logger.error('[CollectionExportService] failed to write heartbeat', err);
    }
  }

  _startHeartbeat() {
    if (this._heartbeatTimer || !this.systemStateDb) return;
    this._recordHeartbeat().catch(err => this.logger.error('[CollectionExportService] heartbeat error', err));
    this._heartbeatTimer = setInterval(() => {
      this._recordHeartbeat().catch(err => this.logger.error('[CollectionExportService] heartbeat error', err));
    }, this.heartbeatIntervalMs);
  }

  _startQueuePolling(intervalMs) {
    if (!this.processingEnabled || this._queuePollTimer) return;
    const pollInterval = Number(intervalMs);
    if (!pollInterval || pollInterval <= 0) return;
    this._queuePollTimer = setInterval(() => {
      if (this.processing) return;
      this._scheduleQueueProcessing();
    }, pollInterval);
  }

  async _recoverStuckJobs() {
    if (!this.collectionExportsDb || typeof this.collectionExportsDb.resetRunningJobs !== 'function') return;
    try {
      const result = await this.collectionExportsDb.resetRunningJobs();
      if (result && result.modifiedCount) {
        this.logger.warn(`[CollectionExportService] Reset ${result.modifiedCount} running export job(s) to pending state after restart.`);
      }
    } catch (err) {
      this.logger.error('[CollectionExportService] failed to reset running jobs', err);
    }
  }

  async _syncWorkerStateFromStore(force = false) {
    if (!this.systemStateDb) return;
    const now = Date.now();
    if (!force && this.stateSyncIntervalMs > 0 && (now - this._lastStateSync) < this.stateSyncIntervalMs) {
      return;
    }
    try {
      const saved = await this.systemStateDb.getValue(WORKER_STATE_KEY, null);
      if (saved && typeof saved === 'object') {
        this.workerState = {
          ...this.workerState,
          ...saved,
          lastHeartbeat: saved.lastHeartbeat ? new Date(saved.lastHeartbeat) : this.workerState.lastHeartbeat
        };
      }
      this._lastStateSync = now;
    } catch (err) {
      this.logger.error('[CollectionExportService] failed to sync worker state', err);
    }
  }

  _isPaused() {
    return !!this.workerState.paused;
  }

  _extractPromptValue(generation) {
    const metadata = generation.metadata || {};
    const requestPayload = generation.requestPayload || generation.request || {};
    const inputs = metadata.request?.inputs || requestPayload.inputs || {};

    const candidate =
      metadata.userInputPrompt ||
      metadata.originalPrompt ||
      metadata.prompt ||
      metadata.userPrompt ||
      requestPayload.user_prompt ||
      inputs.user_prompt ||
      requestPayload.prompt ||
      inputs.prompt ||
      requestPayload.input_prompt ||
      inputs.input_prompt ||
      generation.prompt ||
      '';

    return this._stripLoraTags(candidate);
  }

  _stripLoraTags(value) {
    if (!value) return '';
    return String(value)
      .replace(/<lora:[^>]+>/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}

module.exports = CollectionExportService;
