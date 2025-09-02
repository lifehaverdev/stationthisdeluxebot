const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('WebSocketService');

class WebSocketService {
  constructor() {
    this.connections = new Map(); // masterAccountId -> Set of ws connections
    this.wss = null;
    logger.info('[WebSocketService] Service instantiated.');
  }

  initialize(httpServer) {
    if (this.wss) {
      logger.warn('[WebSocketService] WebSocket server already initialized.');
      return;
    }

    this.wss = new WebSocket.Server({ noServer: true, path: '/ws' });

    httpServer.on('upgrade', (req, socket, head) => {
      const user = this._authenticate(req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        logger.warn('[WebSocketService] Unauthorized connection attempt destroyed.');
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req, user);
      });
    });

    this.wss.on('connection', (ws, req, user) => {
      const { userId } = user; // userId is the masterAccountId
      if (!this.connections.has(userId)) {
        this.connections.set(userId, new Set());
      }
      const userConnections = this.connections.get(userId);
      userConnections.add(ws);
      logger.info(`[WebSocketService] Connection established for user ${userId}. Total: ${userConnections.size}`);

      ws.on('close', () => {
        userConnections.delete(ws);
        logger.info(`[WebSocketService] Connection closed for user ${userId}. Remaining: ${userConnections.size}`);
        if (userConnections.size === 0) {
          this.connections.delete(userId);
          logger.info(`[WebSocketService] All connections for user ${userId} removed.`);
        }
      });

      ws.on('message', (message) => {
        logger.info(`[WebSocketService] Received message from ${userId}: ${message}`);
      });

      ws.send(JSON.stringify({ type: 'connection_ack', message: 'WebSocket connection established.' }));
    });

    logger.info('[WebSocketService] Server initialized and attached to HTTP server.');
  }

  sendToUser(userId, data) {
    if (!this.wss) {
      logger.error('[WebSocketService] Cannot send: WebSocket server not initialized.');
      return false;
    }
    const userConnections = this.connections.get(String(userId));
    if (userConnections && userConnections.size > 0) {
      logger.info('[WebSocketService] DEBUG sendToUser payload', data);
      logger.info(`[WebSocketService] Sending data to user ${userId}. Connections: ${userConnections.size}`);
      const message = JSON.stringify(data);
      userConnections.forEach(connection => {
        if (connection.readyState === WebSocket.OPEN) {
          connection.send(message);
        }
      });
      return true;
    } else {
      logger.warn(`[WebSocketService] No active connections for user ${userId}.`);
      return false;
    }
  }

  _authenticate(req) {
    try {
      if (!req.headers.cookie) {
        logger.warn('[WebSocketService] Auth failed: No cookie header.');
        return null;
      }
      const cookies = cookie.parse(req.headers.cookie);
      const token = cookies.jwt;
      if (!token) {
        logger.warn('[WebSocketService] Auth failed: No JWT in cookie.');
        return null;
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Assuming decoded token has userId which is the masterAccountId
      if (!decoded.userId) {
        logger.warn('[WebSocketService] Auth failed: JWT does not contain userId.');
        return null;
      }
      logger.info(`[WebSocketService] User authenticated via WebSocket: ${decoded.userId}`);
      return decoded;
    } catch (err) {
      logger.error(`[WebSocketService] Authentication error: ${err.message}`);
      return null;
    }
  }
}

// Export a singleton instance
const instance = new WebSocketService();
module.exports = instance; 