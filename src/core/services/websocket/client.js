// src/platforms/web/client/src/services/websocketService.js

const eventListeners = new Map();

let socket = null;
let reconnectInterval = 5000; // 5 seconds
let maxReconnectAttempts = 10;
let reconnectAttempts = 0;

function connect() {
  // Ensure we are in a browser environment
  if (typeof window === 'undefined') return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[WebSocket] Connection established.');
    reconnectAttempts = 0; // Reset attempts on successful connection
    emit('open', {});
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('[WebSocket] Received message:', message);
      // Emit a generic 'message' event and a type-specific event
      emit('message', message);
      if (message.type) {
        emit(message.type, message.payload);
      }
    } catch (error) {
      console.error('[WebSocket] Error parsing message:', error);
    }
  };

  socket.onclose = () => {
    console.log('[WebSocket] Connection closed.');
    emit('close', {});
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting in ${reconnectInterval / 1000}s... (Attempt ${reconnectAttempts})`);
      setTimeout(connect, reconnectInterval);
    } else {
      console.error('[WebSocket] Max reconnect attempts reached.');
    }
  };

  socket.onerror = (error) => {
    console.error('[WebSocket] Error:', error);
    // The onclose event will be fired next, which will handle the reconnect logic.
  };
}

function on(eventName, callback) {
  if (!eventListeners.has(eventName)) {
    eventListeners.set(eventName, []);
  }
  eventListeners.get(eventName).push(callback);
}

function off(eventName, callback) {
  if (eventListeners.has(eventName)) {
    const listeners = eventListeners.get(eventName).filter(cb => cb !== callback);
    eventListeners.set(eventName, listeners);
  }
}

function emit(eventName, data) {
  if (eventListeners.has(eventName)) {
    eventListeners.get(eventName).forEach(callback => callback(data));
  }
}

function sendMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    console.error('[WebSocket] Cannot send message: Connection is not open.');
  }
}

// Automatically connect when the service is loaded
connect();

export const websocketClient = {
  connect,
  on,
  off,
  sendMessage,
}; 