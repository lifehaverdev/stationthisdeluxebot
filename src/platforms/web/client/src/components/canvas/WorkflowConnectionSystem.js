// WorkflowConnectionSystem for StationThis web interface
// Manages connections between workflow tiles to enable data flow

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';
import { dataTypeValidator } from './DataTypeValidator.js';

export class WorkflowConnectionSystem extends Component {
  constructor(canvasElement) {
    super(canvasElement);
    
    // Connection system state
    this.state = {
      connections: [],
      activeConnection: null,
      connectionInProgress: false,
      sourcePort: null,
      validTargets: []
    };
    
    // SVG namespace for creating connection elements
    this.svgNS = "http://www.w3.org/2000/svg";
    
    // Bind methods
    this.startConnection = this.startConnection.bind(this);
    this.updateConnection = this.updateConnection.bind(this);
    this.completeConnection = this.completeConnection.bind(this);
    this.cancelConnection = this.cancelConnection.bind(this);
    this.deleteConnection = this.deleteConnection.bind(this);
    this.validateConnection = this.validateConnection.bind(this);
    this.renderConnections = this.renderConnections.bind(this);
    this.handleCanvasZoom = this.handleCanvasZoom.bind(this);
    this.handleCanvasPan = this.handleCanvasPan.bind(this);
    
    // Initialize the connection system
    this.init();
  }
  
  template() {
    return `
      <svg class="connection-layer" 
           style="position: absolute; 
                  top: 0; 
                  left: 0; 
                  width: 100%; 
                  height: 100%; 
                  pointer-events: none; 
                  z-index: 5;">
        <g class="connections-group"></g>
        <path class="active-connection" 
              stroke="#FFD700" 
              stroke-width="2" 
              stroke-dasharray="5,5" 
              fill="none" 
              d="M0,0 L0,0"
              style="display: none;" />
      </svg>
    `;
  }
  
  init() {
    this.appendToParent();
    
    // Store references to SVG elements
    this.svg = this.element.querySelector('svg.connection-layer');
    this.connectionsGroup = this.element.querySelector('g.connections-group');
    this.activeConnectionPath = this.element.querySelector('path.active-connection');
    
    // Subscribe to connection events
    EventBus.subscribe('connection:start', this.startConnection);
    EventBus.subscribe('connection:cancel', this.cancelConnection);
    EventBus.subscribe('connection:delete', this.deleteConnection);
    EventBus.subscribe('canvas:zoom', this.handleCanvasZoom);
    EventBus.subscribe('canvas:pan', this.handleCanvasPan);
    
    // Add mousemove and mouseup listeners for creating connections
    document.addEventListener('mousemove', this.updateConnection);
    document.addEventListener('mouseup', this.completeConnection);
    
    // Load existing connections if available
    this.loadConnections();
  }
  
  startConnection(data) {
    const { portElement, tileId, portType, portName, portPosition } = data;
    
    this.state.connectionInProgress = true;
    this.state.sourcePort = {
      tileId,
      portType,
      portName,
      position: portPosition
    };
    
    // Show the active connection path
    this.activeConnectionPath.style.display = 'block';
    this.activeConnectionPath.setAttribute('d', `M${portPosition.x},${portPosition.y} L${portPosition.x},${portPosition.y}`);
    
    // Find valid target ports based on source port type
    this.findValidTargets();
  }
  
  updateConnection(e) {
    if (!this.state.connectionInProgress) return;
    
    // Get mouse position relative to canvas
    const canvasRect = this.parent.getBoundingClientRect();
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;
    
    // Update the active connection path
    const sourcePos = this.state.sourcePort.position;
    
    // Create a curved path from source to mouse position
    const path = this.createPathBetweenPoints(
      sourcePos.x, sourcePos.y,
      mouseX, mouseY
    );
    
    this.activeConnectionPath.setAttribute('d', path);
  }
  
