// src/platforms/web/client/src/sandbox/window/domHelpers.js
// Lightweight helper for creating DOM elements with props & children.
// Keeps sandbox code terse while staying 100 % vanilla JS.

/**
 * Create an element and optionally set props/attributes and append children.
 * @param {string} tag – HTML tag name (e.g. 'div').
 * @param {object} [props] – Key/values applied as attributes or property assignments.
 * @param {...(Node|string|null|undefined)} children – Child nodes/text.
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  // Apply props
  Object.entries(props).forEach(([key, val]) => {
    if (val === null || val === undefined) return;
    if (key === 'className') node.className = val;
    else if (key === 'style' && typeof val === 'object') {
      Object.assign(node.style, val);
    } else if (key in node) {
      node[key] = val;
    } else {
      node.setAttribute(key, String(val));
    }
  });
  // Append children
  children.flat().forEach(ch => {
    if (ch === null || ch === undefined) return;
    node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  });
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
