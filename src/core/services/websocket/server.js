const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { createLogger } = require('../../../utils/logger');
const { MILADY_STATION_NFT_ADDRESS, ADMIN_TOKEN_ID } = require('../alchemy/foundationConfig');

const logger = createLogger('WebSocketService');

class WebSocketService {
  constructor() {
    this.connections = new Map(); // masterAccountId -> Set of ws connections
    this.adminConnections = new Set(); // Set of admin WebSocket connections
    this.wss = null;
    this.ethereumServices = null; // Will be set during initialization
    logger.info('[WebSocketService] Service instantiated.');
  }

  setEthereumServices(ethereumServices) {
    this.ethereumServices = ethereumServices;
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

    this.wss.on('connection', async (ws, req, user) => {
      const { userId } = user; // userId is the masterAccountId
      if (!this.connections.has(userId)) {
        this.connections.set(userId, new Set());
      }
      const userConnections = this.connections.get(userId);
      userConnections.add(ws);
      logger.info(`[WebSocketService] Connection established for user ${userId}. Total: ${userConnections.size}`);

      // Check if this is an admin connection
      const isAdmin = await this._checkAdminStatus(userId, req);
      if (isAdmin) {
        this.adminConnections.add(ws);
        logger.info(`[WebSocketService] Admin connection registered for user ${userId}`);
      }

      ws.on('close', () => {
        userConnections.delete(ws);
        this.adminConnections.delete(ws);
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

  /**
   * Broadcast a message to all admin connections
   * @param {object} data - The data to send
   * @returns {boolean} - True if message was sent to at least one admin
   */
  broadcastToAdmins(data) {
    if (!this.wss) {
      logger.error('[WebSocketService] Cannot broadcast: WebSocket server not initialized.');
      return false;
    }
    if (this.adminConnections.size === 0) {
      logger.debug('[WebSocketService] No admin connections to broadcast to.');
      return false;
    }
    const message = JSON.stringify(data);
    let sentCount = 0;
    this.adminConnections.forEach(connection => {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(message);
        sentCount++;
      }
    });
    logger.info(`[WebSocketService] Broadcasted admin activity to ${sentCount} admin connection(s).`);
    return sentCount > 0;
  }

  /**
   * Check if a user is an admin by verifying NFT ownership
   * @private
   */
  async _checkAdminStatus(userId, req) {
    try {
      // Try to get wallet address from JWT or request
      let walletAddress = null;
      if (req.headers.cookie) {
        const cookies = cookie.parse(req.headers.cookie);
        const token = cookies.jwt;
        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            walletAddress = decoded.walletAddress || decoded.address;
          } catch (err) {
            // Token invalid, continue
          }
        }
      }

      if (!walletAddress || !this.ethereumServices) {
        return false;
      }

      // Check NFT ownership on mainnet (chainId 1)
      const ethereumService = this.ethereumServices['1'] || this.ethereumServices[1];
      if (!ethereumService || typeof ethereumService.read !== 'function') {
        return false;
      }

      const ERC721A_ABI = ['function ownerOf(uint256 tokenId) view returns (address)'];
      const owner = await ethereumService.read(
        MILADY_STATION_NFT_ADDRESS,
        ERC721A_ABI,
        'ownerOf',
        ADMIN_TOKEN_ID
      );

      return owner && owner.toLowerCase() === walletAddress.toLowerCase();
    } catch (error) {
      logger.debug(`[WebSocketService] Error checking admin status for user ${userId}: ${error.message}`);
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