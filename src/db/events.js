const EventEmitter = require('events');
class StatsEmitter extends EventEmitter {}

const statsEmitter = new StatsEmitter();
module.exports = statsEmitter;
