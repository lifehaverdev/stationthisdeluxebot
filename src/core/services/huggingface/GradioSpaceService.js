/**
 * Generic service for interacting with any Gradio-based HuggingFace Space.
 * Handles file upload, queue-based invocation, and SSE streaming.
 */
class GradioSpaceService {
  /**
   * @param {object} options
   * @param {string} options.spaceUrl - Base URL of the Gradio space (e.g. https://fancyfeast-joy-caption-beta-one.hf.space)
   * @param {string} [options.token] - HuggingFace personal-access token
   * @param {object} [options.logger]
   */
  constructor({ spaceUrl, token, logger }) {
    this.baseUrl = spaceUrl.replace(/\/+$/, '');
    this.token = token || process.env.HF_TOKEN || null;
    this.logger = logger || console;
  }

  /**
   * Downloads a file from a URL and uploads it to this Gradio space.
   * @param {string} fileUrl - Public URL to download from
   * @returns {Promise<string>} The uploaded file path on the space
   */
  async uploadFile(fileUrl) {
    this.logger.info(`[GradioSpaceService] Downloading file from ${fileUrl}`);
    const downloadResponse = await fetch(fileUrl);
    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text().catch(() => '');
      throw new Error(`Failed to download file (${downloadResponse.status}): ${errorText}`);
    }

    const buffer = Buffer.from(await downloadResponse.arrayBuffer());
    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream';
    const fileName = this._deriveFileName(fileUrl, contentType);

    const formData = new FormData();
    const fileBlob = new Blob([buffer], { type: contentType });
    formData.append('files', fileBlob, fileName);

    const uploadHeaders = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;

    this.logger.info(`[GradioSpaceService] Uploading file to ${this.baseUrl}`);
    const response = await fetch(`${this.baseUrl}/gradio_api/upload`, {
      method: 'POST',
      headers: uploadHeaders,
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`File upload failed (${response.status}): ${errorText}`);
    }

    const json = await response.json();
    if (!Array.isArray(json) || !json[0]) {
      throw new Error('Upload response missing file path');
    }

