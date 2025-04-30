// Tile Component for the StationThis web interface
// Represents a workflow tile that can be placed on the canvas

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';

export class TileComponent extends Component {
  constructor(parentElement, options = {}) {
    super(parentElement);
    
    // Default values for a tile
    this.state = {
      id: options.id || `tile-${Date.now()}`,
      x: options.x || 100,
      y: options.y || 100,
      width: options.width || 200,
      height: options.height || 150,
      label: options.label || 'Workflow',
      status: options.status || 'idle', // idle, running, complete, error
      color: options.color || '#297ACC',
      isSelected: false,
      isDragging: false,
      isResizing: false,
      dragOffsetX: 0,
      dragOffsetY: 0,
      resizeHandle: null // top-left, top-right, bottom-left, bottom-right
    };
    
    // Bind methods
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.contains = this.contains.bind(this);
    this.isInResizeHandle = this.isInResizeHandle.bind(this);
    this.render = this.render.bind(this);
    
    // Initialize the tile
    this.init();
  }
  
  template() {
    return `
      <div class="workflow-tile" 
           data-id="${this.state.id}"
           data-status="${this.state.status}"
           style="left: ${this.state.x}px; 
                  top: ${this.state.y}px; 
                  width: ${this.state.width}px; 
                  height: ${this.state.height}px;
                  background-color: ${this.state.color};">
        <div class="tile-header">
          <span class="tile-label">${this.state.label}</span>
          <span class="tile-status">${this.state.status}</span>
        </div>
        <div class="tile-content"></div>
        <div class="resize-handle top-left"></div>
        <div class="resize-handle top-right"></div>
        <div class="resize-handle bottom-left"></div>
        <div class="resize-handle bottom-right"></div>
      </div>
    `;
  }
  
  init() {
    this.appendToParent();
    
    // Add event listeners
    this.element.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
    
    // Publish tile created event
    EventBus.publish('tile:created', this);
  }
  
  handleMouseDown(e) {
    e.stopPropagation(); // Prevent canvas from detecting this event
    
    // Check if click is on a resize handle
    const resizeHandle = this.isInResizeHandle(e.offsetX, e.offsetY);
    if (resizeHandle) {
      this.state.isResizing = true;
      this.state.resizeHandle = resizeHandle;
    } else {
      // Otherwise, it's a drag operation
      this.state.isDragging = true;
      this.state.dragOffsetX = e.clientX - this.state.x;
      this.state.dragOffsetY = e.clientY - this.state.y;
    }
    
    // Select this tile
    this.select();
    
    // Publish tile selected event
    EventBus.publish('tile:selected', this);
  }
  
  handleMouseMove(e) {
    if (this.state.isDragging) {
      // Update position
      this.state.x = e.clientX - this.state.dragOffsetX;
      this.state.y = e.clientY - this.state.dragOffsetY;
      
      // Update element style
      this.element.style.left = `${this.state.x}px`;
      this.element.style.top = `${this.state.y}px`;
      
      // Publish tile moved event
      EventBus.publish('tile:moved', this);
    } else if (this.state.isResizing) {
      // Handle resizing based on which resize handle is being dragged
      const { resizeHandle } = this.state;
      
      // Calculate new dimensions
      if (resizeHandle.includes('right')) {
        this.state.width = Math.max(100, e.clientX - this.state.x);
      } else if (resizeHandle.includes('left')) {
        const newWidth = Math.max(100, this.state.x + this.state.width - e.clientX);
        const newX = this.state.x + this.state.width - newWidth;
        this.state.x = newX;
        this.state.width = newWidth;
      }
      
      if (resizeHandle.includes('bottom')) {
        this.state.height = Math.max(80, e.clientY - this.state.y);
      } else if (resizeHandle.includes('top')) {
        const newHeight = Math.max(80, this.state.y + this.state.height - e.clientY);
        const newY = this.state.y + this.state.height - newHeight;
        this.state.y = newY;
        this.state.height = newHeight;
      }
      
      // Update element style
      this.element.style.left = `${this.state.x}px`;
      this.element.style.top = `${this.state.y}px`;
      this.element.style.width = `${this.state.width}px`;
      this.element.style.height = `${this.state.height}px`;
      
      // Publish tile resized event
      EventBus.publish('tile:resized', this);
    }
  }
  
  handleMouseUp() {
    this.state.isDragging = false;
    this.state.isResizing = false;
    this.state.resizeHandle = null;
  }
  
  contains(x, y) {
    return (
      x >= this.state.x &&
      x <= this.state.x + this.state.width &&
      y >= this.state.y &&
      y <= this.state.y + this.state.height
    );
  }
  
  isInResizeHandle(x, y) {
    const handleSize = 10;
    
    // Check each resize handle
    if (x <= handleSize && y <= handleSize) return 'top-left';
    if (x >= this.state.width - handleSize && y <= handleSize) return 'top-right';
    if (x <= handleSize && y >= this.state.height - handleSize) return 'bottom-left';
    if (x >= this.state.width - handleSize && y >= this.state.height - handleSize) return 'bottom-right';
    
    return null;
  }
  
  select() {
    this.state.isSelected = true;
    this.element.classList.add('selected');
    
    // Deselect all other tiles
    document.querySelectorAll('.workflow-tile').forEach(tile => {
      if (tile !== this.element) {
        tile.classList.remove('selected');
      }
    });
  }
  
  deselect() {
    this.state.isSelected = false;
    this.element.classList.remove('selected');
  }
  
  setStatus(status) {
    this.state.status = status;
    this.element.dataset.status = status;
    
    // Update the status display
    const statusElement = this.element.querySelector('.tile-status');
    if (statusElement) {
      statusElement.textContent = status;
    }
  }
  
  getData() {
    return {...this.state};
  }
} 