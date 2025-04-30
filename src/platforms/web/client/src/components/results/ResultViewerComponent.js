// Result Viewer Component for displaying workflow output with type-specific viewers
// Provides specialized display for different content types (image, text, audio, video, etc.)

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';
import { collectionService } from '../../services/CollectionService.js';

export class ResultViewerComponent extends Component {
  constructor(parentElement) {
    super(parentElement);
    
    this.state = {
      isVisible: false,
      results: null,
      collections: [],
      selectedCollectionId: '',
      isLoading: false,
      error: null,
      isSaving: false,
      contentType: 'unknown', // image, text, audio, video, model, unknown
      activeTab: 'view', // view, share, export
      shareUrl: '',
      exportFormats: [],
      selectedExportFormat: ''
    };
    
    // Bind methods
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.handleTabChange = this.handleTabChange.bind(this);
    this.handleSaveToCollection = this.handleSaveToCollection.bind(this);
    this.handleShare = this.handleShare.bind(this);
    this.handleExport = this.handleExport.bind(this);
    this.handleCollectionChange = this.handleCollectionChange.bind(this);
    this.handleExportFormatChange = this.handleExportFormatChange.bind(this);
    this.handleDownload = this.handleDownload.bind(this);
    
    // Initialize
    this.init();
  }
  
