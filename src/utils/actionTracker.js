const { randomUUID } = require('crypto');
const { createLogger, setRequestContext } = require('./logger');

const STATIC_ASSET_REGEXP = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|ttf|otf|woff2?|eot)$/i;
const ACTION_IDLE_TIMEOUT_MS = parseInt(process.env.ACTION_IDLE_TIMEOUT_MS || '800', 10);

const logger = createLogger('ActionTracker');

const activeActions = new Map(); // actionId -> entry
const baseKeyToAction = new Map(); // baseKey -> actionId

function nowMs() {
  return Date.now();
}

function buildBaseKey(req) {
  const userId = req.user?.userId || req.user?._id || req.cookies?.masterAccountId || null;
  const remote = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  return `${userId || 'anon'}:${remote}`;
}

function createEntry(actionId, baseKey, metadata = {}) {
  const entry = {
    actionId,
    baseKey,
    actionType: metadata.actionType || null,
    firstSeen: nowMs(),
    lastSeen: nowMs(),
    totalCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    routes: new Map(),
    errors: [],
    userIds: new Set(),
    timer: null,
  };
  activeActions.set(actionId, entry);
  return entry;
}

function ensureEntry(actionId, baseKey, metadata, req) {
  let entry = activeActions.get(actionId);
  if (!entry) {
    entry = createEntry(actionId, baseKey, metadata);
  }
  entry.actionType = entry.actionType || metadata.actionType || null;
  if (req.user?.userId || req.user?._id) {
    entry.userIds.add(req.user.userId || req.user._id);
  }
  return entry;
}

function finalizeEntry(entry) {
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  activeActions.delete(entry.actionId);
  if (entry.baseKey && baseKeyToAction.get(entry.baseKey) === entry.actionId) {
    baseKeyToAction.delete(entry.baseKey);
  }

  const summary = {
    actionId: entry.actionId,
    actionType: entry.actionType || 'auto',
    durationMs: Number((entry.lastSeen - entry.firstSeen).toFixed(2)),
    totalRequests: entry.totalCount,
    avgDurationMs: entry.totalCount ? Number((entry.totalDurationMs / entry.totalCount).toFixed(2)) : 0,
    maxDurationMs: Number(entry.maxDurationMs.toFixed(2)),
    uniqueRoutes: entry.routes.size,
    routes: Array.from(entry.routes.entries()).map(([route, stats]) => ({
      route,
      count: stats.count,
      statusCounts: stats.statusCounts,
      avgMs: Number((stats.totalDurationMs / stats.count).toFixed(2)),
      maxMs: Number(stats.maxDurationMs.toFixed(2)),
    })),
    errors: entry.errors,
    users: Array.from(entry.userIds),
  };

  const logLevel = entry.totalCount > 1 || entry.errors.length ? 'info' : 'debug';
  logger[logLevel](summary, '[ActionTracker] action burst complete');
}

function scheduleFlush(entry) {
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => finalizeEntry(entry), ACTION_IDLE_TIMEOUT_MS);
  if (typeof entry.timer.unref === 'function') {
    entry.timer.unref();
  }
}

function getActionId(req) {
  const explicitId = req.headers['x-action-id'];
  const actionType = req.headers['x-action-type'];
  if (explicitId) {
    return { actionId: explicitId, baseKey: null, actionType };
  }

  const baseKey = buildBaseKey(req);
  let actionId = baseKeyToAction.get(baseKey);
  if (!actionId) {
    actionId = `${baseKey}:${randomUUID()}`;
    baseKeyToAction.set(baseKey, actionId);
  }
  return { actionId, baseKey, actionType };
}

function recordRequest(actionId, req, res) {
  const entry = ensureEntry(actionId, req.__actionBaseKey, { actionType: req.__actionType }, req);
  entry.lastSeen = nowMs();

  const routeKey = `${req.method} ${(req.path || req.originalUrl || '').split('?')[0]}`;
  let stats = entry.routes.get(routeKey);
  if (!stats) {
    stats = {
      count: 0,
      statusCounts: {},
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    entry.routes.set(routeKey, stats);
  }
  stats.count += 1;
  const status = res.statusCode || 0;
  stats.statusCounts[status] = (stats.statusCounts[status] || 0) + 1;

  let durationMs = 0;
  if (res.locals.__actionStartTime) {
    const durationNs = process.hrtime.bigint() - res.locals.__actionStartTime;
    durationMs = Number(durationNs) / 1e6;
  }
  if (durationMs) {
    stats.totalDurationMs += durationMs;
    stats.maxDurationMs = Math.max(stats.maxDurationMs, durationMs);
    entry.totalDurationMs += durationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, durationMs);
  }

  entry.totalCount += 1;
  if (status >= 400) {
    entry.errors.push({ route: routeKey, status });
  }
  scheduleFlush(entry);
}

function actionTrackingMiddleware(req, res, next) {
  if (STATIC_ASSET_REGEXP.test(req.path || req.originalUrl)) {
    return next();
  }
  const { actionId, baseKey, actionType } = getActionId(req);
  req.__actionTracked = true;
  req.__actionBaseKey = baseKey;
  req.__actionType = actionType || null;
  req._actionId = actionId;
  res.locals.__actionStartTime = process.hrtime.bigint();
  setRequestContext({ actionId });

  const finalize = () => {
    if (res.locals.__actionRecorded) return;
    res.locals.__actionRecorded = true;
    recordRequest(actionId, req, res);
  };

  res.once('finish', finalize);
  res.once('close', finalize);

  next();
}

module.exports = {
  actionTrackingMiddleware,
  finalizeEntry,
};
