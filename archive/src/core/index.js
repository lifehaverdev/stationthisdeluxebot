/**
 * Core Module Export
 * 
 * Exports all core modules for easy importing.
 */

const analytics = require('./analytics');
const command = require('./command');
const generation = require('./generation');
const points = require('./points');
const queue = require('./queue');
const session = require('./session');
const shared = require('./shared');
const user = require('./user');
const validation = require('./validation');
const workflow = require('./workflow');
const ui = require('./ui');

module.exports = {
  analytics,
  command,
  generation,
  points,
  queue,
  session,
  shared,
  user,
  validation,
  workflow,
  ui
}; 