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
    logger.debug('[WebSocketService] Service instantiated.');
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
      logger.debug({ userId, normalizedUserId: userIdStr }, '[WebSocketService] Connection attempt');
      if (!this.connections.has(userIdStr)) {
        this.connections.set(userIdStr, new Set());
        logger.debug({ userId: userIdStr }, '[WebSocketService] Created connection bucket');
      }
      const userConnections = this.connections.get(userIdStr);
      userConnections.add(ws);
      logger.debug({
        userId: userIdStr,
        connectionsForUser: userConnections.size,
        totalUsers: this.connections.size,
      }, '[WebSocketService] Connection established');

      // Check if this is an admin connection
      const isAdmin = await this._checkAdminStatus(userIdStr, req);
      if (isAdmin) {
        this.adminConnections.add(ws);
        logger.debug(`[WebSocketService] Admin connection registered for user ${userIdStr}`);
      }

      ws.on('close', () => {
        userConnections.delete(ws);
        this.adminConnections.delete(ws);
        logger.debug({ userId: userIdStr, remaining: userConnections.size }, '[WebSocketService] Connection closed');
        if (userConnections.size === 0) {
          this.connections.delete(userIdStr);
          logger.debug({ userId: userIdStr, totalUsers: this.connections.size }, '[WebSocketService] Removed user from connection map');
        }
      });
      
      ws.on('error', (error) => {
        logger.error({ err: error, userId: userIdStr }, '[WebSocketService] WebSocket error');
      });

      ws.on('message', (message) => {
        logger.debug({ userId: userIdStr }, '[WebSocketService] Received message');
      });

      ws.send(JSON.stringify({ type: 'connection_ack', message: 'WebSocket connection established.' }));
    });

    logger.debug('[WebSocketService] Server initialized and attached to HTTP server.');
  }

  sendToUser(userId, data) {
    if (!this.wss) {
      logger.error('[WebSocketService] Cannot send: WebSocket server not initialized.');
      return false;
    }
    const userIdStr = String(userId);
    const allKeys = Array.from(this.connections.keys());
    logger.debug({
      lookupUserId: userIdStr,
      connectionKeys: allKeys,
      totalUsers: this.connections.size,
    }, '[WebSocketService] sendToUser lookup');

    const userConnections = this.connections.get(userIdStr);
    if (userConnections && userConnections.size > 0) {
      logger.debug({ userId: userIdStr, payloadType: data?.type }, '[WebSocketService] Dispatching payload');
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
      logger.debug({
        userId: userIdStr,
        connections: userConnections.size,
        sentCount,
      }, '[WebSocketService] Sent message to user');
      return sentCount > 0;
    } else {
      logger.debug({ userId: userIdStr }, '[WebSocketService] No active connections');
      return false;
    }
  }

  /**
   * Check if there are any active admin connections
   * @returns {boolean} - True if there are active admin connections
   */
  hasAdminConnections() {
    if (!this.wss || this.adminConnections.size === 0) {
      return false;
    }
    // Check if at least one connection is open
    for (const connection of this.adminConnections) {
      if (connection.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  /**
   * Broadcast a message to all admin connections
   * @param {object} data - The data to send
   * @returns {boolean} - True if message was sent to at least one admin
   */
  broadcastToAdmins(data) {
    if (!this.wss) {
      return false;
    }
    if (this.adminConnections.size === 0) {
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
    if (sentCount > 0) {
      logger.debug(`[WebSocketService] Broadcasted admin activity to ${sentCount} admin connection(s).`);
    }
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
        if (process.env.LOG_VERBOSE_WEBSOCKET === '1') {
          logger.warn('[WebSocketService] Auth failed: No cookie header.');
        } else {
          logger.debug('[WebSocketService] Auth failed: No cookie header.');
        }
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
        if (process.env.LOG_VERBOSE_WEBSOCKET === '1') {
          logger.warn('[WebSocketService] Auth failed: No JWT or guestToken in cookie.');
        } else {
          logger.debug('[WebSocketService] Auth failed: No JWT or guestToken in cookie.');
        }
        return null;
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Assuming decoded token has userId which is the masterAccountId
      if (!decoded.userId) {
        if (process.env.LOG_VERBOSE_WEBSOCKET === '1') {
          logger.warn('[WebSocketService] Auth failed: JWT does not contain userId.');
        } else {
          logger.debug('[WebSocketService] Auth failed: JWT does not contain userId.');
        }
        return null;
      }
      
      const authType = decoded.isGuest ? 'guest' : 'user';
      logger.debug(`[WebSocketService] ${authType} authenticated via WebSocket: ${decoded.userId}`);
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
