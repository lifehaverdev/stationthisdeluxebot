import { Component } from '../../../../../web/dom/Component.js';
import { appStore, storeActions } from '../../stores/AppStore.js';

export class LoginComponent extends Component {
    constructor(element) {
        super(element);
        
        // Initialize state
        this.state = {
            email: '',
            password: '',
            isLoading: false,
            error: null,
            onLogin: null // Callback prop
        };
    }
    
    render() {
        // Extract state
        const { isLoading, error } = this.state;
        
        return `
            <div class="login-container">
                <div class="login-card">
                    <h2>Login to StationThis</h2>
                    ${error ? `<div class="error-message">${error}</div>` : ''}
                    <form id="login-form">
                        <div class="form-group">
                            <label for="email">Email</label>
                            <input 
                                type="email" 
                                id="email" 
                                name="email" 
                                placeholder="Enter your email"
                                required
                            />
                        </div>
                        <div class="form-group">
                            <label for="password">Password</label>
                            <input 
                                type="password" 
                                id="password" 
                                name="password" 
                                placeholder="Enter your password"
                                required
                            />
                        </div>
                        <button 
                            type="submit" 
                            class="btn-primary" 
                            id="login-button"
                            ${isLoading ? 'disabled' : ''}
                        >
                            ${isLoading ? 'Logging in...' : 'Login'}
                        </button>
                    </form>
                </div>
            </div>
        `;
    }
    
    events() {
        return {
            'submit #login-form': this.handleSubmit,
            'input #email': this.handleEmailChange,
            'input #password': this.handlePasswordChange
        };
    }
    
    handleEmailChange(e) {
        this.setState({ email: e.target.value });
    }
    
    handlePasswordChange(e) {
        this.setState({ password: e.target.value });
    }
    
    async handleSubmit(e) {
        e.preventDefault();
        
        const { email, password, onLogin } = this.state;
        
        // Validate inputs
        if (!email || !password) {
            this.setState({ error: 'Please enter both email and password' });
            return;
        }
        
        // Set loading state
        this.setState({ isLoading: true, error: null });
        storeActions.setLoading(true);
        
        try {
            // Call API
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Login failed');
            }
            
            const data = await response.json();
            
            // Store token
            const token = data.token;
            storeActions.login(token);
            
            // Call onLogin callback if provided
            if (onLogin && typeof onLogin === 'function') {
                onLogin(token);
            }
        } catch (error) {
            console.error('Login error:', error);
            this.setState({ error: error.message || 'Authentication failed' });
            storeActions.setError(error.message);
        } finally {
            this.setState({ isLoading: false });
            storeActions.setLoading(false);
        }
    }
    
    /**
     * Apply component-specific styles
     */
    static get styles() {
        return `
            .login-container {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 80vh;
            }
            
            .login-card {
                background-color: #1e1e1e;
                border-radius: 8px;
                padding: 2rem;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                width: 100%;
                max-width: 400px;
            }
            
            .form-group {
                margin-bottom: 1.5rem;
            }
            
            label {
                display: block;
                margin-bottom: 0.5rem;
                color: #e0e0e0;
            }
            
            input {
                width: 100%;
                padding: 0.75rem;
                border-radius: 4px;
                border: 1px solid #333;
                background-color: #2a2a2a;
                color: #fff;
                font-size: 1rem;
            }
            
            .btn-primary {
                background-color: #90caf9;
                color: #121212;
                border: none;
                border-radius: 4px;
                padding: 0.75rem 1.5rem;
                font-size: 1rem;
                cursor: pointer;
                width: 100%;
                font-weight: bold;
            }
            
            .btn-primary:disabled {
                background-color: #5c7b9a;
                cursor: not-allowed;
            }
            
            .error-message {
                background-color: rgba(244, 67, 54, 0.1);
                color: #f44336;
                padding: 0.75rem;
                border-radius: 4px;
                margin-bottom: 1.5rem;
                border-left: 4px solid #f44336;
            }
        `;
    }
} 