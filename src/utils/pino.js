const { createLogger } = require('./logger');

// Create a logger instance specifically for HTTP requests
const httpLogger = createLogger('http');

// Export a pre-configured pino-http instance
module.exports = require('pino-http')({
  logger: httpLogger,

  // Define a custom serializer for the request object to ensure
  // the body is handled correctly and not logged character-by-character.
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        // The raw body is available on req.raw.body
        // We log it here to ensure it's captured correctly by our logger.
        body: req.raw.body,
        remoteAddress: req.remoteAddress,
      };
    },
  },
}); 