const crypto = require('crypto');

/**
 * Adds Alchemy webhook context to the request object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Buffer} buf - Raw body buffer
 * @param {string} encoding - Encoding (not used)
 */
function addAlchemyContextToRequest(req, res, buf, encoding) {
  const logger = req.app && req.app.locals && req.app.locals.logger ? req.app.locals.logger : console;
  logger.info('[AlchemyWebhookUtils] addAlchemyContextToRequest called', {
    bufLength: buf ? buf.length : 0,
    encoding
  });
  if (buf && buf.length) {
    req.rawBody = buf;
    logger.info('[AlchemyWebhookUtils] req.rawBody set', { rawBodyLength: buf.length });
  } else {
    logger.warn('[AlchemyWebhookUtils] No buffer provided to addAlchemyContextToRequest');
  }
}

/**
 * Creates middleware to validate Alchemy webhook signatures
 * @param {string} signingKey - Webhook signing key from Alchemy
 * @returns {Function} Express middleware
 */
function validateAlchemySignature(signingKey) {
  return (req, res, next) => {
    const logger = req.app && req.app.locals && req.app.locals.logger ? req.app.locals.logger : console;
    logger.info('[AlchemyWebhookUtils] validateAlchemySignature called', {
      signature: req.header('X-Alchemy-Signature'),
      hasRawBody: !!req.rawBody
    });
    const signature = req.header('X-Alchemy-Signature');
    if (!signature) {
      logger.error('[AlchemyWebhookUtils] Missing signature header');
      return res.status(401).json({ error: 'Missing signature header' });
    }
    if (!req.rawBody) {
      logger.error('[AlchemyWebhookUtils] Missing raw body');
      return res.status(400).json({ error: 'Missing raw body' });
    }
    // Compute expected signature
    const hmac = crypto.createHmac('sha256', signingKey);
    const computedSignature = hmac.update(req.rawBody).digest('hex');
    logger.info('[AlchemyWebhookUtils] Computed signature', { computedSignature });
    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
      logger.error('[AlchemyWebhookUtils] Invalid signature', { signature, computedSignature });
      return res.status(401).json({ error: 'Invalid signature' });
    }
    logger.info('[AlchemyWebhookUtils] Signature validated successfully');
    next();
  };
}

module.exports = {
  addAlchemyContextToRequest,
  validateAlchemySignature
}; 