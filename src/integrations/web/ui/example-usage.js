/**
 * Example usage of the LoginModal
 * This demonstrates how to initialize and use the vanilla JS login modal
 */

// Initialize the session API service
const apiService = new SessionApiService({
  baseUrl: '/api/internal' // Change as needed for your environment
});

// Function to handle successful login
function handleLogin(loginData) {
  console.log('User logged in:', loginData);
  
  // Store API key in localStorage for future requests
  if (loginData.apiKey) {
    localStorage.setItem('apiKey', loginData.apiKey);
  }
  
  // Store session info
  if (loginData.session) {
    localStorage.setItem('sessionData', JSON.stringify(loginData.session));
  }
  
  // Show success message
  const messageElement = document.getElementById('login-message');
  if (messageElement) {
    messageElement.textContent = `Logged in successfully as ${loginData.session.userId}`;
    messageElement.style.display = 'block';
  }
  
  // Load user data and workflows
  loadUserData(loginData.apiKey);
}

// Function to handle login cancellation
function handleCancel() {
  console.log('Login cancelled');
  
  // Show message
  const messageElement = document.getElementById('login-message');
  if (messageElement) {
    messageElement.textContent = 'Login cancelled';
    messageElement.style.display = 'block';
  }
}

// Function to load user data using API key
async function loadUserData(apiKey) {
  try {
    // Get session data
    const sessionData = await apiService.getSession(apiKey);
    
    if (sessionData.success) {
      // Update UI with user data
      const userInfoElement = document.getElementById('user-info');
      if (userInfoElement) {
        userInfoElement.innerHTML = `
          <h3>User Information</h3>
          <p>User ID: ${sessionData.session.userId}</p>
          <p>Points: ${sessionData.session.points}</p>
          <p>Verified: ${sessionData.session.verified ? 'Yes' : 'No'}</p>
          <p>Client Type: ${sessionData.session.clientType}</p>
        `;
        userInfoElement.style.display = 'block';
      }
    }
  } catch (error) {
    console.error('Error loading user data:', error);
  }
}

// Check if user is already logged in on page load
document.addEventListener('DOMContentLoaded', () => {
  const apiKey = localStorage.getItem('apiKey');
  
  if (apiKey) {
    // User is already logged in, load their data
    loadUserData(apiKey);
  } else {
    // User is not logged in, show login button
    const loginButton = document.getElementById('login-button');
    if (loginButton) {
      loginButton.style.display = 'block';
      
      // Add click handler to show login modal
      loginButton.addEventListener('click', () => {
        showLoginModal({
          apiService,
          onLogin: handleLogin,
          onCancel: handleCancel
        });
      });
    }
  }
  
  // Add logout button handler
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      const apiKey = localStorage.getItem('apiKey');
      
      if (apiKey) {
        try {
          // End session on server
          await apiService.endSession(apiKey);
          
          // Clear local storage
          localStorage.removeItem('apiKey');
          localStorage.removeItem('sessionData');
          
          // Update UI
          const userInfoElement = document.getElementById('user-info');
          if (userInfoElement) {
            userInfoElement.style.display = 'none';
          }
          
          const loginButton = document.getElementById('login-button');
          if (loginButton) {
            loginButton.style.display = 'block';
          }
          
          const messageElement = document.getElementById('login-message');
          if (messageElement) {
            messageElement.textContent = 'Logged out successfully';
            messageElement.style.display = 'block';
          }
        } catch (error) {
          console.error('Error logging out:', error);
        }
      }
    });
  }
});

/**
 * Example HTML structure:
 * 
 * <div id="app">
 *   <h1>StationThis Web Application</h1>
 *   
 *   <div id="login-message" style="display: none;"></div>
 *   
 *   <button id="login-button" style="display: none;">Log In</button>
 *   
 *   <div id="user-info" style="display: none;"></div>
 *   
 *   <button id="logout-button">Log Out</button>
 * </div>
 */ 