  completeConnection(e) {
    // Complete the connection if the target port is valid
    if (!this.state.connectionInProgress || !this.state.sourcePort) return;
    
    // Get client coordinates
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    // Find if there's a port at this position
    const targetPort = this.findPortElementAtPosition(clientX, clientY);
    
    if (targetPort) {
      // Validate the connection
      const sourcePort = this.state.sourcePort;
      const validationResult = this.validateConnection(sourcePort, targetPort);
      
      if (validationResult.valid) {
        // Create a new connection
        const newConnection = {
          id: `conn-${Date.now()}`,
          sourceId: sourcePort.tileId,
          sourcePort: sourcePort.portName,
          targetId: targetPort.tileId,
          targetPort: targetPort.portName
        };
        
        // Add to connections array
        this.state.connections.push(newConnection);
        
        // Render connections
        this.renderConnections();
        
        // Publish the new connection event
        EventBus.publish('connection:created', { connection: newConnection });
      } else {
        // Show error notification for invalid connection
        EventBus.publish('notification', {
          type: 'error',
          message: validationResult.error
        });
        
        // Show suggestion if available
        if (validationResult.suggestion) {
          EventBus.publish('notification', {
            type: 'info',
            message: validationResult.suggestion
          });
        }
      }
    }
    
    // Reset the temporary connection line
    this.cancelConnection();
  }
  
  cancelConnection() {
    this.state.connectionInProgress = false;
    this.state.sourcePort = null;
    this.state.validTargets = [];
    this.activeConnectionPath.style.display = 'none';
    
    // Reset highlighted ports
    document.querySelectorAll('.connection-port.highlight').forEach(port => {
      port.classList.remove('highlight');
    });
  }
  
  deleteConnection(connectionId) {
    const index = this.state.connections.findIndex(conn => conn.id === connectionId);
    
    if (index !== -1) {
      // Remove connection from list
      this.state.connections.splice(index, 1);
      
      // Re-render connections
      this.renderConnections();
      
      // Publish connection deleted event
      EventBus.publish('connection:deleted', { connectionId });
    }
  }
  
  /**
   * Deletes all connections to/from a specific tile
   * @param {string} tileId - The ID of the tile to delete connections for
   */
  deleteConnectionsForTile(tileId) {
    if (!tileId) return;
    
    // Find all connections involving this tile
    const connectionsToDelete = this.state.connections.filter(
      conn => conn.sourceId === tileId || conn.targetId === tileId
    );
    
    // Delete each connection
    connectionsToDelete.forEach(conn => {
      this.deleteConnection(conn.id);
    });
  }
  
  /**
   * Highlights connections in a pipeline
   * @param {Object} pipeline - Pipeline object with connections
   * @param {string} status - Status of the pipeline ('active', 'completed', 'error')
   */
  highlightPipelineConnections(pipeline, status) {
    if (!pipeline || !pipeline.connections) return;
    
    // Reset all connection statuses first
    document.querySelectorAll('.workflow-connection').forEach(conn => {
      conn.classList.remove('pipeline-active', 'pipeline-completed', 'pipeline-error');
    });
    
    // Highlight connections in this pipeline
    pipeline.connections.forEach(connection => {
      const connectionElement = document.querySelector(`.workflow-connection[data-id="${connection.id}"]`);
      if (connectionElement) {
        connectionElement.classList.add(`pipeline-${status}`);
      }
    });
  }
  
  /**
   * Resets pipeline connection highlighting
   */
  resetConnectionHighlighting() {
    document.querySelectorAll('.workflow-connection').forEach(conn => {
      conn.classList.remove('pipeline-active', 'pipeline-completed', 'pipeline-error');
    });
  }
  
