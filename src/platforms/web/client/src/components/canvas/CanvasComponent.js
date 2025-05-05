// Canvas Component for the StationThis web interface
// Implements the core canvas with Gameboy-style water animation, panning and zooming

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';
import { TileComponent } from './TileComponent.js';
import { WorkflowTileComponent } from './WorkflowTileComponent.js';
import { WorkflowConfigPanel } from './WorkflowConfigPanel.js';
import { WorkflowConnectionSystem } from './WorkflowConnectionSystem.js';
import { PipelineExecutionSystem } from './PipelineExecutionSystem.js';
import { TemplateListComponent } from './TemplateListComponent.js';

export class CanvasComponent extends Component {
  constructor(parentElement) {
    super(parentElement);
    this.state = {
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      tiles: [],
      gridSize: 20, // Base grid size in pixels
      frameCount: 0,
      isAuthenticated: false,
      userId: null,
      workspaceId: null,
      lastSaved: null,
      selectedConnection: null,
      selectedTile: null,
      contextMenuX: 0,
      contextMenuY: 0,
      showingTileContextMenu: false,
      showingTemplateMenu: false,
      templates: []
    };
    
    this.canvasRef = null;
    this.ctx = null;
    this.lastFrameTime = 0;
    this.waterAnimationFrames = [];
    this.authService = null; // Will be set during initialization
    this.workflowConfigPanel = null; // Will be set during initialization
    this.connectionSystem = null; // Will be set during initialization
    this.pipelineSystem = null; // Will be set during initialization
    this.templateList = null; // Will be set during initialization
    
    // Bind methods
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.render = this.render.bind(this);
    this.animate = this.animate.bind(this);
    this.drawBackground = this.drawBackground.bind(this);
    this.drawGrid = this.drawGrid.bind(this);
    this.drawTiles = this.drawTiles.bind(this);
    this.checkAuthentication = this.checkAuthentication.bind(this);
    this.loadWorkspace = this.loadWorkspace.bind(this);
    this.saveWorkspace = this.saveWorkspace.bind(this);
    this.handleAuthEvent = this.handleAuthEvent.bind(this);
    this.createWorkflowTile = this.createWorkflowTile.bind(this);
    this.handleWorkflowInputConnections = this.handleWorkflowInputConnections.bind(this);
    this.handleWorkflowOutputData = this.handleWorkflowOutputData.bind(this);
    this.handleConnectionSelected = this.handleConnectionSelected.bind(this);
    this.handleConnectionContextMenuClick = this.handleConnectionContextMenuClick.bind(this);
    this.handleTileContextMenu = this.handleTileContextMenu.bind(this);
    this.handleTileContextMenuClick = this.handleTileContextMenuClick.bind(this);
    this.handleGetConnectionSystem = this.handleGetConnectionSystem.bind(this);
    this.handleGetTileById = this.handleGetTileById.bind(this);
    this.handleLoadTemplate = this.handleLoadTemplate.bind(this);
    
    // Initialize the canvas
    this.init();
  }
  
  template() {
    return `
      <div class="canvas-component">
        <canvas id="main-canvas" width="1000" height="700"></canvas>
        
        <div class="hud-overlay">
          <button class="btn-save-workspace" title="Save Workspace">
            <span class="icon">💾</span>
          </button>
          <button class="btn-add-workflow" title="Add Workflow">
            <span class="icon">+</span>
          </button>
          <button class="btn-templates" title="Templates">
            <span class="icon">📋</span>
          </button>
        </div>
        
        <div class="auth-overlay ${this.state.isAuthenticated ? 'hidden' : ''}">
          <div class="auth-message">
            <h2>Welcome to StationThis</h2>
            <p>Login to access your workflows or continue as guest</p>
            <div class="auth-buttons">
              <button class="btn-login">Login</button>
              <button class="btn-guest">Continue as Guest</button>
            </div>
          </div>
        </div>
        
        ${this.state.selectedConnection ? this.connectionContextMenuTemplate() : ''}
        ${this.state.showingTileContextMenu ? this.tileContextMenuTemplate() : ''}
      </div>
    `;
  }
  
