/**
 * Service to interact with HuggingFace Spaces API.
 */
class HuggingFaceService {
  /**
   * @param {object} options - Service configuration.
   * @param {object} options.logger - A logger instance.
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.baseUrl = 'https://fancyfeast-joy-caption-beta-one.hf.space';
    // Optional HuggingFace personal-access token for higher rate limits
    this.token = process.env.HF_TOKEN || null;
    this.logger.info('HuggingFaceService initialized successfully.');
  }

  /**
   * Interrogates an image using the JoyCaption Beta One API to generate a text description.
   * @param {object} params - Parameters for image interrogation.
   * @param {string} params.imageUrl - URL of the image to interrogate.
   * @param {string} [params.captionType]
   * @param {string} [params.captionLength]
   * @param {string|string[]} [params.extraOptions]
   * @param {string} [params.personName]
   * @param {number} [params.temperature]
   * @param {number} [params.topP]
   * @param {number} [params.maxNewTokens]
   * @param {boolean} [params.logPrompt]
   * @returns {Promise<string>} The generated text description of the image.
   */
  async interrogateImage(params = {}) {
    const {
      imageUrl,
      captionType = 'Descriptive',
      captionLength = 'long',
      extraOptions = [],
      personName = '',
      temperature = 0.6,
      topP = 0.9,
      maxNewTokens = 512,
      logPrompt = false
    } = params;

    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('Image URL is required for interrogation.');
    }

    this.logger.info(`Starting image interrogation for URL: ${imageUrl}`);

