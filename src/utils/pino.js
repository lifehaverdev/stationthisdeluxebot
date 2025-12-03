const { randomUUID } = require('crypto');
const pinoHttp = require('pino-http');
const { getBaseLogger, runWithRequestContext } = require('./logger');

const STATIC_ASSET_REGEXP = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|ttf|otf|woff2?|eot)$/i;

const baseHttpLogger = getBaseLogger().child({ module: 'http' });

const httpLogger = pinoHttp({
  logger: baseHttpLogger,
  genReqId(req) {
    return req.headers['x-request-id'] || randomUUID();
  },
  customAttributeKeys: {
    reqId: 'reqId',
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        remoteAddress: req.ip || req.socket?.remoteAddress,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
  customSuccessMessage(req, res) {
    const duration = res.responseTime ? ` ${res.responseTime}ms` : '';
    return `${req.method} ${req.url} - ${res.statusCode}${duration}`;
  },
  customErrorMessage(req, res, err) {
    return `${req.method} ${req.url} - ${res.statusCode} - ${err.message}`;
  },
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (STATIC_ASSET_REGEXP.test(req.url)) return 'silent';
    if (res.statusCode >= 400) return 'warn';
    if (req.__actionTracked) return 'debug';
    return 'info';
  },
});

module.exports = function httpLoggingMiddleware(req, res, next) {
  httpLogger(req, res, (err) => {
    if (err) return next(err);
    const context = {
      reqId: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.ip || req.socket?.remoteAddress,
      platform: 'web',
    };
    runWithRequestContext(context, () => next());
  });
}; 
