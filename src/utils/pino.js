const pino = require('pino');
const config = require('../config');

// Create a pino logger instance specifically for HTTP requests
const httpLogger = pino({
  level: config.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// Export a pre-configured pino-http instance
module.exports = require('pino-http')({
  logger: httpLogger,

  // Define a custom serializer for the request object to ensure
  // the body is handled correctly and not logged character-by-character.
  serializers: {
    req(req) {
      const body = req.raw.body;
      // When logging the request body, we check if it's a string and parse it if it's JSON
      // This prevents the logger from printing each character of a JSON string on a new line.
      let parsedBody = body;
      if (typeof body === 'string') {
        try {
          parsedBody = JSON.parse(body);
        } catch (e) {
          // Not a JSON string, log as is.
        }
      }
      return {
        method: req.method,
        url: req.url,
        body: parsedBody,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    }
  },

  // Custom log message to provide a clear summary of the request.
  customSuccessMessage: function (req, res) {
    return `${req.method} ${req.url} - ${res.statusCode}`;
  },
  customErrorMessage: function (req, res, err) {
    return `${req.method} ${req.url} - ${res.statusCode} - ${err.message}`;
  }
}); 