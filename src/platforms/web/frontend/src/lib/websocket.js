/**
 * WebSocket client — singleton, auto-reconnect.
 */

const MAX_RETRIES = 10;
const RETRY_INTERVAL = 5000;

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.retries = 0;
    this.connected = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      this.retries = 0;
      this.emit('open');
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.emit('close');
      if (this.retries < MAX_RETRIES) {
        this.retries++;
        setTimeout(() => this.connect(), RETRY_INTERVAL);
      }
    };

    this.ws.onerror = () => {
      this.connectionFailed = true;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type) {
          this.emit(msg.type, msg.payload || msg);
        }
      } catch (e) {
        // ignore parse errors
      }
    };
  }

  isConnected() {
    return this.connected;
  }

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  off(event, fn) {
    if (!this.listeners[event]) return;
    if (fn) {
      this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    } else {
      delete this.listeners[event];
    }
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach(fn => fn(data));
  }

  send(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }
}

export const websocketClient = new WebSocketClient();
