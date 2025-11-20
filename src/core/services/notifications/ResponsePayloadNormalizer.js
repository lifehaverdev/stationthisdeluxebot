/**
 * ResponsePayloadNormalizer
 * ------------------------
 * Centralized utility for normalizing responsePayload formats from various
 * tools and services into a consistent structure that can be delivered
 * across all platforms (Telegram, Discord, Web).
 * 
 * This ensures outputs are never dropped due to format mismatches.
 */

class ResponsePayloadNormalizer {
  /**
   * Normalizes a responsePayload from any tool/service into a consistent array format.
   * 
   * Supported input formats:
   * 1. Array format: [{ type: 'text', data: { text: ["..."] } }]
   * 2. Simple result: { result: "text" }
   * 3. Images object: { images: [...] }
   * 4. Text object: { text: "..." } or { response: "..." }
   * 5. Image URL: { imageUrl: "..." } or { image: "..." }
   * 6. Video URL: { videoUrl: "..." } or { video: "..." }
   * 7. Files array: { files: [...] }
   * 8. Artifact URLs: { artifactUrls: [...] }
   * 9. String: "text"
   * 10. Legacy outputs field: { outputs: [...] }
   * 
   * @param {any} responsePayload - The raw responsePayload from a tool/service
   * @param {Object} options - Normalization options
   * @param {Object} options.logger - Logger instance (optional)
   * @returns {Array} Normalized array format: [{ type: string, data: object }]
   */
  static normalize(responsePayload, options = {}) {
    const logger = options.logger || console;
    
    // Handle null/undefined
    if (responsePayload === null || responsePayload === undefined) {
      logger.warn('[ResponsePayloadNormalizer] responsePayload is null/undefined');
      return [];
    }

    // Already in array format - validate and return
    if (Array.isArray(responsePayload)) {
      // Validate array structure
      const normalized = responsePayload.map(item => {
        if (typeof item === 'string') {
          // Convert plain string to proper format
          return { type: 'text', data: { text: [item] } };
        }
        if (item && typeof item === 'object') {
          // Ensure it has type and data structure
          if (item.data) {
            return { type: item.type || 'unknown', data: item.data };
          }
          // If it's an object without data, wrap it
          return { type: item.type || 'unknown', data: item };
        }
        return item;
      });
      logger.debug('[ResponsePayloadNormalizer] Normalized array format:', normalized.length, 'items');
      return normalized;
    }

    // Handle string directly
    if (typeof responsePayload === 'string') {
      logger.debug('[ResponsePayloadNormalizer] Converting string to array format');
      return [{ type: 'text', data: { text: [responsePayload] } }];
    }

    // Handle object formats
    if (typeof responsePayload === 'object') {
      const normalized = [];

      // Format 1: Simple result format (e.g., ChatGPT: { result: "text" })
      if (responsePayload.result && typeof responsePayload.result === 'string') {
        logger.debug('[ResponsePayloadNormalizer] Converting { result: "text" } format');
        normalized.push({ 
          type: 'text', 
          data: { text: [responsePayload.result] } 
        });
      }

      // Format 2: Direct text fields
      else if (responsePayload.text) {
        logger.debug('[ResponsePayloadNormalizer] Converting { text: "..." } format');
        const textValue = Array.isArray(responsePayload.text) 
          ? responsePayload.text 
          : [responsePayload.text];
        normalized.push({ 
          type: 'text', 
          data: { text: textValue } 
        });
      }

      // Format 3: Response field (alternative text field)
      else if (responsePayload.response) {
        logger.debug('[ResponsePayloadNormalizer] Converting { response: "..." } format');
        const responseValue = Array.isArray(responsePayload.response)
          ? responsePayload.response
          : [responsePayload.response];
        normalized.push({ 
          type: 'text', 
          data: { text: responseValue } 
        });
      }

      // Format 4: Description field
      else if (responsePayload.description) {
        logger.debug('[ResponsePayloadNormalizer] Converting { description: "..." } format');
        normalized.push({ 
          type: 'text', 
          data: { text: [responsePayload.description] } 
        });
      }

      // Format 5: Images array
      else if (Array.isArray(responsePayload.images)) {
        logger.debug('[ResponsePayloadNormalizer] Converting { images: [...] } format');
        normalized.push({ 
          type: 'image', 
          data: { images: responsePayload.images } 
        });
      }

      // Format 6: Single image URL fields
      else if (responsePayload.imageUrl || responsePayload.image) {
        logger.debug('[ResponsePayloadNormalizer] Converting { imageUrl/image: "..." } format');
        const imageUrl = responsePayload.imageUrl || responsePayload.image;
        normalized.push({ 
          type: 'image', 
          data: { images: [{ url: imageUrl }] } 
        });
      }

      // Format 7: Video URL fields
      else if (responsePayload.videoUrl || responsePayload.video) {
        logger.debug('[ResponsePayloadNormalizer] Converting { videoUrl/video: "..." } format');
        const videoUrl = responsePayload.videoUrl || responsePayload.video;
        normalized.push({ 
          type: 'video', 
          data: { files: [{ url: videoUrl, format: 'video/mp4' }] } 
        });
      }

      // Format 8: Artifact URLs array
      else if (Array.isArray(responsePayload.artifactUrls)) {
        logger.debug('[ResponsePayloadNormalizer] Converting { artifactUrls: [...] } format');
        normalized.push({ 
          type: 'image', 
          data: { images: responsePayload.artifactUrls.map(url => ({ url })) } 
        });
      }

      // Format 9: Files array
      else if (Array.isArray(responsePayload.files)) {
        logger.debug('[ResponsePayloadNormalizer] Converting { files: [...] } format');
        normalized.push({ 
          type: 'file', 
          data: { files: responsePayload.files } 
        });
      }

      // Format 10: Legacy outputs field
      else if (Array.isArray(responsePayload.outputs)) {
        logger.debug('[ResponsePayloadNormalizer] Converting { outputs: [...] } format');
        return this.normalize(responsePayload.outputs, options);
      }

      // Format 11: ComfyUI format - object with node IDs as keys and arrays of URLs as values
      // Example: { "3": ["https://...image.png"], "4": ["https://...image2.png"] }
      else if (typeof responsePayload === 'object' && !Array.isArray(responsePayload)) {
        const keys = Object.keys(responsePayload);
        // Check if this looks like ComfyUI output format (numeric keys with URL arrays)
        const isComfyUIFormat = keys.length > 0 && keys.every(key => {
          const value = responsePayload[key];
          return Array.isArray(value) && value.every(item => 
            typeof item === 'string' && (item.startsWith('http://') || item.startsWith('https://'))
          );
        });

        if (isComfyUIFormat) {
          logger.debug('[ResponsePayloadNormalizer] Detected ComfyUI format (node IDs with URL arrays), converting to files array');
          // Flatten all URLs from all node outputs into a single files array
          const allFiles = [];
          keys.forEach(nodeId => {
            const urls = responsePayload[nodeId];
            urls.forEach(url => {
              allFiles.push({ url });
            });
          });
          normalized.push({ 
            type: 'file', 
            data: { files: allFiles } 
          });
        }
        // Format 12: Complex nested structure - try to extract meaningful data
        else {
          logger.debug('[ResponsePayloadNormalizer] Attempting to extract from complex object');
          
          // If it has a 'data' field, wrap it
          if (responsePayload.data) {
            normalized.push({ 
              type: responsePayload.type || 'unknown', 
              data: responsePayload.data 
            });
          }
          // If it looks like it might have content, try to extract
          else if (keys.length > 0) {
            // Try to find text-like fields
            const textFields = keys.filter(k => 
              ['text', 'content', 'message', 'output', 'result'].includes(k.toLowerCase())
            );
            
            if (textFields.length > 0) {
              const textValue = responsePayload[textFields[0]];
              if (typeof textValue === 'string') {
                normalized.push({ 
                  type: 'text', 
                  data: { text: [textValue] } 
                });
              }
            } else {
              // Fallback: wrap the entire object
              logger.warn('[ResponsePayloadNormalizer] Unknown format, wrapping entire object:', keys);
              normalized.push({ 
                type: 'unknown', 
                data: responsePayload 
              });
            }
          }
        }
      }

      // If we found something, return it
      if (normalized.length > 0) {
        logger.debug('[ResponsePayloadNormalizer] Normalized to', normalized.length, 'items');
        return normalized;
      }
    }

    // Fallback: wrap in unknown format
    logger.warn('[ResponsePayloadNormalizer] Could not normalize responsePayload, using fallback:', typeof responsePayload);
    return [{ 
      type: 'unknown', 
      data: responsePayload 
    }];
  }

