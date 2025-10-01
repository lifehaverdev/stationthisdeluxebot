# Training UI Image Upload Feature - Agent Prompt

## Objective
Add image upload and paste functionality to the training dataset creation form, allowing users to upload images from their computer or paste them directly from clipboard.

## Context
Currently, the dataset creation form only accepts image URLs via text input. Users need the ability to upload images directly from their computer or paste images from clipboard for a better user experience.

## Files to Modify
- `src/platforms/web/client/src/sandbox/components/ModsMenuModal.js` (main training UI)
- `src/platforms/web/client/src/sandbox/components/modsMenuModal.css` (styling)
- `src/api/internal/datasetsApi.js` (backend API for image upload)
- `src/api/internal/uploadApi.js` (create new upload service)

## Current State
The dataset form currently only has:
```javascript
<label>Add Images (URLs):<br>
  <textarea name="imageUrls" placeholder="Enter image URLs, one per line or comma-separated"></textarea>
</label>
<button type="button" class="add-images-btn">Add Images</button>
```

## Required Features

### 1. File Upload Interface (HIGH PRIORITY)
**Implementation**: Add drag-and-drop file upload area with multiple file selection

**Code Location**: Replace/enhance the image URL input section in ModsMenuModal.js
```javascript
// Enhanced image upload section
<div class="form-section">
  <h3>Images</h3>
  
  <!-- Upload Methods Tabs -->
  <div class="upload-methods">
    <button type="button" class="upload-tab-btn active" data-method="upload">Upload Files</button>
    <button type="button" class="upload-tab-btn" data-method="urls">Image URLs</button>
    <button type="button" class="upload-tab-btn" data-method="paste">Paste Images</button>
  </div>

  <!-- File Upload Area -->
  <div class="upload-method-content" id="upload-method">
    <div class="file-upload-area" id="file-upload-area">
      <div class="upload-prompt">
        <div class="upload-icon">📁</div>
        <p>Drag and drop images here, or <button type="button" class="file-select-btn">click to browse</button></p>
        <p class="upload-hint">Supports JPG, PNG, WebP, GIF (max 10MB each)</p>
      </div>
      <input type="file" id="file-input" multiple accept="image/*" style="display: none;" />
    </div>
    
    <!-- Upload Progress -->
    <div class="upload-progress" id="upload-progress" style="display: none;">
      <div class="progress-bar">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
      <div class="progress-text" id="progress-text">Uploading...</div>
    </div>
  </div>

  <!-- URL Input (existing functionality) -->
  <div class="upload-method-content" id="urls-method" style="display: none;">
    <label>Add Images (URLs):<br>
      <textarea name="imageUrls" placeholder="Enter image URLs, one per line or comma-separated"></textarea>
    </label>
    <button type="button" class="add-images-btn">Add Images</button>
  </div>

  <!-- Paste Area -->
  <div class="upload-method-content" id="paste-method" style="display: none;">
    <div class="paste-area" id="paste-area">
      <div class="paste-prompt">
        <div class="paste-icon">📋</div>
        <p>Paste images from clipboard (Ctrl+V or Cmd+V)</p>
        <p class="paste-hint">Copy images from any application and paste them here</p>
      </div>
    </div>
  </div>

  <!-- Image Preview -->
  <div class="image-preview" id="image-preview">
    ${(formValues.images||[]).map(url => `
      <div class="image-item">
        <img src="${url}" class="thumb" />
        <button type="button" class="remove-image" data-url="${url}">×</button>
      </div>
    `).join('')}
  </div>
</div>
```

### 2. File Upload Handler (HIGH PRIORITY)
**Implementation**: Add JavaScript methods to handle file uploads, drag-and-drop, and paste events

