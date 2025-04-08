const { createSessionAdapter } = require('../adapters/sessionAdapter');
const { createSessionManager } = require('../services/sessionManager');
const crypto = require('crypto');

/**
 * Example WebhookHandler class that uses SessionAdapter to track
 * webhook deliveries and handle user session updates from external services
 */
class WebhookHandler {
  constructor(options) {
    this.sessionAdapter = options.sessionAdapter;
    this.webhookSecret = options.webhookSecret || process.env.WEBHOOK_SECRET;
    this.handlers = new Map();
    
    // Register default handlers
    this.registerHandler('payment_succeeded', this.handlePaymentSucceeded.bind(this));
    this.registerHandler('subscription_updated', this.handleSubscriptionUpdated.bind(this));
    this.registerHandler('user_data_updated', this.handleUserDataUpdated.bind(this));
  }

  registerHandler(eventType, handlerFn) {
    this.handlers.set(eventType, handlerFn);
  }

  /**
   * Validate webhook signature to ensure the request is authentic
   */
  validateSignature(payload, signature) {
    if (!this.webhookSecret) {
      console.warn('Webhook secret not configured, skipping signature validation');
      return true;
    }

    const computedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
      
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature)
    );
  }

  /**
   * Process incoming webhook request
   */
  async processWebhook(body, headers) {
    try {
      // Validate webhook signature
      const signature = headers['x-webhook-signature'];
      if (!this.validateSignature(body, signature)) {
        console.error('Invalid webhook signature');
        return { 
          success: false, 
          statusCode: 401, 
          message: 'Invalid signature' 
        };
      }

      // Extract webhook data
      const { event_type, user_id, data, timestamp } = body;
      
      if (!event_type || !user_id) {
        return { 
          success: false, 
          statusCode: 400, 
          message: 'Missing required fields' 
        };
      }

      // Track webhook delivery in session
      await this.sessionAdapter.updateUserActivity(user_id, {
        action: 'webhook_received',
        event_type,
        timestamp: new Date(timestamp || Date.now())
      });

      // Find appropriate handler
      const handler = this.handlers.get(event_type);
      if (!handler) {
        console.warn(`No handler registered for event type: ${event_type}`);
        return { 
          success: true, 
          statusCode: 202, 
          message: 'Webhook received but no handler found' 
        };
      }

      // Execute handler with session context
      const userSession = await this.sessionAdapter.getUserSessionData(user_id);
      if (!userSession) {
        console.warn(`User session not found for user ID: ${user_id}`);
      }

      const result = await handler(userSession, data);
      
      return { 
        success: true,
        statusCode: 200,
        message: 'Webhook processed successfully',
        result
      };
    } catch (error) {
      console.error('Error processing webhook:', error);
      return { 
        success: false, 
        statusCode: 500, 
        message: 'Internal server error' 
      };
    }
  }

  /**
   * Handler for payment_succeeded events
   */
  async handlePaymentSucceeded(userSession, data) {
    if (!userSession) {
      // Create new session if user doesn't exist yet
      await this.sessionAdapter.createUserSession(data.user_id, {
        paymentHistory: [data]
      });
      return { action: 'created_new_user' };
    }

    // Update existing session with payment information
    const updates = {
      hasPaid: true,
      lastPaymentDate: new Date(),
      paymentAmount: data.amount,
      paymentHistory: [...(userSession.paymentHistory || []), data]
    };

    await this.sessionAdapter.updateUserSession(userSession.userId, updates);
    return { action: 'updated_payment_status' };
  }

  /**
   * Handler for subscription_updated events
   */
  async handleSubscriptionUpdated(userSession, data) {
    if (!userSession) {
      console.warn(`Cannot update subscription for non-existent user: ${data.user_id}`);
      return { action: 'skipped' };
    }

    const updates = {
      subscriptionStatus: data.status,
      subscriptionTier: data.tier,
      subscriptionExpiresAt: new Date(data.expires_at),
      subscriptionUpdatedAt: new Date()
    };

    await this.sessionAdapter.updateUserSession(userSession.userId, updates);
    return { action: 'updated_subscription' };
  }

  /**
   * Handler for user_data_updated events
   */
  async handleUserDataUpdated(userSession, data) {
    if (!userSession) {
      console.warn(`Cannot update data for non-existent user: ${data.user_id}`);
      return { action: 'skipped' };
    }

    // Only update fields that are present in the data object
    const updates = {};
    if (data.email) updates.email = data.email;
    if (data.name) updates.name = data.name;
    if (data.preferences) updates.preferences = data.preferences;
    
    if (Object.keys(updates).length === 0) {
      return { action: 'no_changes' };
    }

    await this.sessionAdapter.updateUserSession(userSession.userId, updates);
    return { action: 'updated_user_data' };
  }
}

/**
 * Example demonstrating how to use the WebhookHandler with SessionAdapter
 */
async function runWebhookHandlerExample() {
  try {
    // Initialize core services
    const sessionManager = createSessionManager({
      databaseUrl: process.env.DATABASE_URL
    });

    // Create the session adapter
    const sessionAdapter = createSessionAdapter({
      sessionManager
    });

    // Create webhook handler
    const webhookHandler = new WebhookHandler({
      sessionAdapter,
      webhookSecret: 'your_webhook_secret_key'
    });

    // Register a custom webhook handler
    webhookHandler.registerHandler('account_verified', async (userSession, data) => {
      if (!userSession) return { action: 'skipped' };
      
      await sessionAdapter.updateUserSession(userSession.userId, {
        verified: true,
        verifiedAt: new Date(),
        verificationMethod: data.method
      });
      
      return { action: 'marked_account_verified' };
    });

    // Simulate incoming webhooks
    console.log('\nProcessing payment_succeeded webhook:');
    const paymentWebhook = {
      event_type: 'payment_succeeded',
      user_id: '123456789',
      data: {
        payment_id: 'pay_123456',
        amount: 19.99,
        currency: 'USD',
        status: 'succeeded'
      },
      timestamp: new Date().toISOString()
    };
    
    const paymentResult = await webhookHandler.processWebhook(
      paymentWebhook,
      { 'x-webhook-signature': 'simulated_signature' }
    );
    console.log(paymentResult);
    
    console.log('\nProcessing subscription_updated webhook:');
    const subscriptionWebhook = {
      event_type: 'subscription_updated',
      user_id: '123456789',
      data: {
        status: 'active',
        tier: 'premium',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      timestamp: new Date().toISOString()
    };
    
    const subscriptionResult = await webhookHandler.processWebhook(
      subscriptionWebhook,
      { 'x-webhook-signature': 'simulated_signature' }
    );
    console.log(subscriptionResult);

  } catch (error) {
    console.error('Error in webhook handler example:', error);
  }
}

module.exports = { 
  runWebhookHandlerExample,
  WebhookHandler 
}; 