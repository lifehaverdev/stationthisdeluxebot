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
    this.baseUrl = 'https://fancyfeast-joy-caption-pre-alpha.hf.space';
    this.logger.info('HuggingFaceService initialized successfully.');
  }

  /**
   * Interrogates an image using the Joy Caption API to generate a text description.
   * @param {object} params - Parameters for image interrogation.
   * @param {string} params.imageUrl - URL of the image to interrogate.
   * @returns {Promise<string>} The generated text description of the image.
   */
  async interrogateImage({ imageUrl }) {
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('Image URL is required for interrogation.');
    }

    this.logger.info(`Starting image interrogation for URL: ${imageUrl}`);

    try {
      // Step 1: Get Event ID
      const eventId = await this._getEventId(imageUrl);
      
      if (!eventId) {
        throw new Error('Failed to get event ID from HuggingFace API');
      }

      // Step 2: Stream Result
      const description = await this._streamEventResult(eventId);
      
      this.logger.info('Image interrogation completed successfully');
      return description;

    } catch (error) {
      // Check for quota/rate limit errors with retry time
      const waitTimeMatch = error.message.match(/retry in (\d+):(\d+):(\d+)/);
      if (waitTimeMatch) {
        const [_, hours, minutes, seconds] = waitTimeMatch;
        const totalMinutes = (parseInt(hours) * 60) + parseInt(minutes) + Math.ceil(parseInt(seconds) / 60);
        throw new Error(`⏳ HuggingFace quota exceeded. Please try again in ${totalMinutes} minutes.`);
      }
      
      // Generic quota error
      if (error.message.includes('exceeded your GPU quota') || error.message.includes('quota') || error.message.includes('rate limit')) {
        this.logger.error(`HuggingFace quota/rate limit error: ${error.message}`);
        throw new Error('⏳ HuggingFace API quota exceeded. Please try again in 15 minutes.');
      }

      this.logger.error(`Image interrogation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Step 1: Send POST request to get event ID
   * @private
   */
  async _getEventId(imageUrl) {
    this.logger.info('Requesting event ID from HuggingFace...');
    
    try {
      const response = await fetch(`${this.baseUrl}/call/stream_chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [{ path: imageUrl }]
        })
      });

      // Log response headers for rate limit info
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      this.logger.info(`[HuggingFace] POST response status: ${response.status}, headers: ${JSON.stringify(headers)}`);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`[HuggingFace] POST failed: ${response.status} - ${errorText}`);
        throw new Error(`HuggingFace API returned status ${response.status}: ${errorText}`);
      }

      const jsonResponse = await response.json();
      this.logger.debug('Event ID response:', jsonResponse);

      // Extract event ID from response (using legacy extraction logic)
      const eventId = JSON.stringify(jsonResponse).split('"')[3];
      
      if (!eventId) {
        throw new Error('Failed to extract event ID from response');
      }

      this.logger.info(`Event ID received: ${eventId}`);
      return eventId;

    } catch (error) {
      this.logger.error(`Error getting event ID: ${error.message}`);
      throw error;
    }
  }

  /**
   * Step 2: Stream result using event ID
   * @private
   */
  async _streamEventResult(eventId) {
    this.logger.info(`Streaming result for event ID: ${eventId}`);
    
    const streamUrl = `${this.baseUrl}/call/stream_chat/${eventId}`;

    try {
      const response = await fetch(streamUrl, { 
        method: 'GET',
        signal: AbortSignal.timeout(60000) // 60 second timeout
      });

      // Log response headers for rate limit info
      const streamHeaders = {};
      response.headers.forEach((value, key) => {
        streamHeaders[key] = value;
      });
      this.logger.info(`[HuggingFace] Stream response status: ${response.status}, headers: ${JSON.stringify(streamHeaders)}`);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`[HuggingFace] Stream failed: ${response.status} - ${errorText}`);
        throw new Error(`Stream request failed with status ${response.status}: ${errorText}`);
      }

      const result = await response.text();
      this.logger.debug('Raw stream response received');
      this.logger.info(`[HuggingFace] Full SSE response: ${result}`); // Log full response for debugging

      // Parse Server-Sent Events format - log ALL lines for debugging
      const lines = result.split('\n');
      this.logger.info(`[HuggingFace] SSE has ${lines.length} lines`);
      
      let lastDataLine = null;
      let isErrorEvent = false;
      let errorMessage = null;
      let allEvents = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue; // Skip empty lines
        
        this.logger.info(`[HuggingFace] SSE Line ${i}: "${line}"`);
        
        // Track all event types
        if (line.startsWith('event:')) {
          const eventType = line.replace('event:', '').trim();
          allEvents.push(eventType);
          this.logger.info(`[HuggingFace] Event type: ${eventType}`);
          
          if (eventType === 'error') {
            isErrorEvent = true;
          }
          continue;
        }

        // Process data events - capture ALL data
        if (line.startsWith('data:')) {
          const data = line.replace('data:', '').trim();
          this.logger.info(`[HuggingFace] Data content: "${data}"`);
          
          // If this is data after an error event, it might contain error details
          if (isErrorEvent) {
            if (data && data !== 'null') {
              try {
                const parsed = JSON.parse(data);
                errorMessage = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                this.logger.error(`[HuggingFace] Error details: ${errorMessage}`);
              } catch (e) {
                // Not JSON, might be plain text error
                errorMessage = data;
                this.logger.error(`[HuggingFace] Error text: ${data}`);
              }
            } else {
              this.logger.warn(`[HuggingFace] Error event has null/empty data`);
            }
          } else if (data !== 'null' && data !== '') {
            // Normal success data
            try {
              JSON.parse(data);
              lastDataLine = data;
            } catch (e) {
              this.logger.warn('Invalid JSON data received:', data);
            }
          }
        }
        
        // Log any other SSE fields
        if (!line.startsWith('event:') && !line.startsWith('data:')) {
          this.logger.info(`[HuggingFace] Other SSE field: "${line}"`);
        }
      }

      this.logger.info(`[HuggingFace] All events detected: ${allEvents.join(', ')}`);

      // Handle different scenarios
      if (isErrorEvent) {
        if (!errorMessage) {
          // No error details provided - this is the quota limit case
          this.logger.error('[HuggingFace] Error event with no details - likely quota/rate limit');
          errorMessage = 'Rate limit or quota exceeded (no details provided by API)';
        }
        throw new Error(errorMessage);
      }

      if (!lastDataLine) {
        throw new Error('No valid data received from the server');
      }

      const jsonData = JSON.parse(lastDataLine);
      this.logger.debug('Parsed JSON data:', jsonData);

      if (!Array.isArray(jsonData) || jsonData.length === 0) {
        throw new Error('Invalid response format from server');
      }

      const description = jsonData[0];
      
      if (!description || typeof description !== 'string') {
        throw new Error('Invalid description format received');
      }

      return description;

    } catch (error) {
      this.logger.error(`Error streaming result: ${error.message}`);
      
      // Provide more specific error messages
      if (error.message === 'No valid data received from the server') {
        throw new Error('The image analysis service is currently unavailable. Please try again later.');
      }
      if (error.message === 'Server returned an error event') {
        throw new Error('The server encountered an error processing your request. Please try again.');
      }
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error('Request timed out. The image may be too large or the service is slow.');
      }
      
      throw error;
    }
  }
}

module.exports = HuggingFaceService;

