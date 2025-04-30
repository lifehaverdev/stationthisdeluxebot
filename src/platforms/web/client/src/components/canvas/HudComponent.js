// HUD Component for the StationThis web interface
// Displays user information and controls in the upper left corner

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';

export class HudComponent extends Component {
  constructor(parentElement) {
    super(parentElement);
    
    this.state = {
      isVisible: true,
      username: 'Guest',
      isGuest: true,
      points: 0,
      isMouseOver: false,
      lastMouseMove: Date.now(),
      lastSaved: null,
      isAuthenticated: false
    };
    
    this.authService = null; // Will be set during initialization
    
    // Bind methods
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.checkMouseActivity = this.checkMouseActivity.bind(this);
    this.checkAuthentication = this.checkAuthentication.bind(this);
    this.updateUserPoints = this.updateUserPoints.bind(this);
    
    // Initialize the HUD
    this.init();
    
    // Set up event listeners for auth events
    EventBus.subscribe('auth:authenticated', this.handleAuthEvent.bind(this));
    EventBus.subscribe('auth:logout:complete', this.handleLogout.bind(this));
    EventBus.subscribe('workspace:saved', this.handleWorkspaceSaved.bind(this));
    EventBus.subscribe('points:updated', this.updateUserPoints);
    
    // Start the mouse activity check interval
    this.mouseActivityInterval = setInterval(this.checkMouseActivity, 1000);
    
    // Start the points refresh interval for authenticated users
    this.pointsRefreshInterval = setInterval(this.updateUserPoints, 60000); // Update points every minute
  }
  
  template() {
    // Format last saved time if available
    const lastSavedText = this.state.lastSaved 
      ? `Last saved: ${new Date(this.state.lastSaved).toLocaleTimeString()}`
      : '';
      
    return `
      <div class="canvas-hud ${this.state.isVisible ? 'visible' : 'hidden'}">
        <div class="hud-content ${this.state.isMouseOver ? 'expanded' : ''}">
          <div class="user-info">
            <span class="username ${this.state.isGuest ? 'guest' : ''}">${this.state.username}</span>
            <span class="points">${this.state.points} points</span>
            ${this.state.isAuthenticated ? `<span class="last-saved">${lastSavedText}</span>` : ''}
          </div>
          <div class="hud-buttons">
            <button class="hud-btn add-tile">Add Tile</button>
            <button class="hud-btn settings">Settings</button>
            ${this.state.isAuthenticated 
              ? `<button class="hud-btn logout">Logout</button>` 
              : `<button class="hud-btn login">Login</button>`}
          </div>
        </div>
      </div>
    `;
  }
  
  init() {
    this.appendToParent();
    
    // Try to import AuthService
    import('../../services/AuthService.js').then(module => {
      this.authService = module.default || module.AuthService;
      // Check authentication status after getting AuthService
      this.checkAuthentication();
    }).catch(err => {
      console.error('Failed to load AuthService:', err);
    });
    
    // Add event listeners
    this.element.addEventListener('mouseenter', this.handleMouseEnter);
    this.element.addEventListener('mouseleave', this.handleMouseLeave);
    document.addEventListener('mousemove', this.handleMouseMove);
    
    // Add button event listeners
    this.addButtonEventListeners();
  }
  