**Code Location**: Add to ModsMenuModal.js methods
```javascript
// Add to ModsMenuModal class methods

initializeImageUpload() {
  const fileUploadArea = this.modalElement.querySelector('#file-upload-area');
  const fileInput = this.modalElement.querySelector('#file-input');
  const fileSelectBtn = this.modalElement.querySelector('.file-select-btn');
  const pasteArea = this.modalElement.querySelector('#paste-area');
  const uploadTabs = this.modalElement.querySelectorAll('.upload-tab-btn');

  // File selection
  fileSelectBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files));

  // Drag and drop
  fileUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUploadArea.classList.add('drag-over');
  });

  fileUploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove('drag-over');
  });

  fileUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove('drag-over');
    this.handleFileSelect(e.dataTransfer.files);
  });

  // Paste functionality
  pasteArea.addEventListener('paste', (e) => this.handlePaste(e));

  // Tab switching
  uploadTabs.forEach(tab => {
    tab.addEventListener('click', () => this.switchUploadMethod(tab.dataset.method));
  });
}

async handleFileSelect(files) {
  const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
  
  if (imageFiles.length === 0) {
    this.setState({ formError: 'Please select valid image files' });
    return;
  }

  // Validate file sizes
  const oversizedFiles = imageFiles.filter(file => file.size > 10 * 1024 * 1024); // 10MB
  if (oversizedFiles.length > 0) {
    this.setState({ formError: `Some files are too large (max 10MB each): ${oversizedFiles.map(f => f.name).join(', ')}` });
    return;
  }

  this.setState({ uploading: true, formError: null });
  
  try {
    const uploadPromises = imageFiles.map(file => this.uploadImage(file));
    const uploadedUrls = await Promise.all(uploadPromises);
    
    // Add to existing images
    const currentImages = this.state.formValues.images || [];
    this.setState({
      formValues: {
        ...this.state.formValues,
        images: [...currentImages, ...uploadedUrls]
      },
      uploading: false
    });
    
    this.render(); // Re-render to show new images
  } catch (error) {
    this.setState({ 
      uploading: false, 
      formError: `Upload failed: ${error.message}` 
    });
  }
}

async uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('datasetId', this.state.formValues._id || 'temp');

  const response = await fetch('/api/v1/upload/image', {
    method: 'POST',
    body: formData,
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data.url;
}

handlePaste(e) {
  const items = e.clipboardData.items;
  const imageFiles = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      imageFiles.push(file);
    }
  }

  if (imageFiles.length > 0) {
    this.handleFileSelect(imageFiles);
  }
}

switchUploadMethod(method) {
  // Update tab states
  this.modalElement.querySelectorAll('.upload-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.method === method);
  });

  // Show/hide content areas
  this.modalElement.querySelectorAll('.upload-method-content').forEach(content => {
    content.style.display = content.id === `${method}-method` ? 'block' : 'none';
  });
}

updateUploadProgress(loaded, total) {
  const progressFill = this.modalElement.querySelector('#progress-fill');
  const progressText = this.modalElement.querySelector('#progress-text');
  const progressContainer = this.modalElement.querySelector('#upload-progress');
  
  if (total > 0) {
    const percentage = (loaded / total) * 100;
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `Uploading... ${Math.round(percentage)}%`;
    progressContainer.style.display = 'block';
  } else {
    progressContainer.style.display = 'none';
  }
}
```

### 3. Backend Upload API (HIGH PRIORITY)
**Implementation**: Create image upload endpoint with file validation and storage