  /**
   * Extracts text outputs from normalized payload array
   * @param {Array} normalizedPayload - Normalized payload array
   * @returns {Array<string>} Array of text strings
   */
  static extractText(normalizedPayload) {
    const texts = [];
    if (!Array.isArray(normalizedPayload)) return texts;
    
    for (const item of normalizedPayload) {
      if (item.data && item.data.text) {
        const textData = item.data.text;
        if (Array.isArray(textData)) {
          texts.push(...textData);
        } else if (typeof textData === 'string') {
          texts.push(textData);
        }
      }
    }
    
    return texts;
  }

  /**
   * Extracts media (images/videos) from normalized payload array
   * @param {Array} normalizedPayload - Normalized payload array
   * @returns {Array<Object>} Array of media objects with { type, url, ... }
   */
  static extractMedia(normalizedPayload) {
    const media = [];
    if (!Array.isArray(normalizedPayload)) return media;
    
    for (const item of normalizedPayload) {
      if (!item.data) continue;
      
      // Extract images
      if (item.data.images && Array.isArray(item.data.images)) {
        item.data.images.forEach(image => {
          if (image && image.url) {
            media.push({ 
              type: 'photo', 
              url: image.url,
              ...image 
            });
          }
        });
      }
      
      // Extract files (videos, documents, images, etc.)
      if (item.data.files && Array.isArray(item.data.files)) {
        item.data.files.forEach(file => {
          if (file && file.url) {
            // Determine type from file properties
            let mediaType = 'document';
            
            // Check for images first (images should be sent as photos, not documents)
            if (file.format && file.format.startsWith('image/')) {
              mediaType = 'photo';
            } else if (file.filename) {
              // Check filename extensions
              if (file.filename.match(/\.(png|jpg|jpeg|gif|webp|avif|bmp|svg)$/i)) {
                mediaType = 'photo';
              } else if (file.filename.match(/\.(mp4|webm|avi|mov|mkv)$/i)) {
                mediaType = 'video';
              } else if (file.filename.match(/\.(gif)$/i)) {
                mediaType = 'animation';
              }
            } else if (file.subfolder === 'video') {
              mediaType = 'video';
            } else if (file.subfolder === 'image' || file.subfolder === 'images') {
              mediaType = 'photo';
            } else if (file.format && file.format.startsWith('video/')) {
              mediaType = 'video';
            }
            
            // CRITICAL FIX: If mediaType is still 'document', check URL itself for image patterns
            // ComfyUI often doesn't include format/filename/subfolder, so URL-based detection is essential
            // This ensures PNG images from ComfyUI are detected as photos, not documents
            if (mediaType === 'document') {
              const url = file.url.toLowerCase();
              if (url.match(/\.(png|jpg|jpeg|gif|webp|avif|bmp|svg)(\?|$)/i)) {
                mediaType = 'photo';
              } else if (url.match(/\.(mp4|webm|avi|mov|mkv)(\?|$)/i)) {
                mediaType = 'video';
              } else if (url.match(/\.(gif)(\?|$)/i)) {
                mediaType = 'animation';
              } else if (url.includes('/images/') || url.includes('/image/') || url.includes('/img/')) {
                // URL path suggests it's an image
                mediaType = 'photo';
              }
            }
            
            media.push({ 
              type: mediaType, 
              url: file.url,
              ...file 
            });
          }
        });
      }
    }
    
    return media;
  }

  /**
   * Converts normalized payload to web-friendly format
   * (for WebSandboxNotifier - maintains backward compatibility)
   * @param {Array} normalizedPayload - Normalized payload array
   * @returns {Object} Web-friendly output object
   */
  static toWebFormat(normalizedPayload) {
    if (!Array.isArray(normalizedPayload) || normalizedPayload.length === 0) {
      return {};
    }

    // If single item, extract its data directly for backward compatibility
    if (normalizedPayload.length === 1) {
      const item = normalizedPayload[0];
      
      // Text output
      if (item.type === 'text' && item.data && item.data.text) {
        const text = item.data.text;
        return { 
          text: Array.isArray(text) ? text[0] : text 
        };
      }
      
      // Image output
      if (item.type === 'image' && item.data && item.data.images) {
        const images = item.data.images;
        if (images.length > 0) {
          return { 
            images: images 
          };
        }
      }
      
      // Video output
      if (item.type === 'video' && item.data && item.data.files) {
        const files = item.data.files;
        if (files.length > 0) {
          return { 
            files: files 
          };
        }
      }
    }

    // Multiple items - return as array format
    return normalizedPayload;
  }
}

module.exports = ResponsePayloadNormalizer;

