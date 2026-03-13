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
  join: (sep, arr) => Array.isArray(arr) ? arr.join(sep ?? ',') : (Array.isArray(sep) ? sep.join(',') : String(sep)),
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
 * Evaluate an expression string (multi-line supported) with given variables.
 * Each line runs in sequence. The result of each line becomes `input` for the next.
 * Blank lines and lines starting with # are skipped.
 * @param {string} expression - One or more expr-eval expressions, one per line
 * @param {object} variables - Variables available in the expression (e.g., { input: 'hello', n: 0, N: 6 })
 * @returns {*} The result of the last expression
 */
export function evaluate(expression, variables = {}) {
  const vars = { ...customFunctions, ...variables };
  const lines = expression.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (lines.length === 0) throw new Error('No expression to evaluate');

  let result;
  for (const line of lines) {
    result = parser.evaluate(line, vars);
    // Feed result forward as `input` for next line
    vars.input = result;
  }
  return result;
}

/**
 * Validate an expression string (multi-line) without executing it.
 * @param {string} expression
 * @returns {{ valid: boolean, error?: string, line?: number }}
 */
export function validate(expression) {
  const lines = expression.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  for (let i = 0; i < lines.length; i++) {
    try {
      parser.parse(lines[i]);
    } catch (err) {
      return { valid: false, error: `Line ${i + 1}: ${err.message}`, line: i + 1 };
    }
  }
  return { valid: true };
}
