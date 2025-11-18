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
      // Normalize userId to string for consistent storage/lookup
      const userIdStr = String(userId);
      logger.info(`[WebSocketService] DEBUG connection - userId from JWT: "${userId}" (type: ${typeof userId}), normalized: "${userIdStr}"`);
      if (!this.connections.has(userIdStr)) {
        this.connections.set(userIdStr, new Set());
        logger.info(`[WebSocketService] DEBUG connection - Created new Set for user ${userIdStr}`);
      }
      const userConnections = this.connections.get(userIdStr);
      userConnections.add(ws);
      logger.info(`[WebSocketService] Connection established for user ${userIdStr}. Total connections for this user: ${userConnections.size}, Total users: ${this.connections.size}`);

      // Check if this is an admin connection
      const isAdmin = await this._checkAdminStatus(userIdStr, req);
      if (isAdmin) {
        this.adminConnections.add(ws);
        logger.info(`[WebSocketService] Admin connection registered for user ${userIdStr}`);
      }

      ws.on('close', () => {
        userConnections.delete(ws);
        this.adminConnections.delete(ws);
        logger.info(`[WebSocketService] Connection closed for user ${userIdStr}. Remaining: ${userConnections.size}`);
        if (userConnections.size === 0) {
          this.connections.delete(userIdStr);
          logger.info(`[WebSocketService] All connections for user ${userIdStr} removed. Total users remaining: ${this.connections.size}`);
        }
      });
      
      ws.on('error', (error) => {
        logger.error(`[WebSocketService] WebSocket error for user ${userIdStr}:`, error);
      });

      ws.on('message', (message) => {
        logger.info(`[WebSocketService] Received message from ${userIdStr}: ${message}`);
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
    const userIdStr = String(userId);
    // Debug: Log all connection keys to help diagnose lookup issues
    const allKeys = Array.from(this.connections.keys());
    logger.info(`[WebSocketService] DEBUG sendToUser - Looking up userId: "${userIdStr}" (type: ${typeof userIdStr})`);
    logger.info(`[WebSocketService] DEBUG sendToUser - All connection keys: [${allKeys.map(k => `"${k}"`).join(', ')}]`);
    logger.info(`[WebSocketService] DEBUG sendToUser - Total users with connections: ${this.connections.size}`);
    
    const userConnections = this.connections.get(userIdStr);
    if (userConnections && userConnections.size > 0) {
      logger.info('[WebSocketService] DEBUG sendToUser payload', data);
      logger.info(`[WebSocketService] Sending data to user ${userIdStr}. Connections: ${userConnections.size}`);
      const message = JSON.stringify(data);
      let sentCount = 0;
      userConnections.forEach(connection => {
        if (connection.readyState === WebSocket.OPEN) {
          connection.send(message);
          sentCount++;
        } else {
          logger.warn(`[WebSocketService] Connection not OPEN (state: ${connection.readyState})`);
        }
      });
      logger.info(`[WebSocketService] Sent message to ${sentCount} of ${userConnections.size} connections`);
      return sentCount > 0;
    } else {
      logger.warn(`[WebSocketService] No active connections for user ${userIdStr}.`);
      logger.warn(`[WebSocketService] DEBUG - Connection map has ${this.connections.size} users, keys: [${allKeys.join(', ')}]`);
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
      
      // Check for regular JWT token first
      let token = cookies.jwt;
      
      // Fallback to guest token if regular JWT not found
      if (!token) {
        token = cookies.guestToken;
      }
      
      if (!token) {
        logger.warn('[WebSocketService] Auth failed: No JWT or guestToken in cookie.');
        return null;
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Assuming decoded token has userId which is the masterAccountId
      if (!decoded.userId) {
        logger.warn('[WebSocketService] Auth failed: JWT does not contain userId.');
        return null;
      }
      
      const authType = decoded.isGuest ? 'guest' : 'user';
      logger.info(`[WebSocketService] ${authType} authenticated via WebSocket: ${decoded.userId}`);
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