  addButtonEventListeners() {
    const addTileBtn = this.element.querySelector('.add-tile');
    const settingsBtn = this.element.querySelector('.settings');
    const loginBtn = this.element.querySelector('.login');
    const logoutBtn = this.element.querySelector('.logout');
    
    if (addTileBtn) {
      addTileBtn.addEventListener('click', () => {
        // Only allow adding tiles if authenticated
        if (this.state.isAuthenticated) {
          EventBus.publish('tile:add', { x: 100, y: 100 });
        } else {
          EventBus.publish('auth:show-modal', { 
            initialTab: 'login',
            message: 'Please log in to add workflow tiles'
          });
        }
      });
    }
    
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        EventBus.publish('settings:show');
      });
    }
    
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        EventBus.publish('auth:show-modal', { initialTab: 'login' });
      });
    }
    
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (this.authService) {
          this.authService.logout();
        } else {
          EventBus.publish('auth:logout');
        }
      });
    }
  }
  
  checkAuthentication() {
    if (!this.authService) {
      return;
    }
    
    const isAuthenticated = this.authService.isAuthenticated();
    const currentUser = this.authService.getCurrentUser();
    
    if (isAuthenticated && currentUser) {
      this.setState({
        isAuthenticated: true,
        isGuest: currentUser.isGuest || false,
        username: this.formatUsername(currentUser),
        points: currentUser.points || 0
      });
      
      // Immediately fetch latest points
      this.updateUserPoints();
    }
  }
  
  formatUsername(user) {
    if (!user) return 'Guest';
    
    if (user.username) {
      return user.username;
    } else if (user.walletAddress) {
      // Truncate wallet address for display
      return user.walletAddress.substring(0, 6) + '...' + 
        user.walletAddress.substring(user.walletAddress.length - 4);
    } else if (user.isGuest) {
      return 'Guest';
    }
    
    return 'User';
  }
  
  async updateUserPoints() {
    if (!this.state.isAuthenticated || !this.authService) {
      return;
    }
    
    try {
      const response = await fetch('/api/users/points', {
        headers: {
          'Authorization': `Bearer ${this.authService.getToken()}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch user points');
      }
      
      const data = await response.json();
      
      this.setState({ points: data.points || 0 });
    } catch (error) {
      console.error('Error fetching user points:', error);
    }
  }
  
  handleMouseEnter() {
    this.setState({ isMouseOver: true });
  }
  
  handleMouseLeave() {
    this.setState({ isMouseOver: false });
  }
  
  handleMouseMove() {
    this.state.lastMouseMove = Date.now();
    
    // Show the HUD if it's hidden
    if (!this.state.isVisible) {
      this.setState({ isVisible: true });
    }
  }
  
  checkMouseActivity() {
    // If mouse has been inactive for 3 seconds, hide the HUD
    const currentTime = Date.now();
    if (currentTime - this.state.lastMouseMove > 3000 && !this.state.isMouseOver) {
      this.setState({ isVisible: false });
    }
  }
  
  handleAuthEvent(data) {
    this.setState({
      isAuthenticated: true,
      username: this.formatUsername(data.user),
      isGuest: data.method === 'guest',
      points: data.user ? (data.user.points || 0) : 0
    });
    
    // Fetch latest points
    this.updateUserPoints();
  }
  
  handleLogout() {
    this.setState({
      isAuthenticated: false,
      username: 'Guest',
      isGuest: true,
      points: 0,
      lastSaved: null
    });
  }
  
  handleWorkspaceSaved(data) {
    this.setState({ lastSaved: data.timestamp });
  }
  
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
    
    // Re-attach event listeners to buttons after re-rendering
    this.addButtonEventListeners();
  }
  
  destroy() {
    // Clear the intervals when component is destroyed
    clearInterval(this.mouseActivityInterval);
    clearInterval(this.pointsRefreshInterval);
    
    // Remove event listeners
    this.element.removeEventListener('mouseenter', this.handleMouseEnter);
    this.element.removeEventListener('mouseleave', this.handleMouseLeave);
    document.removeEventListener('mousemove', this.handleMouseMove);
    
    // Unsubscribe from events
    EventBus.unsubscribe('auth:authenticated', this.handleAuthEvent);
    EventBus.unsubscribe('auth:logout:complete', this.handleLogout);
    EventBus.unsubscribe('workspace:saved', this.handleWorkspaceSaved);
    EventBus.unsubscribe('points:updated', this.updateUserPoints);
    
    // Remove the element
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
} 