**Code Location**: `src/api/internal/uploadApi.js` (create new)
```javascript
/**
 * API Service for File Uploads
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

function createUploadApi(dependencies) {
  const { logger, storageService } = dependencies;
  const router = express.Router();

  // Configure multer for memory storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
      files: 20 // Max 20 files per request
    },
    fileFilter: (req, file, cb) => {
      // Validate image types
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPG, PNG, WebP, and GIF are allowed.'), false);
      }
    }
  });

  // POST /api/v1/upload/image - Upload single image
  router.post('/image', upload.single('image'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          error: { code: 'NO_FILE', message: 'No image file provided' } 
        });
      }

      const { datasetId } = req.body;
      const file = req.file;
      
      // Generate unique filename
      const fileExtension = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;
      
      // Upload to storage service (Cloudflare R2 or similar)
      const uploadResult = await storageService.uploadImage(file.buffer, fileName, {
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
          datasetId: datasetId || 'temp'
        }
      });

      logger.info(`Image uploaded successfully: ${fileName}`);

      res.json({
        success: true,
        data: {
          url: uploadResult.url,
          fileName: fileName,
          originalName: file.originalname,
          size: file.size,
          contentType: file.mimetype
        }
      });
    } catch (error) {
      logger.error('Image upload failed:', error);
      res.status(500).json({ 
        error: { code: 'UPLOAD_ERROR', message: 'Failed to upload image' } 
      });
    }
  });

  // POST /api/v1/upload/images - Upload multiple images
  router.post('/images', upload.array('images', 20), async (req, res, next) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ 
          error: { code: 'NO_FILES', message: 'No image files provided' } 
        });
      }

      const { datasetId } = req.body;
      const files = req.files;
      
      const uploadPromises = files.map(async (file) => {
        const fileExtension = path.extname(file.originalname);
        const fileName = `${uuidv4()}${fileExtension}`;
        
        const uploadResult = await storageService.uploadImage(file.buffer, fileName, {
          contentType: file.mimetype,
          metadata: {
            originalName: file.originalname,
            uploadedAt: new Date().toISOString(),
            datasetId: datasetId || 'temp'
          }
        });

        return {
          url: uploadResult.url,
          fileName: fileName,
          originalName: file.originalname,
          size: file.size,
          contentType: file.mimetype
        };
      });

      const results = await Promise.all(uploadPromises);
      
      logger.info(`${results.length} images uploaded successfully`);

      res.json({
        success: true,
        data: {
          images: results,
          count: results.length
        }
      });
    } catch (error) {
      logger.error('Multiple image upload failed:', error);
      res.status(500).json({ 
        error: { code: 'UPLOAD_ERROR', message: 'Failed to upload images' } 
      });
    }
  });

  // DELETE /api/v1/upload/image/:fileName - Delete uploaded image
  router.delete('/image/:fileName', async (req, res, next) => {
    try {
      const { fileName } = req.params;
      
      await storageService.deleteImage(fileName);
      
      logger.info(`Image deleted successfully: ${fileName}`);
      
      res.json({
        success: true,
        data: { message: 'Image deleted successfully' }
      });
    } catch (error) {
      logger.error('Image deletion failed:', error);
      res.status(500).json({ 
        error: { code: 'DELETE_ERROR', message: 'Failed to delete image' } 
      });
    }
  });

  return router;
}

module.exports = createUploadApi;
```

### 4. CSS Styling (MEDIUM PRIORITY)
**Implementation**: Add comprehensive styling for upload interface

**Code Location**: Add to `modsMenuModal.css`
```css
/* Upload Methods */
.upload-methods {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  border-bottom: 1px solid #333;
}

.upload-tab-btn {
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #ccc;
  cursor: pointer;
  transition: all 0.3s ease;
}

.upload-tab-btn:hover {
  color: #90caf9;
}

.upload-tab-btn.active {
  color: #90caf9;
  border-bottom-color: #90caf9;
}

/* File Upload Area */
.file-upload-area {
  border: 2px dashed #666;
  border-radius: 8px;
  padding: 40px 20px;
  text-align: center;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.3s ease;
  cursor: pointer;
}

.file-upload-area:hover {
  border-color: #90caf9;
  background: rgba(144, 202, 249, 0.05);
}

.file-upload-area.drag-over {
  border-color: #90caf9;
  background: rgba(144, 202, 249, 0.1);
}

.upload-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.upload-icon {
  font-size: 48px;
  opacity: 0.7;
}

.upload-hint {
  font-size: 12px;
  color: #999;
  margin-top: 5px;
}

.file-select-btn {
  background: #90caf9;
  color: #000;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.file-select-btn:hover {
  background: #64b5f6;
}

/* Upload Progress */
.upload-progress {
  margin-top: 20px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #90caf9, #42a5f5);
  transition: width 0.3s ease;
  width: 0%;
}

.progress-text {
  text-align: center;
  margin-top: 8px;
  font-size: 14px;
  color: #ccc;
}

/* Paste Area */
.paste-area {
  border: 2px dashed #666;
  border-radius: 8px;
  padding: 40px 20px;
  text-align: center;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.3s ease;
  cursor: pointer;
}

.paste-area:hover {
  border-color: #90caf9;
  background: rgba(144, 202, 249, 0.05);
}

.paste-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.paste-icon {
  font-size: 48px;
  opacity: 0.7;
}

.paste-hint {
  font-size: 12px;
  color: #999;
  margin-top: 5px;
}

/* Image Preview Enhancements */
.image-preview {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 15px;
  margin-top: 20px;
}

.image-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid #333;
  transition: all 0.3s ease;
}

.image-item:hover {
  border-color: #90caf9;
  transform: translateY(-2px);
}

.image-item img {
  width: 100%;
  height: 100px;
  object-fit: cover;
  display: block;
}

.remove-image {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(239, 83, 80, 0.9);
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.remove-image:hover {
  background: #f44336;
  transform: scale(1.1);
}

/* Responsive Design */
@media (max-width: 768px) {
  .upload-methods {
    flex-direction: column;
    gap: 5px;
  }
  
  .upload-tab-btn {
    padding: 12px 16px;
    text-align: center;
  }
  
  .file-upload-area,
  .paste-area {
    padding: 30px 15px;
  }
  
  .image-preview {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 10px;
  }
  
  .image-item img {
    height: 80px;
  }
}
```