  validateConnection(sourcePort, targetPort) {
    // Validate that the connection is valid
    
    // Check that ports are of opposite types
    if (sourcePort.portType === targetPort.portType) {
      return {
        valid: false,
        error: `Cannot connect two ${sourcePort.portType} ports`
      };
    }
    
    // Check that we don't connect a tile to itself
    if (sourcePort.tileId === targetPort.tileId) {
      return {
        valid: false,
        error: 'Cannot connect a tile to itself'
      };
    }
    
    // Ensure the input port doesn't already have a connection
    if (targetPort.portType === 'input') {
      const existingConnection = this.state.connections.find(
        conn => conn.targetId === targetPort.tileId && conn.targetPort === targetPort.portName
      );
      
      if (existingConnection) {
        return {
          valid: false,
          error: 'Input port already has a connection'
        };
      }
    }
    
    // Get port data types for validation
    let sourcePortType, targetPortType;
    
    // Request port type information through EventBus
    EventBus.publish('workflow:getPortType', {
      tileId: sourcePort.tileId,
      portName: sourcePort.portName,
      portDirection: sourcePort.portType,
      callback: (type) => {
        sourcePortType = type;
      }
    });
    
    EventBus.publish('workflow:getPortType', {
      tileId: targetPort.tileId,
      portName: targetPort.portName,
      portDirection: targetPort.portType,
      callback: (type) => {
        targetPortType = type;
      }
    });
    
    // Validate data types if available
    if (sourcePortType && targetPortType) {
      // Check type compatibility using the validator
      const typesCompatible = dataTypeValidator.areTypesCompatible(
        sourcePortType, 
        targetPortType
      );
      
      if (!typesCompatible) {
        const errorMsg = dataTypeValidator.getTypeMismatchError(
          sourcePort.portName, 
          sourcePortType, 
          targetPort.portName, 
          targetPortType
        );
        
        const suggestion = dataTypeValidator.getSuggestionForMismatch(
          sourcePortType, 
          targetPortType
        );
        
        return {
          valid: false,
          error: errorMsg,
          suggestion: suggestion
        };
      }
    }
    
    return { valid: true };
  }
  