    try {
      const normalizedExtraOptions = this._normalizeExtraOptions(extraOptions);

      const prompt = await this._buildPrompt({
        captionType,
        captionLength,
        extraOptions: normalizedExtraOptions,
        personName
      });

      const hfImagePath = await this._uploadImageFromUrl(imageUrl);

      const temperatureValue = this._sanitizeNumber(temperature, 0, 2, 0.6);
      const topPValue = this._sanitizeNumber(topP, 0, 1, 0.9);
      const maxTokensValue = Math.round(this._sanitizeNumber(maxNewTokens, 1, 2048, 512));
      const consentToLog = Boolean(logPrompt);

      const description = await this._invokeQueueFunction('chat_joycaption', [
        { path: hfImagePath },
        prompt,
        temperatureValue,
        topPValue,
        maxTokensValue,
        consentToLog
      ]);

      if (!description || typeof description !== 'string') {
        throw new Error('Invalid description format received');
      }

      this.logger.info('Image interrogation completed successfully');
      return description;
    } catch (error) {
      // Check for quota/rate limit errors with retry time
      const waitTimeMatch = error.message.match(/retry in (\d+):(\d+):(\d+)/);
      if (waitTimeMatch) {
        const [_, hours, minutes, seconds] = waitTimeMatch;
        const totalMinutes = (parseInt(hours, 10) * 60) + parseInt(minutes, 10) + Math.ceil(parseInt(seconds, 10) / 60);
        throw new Error(`⏳ HuggingFace quota exceeded. Please try again in ${totalMinutes} minutes.`);
      }
      
      if (error.message.includes('exceeded your GPU quota') || error.message.includes('quota') || error.message.includes('rate limit')) {
        this.logger.error(`HuggingFace quota/rate limit error: ${error.message}`);
        throw new Error('⏳ JoyCaption daily quota exhausted. Please try again tomorrow. You can still use the free UI directly at https://huggingface.co/spaces/fancyfeast/joy-caption-beta-one');
      }

      this.logger.error(`Image interrogation failed: ${error.message}`);
      throw error;
    }
  }

  async _buildPrompt({ captionType, captionLength, extraOptions, personName }) {
    try {
      const result = await this._invokeQueueFunction('build_prompt', [
        captionType || 'Descriptive',
        captionLength || 'long',
        Array.isArray(extraOptions) ? extraOptions : [],
        personName || ''
      ]);

      if (typeof result === 'string') return result;
      if (Array.isArray(result) && typeof result[0] === 'string') return result[0];
    } catch (error) {
      this.logger.warn(`[HuggingFace] Prompt builder failed (${error.message}). Falling back to default prompt.`);
    }
    return 'Write a long detailed description for this image.';
  }

  async _uploadImageFromUrl(imageUrl) {
    this.logger.info('[HuggingFace] Downloading image before upload');
    const downloadResponse = await fetch(imageUrl);
    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text().catch(() => '');
      throw new Error(`Failed to download image (${downloadResponse.status}): ${errorText}`);
    }

    const buffer = Buffer.from(await downloadResponse.arrayBuffer());
    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream';
    const fileName = this._deriveFileName(imageUrl, contentType);

    const formData = new FormData();
    const fileBlob = new Blob([buffer], { type: contentType });
    formData.append('files', fileBlob, fileName);

    const uploadHeaders = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;

    this.logger.info('[HuggingFace] Uploading image chunk to JoyCaption space');
    const response = await fetch(`${this.baseUrl}/gradio_api/upload`, {
      method: 'POST',
      headers: uploadHeaders,
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Image upload failed (${response.status}): ${errorText}`);
    }

    const json = await response.json();
    if (!Array.isArray(json) || !json[0]) {
      throw new Error('Upload response missing file path');
    }

    this.logger.info('[HuggingFace] Image uploaded successfully');
    return json[0];
  }

  async _invokeQueueFunction(functionName, dataPayload) {
    const eventId = await this._createEvent(functionName, dataPayload);
    if (!eventId) throw new Error('Failed to create HuggingFace job');
    const { finalData } = await this._streamEventResult(functionName, eventId);

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

  async _createEvent(functionName, dataPayload) {
    const postHeaders = { 'Content-Type': 'application/json' };
    if (this.token) postHeaders['Authorization'] = `Bearer ${this.token}`;

    const payload = { data: dataPayload };
    this.logger.info(`[HuggingFace] Creating job for ${functionName}`);

    const response = await fetch(`${this.baseUrl}/gradio_api/call/${functionName}`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify(payload)
    });

    this._logHeaders('POST', response);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[HuggingFace] POST failed: ${response.status} - ${errorText}`);
      throw new Error(`HuggingFace API returned status ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    const eventId = json?.event_id;

    if (!eventId) {
      throw new Error('Failed to extract event ID from response');
    }

    this.logger.info(`[HuggingFace] Event ID for ${functionName}: ${eventId}`);
    return eventId;
  }

  async _streamEventResult(functionName, eventId) {
    const streamUrl = `${this.baseUrl}/gradio_api/call/${functionName}/${eventId}`;
    this.logger.info(`[HuggingFace] Streaming result for ${functionName} (${eventId})`);

    const streamHeaders = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: streamHeaders,
      signal: AbortSignal.timeout(180000) // 3 minute timeout
    });

    this._logHeaders('STREAM', response);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[HuggingFace] Stream failed: ${response.status} - ${errorText}`);
      throw new Error(`Stream request failed with status ${response.status}: ${errorText}`);
    }

    const raw = await response.text();
    this.logger.debug('[HuggingFace] Raw SSE payload:', raw);

    const events = this._parseSSE(raw);
    let finalData = null;
    let lastGeneratingData = null;
    let errorMessage = null;

    events.forEach(({ name, data }) => {
      this.logger.info(`[HuggingFace] Event ${name} => ${data}`);
      if (name === 'error') {
        errorMessage = this._extractErrorMessage(data);
      } else if (name === 'complete') {
        finalData = data;
      } else if (name === 'generating') {
        lastGeneratingData = data;
      }
    });

    if (errorMessage) {
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
        this.logger.info(`[HuggingFace] SSE event detected on line ${index}: ${currentEvent.name}`);
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

  _extractErrorMessage(payload) {
    if (!payload || payload === 'null') {
      return 'The JoyCaption space reported an unknown error. Please try again shortly.';
    }

    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed === 'string') return parsed;
      return JSON.stringify(parsed);
    } catch (error) {
      return payload;
    }
  }

  _normalizeExtraOptions(extraOptions) {
    if (Array.isArray(extraOptions)) {
      return extraOptions.map(option => option && option.toString().trim()).filter(Boolean);
    }

    if (typeof extraOptions === 'string') {
      return extraOptions
        .split(/[\n,;]+/)
        .map(part => part.trim())
        .filter(Boolean);
    }

    return [];
  }

  _deriveFileName(imageUrl, contentType) {
    try {
      const parsed = new URL(imageUrl);
      const baseName = parsed.pathname.split('/').pop();
      if (baseName && baseName.includes('.')) return baseName;
    } catch (_) {
      // ignore parsing errors – fall back below
    }

    const extensionFromType = contentType?.split('/').pop() || 'jpg';
    return `image-${Date.now()}.${extensionFromType}`;
  }

  _sanitizeNumber(value, min, max, fallback) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  _logHeaders(stage, response) {
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    this.logger.info(`[HuggingFace] ${stage} response status: ${response.status}, headers: ${JSON.stringify(headers)}`);
  }
}

module.exports = HuggingFaceService;
