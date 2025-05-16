/**
 * Minimal Test Server for StationThis UI Testing
 * This server is specifically for Playwright testing and avoids the dependencies
 * that are causing issues in the main server.
 */

const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static files from user-interface directory if it exists
app.use(express.static(path.join(__dirname, '../../user-interface')));

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Define HTML content for the test page that matches the actual app structure
const testPageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StationThis | Control Interface</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f0f0f0; }
    .workspace-container { 
      position: relative; 
      width: 100%; 
      height: 100vh; 
      background: #ffffff;
      overflow: hidden;
    }
    .floating-hud {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 10px;
      z-index: 100;
    }
    .status-display {
      display: flex;
      justify-content: space-around;
    }
    .status-item {
      display: flex;
      align-items: center;
      margin: 0 10px;
    }
    .status-label {
      font-weight: bold;
      margin-right: 5px;
    }
    .status-bar {
      width: 100px;
      height: 10px;
      background: #333;
      border-radius: 5px;
      overflow: hidden;
      margin: 0 5px;
    }
    .status-fill {
      height: 100%;
      background: #4caf50;
    }
    .exp-fill { background: #2196f3; }
    .health-fill { background: #f44336; }
    .energy-fill { background: #ffeb3b; }
    .tile {
      position: absolute;
      width: 150px;
      height: 150px;
      background: white;
      border: 1px solid #ccc;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      border-radius: 5px;
      cursor: move;
      user-select: none;
    }
    .tile-header {
      background: #2196f3;
      color: white;
      padding: 5px 10px;
      font-weight: bold;
      border-radius: 5px 5px 0 0;
    }
    .tile-content {
      padding: 10px;
    }
  </style>
</head>
<body>
  <div class="workspace-container">
    <!-- Top HUD Bar - Floating over workspace -->
    <div class="floating-hud">
      <div class="status-display">
        <div class="status-item">
          <span class="status-label">EXP</span>
          <div class="status-bar">
            <div class="status-fill exp-fill" style="width: 35%"></div>
          </div>
          <span class="status-value">35%</span>
        </div>
        <div class="status-item">
          <span class="status-label">HP</span>
          <div class="status-bar">
            <div class="status-fill health-fill" style="width: 78%"></div>
          </div>
          <span class="status-value">78%</span>
        </div>
        <div class="status-item">
          <span class="status-label">MP</span>
          <div class="status-bar">
            <div class="status-fill energy-fill" style="width: 92%"></div>
          </div>
          <span class="status-value">92%</span>
        </div>
        <div class="status-item">
          <span class="status-label">LEVEL</span>
          <span class="status-value">12</span>
        </div>
        <div class="status-item">
          <span class="status-label">CREDITS</span>
          <span class="status-value">5,280</span>
        </div>
        <div class="status-item">
          <span class="status-label">STATION</span>
          <span class="status-value">Alpha</span>
        </div>
      </div>
    </div>
    
    <!-- Example tile -->
    <div class="tile" style="left: 100px; top: 100px;">
      <div class="tile-header">Image Generator</div>
      <div class="tile-content">
        This tile generates images based on prompts.
      </div>
    </div>
    
    <div class="tile" style="left: 300px; top: 150px;">
      <div class="tile-header">Text Processor</div>
      <div class="tile-content">
        This tile processes text inputs.
      </div>
    </div>
  </div>
  
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      console.log('DOM fully loaded and parsed');
      
      // Log element existence for debugging
      const workspaceContainer = document.querySelector('.workspace-container');
      const floatingHud = document.querySelector('.floating-hud');
      console.log('Workspace container exists:', !!workspaceContainer);
      console.log('Floating HUD exists:', !!floatingHud);
      
      // Make tiles draggable
      document.querySelectorAll('.tile').forEach(tile => {
        tile.addEventListener('mousedown', function(e) {
          if (e.target.classList.contains('tile-header')) {
            console.log('Tile drag started');
            
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseInt(tile.style.left) || 0;
            const startTop = parseInt(tile.style.top) || 0;
            
            function moveHandler(e) {
              tile.style.left = (startLeft + e.clientX - startX) + 'px';
              tile.style.top = (startTop + e.clientY - startY) + 'px';
            }
            
            function upHandler() {
              console.log('Tile drag ended');
              document.removeEventListener('mousemove', moveHandler);
              document.removeEventListener('mouseup', upHandler);
            }
            
            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
          }
        });
      });
      
      // Add double-click handler to workspace to create new tiles
      workspaceContainer.addEventListener('dblclick', function(e) {
        if (e.target === workspaceContainer) {
          console.log('Creating new tile');
          
          const newTile = document.createElement('div');
          newTile.className = 'tile';
          newTile.style.left = e.clientX + 'px';
          newTile.style.top = e.clientY + 'px';
          
          const header = document.createElement('div');
          header.className = 'tile-header';
          header.textContent = 'New Workflow';
          
          const content = document.createElement('div');
          content.className = 'tile-content';
          content.textContent = 'Double-click to configure this workflow.';
          
          newTile.appendChild(header);
          newTile.appendChild(content);
          workspaceContainer.appendChild(newTile);
          
          // Make new tile draggable
          newTile.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('tile-header')) {
              const startX = e.clientX;
              const startY = e.clientY;
              const startLeft = parseInt(newTile.style.left) || 0;
              const startTop = parseInt(newTile.style.top) || 0;
              
              function moveHandler(e) {
                newTile.style.left = (startLeft + e.clientX - startX) + 'px';
                newTile.style.top = (startTop + e.clientY - startY) + 'px';
              }
              
              function upHandler() {
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
              }
              
              document.addEventListener('mousemove', moveHandler);
              document.addEventListener('mouseup', upHandler);
            }
          });
        }
      });
    });
  </script>
</body>
</html>
`;

// Serve the test HTML file for UI component testing
app.get('/', (req, res) => {
  console.log('Serving test page HTML');
  res.send(testPageHTML);
});

// Add API mock endpoints
app.get('/api/status', (req, res) => {
  res.json({
    exp: 35,
    health: 78,
    energy: 92,
    level: 12,
    credits: 5280,
    station: 'Alpha'
  });
});

app.get('/api/workflows', (req, res) => {
  res.json([
    { id: 1, name: 'Image Generator', type: 'generator' },
    { id: 2, name: 'Text Processor', type: 'processor' },
    { id: 3, name: 'Data Analyzer', type: 'analyzer' }
  ]);
});

// Start the server
const server = app.listen(port, () => {
  console.log(`Test server running at http://localhost:${port}`);
  console.log(`Test page available at: http://localhost:${port}`);
});

// Handle server shutdown
process.on('SIGINT', () => {
  console.log('Shutting down test server');
  server.close();
  process.exit(0);
});

// Export server for potential programmatic usage
module.exports = server; 