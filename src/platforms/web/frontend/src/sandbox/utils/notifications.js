// Simple notification system for workspace operations

/**
 * Show a notification to the user
 * @param {string} message - The message to display
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (0 = no auto-close)
 */
export function showNotification(message, type = 'info', duration = 5000) {
  const notification = document.createElement('div');
  notification.className = `sandbox-notification sandbox-notification-${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: #fff;
    background: ${type === 'error' ? '#d32f2f' : type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : '#2196f3'};
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 400px;
    word-wrap: break-word;
    font-size: 17px;
    line-height: 1.5;
    opacity: 0;
    transform: translateX(100%);
    transition: opacity 0.3s, transform 0.3s;
  `;
  
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Animate in
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(0)';
  });
  
  // Auto-remove if duration specified
  if (duration > 0) {
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, duration);
  }
  
  return notification;
}

/**
 * Show a loading indicator
 * @param {string} message - Loading message
 * @returns {Function} - Function to call when done (with optional success/error message)
 */
export function showLoading(message = 'Loading...') {
  const loading = document.createElement('div');
  loading.className = 'sandbox-loading';
  loading.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    background: rgba(0,0,0,0.8);
    color: #fff;
    z-index: 10001;
    font-size: 17px;
    display: flex;
    align-items: center;
    gap: 10px;
  `;
  
  const spinner = document.createElement('div');
  spinner.style.cssText = `
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  `;
  
  const text = document.createElement('span');
  text.textContent = message;
  
  loading.appendChild(spinner);
  loading.appendChild(text);
  
  // Add spinner animation if not already in stylesheet
  if (!document.getElementById('sandbox-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'sandbox-spinner-style';
    style.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(loading);
  
  return (finalMessage = null, finalType = 'success') => {
    loading.remove();
    if (finalMessage) {
      showNotification(finalMessage, finalType);
    }
  };
}