  renderConnections() {
    // Clear existing connections
    while (this.connectionsGroup.firstChild) {
      this.connectionsGroup.removeChild(this.connectionsGroup.firstChild);
    }
    
    // Render each connection
    this.state.connections.forEach(connection => {
      // Get source and target port positions
      const sourcePosition = this.getPortPosition(connection.sourceId, connection.sourcePort, 'output');
      const targetPosition = this.getPortPosition(connection.targetId, connection.targetPort, 'input');
      
      if (!sourcePosition || !targetPosition) {
        return; // Skip if positions can't be determined
      }
      
      // Create path
      const path = document.createElementNS(this.svgNS, 'path');
      path.setAttribute('class', 'workflow-connection');
      path.setAttribute('data-id', connection.id);
      path.setAttribute('data-source', connection.sourceId);
      path.setAttribute('data-target', connection.targetId);
      
      // Create curved path between points
      const pathD = this.createPathBetweenPoints(
        sourcePosition.x, sourcePosition.y,
        targetPosition.x, targetPosition.y
      );
      
      path.setAttribute('d', pathD);
      path.setAttribute('stroke', '#4CAF50');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      
      // Add click handler to select/delete connection
      path.style.pointerEvents = 'stroke';
      path.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectConnection(connection.id);
      });
      
      // Add to SVG
      this.connectionsGroup.appendChild(path);
    });
    
    // Save connections to local storage
    this.saveConnections();
  }
  
  createPathBetweenPoints(x1, y1, x2, y2) {
    // Create a curved path between two points
    const dx = Math.abs(x2 - x1) * 0.5;
    
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  
  getPortPosition(tileId, portName, portType) {
    // Find the port element
    const portSelector = `.workflow-tile[data-id="${tileId}"] .connection-port[data-port="${portName}"][data-type="${portType}"]`;
    const portElement = document.querySelector(portSelector);
    
    if (!portElement) return null;
    
    // Get position relative to canvas
    const rect = portElement.getBoundingClientRect();
    const canvasRect = this.parent.getBoundingClientRect();
    
    return {
      x: rect.left + rect.width / 2 - canvasRect.left,
      y: rect.top + rect.height / 2 - canvasRect.top
    };
  }
  
  findPortElementAtPosition(clientX, clientY) {
    // Find port elements that contain the point
    const ports = document.querySelectorAll('.connection-port');
    let targetPort = null;
    
    ports.forEach(port => {
      const rect = port.getBoundingClientRect();
      
      if (
        clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom
      ) {
        targetPort = {
          portElement: port,
          tileId: port.closest('.workflow-tile').dataset.id,
          portType: port.dataset.type,
          portName: port.dataset.port,
          position: {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          }
        };
      }
    });
    
    return targetPort;
  }
  
  findValidTargets() {
    if (!this.state.sourcePort) return;
    
    // Clear previously highlighted ports
    document.querySelectorAll('.connection-port.highlight').forEach(port => {
      port.classList.remove('highlight');
    });
    
    // Find valid target ports based on source port
    const sourcePort = this.state.sourcePort;
    const targetType = sourcePort.portType === 'output' ? 'input' : 'output';
    
    // Find all ports of the target type except those on the same tile
    const portSelector = `.workflow-tile:not([data-id="${sourcePort.tileId}"]) .connection-port[data-type="${targetType}"]`;
    const ports = document.querySelectorAll(portSelector);
    
    // Highlight valid ports
    ports.forEach(port => {
      // Skip ports that already have a connection if they're inputs
      if (targetType === 'input') {
        const targetId = port.closest('.workflow-tile').dataset.id;
        const targetPort = port.dataset.port;
        
        const existingConnection = this.state.connections.find(
          conn => conn.targetId === targetId && conn.targetPort === targetPort
        );
        
        if (existingConnection) return;
      }
      
      port.classList.add('highlight');
      this.state.validTargets.push({
        portElement: port,
        tileId: port.closest('.workflow-tile').dataset.id,
        portType: port.dataset.type,
        portName: port.dataset.port
      });
    });
  }
  
  selectConnection(connectionId) {
    // Toggle selected class on connection
    const path = this.connectionsGroup.querySelector(`[data-id="${connectionId}"]`);
    
    if (path) {
      if (path.classList.contains('selected')) {
        path.classList.remove('selected');
        path.setAttribute('stroke', '#4CAF50');
        path.setAttribute('stroke-width', '2');
      } else {
        // Deselect all connections
        this.connectionsGroup.querySelectorAll('path').forEach(p => {
          p.classList.remove('selected');
          p.setAttribute('stroke', '#4CAF50');
          p.setAttribute('stroke-width', '2');
        });
        
        // Select this connection
        path.classList.add('selected');
        path.setAttribute('stroke', '#FFD700');
        path.setAttribute('stroke-width', '3');
        
        // Show delete option via EventBus
        EventBus.publish('connection:selected', { connectionId });
      }
    }
  }
  
  handleCanvasZoom(zoomData) {
    // Update connection rendering on canvas zoom
    this.renderConnections();
  }
  
  handleCanvasPan(panData) {
    // Update connection rendering on canvas pan
    this.renderConnections();
  }
  
  saveConnections() {
    // Save connections to local storage
    if (this.state.connections.length > 0) {
      try {
        localStorage.setItem('workflowConnections', JSON.stringify(this.state.connections));
      } catch (e) {
        console.error('Failed to save connections:', e);
      }
    }
  }
  
  loadConnections() {
    // Load connections from local storage
    try {
      const savedConnections = localStorage.getItem('workflowConnections');
      if (savedConnections) {
        this.state.connections = JSON.parse(savedConnections);
        this.renderConnections();
      }
    } catch (e) {
      console.error('Failed to load connections:', e);
    }
  }
  
  getConnectionsByTileId(tileId) {
    // Get all connections for a specific tile
    return this.state.connections.filter(
      conn => conn.sourceId === tileId || conn.targetId === tileId
    );
  }
  
  getInputConnections(tileId) {
    // Get all incoming connections for a tile
    return this.state.connections.filter(conn => conn.targetId === tileId);
  }
  
  getOutputConnections(tileId) {
    // Get all outgoing connections for a tile
    return this.state.connections.filter(conn => conn.sourceId === tileId);
  }
} 