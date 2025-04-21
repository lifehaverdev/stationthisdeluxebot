/**
 * Session Agent
 * 
 * Handles platform-specific session initialization and management.
 * Provides specialized workflows for web and Telegram users.
 */

const crypto = require('crypto');
const { SessionService } = require('./service');
const { ClientType } = require('./models');
const { AppError } = require('../shared/errors/AppError');
const { Logger } = require('../../utils/logger');

/**
 * Generate a secure API key
 * @returns {string} - Generated API key
 */
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sign a nonce with the server's private key
 * @param {string} nonce - Nonce to sign
 * @param {string} walletAddress - Wallet address
 * @returns {string} - Signed nonce
 */
function signNonce(nonce, walletAddress) {
  // Implementation would use proper crypto signing
  // This is a placeholder
  const hmac = crypto.createHmac('sha256', process.env.WALLET_SECRET || 'dev-secret');
  hmac.update(`${nonce}:${walletAddress}`);
  return hmac.digest('hex');
}

/**
 * Validate a wallet signature
 * @param {string} signature - Signature to validate
 * @param {string} nonce - Original nonce
 * @param {string} walletAddress - Wallet address
 * @returns {boolean} - Whether signature is valid
 */
function validateWalletSignature(signature, nonce, walletAddress) {
  // Implementation would verify the signature cryptographically
  // This is a placeholder that should be replaced with proper validation
  return true;
}

/**
 * Session Agent
 * Manages session initialization and platform-specific flows
 */
class SessionAgent {
  /**
   * Create a new session agent
   * @param {Object} options - Agent options
   * @param {SessionService} options.sessionService - Session service
   * @param {Object} options.logger - Logger instance
   */
  constructor(options = {}) {
    this.sessionService = options.sessionService || new SessionService();
    this.logger = options.logger || new Logger({
      level: process.env.LOG_LEVEL || 'info',
      name: 'session-agent'
    });
  }

  /**
   * Initialize a web session
   * @param {Object} options - Session options
   * @param {string} options.apiKey - API key for authentication (optional)
   * @param {string} options.walletAddress - User's wallet address (optional)
   * @param {string} options.walletSignature - Signature from wallet (optional)
   * @param {string} options.nonce - Nonce used for wallet signing (optional)
   * @param {boolean} options.isGuest - Whether this is a guest session
   * @returns {Promise<Object>} - Session information including API key
   */
  async initializeWebSession(options = {}) {
    try {
      let userId = null;
      let session = null;
      let apiKey = options.apiKey;
      
      this.logger.info('Initializing web session', { 
        hasApiKey: !!apiKey,
        hasWallet: !!options.walletAddress,
        isGuest: !!options.isGuest
      });

      // Case 1: User provides an API key
      if (apiKey) {
        session = await this.sessionService.getSessionByApiKey(apiKey);
        
        if (!session) {
          throw new AppError('Invalid API key', {
            code: 'INVALID_API_KEY',
            userFacing: true
          });
        }
        
        userId = session.userId;
        this.logger.info('Session retrieved via API key', { userId });
      }
      // Case 2: User connects wallet
      else if (options.walletAddress && options.walletSignature && options.nonce) {
        // Validate wallet signature
        const isValid = validateWalletSignature(
          options.walletSignature,
          options.nonce,
          options.walletAddress
        );
        
        if (!isValid) {
          throw new AppError('Invalid wallet signature', {
            code: 'INVALID_WALLET_SIGNATURE',
            userFacing: true
          });
        }
        
        // Use wallet address as userId
        userId = `wallet_${options.walletAddress}`;
        
        // Check if user already has a session
        session = await this.sessionService.getSessionByUserId(userId);
        
        if (!session) {
          // Generate API key for new user
          apiKey = generateApiKey();
          
          // Create session with wallet info
          const result = await this.sessionService.createWebSession(userId, {
            walletAddress: options.walletAddress,
            verified: true
          });
          
          session = result.session;
          apiKey = result.apiKey;
          
          this.logger.info('Created new session for wallet user', { userId });
        } else {
          // Update existing session
          apiKey = session.state.apiKey || generateApiKey();
          
          // Add web client connection
          const clientId = `web_${Date.now()}`;
          await this.sessionService.addClientConnection(
            userId,
            clientId,
            ClientType.WEB,
            { walletAddress: options.walletAddress }
          );
          
          // Set as active client
          await this.sessionService.setActiveClient(userId, clientId);
          
          this.logger.info('Updated session for existing wallet user', { userId });
        }
      }
      // Case 3: Create guest/anonymous session
      else if (options.isGuest) {
        // Generate anonymous user ID
        userId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        
        // Generate API key
        apiKey = generateApiKey();
        
        // Create session
        const result = await this.sessionService.createWebSession(userId, {
          isGuest: true,
          verified: false
        });
        
        session = result.session;
        apiKey = result.apiKey;
        
        this.logger.info('Created guest session', { userId });
      }
      // Case 4: Invalid initialization
      else {
        throw new AppError('Invalid session initialization parameters', {
          code: 'INVALID_SESSION_PARAMS',
          userFacing: true
        });
      }
      
      // At this point we should have a valid session and userId
      if (!session || !userId) {
        throw new AppError('Failed to initialize session', {
          code: 'SESSION_INIT_FAILED',
          userFacing: true
        });
      }
      
      // Add additional metadata about the session
      const sessionData = {
        userId,
        apiKey,
        clientType: ClientType.WEB,
        isGuest: !!options.isGuest,
        hasWallet: !!options.walletAddress,
        points: session.state.points || 0,
        verified: session.state.verified || false
      };
      
      return {
        success: true,
        session: sessionData
      };
    } catch (error) {
      this.logger.error('Web session initialization error', { error });
      
      return {
        success: false,
        error: error.message,
        code: error.code || 'SESSION_ERROR'
      };
    }
  }

