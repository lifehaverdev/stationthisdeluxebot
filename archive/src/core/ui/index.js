/**
 * Platform-Agnostic UI Module
 * 
 * Provides a unified interface for creating UI components
 * that can be rendered across different platforms.
 */

const interfaces = require('./interfaces');
const components = require('./components');

/**
 * Create a UI manager instance
 * @param {Object} options - Manager options
 * @returns {UIManager} The UI manager instance
 */
function createUIManager(options = {}) {
  return new interfaces.UIManager(options);
}

/**
 * Create a text component
 * @param {Object} props - Component properties
 * @returns {TextComponent} The created component
 */
function createTextComponent(props = {}) {
  return new components.TextComponent(props);
}

/**
 * Create a button component
 * @param {Object} props - Component properties
 * @returns {ButtonComponent} The created component
 */
function createButtonComponent(props = {}) {
  return new components.ButtonComponent(props);
}

/**
 * Create an input component
 * @param {Object} props - Component properties
 * @returns {InputComponent} The created component
 */
function createInputComponent(props = {}) {
  return new components.InputComponent(props);
}

module.exports = {
  // Factory functions
  createUIManager,
  createTextComponent,
  createButtonComponent,
  createInputComponent,
  
  // Component classes
  TextComponent: components.TextComponent,
  ButtonComponent: components.ButtonComponent,
  InputComponent: components.InputComponent,
  
  // Interface classes
  UIComponent: interfaces.UIComponent,
  UIRenderer: interfaces.UIRenderer,
  UIManager: interfaces.UIManager
}; 