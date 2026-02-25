const pino = require('pino');
const config = require('../config');

// Create a pino logger instance specifically for HTTP requests
let prettyTransport = null;
if (!config.IS_PRODUCTION) {
  try {
    // Only load pino-pretty when it is installed (local dev). Production builds omit devDeps.
    require.resolve('pino-pretty');
    prettyTransport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pino] pino-pretty not available; falling back to JSON logs.');
  }
}

const httpLogger = pino({
  level: config.LOG_LEVEL,
  ...(prettyTransport ? { transport: prettyTransport } : {}),
});

// Export a pre-configured pino-http instance
module.exports = require('pino-http')({
  logger: httpLogger,

  // Define a custom serializer for the request object to ensure
  // the body is handled correctly and not logged character-by-character.
  serializers: {
    req(req) {
      // For abbrev logs we don't need full body at all
      return {
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    }
  },

  // Custom log message to provide a clear summary of the request.
  customSuccessMessage: function (req, res) {
    return `${req.method} ${req.url} - ${res.statusCode}`;
  },
  customErrorMessage: function (req, res, err) {
    return `${req.method} ${req.url} - ${res.statusCode} - ${err.message}`;
  },
  // Silence logs for requests that only serve static assets to reduce console noise
  customLogLevel: function (req, res, err) {
    // If an error occurred, always log it as error
    if (err || res.statusCode >= 500) return 'error';

    // Skip logging for common static asset extensions (css, js, images, fonts, maps)
    const STATIC_ASSET_REGEXP = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|ttf|otf|woff2?|eot)$/i;
    if (STATIC_ASSET_REGEXP.test(req.url)) {
      return 'silent';
    }

    // Silence internal polling endpoints
    if (req.url && req.url.startsWith('/internal/v1/data/generations')) {
      return 'silent';
    }

    // Warn for client errors
    if (res.statusCode >= 400) return 'warn';

    // Otherwise, use info for application/API requests
    return 'info';
  }
}); 