  connectionContextMenuTemplate() {
    return `
      <div class="context-menu connection-context-menu" style="left: ${this.state.contextMenuX}px; top: ${this.state.contextMenuY}px;">
        <ul>
          <li class="context-menu-item" data-action="delete">Delete Connection</li>
        </ul>
      </div>
    `;
  }
  
  tileContextMenuTemplate() {
    return `
      <div class="context-menu tile-context-menu" style="left: ${this.state.contextMenuX}px; top: ${this.state.contextMenuY}px;">
        <ul>
          <li class="context-menu-item" data-action="configure">Configure</li>
          <li class="context-menu-item" data-action="execute">Execute Workflow</li>
          <li class="context-menu-item" data-action="pipeline">Execute Pipeline</li>
          <li class="context-menu-item" data-action="saveTemplate">Save as Template</li>
          <li class="context-menu-item" data-action="duplicate">Duplicate</li>
          <li class="context-menu-item" data-action="delete">Delete</li>
        </ul>
      </div>
    `;
  }
  
  init() {
    // Check if parentElement exists before appending
    if (this.parentElement && this.parentElement.appendChild) {
      this.appendToParent();
    } else {
      console.error('Invalid parent element for CanvasComponent');
      
      // Create and append to body as fallback
      if (!this.element) {
        this.render();
      }
      
      if (this.element && document.body) {
        document.body.appendChild(this.element);
        console.log('Canvas component appended to document.body as fallback');
      }
    }
    
    // Get canvas reference
    this.canvasRef = document.getElementById('main-canvas');
    
    // Check if canvas exists before getting context
    if (this.canvasRef) {
      this.ctx = this.canvasRef.getContext('2d');
      
      // Set canvas size to full viewport
      this.resizeCanvas();
      
      // Add canvas-specific event listeners
      this.canvasRef.addEventListener('mousedown', this.handleMouseDown);
      this.canvasRef.addEventListener('wheel', this.handleWheel);
    } else {
      console.error('Canvas element not found, will try to initialize later');
      // Try again on next frame
      setTimeout(() => this.initCanvas(), 100);
    }
    
    // Try to import AuthService
    import('../../services/AuthService.js').then(module => {
      this.authService = module.default || module.AuthService;
      // Check authentication status after getting AuthService
      this.checkAuthentication();
    }).catch(err => {
      console.error('Failed to load AuthService:', err);
    });
    
    // Initialize workflow config panel
    this.workflowConfigPanel = new WorkflowConfigPanel(this.element);
    
    // Initialize connection system
    this.connectionSystem = new WorkflowConnectionSystem(this.element);
    
    // Initialize pipeline execution system
    this.pipelineSystem = new PipelineExecutionSystem(this.element);
    
    // Initialize template list component
    this.templateList = new TemplateListComponent(this.element);
    
    // Add event listeners
    window.addEventListener('resize', () => this.resizeCanvas());
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('click', (e) => {
      // Close context menus when clicking elsewhere
      if (this.state.selectedConnection || this.state.showingTileContextMenu) {
        this.setState({ 
          selectedConnection: null,
          showingTileContextMenu: false
        });
        this.render();
      }
    });
    
    // Subscribe to authentication events
    EventBus.subscribe('auth:authenticated', this.handleAuthEvent);
    EventBus.subscribe('auth:logout:complete', () => {
      this.setState({ isAuthenticated: false, userId: null });
      this.render();
    });
    
    // Subscribe to workflow connection events
    EventBus.subscribe('connection:selected', this.handleConnectionSelected);
    EventBus.subscribe('workflow:getInputConnections', this.handleWorkflowInputConnections);
    EventBus.subscribe('workflow:getOutputData', this.handleWorkflowOutputData);
    
    // Subscribe to new events for pipeline execution
    EventBus.subscribe('tile:contextmenu', this.handleTileContextMenu);
    EventBus.subscribe('canvas:getConnectionSystem', this.handleGetConnectionSystem);
    EventBus.subscribe('canvas:getTileById', this.handleGetTileById);
    EventBus.subscribe('canvas:loadTemplate', this.handleLoadTemplate);
    
    // Add auth overlay button listeners
    const loginBtn = this.element.querySelector('.btn-login');
    const guestBtn = this.element.querySelector('.btn-guest');
    
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        EventBus.publish('auth:show-modal', { initialTab: 'login' });
      });
    }
    
    if (guestBtn) {
      guestBtn.addEventListener('click', () => {
        EventBus.publish('auth:guest', { guestId: `guest-${Date.now()}` });
      });
    }
    
    // Add workflow category button listeners
    const workflowButtons = this.element.querySelectorAll('.workflow-category');
    workflowButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const workflowType = e.currentTarget.dataset.workflow;
        if (workflowType) {
          this.createWorkflowTile(workflowType);
        }
      });
    });
    
    // Load water animation frames (for demonstration, we'll simulate them)
    this.loadWaterAnimationFrames();
    
    // Start animation loop
    requestAnimationFrame(this.animate);
    
    // Add HUD button listeners
    const saveBtn = this.element.querySelector('.btn-save-workspace');
    const addWorkflowBtn = this.element.querySelector('.btn-add-workflow');
    const templatesBtn = this.element.querySelector('.btn-templates');
    
    if (saveBtn) {
      saveBtn.addEventListener('click', this.saveWorkspace);
    }
    
    if (addWorkflowBtn) {
      addWorkflowBtn.addEventListener('click', () => {
        // Show workflow menu
        const menu = this.element.querySelector('.workflow-menu');
        if (menu) {
          menu.classList.toggle('visible');
        }
      });
    }
    
    if (templatesBtn) {
      templatesBtn.addEventListener('click', () => {
        // Toggle template list
        EventBus.publish('template:toggle');
      });
    }
  }
  
  // Helper method to initialize canvas after a delay
  initCanvas() {
    this.canvasRef = document.getElementById('main-canvas');
    if (this.canvasRef) {
      this.ctx = this.canvasRef.getContext('2d');
      this.resizeCanvas();
      this.canvasRef.addEventListener('mousedown', this.handleMouseDown);
      this.canvasRef.addEventListener('wheel', this.handleWheel);
      console.log('Canvas initialized successfully');
    } else {
      console.error('Canvas element still not found after retry');
    }
  }
  
  checkAuthentication() {
    if (!this.authService) {
      console.error('AuthService not available');
      return;
    }
    
    const isAuthenticated = this.authService.isAuthenticated();
    const currentUser = this.authService.getCurrentUser();
    
    this.setState({
      isAuthenticated,
      userId: currentUser ? currentUser.id : null
    });
    
    if (isAuthenticated && currentUser) {
      this.loadWorkspace();
    }
    
    this.render();
  }
  
  handleAuthEvent(data) {
    this.setState({ 
      isAuthenticated: true,
      userId: data.user ? data.user.id : null 
    });
    
    // Load workspace for the authenticated user
    this.loadWorkspace();
    
    // Remove the auth overlay by re-rendering
    this.render();
  }
  
  async loadWorkspace() {
    if (!this.state.isAuthenticated || !this.state.userId) {
      return;
    }
    
    try {
      const response = await fetch('/api/workspaces/current', {
        headers: {
          'Authorization': `Bearer ${this.authService.getToken()}`
        }
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          // User doesn't have a workspace yet, create a new one
          return this.saveWorkspace();
        }
        throw new Error('Failed to load workspace');
      }
      
      const data = await response.json();
      
      // Update workspace ID
      this.setState({
        workspaceId: data.workspaceId,
        lastSaved: new Date(data.lastUpdated)
      });
      
      // Clear existing tiles
      this.state.tiles.forEach(tile => {
        if (tile.element && tile.element.parentNode) {
          tile.element.parentNode.removeChild(tile.element);
        }
      });
      
      this.setState({ tiles: [] });
      
      // Recreate tiles from workspace data
      if (data.tiles && Array.isArray(data.tiles)) {
        data.tiles.forEach(tileData => {
          if (tileData.workflowType) {
            // This is a workflow tile
            this.addWorkflowTile(tileData);
          } else {
            // This is a regular tile
            this.addTile(tileData);
          }
        });
      }
      
      // Load connections if available
      if (data.connections && this.connectionSystem) {
        this.connectionSystem.state.connections = data.connections;
        this.connectionSystem.renderConnections();
      }
      
      // Publish workspace loaded event
      EventBus.publish('workspace:loaded', {
        workspaceId: data.workspaceId,
        tileCount: this.state.tiles.length
      });
      
    } catch (error) {
      console.error('Error loading workspace:', error);
      
      // Create a new workspace if loading fails
      this.saveWorkspace();
    }
  }
  
  async saveWorkspace() {
    if (!this.state.isAuthenticated || !this.state.userId) {
      return;
    }
    
    try {
      // Collect data from all tiles
      const tilesData = this.state.tiles.map(tile => tile.getData());
      
      // Get connection data if connection system is available
      let connectionsData = [];
      if (this.connectionSystem) {
        connectionsData = this.connectionSystem.state.connections;
      }
      
      // Create workspace data object
      const workspaceData = {
        id: this.state.workspaceId || `workspace-${Date.now()}`,
        userId: this.state.userId,
        name: 'My Workspace',
        tiles: tilesData,
        connections: connectionsData,
        canvas: {
          offsetX: this.state.offsetX,
          offsetY: this.state.offsetY,
          zoom: this.state.zoom
        },
        lastUpdated: new Date().toISOString()
      };
      
      const response = await fetch('/api/workspaces/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authService.getToken()}`
        },
        body: JSON.stringify(workspaceData)
      });
      
      if (!response.ok) {
        throw new Error('Failed to save workspace');
      }
      
      const data = await response.json();
      
      // Update workspace ID and last saved time
      this.setState({
        workspaceId: data.workspaceId,
        lastSaved: new Date()
      });
      
      // Publish workspace saved event
      EventBus.publish('workspace:saved', {
        workspaceId: data.workspaceId,
        timestamp: this.state.lastSaved
      });
      
    } catch (error) {
      console.error('Error saving workspace:', error);
      
      // Publish workspace save error event
      EventBus.publish('workspace:save:error', {
        error: error.message
      });
    }
  }
  
  resizeCanvas() {
    if (!this.canvasRef) return;
    
    this.canvasRef.width = window.innerWidth;
    this.canvasRef.height = window.innerHeight;
    
    // Re-render after resize
    this.render();
  }
  
  loadWaterAnimationFrames() {
    // For demonstration, we'll create 8 frames of water animation
    this.waterAnimationFrames = Array(8).fill(null);
  }
  
  createWorkflowTile(workflowType, position = null, parameters = null) {
    if (!this.state.isAuthenticated) {
      EventBus.publish('notification', {
        type: 'warning',
        message: 'Please log in or continue as guest to create workflows'
      });
      return;
    }
    
    // Generate a position if none provided
    if (!position) {
      position = {
        x: (this.canvasRef.width / 2 - this.state.offsetX) / this.state.zoom - 150,
        y: (this.canvasRef.height / 2 - this.state.offsetY) / this.state.zoom - 100
      };
    }
    
    // Create a new workflow tile
    const tileOptions = {
      x: position.x,
      y: position.y,
      width: 300,
      height: 200,
      label: getWorkflowLabel(workflowType),
      color: null, // Let WorkflowTileComponent determine color based on type
      workflowType,
      parameters: parameters || {}
    };
    
    const workflowTile = new WorkflowTileComponent(this.element, tileOptions);
    
    // Add to tiles array
    this.setState({
      tiles: [...this.state.tiles, workflowTile]
    });
    
    // Add right-click event listener for context menu
    workflowTile.element.addEventListener('contextmenu', (e) => {
      EventBus.publish('tile:contextmenu', {
        tileId: workflowTile.state.id,
        clientX: e.clientX,
        clientY: e.clientY,
        event: e
      });
    });
    
    return workflowTile;
  }
  
  handleMouseDown(e) {
    // Start canvas dragging (panning)
    this.setState({
      isDragging: true,
      dragStartX: e.clientX,
      dragStartY: e.clientY
    });
  }
  
  handleMouseMove(e) {
    if (this.state.isDragging) {
      // Update canvas offset based on drag
      const deltaX = e.clientX - this.state.dragStartX;
      const deltaY = e.clientY - this.state.dragStartY;
      
      this.setState({
        offsetX: this.state.offsetX + deltaX,
        offsetY: this.state.offsetY + deltaY,
        dragStartX: e.clientX,
        dragStartY: e.clientY
      });
      
      this.render();
    }
  }
  
  handleMouseUp() {
    this.state.isDragging = false;
    document.body.style.cursor = 'default';
    
    // Update connection paths if connection system is available
    if (this.connectionSystem) {
      this.connectionSystem.renderConnections();
    }
  }
  
  handleWheel(e) {
    e.preventDefault();
    
    // Calculate zoom center (mouse position)
    const rect = this.canvasRef.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate point under mouse in world space before zoom
    const worldX = mouseX / this.state.zoom + this.state.offsetX;
    const worldY = mouseY / this.state.zoom + this.state.offsetY;
    
    // Update zoom factor
    const zoomDelta = -e.deltaY * 0.001;
    const newZoom = Math.max(0.1, Math.min(3, this.state.zoom + zoomDelta));
    
    // Calculate new offset to keep point under mouse at the same screen position
    const newOffsetX = worldX - mouseX / newZoom;
    const newOffsetY = worldY - mouseY / newZoom;
    
    this.setState({
      zoom: newZoom,
      offsetX: newOffsetX,
      offsetY: newOffsetY
    });
    
    // Publish canvas zoom event for connection system
    EventBus.publish('canvas:zoom', {
      zoom: newZoom
    });
    
    // Update connection paths if connection system is available
    if (this.connectionSystem) {
      this.connectionSystem.renderConnections();
    }
  }
  
  animate(timestamp) {
    // Calculate delta time
    const deltaTime = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;
    
    // Update animation frame counter
    this.setState({
      frameCount: (this.state.frameCount + 1) % this.waterAnimationFrames.length
    });
    
    // Render canvas
    this.render();
    
    // Request next frame
    requestAnimationFrame(this.animate);
  }
  
  drawBackground() {
    // Draw dark background
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvasRef.width, this.canvasRef.height);
    
    // Draw animated water effect (as a placeholder, using a simple pattern)
    const frameIndex = this.state.frameCount;
    this.ctx.fillStyle = '#121218';
    
    const tileSize = 32 * this.state.zoom;
    const offsetX = this.state.offsetX % tileSize;
    const offsetY = this.state.offsetY % tileSize;
    
    for (let x = -tileSize; x < this.canvasRef.width + tileSize; x += tileSize) {
      for (let y = -tileSize; y < this.canvasRef.height + tileSize; y += tileSize) {
        this.ctx.fillRect(
          Math.floor(x + offsetX),
          Math.floor(y + offsetY),
          Math.ceil(tileSize - 2),
          Math.ceil(tileSize - 2)
        );
      }
    }
  }
  
  drawGrid() {
    // Calculate grid size based on zoom
    const gridSize = this.state.gridSize * this.state.zoom;
    
    // Only draw grid if it's large enough to be visible
    if (gridSize < 5) return;
    
    // Calculate grid offset
    const offsetX = (this.state.offsetX % gridSize + gridSize) % gridSize;
    const offsetY = (this.state.offsetY % gridSize + gridSize) % gridSize;
    
    // Draw grid
    this.ctx.strokeStyle = 'rgba(100, 100, 255, 0.2)';
    this.ctx.lineWidth = 1;
    
    // Draw vertical lines
    for (let x = offsetX; x < this.canvasRef.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvasRef.height);
      this.ctx.stroke();
    }
    
    // Draw horizontal lines
    for (let y = offsetY; y < this.canvasRef.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvasRef.width, y);
      this.ctx.stroke();
    }
  }
  
  drawTiles() {
    // Tiles are rendered by their own components
    // This method is a placeholder for any canvas-specific rendering of tiles
  }
  
  render() {
    // Don't try to render if we don't have a context
    if (!this.ctx || !this.canvasRef) {
      console.warn('Attempted to render without canvas context');
      return;
    }
    
    // Clear the canvas
    this.ctx.clearRect(0, 0, this.canvasRef.width, this.canvasRef.height);
    
    // Draw the background (water animation)
    this.drawBackground();
    
    // Draw the grid
    this.drawGrid();
    
    // Draw the tiles
    this.drawTiles();
    
    // Draw the connections
    if (this.connectionSystem) {
      this.connectionSystem.render(this.ctx, this.state.offsetX, this.state.offsetY, this.state.zoom);
    }
    
    // Update tile positions based on canvas offset and zoom
    this.state.tiles.forEach(tile => {
      const { x, y, width, height } = tile.state;
      
      const screenX = x * this.state.zoom + this.state.offsetX;
      const screenY = y * this.state.zoom + this.state.offsetY;
      const screenWidth = width * this.state.zoom;
      const screenHeight = height * this.state.zoom;
      
      tile.element.style.transform = `scale(${this.state.zoom})`;
      tile.element.style.transformOrigin = '0 0';
      tile.element.style.left = `${screenX}px`;
      tile.element.style.top = `${screenY}px`;
    });
  }
  
  addTile(tileData) {
    const tile = new TileComponent(this.element, tileData);
    this.state.tiles.push(tile);
    return tile;
  }
  
  destroy() {
    // Remove event listeners
    window.removeEventListener('resize', this.resizeCanvas);
    this.canvasRef.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
    this.canvasRef.removeEventListener('wheel', this.handleWheel);
    
    // Unsubscribe from events
    EventBus.unsubscribe('auth:authenticated', this.handleAuthEvent);
    
    // Destroy tiles
    this.state.tiles.forEach(tile => {
      if (typeof tile.destroy === 'function') {
        tile.destroy();
      }
    });
    
    // Destroy workflow config panel
    if (this.workflowConfigPanel) {
      this.workflowConfigPanel.destroy();
    }
    
    // Remove from DOM
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
  
  handleConnectionSelected(data) {
    const { connectionId } = data;
    
    // Get the selected connection path element
    const connectionPath = document.querySelector(`.workflow-connection[data-id="${connectionId}"]`);
    
    if (connectionPath) {
      // Get position for the context menu
      const bounds = connectionPath.getBoundingClientRect();
      const canvasBounds = this.element.getBoundingClientRect();
      
      const contextMenuX = bounds.left + bounds.width / 2 - canvasBounds.left - 40;
      const contextMenuY = bounds.top + bounds.height / 2 - canvasBounds.top - 20;
      
      this.setState({
        selectedConnection: connectionId,
        contextMenuX,
        contextMenuY
      });
      
      this.render();
      
      // Add click listener to delete button
      const deleteBtn = this.element.querySelector('.btn-delete-connection');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', this.handleConnectionContextMenuClick);
      }
    }
  }
  
  handleConnectionContextMenuClick(e) {
    e.stopPropagation();
    
    // Delete the selected connection
    if (this.state.selectedConnection) {
      EventBus.publish('connection:delete', this.state.selectedConnection);
      this.setState({ selectedConnection: null });
      this.render();
    }
  }
  
  handleWorkflowInputConnections(data) {
    const { tileId, callback } = data;
    
    if (!this.connectionSystem) {
      callback([]);
      return;
    }
    
    // Get input connections for the tile
    const connections = this.connectionSystem.getInputConnections(tileId);
    callback(connections);
  }
  
  handleWorkflowOutputData(data) {
    const { tileId, portName, callback } = data;
    
    // Find the source tile
    const sourceTile = this.state.tiles.find(tile => tile.state.id === tileId);
    
    if (!sourceTile || !sourceTile.getOutputData) {
      callback(null);
      return;
    }
    
    // Get output data from the source tile
    const outputData = sourceTile.getOutputData();
    callback(outputData[portName] || null);
  }
  
  handleTileContextMenu(data) {
    const { tileId, clientX, clientY } = data;
    
    // Get tile component
    const tileComponent = this.state.tiles.find(tile => tile.state.id === tileId);
    
    if (!tileComponent) return;
    
    // Prevent default context menu
    if (data.event) {
      data.event.preventDefault();
    }
    
    // Show custom context menu
    const canvasBounds = this.element.getBoundingClientRect();
    const contextMenuX = clientX - canvasBounds.left;
    const contextMenuY = clientY - canvasBounds.top;
    
    this.setState({
      selectedTile: tileId,
      contextMenuX,
      contextMenuY,
      showingTileContextMenu: true
    });
    
    this.render();
    
    // Add click listeners to context menu items
    setTimeout(() => {
      const contextMenuItems = this.element.querySelectorAll('.tile-context-menu .context-menu-item');
      
      if (contextMenuItems.length > 0) {
        contextMenuItems.forEach(item => {
          const action = item.getAttribute('data-action');
          item.addEventListener('click', (e) => this.handleTileContextMenuClick(e, action));
        });
      }
    }, 0);
  }
  
  handleTileContextMenuClick(e, action) {
    e.stopPropagation();
    
    if (!this.state.selectedTile) return;
    
    // Find the tile component
    const tileComponent = this.state.tiles.find(tile => tile.state.id === this.state.selectedTile);
    
    if (!tileComponent) return;
    
    // Handle different actions
    switch (action) {
      case 'execute':
        // Execute the workflow
        if (tileComponent.executeWorkflow) {
          tileComponent.executeWorkflow();
        }
        break;
        
      case 'pipeline':
        // Execute the pipeline starting from this tile
        EventBus.publish('pipeline:execute', { tileId: this.state.selectedTile });
        break;
        
      case 'saveTemplate':
        // Save the pipeline as a template
        EventBus.publish('pipeline:saveAsTemplate', { tileId: this.state.selectedTile });
        break;
        
      case 'duplicate':
        // Duplicate the tile
        if (tileComponent instanceof WorkflowTileComponent) {
          const newPos = {
            x: tileComponent.state.x + 50,
            y: tileComponent.state.y + 50
          };
          
          this.createWorkflowTile(
            tileComponent.state.workflowType,
            newPos,
            { ...tileComponent.state.parameters }
          );
        }
        break;
        
      case 'configure':
        // Configure the workflow
        if (tileComponent instanceof WorkflowTileComponent) {
          tileComponent.showConfigurationPanel();
        }
        break;
        
      case 'delete':
        // Delete the tile
        this.deleteTile(tileComponent);
        break;
    }
    
    // Hide the context menu
    this.setState({ showingTileContextMenu: false });
    this.render();
  }
  
  handleGetConnectionSystem(callback) {
    if (typeof callback === 'function') {
      callback(this.connectionSystem);
    }
  }
  
  handleGetTileById(data) {
    const { tileId, callback } = data;
    
    if (!tileId || !callback) return;
    
    const tile = this.state.tiles.find(t => t.state.id === tileId);
    callback(tile);
  }
  
  /**
   * Handles loading a pipeline template
   * @param {Object} data - Template data and callback
   */
  handleLoadTemplate(data) {
    const { template, callback } = data;
    
    if (!template || !template.tiles || !template.connections) {
      if (callback) callback(false);
      return;
    }
    
    try {
      // Store current offset for relative positioning
      const baseOffsetX = this.state.offsetX;
      const baseOffsetY = this.state.offsetY;
      
      // Clear existing tiles if requested
      if (data.clearExisting) {
        this.state.tiles.forEach(tile => {
          if (tile.element && tile.element.parentNode) {
            tile.element.parentNode.removeChild(tile.element);
          }
        });
        this.setState({ tiles: [] });
        
        // Clear existing connections
        if (this.connectionSystem) {
          this.connectionSystem.state.connections = [];
          this.connectionSystem.renderConnections();
        }
      }
      
      // Map of old tile IDs to newly created tile IDs
      const tileIdMap = {};
      
      // Create each tile from the template
      template.tiles.forEach(tileData => {
        const oldId = tileData.id;
        const newId = `tile-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        tileIdMap[oldId] = newId;
        
        // Create tile with modified data
        const modifiedData = {
          ...tileData,
          id: newId,
          // Apply relative positioning
          x: tileData.x + (data.positionX || 0),
          y: tileData.y + (data.positionY || 0)
        };
        
        if (tileData.workflowType) {
          // This is a workflow tile
          this.addWorkflowTile(modifiedData);
        } else {
          // This is a regular tile
          this.addTile(modifiedData);
        }
      });
      
      // Create connections with updated tile IDs
      if (this.connectionSystem && template.connections) {
        const newConnections = template.connections.map(conn => {
          return {
            ...conn,
            id: `conn-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            sourceId: tileIdMap[conn.sourceId] || conn.sourceId,
            targetId: tileIdMap[conn.targetId] || conn.targetId
          };
        });
        
        // Add connections to the connection system
        this.connectionSystem.state.connections = [
          ...this.connectionSystem.state.connections,
          ...newConnections
        ];
        this.connectionSystem.renderConnections();
      }
      
      // Call success callback
      if (callback) callback(true);
      
    } catch (error) {
      console.error('Error loading template:', error);
      if (callback) callback(false);
    }
  }
  
  /**
   * Deletes a tile from the canvas
   * @param {Object} tileComponent - The tile component to delete
   */
  deleteTile(tileComponent) {
    if (!tileComponent) return;
    
    const tileId = tileComponent.state.id;
    const index = this.state.tiles.findIndex(tile => tile.state.id === tileId);
    
    if (index !== -1) {
      // Remove any connections to/from this tile
      if (this.connectionSystem) {
        this.connectionSystem.deleteConnectionsForTile(tileId);
      }
      
      // Remove the tile element
      if (tileComponent.element && tileComponent.element.parentNode) {
        tileComponent.element.parentNode.removeChild(tileComponent.element);
      }
      
      // Remove from tiles array
      const updatedTiles = [...this.state.tiles];
      updatedTiles.splice(index, 1);
      this.setState({ 
        tiles: updatedTiles,
        selectedTile: null
      });
    }
  }
}

// Helper functions
function getWorkflowLabel(workflowType) {
  const labels = {
    makeImage: 'Make Image',
    textToImage: 'Text to Image',
    trainModel: 'Train Model',
    upscale: 'Upscale',
    inpaint: 'Inpaint',
    collections: 'Collections',
    settings: 'Settings'
  };
  
  return labels[workflowType] || workflowType;
} 