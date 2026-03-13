import { Parser } from 'expr-eval';

const parser = new Parser({
  allowMemberAccess: true,
  operators: {
    conditional: true,   // ternary
    logical: true,       // &&, ||
    comparison: true,    // ==, !=, <, >, <=, >=
    add: true, subtract: true, multiply: true, divide: true, remainder: true,
    power: true, concatenate: true,
    // Disallow assignment and function definition
    assignment: false,
  },
});

// Register custom functions
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

/**
 * Evaluate an expression string with given variables.
 * @param {string} expression - The expr-eval expression
 * @param {object} variables - Variables available in the expression (e.g., { input: 'hello', n: 0, N: 6 })
 * @returns {*} The result of the expression
 */
export function evaluate(expression, variables = {}) {
  const vars = { ...customFunctions, ...variables };
  return parser.evaluate(expression, vars);
}

/**
 * Validate an expression string without executing it.
 * @param {string} expression
 * @returns {{ valid: boolean, error?: string }}
 */
export function validate(expression) {
  try {
    parser.parse(expression);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
