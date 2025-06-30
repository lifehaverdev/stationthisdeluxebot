const crypto = require('crypto');

/**
 * Adds Alchemy webhook context to the request object
 * @param {Buffer} rawBody - Raw request body buffer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Buffer} buf - Raw body buffer
 */
function addAlchemyContextToRequest(rawBody, req, res, buf) {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}

/**
 * Creates middleware to validate Alchemy webhook signatures
 * @param {string} signingKey - Webhook signing key from Alchemy
 * @returns {Function} Express middleware
 */
function validateAlchemySignature(signingKey) {
  return (req, res, next) => {
    const signature = req.header('X-Alchemy-Signature');
    if (!signature) {
      return res.status(401).json({ error: 'Missing signature header' });
    }

    if (!req.rawBody) {
      return res.status(400).json({ error: 'Missing raw body' });
    }

    // Compute expected signature
    const hmac = crypto.createHmac('sha256', signingKey);
    const computedSignature = hmac.update(req.rawBody).digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  };
}

module.exports = {
  addAlchemyContextToRequest,
  validateAlchemySignature
}; 