    this.logger.info('[GradioSpaceService] File uploaded successfully');
    return json[0];
  }

  /**
   * Constructs a full download URL for a Gradio file reference.
   * @param {string} filePath - Path returned by the space
   * @returns {string}
   */
  resolveFileUrl(filePath) {
    if (filePath && filePath.startsWith('http')) return filePath;
    return `${this.baseUrl}/gradio_api/file=${filePath}`;
  }

  /**
   * Invokes a Gradio queue function and returns the parsed result.
   * @param {string} functionName - Gradio function name (e.g. 'chat_joycaption')
   * @param {Array} dataArray - Positional arguments for the function
   * @param {object} [options]
   * @param {number} [options.timeout=180000] - SSE stream timeout in ms
   * @returns {Promise<any>} Parsed result (single-element arrays are unwrapped)
   */
  async invoke(functionName, dataArray, { timeout = 180000 } = {}) {
    const eventId = await this._createEvent(functionName, dataArray);
    if (!eventId) throw new Error('Failed to create HuggingFace job');
    const { finalData } = await this._streamEventResult(functionName, eventId, { timeout });

    let parsed;
    try {
      parsed = JSON.parse(finalData);
    } catch (error) {
      throw new Error(`Invalid JSON data received from HuggingFace: ${error.message}`);
    }

    if (Array.isArray(parsed)) {
      return parsed.length === 1 ? parsed[0] : parsed;
    }

    return parsed;
  }

  // ── Internal methods ──────────────────────────────────────────────

  async _createEvent(functionName, dataPayload) {
    const postHeaders = { 'Content-Type': 'application/json' };
    if (this.token) postHeaders['Authorization'] = `Bearer ${this.token}`;

    const payload = { data: dataPayload };
    this.logger.info(`[GradioSpaceService] Creating job for ${functionName}`);

    const response = await fetch(`${this.baseUrl}/gradio_api/call/${functionName}`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify(payload)
    });

    this._logHeaders('POST', response);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[GradioSpaceService] POST failed: ${response.status} - ${errorText}`);
      throw new Error(`HuggingFace API returned status ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    const eventId = json?.event_id;

    if (!eventId) {
      throw new Error('Failed to extract event ID from response');
    }

    this.logger.info(`[GradioSpaceService] Event ID for ${functionName}: ${eventId}`);
    return eventId;
  }

  async _streamEventResult(functionName, eventId, { timeout = 180000 } = {}) {
    const streamUrl = `${this.baseUrl}/gradio_api/call/${functionName}/${eventId}`;
    this.logger.info(`[GradioSpaceService] Streaming result for ${functionName} (${eventId})`);

    const streamHeaders = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: streamHeaders,
      signal: AbortSignal.timeout(timeout)
    });

    this._logHeaders('STREAM', response);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[GradioSpaceService] Stream failed: ${response.status} - ${errorText}`);
      throw new Error(`Stream request failed with status ${response.status}: ${errorText}`);
    }

    const raw = await response.text();
    this.logger.debug(`[GradioSpaceService] Raw SSE payload length: ${raw.length}`);

    const events = this._parseSSE(raw);
    let finalData = null;
    let lastGeneratingData = null;
    let errorMessage = null;
    let generatingEvents = 0;

    events.forEach(({ name, data }) => {
      if (name === 'generating') {
        generatingEvents += 1;
        lastGeneratingData = data;
        return;
      }

      const preview = this._formatPayloadForLog(data);
      const suffix = preview ? ` => ${preview}` : '';
      this.logger.info(`[GradioSpaceService] Event ${name}${suffix}`);
      if (name === 'error') {
        errorMessage = this._extractErrorMessage(data);
      } else if (name === 'complete') {
        finalData = data;
      }
    });

    if (generatingEvents > 0) {
      const preview = this._formatPayloadForLog(lastGeneratingData);
      const summarySuffix = preview ? ` Last chunk: ${preview}` : '';
      this.logger.info(`[GradioSpaceService] Received ${generatingEvents} generating events.${summarySuffix}`);
    }

    // Quota / rate-limit detection
    if (errorMessage) {
      const waitTimeMatch = errorMessage.match(/retry in (\d+):(\d+):(\d+)/);
      if (waitTimeMatch) {
        const [_, hours, minutes, seconds] = waitTimeMatch;
        const totalMinutes = (parseInt(hours, 10) * 60) + parseInt(minutes, 10) + Math.ceil(parseInt(seconds, 10) / 60);
        throw new Error(`HuggingFace quota exceeded. Please try again in ${totalMinutes} minutes.`);
      }
      if (errorMessage.includes('exceeded your GPU quota') || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
        throw new Error('HuggingFace GPU quota exhausted. Please try again later.');
      }
      throw new Error(errorMessage);
    }

    const payload = finalData || lastGeneratingData;
    if (!payload) {
      throw new Error('No valid data received from the server');
    }

    return { finalData: payload, events };
  }

  _parseSSE(content) {
    const events = [];
    const lines = content.split('\n');
    let currentEvent = null;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentEvent) {
          events.push({ name: currentEvent.name || 'message', data: currentEvent.data.join('\n') });
          currentEvent = null;
        }
        return;
      }
      if (trimmed.startsWith('event:')) {
        if (currentEvent) {
          events.push({ name: currentEvent.name || 'message', data: currentEvent.data.join('\n') });
        }
        currentEvent = { name: trimmed.replace('event:', '').trim(), data: [] };
        this.logger.debug(`[GradioSpaceService] SSE event detected on line ${index}: ${currentEvent.name}`);
        return;
      }
      if (trimmed.startsWith('data:')) {
        if (!currentEvent) currentEvent = { name: 'message', data: [] };
        currentEvent.data.push(trimmed.replace('data:', '').trim());
      }
    });

    if (currentEvent) {
      events.push({ name: currentEvent.name || 'message', data: currentEvent.data.join('\n') });
    }

    return events;
  }

  _deriveFileName(url, contentType) {
    try {
      const parsed = new URL(url);
      const baseName = parsed.pathname.split('/').pop();
      if (baseName && baseName.includes('.')) return baseName;
    } catch (_) {
      // ignore parsing errors
    }
    const extensionFromType = contentType?.split('/').pop() || 'jpg';
    return `file-${Date.now()}.${extensionFromType}`;
  }

  _logHeaders(stage, response) {
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    this.logger.info(`[GradioSpaceService] ${stage} response status: ${response.status}, headers: ${JSON.stringify(headers)}`);
  }

  _formatPayloadForLog(payload, limit = 160) {
    if (payload === undefined || payload === null) return '';
    let value = payload;
    if (typeof value !== 'string') {
      try {
        value = JSON.stringify(value);
      } catch (error) {
        value = String(value);
      }
    }
    let sanitized = value.replace(/\s+/g, ' ').trim();
    if (sanitized.length > limit) {
      sanitized = `${sanitized.slice(0, limit)}...`;
    }
    return sanitized;
  }

  _extractErrorMessage(payload) {
    if (!payload || payload === 'null') {
      return 'The HuggingFace space reported an unknown error. Please try again shortly.';
    }
    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed === 'string') return parsed;
      return JSON.stringify(parsed);
    } catch (error) {
      return payload;
    }
  }
}

module.exports = GradioSpaceService;