### 5. Integration with Dataset API (MEDIUM PRIORITY)
**Implementation**: Update dataset creation to handle uploaded images

**Code Location**: Update `src/api/internal/datasetsApi.js`
```javascript
// Add to existing datasetsApi.js

// POST /api/v1/datasets/:datasetId/images - Add uploaded images to dataset
router.post('/:datasetId/images', async (req, res, next) => {
  const { datasetId } = req.params;
  const { imageUrls } = req.body;
  
  if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'imageUrls array is required' } });
  }
  
  try {
    // Validate that all URLs are accessible
    const validUrls = await Promise.all(
      imageUrls.map(async (url) => {
        try {
          const response = await fetch(url, { method: 'HEAD' });
          return response.ok ? url : null;
        } catch {
          return null;
        }
      })
    );
    
    const filteredUrls = validUrls.filter(Boolean);
    
    if (filteredUrls.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_URLS', message: 'No valid image URLs provided' } });
    }
    
    const result = await db.data.datasets.updateOne(
      { _id: new ObjectId(datasetId) },
      { 
        $push: { images: { $each: filteredUrls } },
        $set: { updatedAt: new Date() }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
    }
    
    res.json({ 
      success: true, 
      data: { 
        addedCount: filteredUrls.length,
        invalidCount: imageUrls.length - filteredUrls.length
      } 
    });
  } catch (error) {
    logger.error('Failed to add images to dataset:', error);
    res.status(500).json({ error: { code: 'ADD_IMAGES_ERROR', message: 'Failed to add images' } });
  }
});
```

## Success Criteria
- [ ] File upload interface with drag-and-drop support
- [ ] Multiple file selection and batch upload
- [ ] Image paste functionality from clipboard
- [ ] Upload progress indication
- [ ] File validation (type, size limits)
- [ ] Image preview with remove functionality
- [ ] Backend API for image upload and storage
- [ ] Integration with existing dataset creation flow
- [ ] Responsive design for mobile devices
- [ ] Error handling for upload failures

## Testing
1. Test file upload with various image formats (JPG, PNG, WebP, GIF)
2. Test drag-and-drop functionality
3. Test paste functionality from different applications
4. Test file size validation (reject files > 10MB)
5. Test multiple file upload
6. Test upload progress indication
7. Test error handling for network failures
8. Test mobile responsiveness
9. Test integration with dataset creation
10. Test image removal functionality

## Notes
- Use existing storage service patterns for file uploads
- Implement proper file validation and security measures
- Add progress indication for better user experience
- Ensure mobile compatibility for touch devices
- Follow existing code patterns and styling conventions
- Add proper error handling and user feedback
- Consider adding image compression for large files
- Implement proper cleanup for failed uploads
