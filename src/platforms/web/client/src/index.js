// Main entry point for the StationThis web client
// Implements the canvas demonstration for Phase 4

import './index.css';
import './components/canvas/canvas.css';
import './components/results/result-viewer.css';
import { EventBus } from './stores/EventBus.js';
import { AuthModalComponent } from './components/auth/AuthModalComponent.js';
import { CanvasComponent } from './components/canvas/CanvasComponent.js';
import { HudComponent } from './components/canvas/HudComponent.js';
import { TileComponent } from './components/canvas/TileComponent.js';
import { ResultViewerComponent } from './components/results/ResultViewerComponent.js';

// Enable EventBus debug mode in development
EventBus.setDebug(true);

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('StationThis Canvas Demonstration');
  
  // Initialize the canvas component
  const mainContainer = document.getElementById('app');
  const canvasComponent = new CanvasComponent(mainContainer);
  
  // Initialize the auth modal
  const authModal = new AuthModalComponent(mainContainer);
  
  // Initialize the HUD component
  const hudComponent = new HudComponent(mainContainer);
  
  // Initialize the Result Viewer component
  const resultViewer = new ResultViewerComponent(mainContainer);
  
  // Subscribe to events
  EventBus.subscribe('tile:add', (data) => {
    // Create a new workflow tile when requested
    const tileOptions = {
      x: data.x || 100,
      y: data.y || 100,
      label: data.label || 'New Workflow',
      status: 'idle'
    };
    
    new TileComponent(mainContainer, tileOptions);
  });
  
  // Event handling for auth events
  EventBus.subscribe('auth:login', (data) => {
    if (data.success) {
      console.log(`Logged in as: ${data.username}`);
      // Add some sample tiles after login
      addSampleTiles(mainContainer);
    }
  });
  
  EventBus.subscribe('auth:wallet', (data) => {
    if (data.success) {
      console.log(`Connected wallet: ${data.address}`);
      // Add some sample tiles after wallet connection
      addSampleTiles(mainContainer);
    }
  });
  
  EventBus.subscribe('auth:guest', (data) => {
    if (data.success) {
      console.log(`Guest access: ${data.guestId}`);
      // Add some sample tiles for guest users
      addSampleTiles(mainContainer);
    }
  });
});

// Helper function to add sample workflow tiles for demonstration
function addSampleTiles(container) {
  // Text generation workflow
  new TileComponent(container, {
    x: 100,
    y: 100,
    width: 220,
    height: 160,
    label: 'Text Generation',
    status: 'complete',
    color: '#2979FF'
  });
  
  // Image generation workflow
  new TileComponent(container, {
    x: 400,
    y: 150,
    width: 250,
    height: 180,
    label: 'Image Generation',
    status: 'idle',
    color: '#00C853'
  });
  
  // Model training workflow
  new TileComponent(container, {
    x: 200,
    y: 350,
    width: 280,
    height: 200,
    label: 'Model Training',
    status: 'running',
    color: '#AA00FF'
  });
} 