  template() {
    const { isVisible, results, contentType, activeTab, collections, isLoading, isSaving, error, shareUrl, exportFormats } = this.state;
    
    if (!isVisible) {
      return '<div class="result-viewer-container" style="display: none;"></div>';
    }
    
    return `
      <div class="result-viewer-container">
        <div class="result-viewer-modal">
          <div class="result-viewer-header">
            <h2>Result Viewer</h2>
            <div class="tab-container">
              <button class="tab-button ${activeTab === 'view' ? 'active' : ''}" data-tab="view">View</button>
              <button class="tab-button ${activeTab === 'share' ? 'active' : ''}" data-tab="share">Share</button>
              <button class="tab-button ${activeTab === 'export' ? 'active' : ''}" data-tab="export">Export</button>
            </div>
            <button class="close-button">×</button>
          </div>
          
          <div class="result-viewer-content">
            ${this.renderTabContent()}
          </div>
          
          <div class="result-viewer-footer">
            ${activeTab === 'view' ? `
              <div class="save-to-collection">
                <select class="collection-select" ${isSaving ? 'disabled' : ''}>
                  <option value="">Select collection...</option>
                  ${collections.map(collection => `
                    <option value="${collection.id}">${collection.name}</option>
                  `).join('')}
                </select>
                <button class="save-button" ${isSaving || !this.state.selectedCollectionId ? 'disabled' : ''}>
                  ${isSaving ? 'Saving...' : 'Save to Collection'}
                </button>
              </div>
            ` : ''}
            
            ${error ? `<div class="error-message">${error}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  
  renderTabContent() {
    const { activeTab, results, contentType, shareUrl, exportFormats, selectedExportFormat } = this.state;
    
    if (!results) {
      return '<div class="no-results">No results to display</div>';
    }
    
    switch (activeTab) {
      case 'view':
        return this.renderResultContent();
      
      case 'share':
        return `
          <div class="share-tab">
            <h3>Share Result</h3>
            <div class="share-url-container">
              <input type="text" class="share-url" value="${shareUrl}" readonly />
              <button class="copy-url-button">Copy</button>
            </div>
            <div class="share-options">
              <button class="share-twitter">Share on Twitter</button>
              <button class="share-discord">Share on Discord</button>
            </div>
          </div>
        `;
      
      case 'export':
        return `
          <div class="export-tab">
            <h3>Export Result</h3>
            <div class="export-format-container">
              <select class="export-format-select">
                <option value="">Select format...</option>
                ${exportFormats.map(format => `
                  <option value="${format.id}">${format.name}</option>
                `).join('')}
              </select>
              <button class="export-button" ${!selectedExportFormat ? 'disabled' : ''}>
                Export
              </button>
            </div>
            <div class="download-options">
              <button class="download-button">Download Original</button>
            </div>
          </div>
        `;
      
      default:
        return '<div class="unknown-tab">Unknown tab selected</div>';
    }
  }
  
  renderResultContent() {
    const { results, contentType } = this.state;
    
    if (!results) {
      return '<div class="no-results">No results to display</div>';
    }
    
    switch (contentType) {
      case 'image':
        return `
          <div class="image-viewer">
            <div class="image-container">
              <img src="${results.url}" alt="Generated image" />
            </div>
            <div class="image-metadata">
              ${results.metadata ? `
                <div class="metadata-item">
                  <span class="metadata-label">Dimensions:</span>
                  <span class="metadata-value">${results.metadata.width || '?'} x ${results.metadata.height || '?'}</span>
                </div>
                ${results.metadata.prompt ? `
                  <div class="metadata-item">
                    <span class="metadata-label">Prompt:</span>
                    <span class="metadata-value prompt">${results.metadata.prompt}</span>
                  </div>
                ` : ''}
              ` : ''}
            </div>
          </div>
        `;
      
      case 'text':
        return `
          <div class="text-viewer">
            <pre class="text-content">${results.content}</pre>
          </div>
        `;
      
      case 'audio':
        return `
          <div class="audio-viewer">
            <audio controls src="${results.url}"></audio>
            <div class="audio-metadata">
              ${results.metadata ? `
                <div class="metadata-item">
                  <span class="metadata-label">Duration:</span>
                  <span class="metadata-value">${results.metadata.duration || '?'} seconds</span>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      
      case 'video':
        return `
          <div class="video-viewer">
            <video controls src="${results.url}"></video>
            <div class="video-metadata">
              ${results.metadata ? `
                <div class="metadata-item">
                  <span class="metadata-label">Duration:</span>
                  <span class="metadata-value">${results.metadata.duration || '?'} seconds</span>
                </div>
                <div class="metadata-item">
                  <span class="metadata-label">Dimensions:</span>
                  <span class="metadata-value">${results.metadata.width || '?'} x ${results.metadata.height || '?'}</span>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      
      case 'model':
        return `
          <div class="model-viewer">
            <div class="model-info">
              <h3>${results.name || 'Model'}</h3>
              <p>${results.description || 'No description available'}</p>
            </div>
            <div class="model-metadata">
              ${results.metadata ? Object.entries(results.metadata).map(([key, value]) => `
                <div class="metadata-item">
                  <span class="metadata-label">${key}:</span>
                  <span class="metadata-value">${value}</span>
                </div>
              `).join('') : ''}
            </div>
          </div>
        `;
      
      default:
        return `
          <div class="generic-viewer">
            <div class="result-data">
              <pre>${JSON.stringify(results, null, 2)}</pre>
            </div>
          </div>
        `;
    }
  }
  
  init() {
    this.appendToParent();
    
    // Subscribe to workflow result events
    EventBus.subscribe('workflow:showResults', this.show);
    
    // Add event listeners
    this.addEventListeners();
    
    // Initially hide the viewer
    this.hide();
  }
  
  addEventListeners() {
    document.addEventListener('click', (e) => {
      if (!this.element) return;
      
      // Close button
      if (e.target.matches('.result-viewer-container .close-button')) {
        this.hide();
      }
      
      // Tab buttons
      if (e.target.matches('.result-viewer-container .tab-button')) {
        const tabName = e.target.dataset.tab;
        this.handleTabChange(tabName);
      }
      
      // Save button
      if (e.target.matches('.result-viewer-container .save-button')) {
        this.handleSaveToCollection();
      }
      
      // Copy URL button
      if (e.target.matches('.result-viewer-container .copy-url-button')) {
        const urlInput = this.element.querySelector('.share-url');
        if (urlInput) {
          urlInput.select();
          document.execCommand('copy');
          
          // Show feedback
          e.target.textContent = 'Copied!';
          setTimeout(() => {
            e.target.textContent = 'Copy';
          }, 2000);
        }
      }
      
      // Share buttons
      if (e.target.matches('.result-viewer-container .share-twitter')) {
        this.handleShare('twitter');
      }
      
      if (e.target.matches('.result-viewer-container .share-discord')) {
        this.handleShare('discord');
      }
      
      // Export button
      if (e.target.matches('.result-viewer-container .export-button')) {
        this.handleExport();
      }
      
      // Download button
      if (e.target.matches('.result-viewer-container .download-button')) {
        this.handleDownload();
      }
    });
    
    document.addEventListener('change', (e) => {
      if (!this.element) return;
      
      // Collection select
      if (e.target.matches('.result-viewer-container .collection-select')) {
        this.handleCollectionChange(e.target.value);
      }
      
      // Export format select
      if (e.target.matches('.result-viewer-container .export-format-select')) {
        this.handleExportFormatChange(e.target.value);
      }
    });
  }
  
  show(data) {
    if (!data || !data.results) {
      console.error('No results provided to ResultViewerComponent');
      return;
    }
    
    // Determine content type from results
    let contentType = 'unknown';
    if (data.results.type) {
      contentType = data.results.type;
    } else if (data.results.url) {
      if (data.results.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        contentType = 'image';
      } else if (data.results.url.match(/\.(mp3|wav|ogg)$/i)) {
        contentType = 'audio';
      } else if (data.results.url.match(/\.(mp4|webm|mov)$/i)) {
        contentType = 'video';
      }
    } else if (typeof data.results.content === 'string') {
      contentType = 'text';
    }
    
    // Determine available export formats based on content type
    const exportFormats = this.getExportFormatsForType(contentType);
    
    // Generate share URL
    const shareUrl = this.generateShareUrl(data.results, data.tileId);
    
    // Update state with the provided data
    this.setState({
      isVisible: true,
      results: data.results,
      contentType,
      onSave: data.onSave || null,
      shareUrl,
      exportFormats,
      isLoading: true,
      error: null
    });
    
    // Fetch collections for saving
    this.loadCollections();
  }
  
  hide() {
    this.setState({
      isVisible: false,
      results: null
    });
  }
  
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
  }
  
