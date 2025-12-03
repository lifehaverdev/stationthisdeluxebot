/**
 * Logger Utility (Pino + AsyncLocalStorage)
 *
 * Provides consistent structured logging and lightweight request context propagation.
 */

const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');
const pino = require('pino');
const config = require('../config');

const loggingContext = new AsyncLocalStorage();

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-internal-client-key"]',
  'req.headers["x-guest-token"]',
  'req.body.password',
  'req.body.apiKey',
  'apiKey',
  'token',
];

const prettyTransport = !config.IS_PRODUCTION
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:standard',
      },
    }
  : null;

const baseLogger = pino({
  level: config.LOG_LEVEL || 'info',
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: prettyTransport ? { target: prettyTransport.target, options: prettyTransport.options } : undefined,
  mixin() {
    const context = loggingContext.getStore();
    if (!context) return {};
    // Avoid leaking mutable references
    return { ...context };
  },
});

function createLogger(module) {
  const child = baseLogger.child(module ? { module } : {});
  if (!config.LOG_VERBOSE_API && module && module.toLowerCase().includes('api')) {
    const debugFn = child.debug ? child.debug.bind(child) : baseLogger.debug.bind(baseLogger);
    child.info = (...args) => {
      debugFn(...args);
    };
  }
  return child;
}

function runWithRequestContext(context, fn) {
  const ctx = context && typeof context === 'object' ? { ...context } : {};
  if (!ctx.reqId) {
    ctx.reqId = randomUUID();
  }
  return loggingContext.run(ctx, fn);
}

function setRequestContext(values) {
  if (!values || typeof values !== 'object') return;
  const store = loggingContext.getStore();
  if (!store) return;
  Object.assign(store, values);
}

function getRequestContext() {
  return loggingContext.getStore() || {};
}

function getBaseLogger() {
  return baseLogger;
}

module.exports = {
  createLogger,
  getBaseLogger,
  runWithRequestContext,
  setRequestContext,
  getRequestContext,
};
