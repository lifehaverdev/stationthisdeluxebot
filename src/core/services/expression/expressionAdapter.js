const { Parser } = require('expr-eval');
const registry = require('../adapterRegistry');

const parser = new Parser({
  allowMemberAccess: true,
  operators: {
    conditional: true,
    logical: true,
    comparison: true,
    add: true, subtract: true, multiply: true, divide: true, remainder: true,
    power: true, concatenate: true,
    assignment: false,
  },
});

const customFunctions = {
  replace: (str, search, rep) => String(str).replace(new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), String(rep)),
  split: (str, sep) => String(str).split(String(sep)),
  trim: (str) => String(str).trim(),
  padStart: (str, len, fill) => String(str).padStart(len, fill || ' '),
  padEnd: (str, len, fill) => String(str).padEnd(len, fill || ' '),
  toUpperCase: (str) => String(str).toUpperCase(),
  toLowerCase: (str) => String(str).toLowerCase(),
  slice: (str, start, end) => String(str).slice(start, end),
  at: (arr, idx) => Array.isArray(arr) ? arr[idx] : String(arr).charAt(idx),
  join: (arr, sep) => Array.isArray(arr) ? arr.join(sep ?? ',') : String(arr),
  includes: (str, search) => String(str).includes(String(search)),
  startsWith: (str, search) => String(str).startsWith(String(search)),
  endsWith: (str, search) => String(str).endsWith(String(search)),
  len: (str) => Array.isArray(str) ? str.length : String(str).length,
  range: (n) => Array.from({ length: n }, (_, i) => i),
  repeat: (str, n) => String(str).repeat(n),
  toString: (v) => String(v),
  toNumber: (v) => Number(v),
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

class ExpressionAdapter {
  async execute(params) {
    const { expression, ...inputVars } = params;
    if (!expression) throw new Error('expression is required');

    const vars = { ...customFunctions, ...inputVars };
    let result;
    try {
      result = parser.evaluate(expression, vars);
    } catch (err) {
      throw new Error(`Expression error: ${err.message}`);
    }

    const text = Array.isArray(result) ? JSON.stringify(result) : String(result);
    return { type: 'text', data: { text: [text], result: text }, status: 'succeeded' };
  }
}

const adapter = new ExpressionAdapter();
registry.register('expression', adapter);
module.exports = adapter;
