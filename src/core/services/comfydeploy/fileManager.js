/**
 * ComfyDeploy File Manager Utilities
 * 
 * Handles file type determination and uploading files via ComfyDeploy API.
 */

const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const DEBUG_LOGGING_ENABLED = false; // Set to true for detailed file management logs

// Local helper function (previously _determineFileType)
function determineFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Get a pre-signed URL for file uploads from ComfyDeploy API.
 * 
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiUrl - The base API URL.
 * @param {string} instanceData.apiKey - The API key.
 * @param {object} instanceData.logger - Logger instance.
 * @param {object} options - Options for getting upload URL.
 * @param {string} options.fileType - MIME type of the file.
 * @param {number} options.fileSize - Size of the file in bytes.
 * @returns {Promise<Object>} - Upload URL and file information.
 */
async function getUploadUrl(instanceData, options = {}) {
  const { apiUrl, apiKey, logger } = instanceData;
  const { fileType, fileSize } = options;
  
  if (!fileType || !fileSize) {
    throw new Error('File type and size are required for getUploadUrl');
  }
  
  // Assuming API_ENDPOINTS.FILE_UPLOAD = '/api/file' based on previous context
  const endpoint = '/api/file'; 
  const url = `${apiUrl}${endpoint}`;

  try {
    if (DEBUG_LOGGING_ENABLED) logger.debug(`[fileManager.getUploadUrl] Requesting upload URL from ${url} for type: ${fileType}, size: ${fileSize}`);
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        type: fileType,
        file_size: fileSize
      }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json' // Added Accept header
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[fileManager.getUploadUrl] Failed response (${response.status}): ${errorText}`);
      throw new Error(`Failed to get upload URL: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    if (DEBUG_LOGGING_ENABLED) logger.debug(`[fileManager.getUploadUrl] Received upload URL: ${data.upload_url}, fileId: ${data.file_id}`);
    
    return {
      uploadUrl: data.upload_url,
      fileId: data.file_id,
      downloadUrl: data.download_url
    };
  } catch (error) {
    logger.error(`[fileManager.getUploadUrl] Error: ${error.message}`);
    throw error;
  }
}

/**
 * Upload a file to ComfyUI Deploy using a pre-signed URL.
 * 
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiUrl - The base API URL.
 * @param {string} instanceData.apiKey - The API key.
 * @param {object} instanceData.logger - Logger instance.
 * @param {object} options - Upload options.
 * @param {string} options.filePath - Path to the file to upload.
 * @param {string} options.fileType - MIME type of the file (optional, detected from file).
 * @returns {Promise<Object>} - Information about the uploaded file.
 */
async function uploadFile(instanceData, options = {}) {
  const { logger } = instanceData;
  const { filePath, fileType: providedFileType } = options;
  
  if (!filePath) {
    throw new Error('File path is required for uploadFile');
  }
  
  logger.info(`[fileManager.uploadFile] Starting upload for: ${filePath}`);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
      logger.error(`[fileManager.uploadFile] File not found: ${filePath}`);
    throw new Error(`File not found: ${filePath}`);
  }
  
  try {
    // Get file stats for size
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    if (DEBUG_LOGGING_ENABLED) logger.debug(`[fileManager.uploadFile] File size: ${fileSize} bytes`);
    
    // Determine file type
    const fileType = providedFileType || determineFileType(filePath);
    if (DEBUG_LOGGING_ENABLED) logger.debug(`[fileManager.uploadFile] Determined file type: ${fileType}`);
    
    // Get upload URL using the exported function
    if (DEBUG_LOGGING_ENABLED) logger.debug(`[fileManager.uploadFile] Getting upload URL...`);
    const { uploadUrl, fileId, downloadUrl } = await getUploadUrl(instanceData, {
      fileType,
      fileSize
    });
    
    // Read file content
    if (DEBUG_LOGGING_ENABLED) logger.debug(`[fileManager.uploadFile] Reading file content...`);
    const fileContent = fs.readFileSync(filePath);
    
    // Upload to the pre-signed URL
    if (DEBUG_LOGGING_ENABLED) logger.info(`[fileManager.uploadFile] Uploading to pre-signed URL: ${uploadUrl}`);
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileContent,
      headers: {
        'Content-Type': fileType,
        'Content-Length': fileSize.toString()
      }
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
       logger.error(`[fileManager.uploadFile] Upload failed (${uploadResponse.status}): ${errorText}`);
      throw new Error(`File upload failed: ${uploadResponse.status} ${errorText}`);
    }
    
    logger.info(`[fileManager.uploadFile] File uploaded successfully. File ID: ${fileId}, Download URL: ${downloadUrl}`);
    return {
      fileId,
      downloadUrl,
      success: true
    };
  } catch (error) {
    logger.error(`[fileManager.uploadFile] Error during upload process for ${filePath}: ${error.message}`);
    throw error;
  }
}

module.exports = {
    getUploadUrl,
    uploadFile
}; 