  /**
   * Initialize a Telegram session
   * @param {Object} message - Telegram message object
   * @returns {Promise<Object>} - Session information
   */
  async initializeTelegramSession(message) {
    try {
      if (!message || !message.from || !message.from.id) {
        throw new AppError('Invalid Telegram message', {
          code: 'INVALID_MESSAGE',
          userFacing: false
        });
      }
      
      const userId = message.from.id.toString();
      const chatId = message.chat.id.toString();
      const threadId = message.thread_id;
      
      this.logger.info('Initializing Telegram session', { 
        userId,
        chatId,
        threadId: threadId || 'none'
      });
      
      // Check for existing session
      let session = await this.sessionService.getSessionByUserId(userId);
      
      if (!session) {
        // No session exists, create one using lobby data if available
        try {
          // Try to create from legacy lobby first
          session = await this.sessionService.createFromLobby(userId, {
            stationed: { [chatId]: true },
          });
          
          this.logger.info('Created session from lobby data', { userId });
        } catch (error) {
          // If lobby doesn't exist or other error, create a new session
          session = await this.sessionService.createSession(userId, {
            stationedIn: { [chatId]: true }
          });
          
          this.logger.info('Created new Telegram session', { userId });
        }
      }
      
      // Ensure the Telegram-specific client connection exists
      const clientId = `telegram_${chatId}`;
      await this.sessionService.addClientConnection(
        userId,
        clientId,
        ClientType.TELEGRAM,
        {
          chatId,
          threadId: threadId || null,
          username: message.from.username,
          firstName: message.from.first_name,
          lastName: message.from.last_name
        }
      );
      
      // Set as active client
      await this.sessionService.setActiveClient(userId, clientId);
      
      // Return session info
      return {
        success: true,
        session: {
          userId,
          clientType: ClientType.TELEGRAM,
          chatId,
          threadId: threadId || null,
          points: session.state.points || 0,
          hasActiveWorkflow: !!session.state.activeWorkflowId
        }
      };
    } catch (error) {
      this.logger.error('Telegram session initialization error', { error });
      
      return {
        success: false,
        error: error.message,
        code: error.code || 'SESSION_ERROR'
      };
    }
  }

  /**
   * Route Telegram input to appropriate handler
   * @param {Object} message - Telegram message
   * @param {Object} options - Routing options
   * @param {Object} options.commandRegistry - Command registry
   * @param {Object} options.workflowManager - Workflow manager
   * @returns {Promise<Object>} - Routing result
   */
  async routeTelegramInput(message, options = {}) {
    const { commandRegistry, workflowManager } = options;
    
    if (!commandRegistry || !workflowManager) {
      throw new AppError('Command registry and workflow manager required', {
        code: 'MISSING_DEPENDENCIES',
        userFacing: false
      });
    }
    
    try {
      // Initialize session first
      const sessionResult = await this.initializeTelegramSession(message);
      
      if (!sessionResult.success) {
        throw new AppError('Failed to initialize session', {
          code: sessionResult.code,
          cause: new Error(sessionResult.error)
        });
      }
      
      const session = sessionResult.session;
      const userId = session.userId;
      
      // Check if there's an active workflow
      const fullSession = await this.sessionService.getSessionByUserId(userId);
      const activeWorkflowId = fullSession.state.activeWorkflowId;
      
      if (activeWorkflowId) {
        // Continue workflow with this input
        this.logger.info('Continuing active workflow', { 
          userId, 
          workflowId: activeWorkflowId
        });
        
        return {
          type: 'workflow',
          workflowId: activeWorkflowId,
          sessionInfo: session,
          input: message.text
        };
      }
      
      // Check if input is a command
      const text = message.text || '';
      if (text.startsWith('/')) {
        const commandName = text.split(' ')[0].substring(1).split('@')[0];
        const command = commandRegistry.get(commandName);
        
        if (command) {
          this.logger.info('Routing to command', { userId, command: commandName });
          
          return {
            type: 'command',
            commandName,
            sessionInfo: session,
            message
          };
        }
      }
      
      // Default to help menu or prompt for command
      return {
        type: 'default',
        sessionInfo: session,
        message
      };
    } catch (error) {
      this.logger.error('Error routing Telegram input', { error });
      
      return {
        type: 'error',
        error: error.message,
        code: error.code || 'ROUTING_ERROR'
      };
    }
  }
}

module.exports = {
  SessionAgent,
  generateApiKey,
  signNonce,
  validateWalletSignature
}; 