  handleTabChange(tabName) {
    this.setState({ activeTab: tabName });
  }
  
  handleCollectionChange(collectionId) {
    this.setState({ selectedCollectionId: collectionId });
  }
  
  handleExportFormatChange(formatId) {
    this.setState({ selectedExportFormat: formatId });
  }
  
  async loadCollections() {
    try {
      const collections = await collectionService.getUserCollections();
      this.setState({ 
        collections,
        isLoading: false
      });
    } catch (error) {
      this.setState({ 
        error: `Failed to load collections: ${error.message}`,
        isLoading: false
      });
    }
  }
  
  handleSaveToCollection() {
    const { selectedCollectionId, results, onSave } = this.state;
    
    if (!selectedCollectionId || !results) {
      return;
    }
    
    this.setState({ isSaving: true, error: null });
    
    if (onSave) {
      onSave(selectedCollectionId)
        .then(() => {
          this.setState({ 
            isSaving: false,
            error: null
          });
        })
        .catch(error => {
          this.setState({ 
            isSaving: false,
            error: `Failed to save to collection: ${error.message}`
          });
        });
    } else {
      // Fallback to collection service if no onSave callback provided
      collectionService.addToCollection(selectedCollectionId, results)
        .then(() => {
          this.setState({ 
            isSaving: false,
            error: null
          });
          
          EventBus.publish('notification', {
            type: 'success',
            message: 'Result saved to collection'
          });
        })
        .catch(error => {
          this.setState({ 
            isSaving: false,
            error: `Failed to save to collection: ${error.message}`
          });
        });
    }
  }
  
  handleShare(platform) {
    const { shareUrl, results } = this.state;
    
    if (!shareUrl || !results) {
      return;
    }
    
    let shareTarget = '';
    
    switch (platform) {
      case 'twitter':
        shareTarget = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent('Check out what I created with StationThis!')}`;
        break;
      
      case 'discord':
        // Generate a Discord-friendly message
        navigator.clipboard.writeText(`Check out what I created with StationThis! ${shareUrl}`);
        EventBus.publish('notification', {
          type: 'success',
          message: 'Discord share message copied to clipboard!'
        });
        return;
      
      default:
        return;
    }
    
    if (shareTarget) {
      window.open(shareTarget, '_blank');
    }
  }
  
  handleExport() {
    const { selectedExportFormat, results, contentType } = this.state;
    
    if (!selectedExportFormat || !results) {
      return;
    }
    
    // Implementation would depend on backend export capabilities
    // Here we just show a notification as a placeholder
    EventBus.publish('notification', {
      type: 'info',
      message: `Exporting result as ${selectedExportFormat}. This feature is coming soon!`
    });
  }
  
  handleDownload() {
    const { results, contentType } = this.state;
    
    if (!results || !results.url) {
      return;
    }
    
    // Create a download link and click it
    const link = document.createElement('a');
    link.href = results.url;
    
    // Generate filename based on content type and current date
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    let filename = `stationthis-result-${date}`;
    
    // Add extension based on content type
    switch (contentType) {
      case 'image':
        // Extract extension from URL or default to .png
        const imageExt = results.url.match(/\.([^.]+)$/);
        filename += imageExt ? imageExt[0] : '.png';
        break;
      case 'audio':
        // Extract extension from URL or default to .mp3
        const audioExt = results.url.match(/\.([^.]+)$/);
        filename += audioExt ? audioExt[0] : '.mp3';
        break;
      case 'video':
        // Extract extension from URL or default to .mp4
        const videoExt = results.url.match(/\.([^.]+)$/);
        filename += videoExt ? videoExt[0] : '.mp4';
        break;
      case 'text':
        filename += '.txt';
        break;
      default:
        filename += '.bin';
    }
    
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  generateShareUrl(results, tileId) {
    // This would ideally generate a publicly accessible URL
    // For now, we'll create a placeholder URL
    const baseUrl = window.location.origin;
    const resultId = results.id || tileId || Date.now().toString(36);
    return `${baseUrl}/share/${resultId}`;
  }
  
  getExportFormatsForType(contentType) {
    // Return appropriate export formats based on content type
    switch (contentType) {
      case 'image':
        return [
          { id: 'png', name: 'PNG Image' },
          { id: 'jpg', name: 'JPEG Image' },
          { id: 'webp', name: 'WebP Image' }
        ];
      
      case 'text':
        return [
          { id: 'txt', name: 'Plain Text' },
          { id: 'md', name: 'Markdown' },
          { id: 'json', name: 'JSON' }
        ];
      
      case 'audio':
        return [
          { id: 'mp3', name: 'MP3 Audio' },
          { id: 'wav', name: 'WAV Audio' },
          { id: 'ogg', name: 'OGG Audio' }
        ];
      
      case 'video':
        return [
          { id: 'mp4', name: 'MP4 Video' },
          { id: 'webm', name: 'WebM Video' },
          { id: 'gif', name: 'Animated GIF' }
        ];
      
      default:
        return [];
    }
  }
} 