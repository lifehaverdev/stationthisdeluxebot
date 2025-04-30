import { Component } from '../../../../../web/dom/Component.js';
import { eventBus } from '../../../../../web/dom/EventBus.js';

export class NavbarComponent extends Component {
    constructor(element) {
        super(element);
        
        // Initialize state
        this.state = {
            isAuthenticated: false,
            onLogout: null // Callback prop
        };
    }
    
    render() {
        const { isAuthenticated } = this.state;
        
        return `
            <nav class="navbar">
                <div class="navbar-brand">
                    <a href="/" class="logo">StationThis</a>
                </div>
                <div class="navbar-menu">
                    ${isAuthenticated ? `
                        <a href="/collections" class="nav-link">My Collections</a>
                        <a href="/shared" class="nav-link">Shared</a>
                        <button id="logout-button" class="nav-link btn-link">Logout</button>
                    ` : `
                        <a href="/login" class="nav-link">Login</a>
                    `}
                </div>
            </nav>
        `;
    }
    
    events() {
        return {
            'click #logout-button': this.handleLogout
        };
    }
    
    handleLogout(e) {
        e.preventDefault();
        
        const { onLogout } = this.state;
        
        // Call onLogout callback if provided
        if (onLogout && typeof onLogout === 'function') {
            onLogout();
        }
    }
    
    /**
     * Apply component-specific styles
     */
    static get styles() {
        return `
            .navbar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem 2rem;
                background-color: #1a1a1a;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            
            .navbar-brand {
                font-size: 1.5rem;
                font-weight: bold;
            }
            
            .logo {
                color: #90caf9;
                text-decoration: none;
            }
            
            .navbar-menu {
                display: flex;
                gap: 1.5rem;
            }
            
            .nav-link {
                color: #e0e0e0;
                text-decoration: none;
                padding: 0.5rem 0;
                transition: color 0.2s;
            }
            
            .nav-link:hover {
                color: #90caf9;
            }
            
            .btn-link {
                background: none;
                border: none;
                cursor: pointer;
                font-size: 1rem;
                padding: 0;
            }
        `;
    }
} 