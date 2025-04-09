/**
 * TextComponent Tests
 * 
 * Tests for the TextComponent class
 */

const { describe, test, expect } = require('@jest/globals');
const { TextComponent } = require('../../../../src/core/ui/components');

describe('TextComponent', () => {
  describe('constructor', () => {
    test('should create a component with default values', () => {
      const component = new TextComponent();
      
      expect(component.type).toBe('text');
      expect(component.props.text).toBe('');
      expect(component.props.format).toBe('plain');
      expect(component.props.inline).toBe(false);
      expect(component.props.style).toEqual({});
    });
    
    test('should create a component with provided values', () => {
      const props = {
        text: 'Hello, world!',
        format: 'markdown',
        inline: true,
        style: { color: 'red' }
      };
      
      const component = new TextComponent(props);
      
      expect(component.props.text).toBe('Hello, world!');
      expect(component.props.format).toBe('markdown');
      expect(component.props.inline).toBe(true);
      expect(component.props.style).toEqual({ color: 'red' });
    });
  });
  
  describe('validate', () => {
    test('should validate correctly formatted component', () => {
      const component = new TextComponent({
        text: 'Valid text',
        format: 'plain'
      });
      
      expect(component.validate()).toBe(true);
    });
    
    test('should invalidate component with non-string text', () => {
      const component = new TextComponent();
      component.props.text = 123;
      
      expect(component.validate()).toBe(false);
    });
    
    test('should invalidate component with invalid format', () => {
      const component = new TextComponent();
      component.props.format = 'invalid';
      
      expect(component.validate()).toBe(false);
    });
    
    test('should validate with all supported formats', () => {
      const validFormats = ['plain', 'markdown', 'html'];
      
      validFormats.forEach(format => {
        const component = new TextComponent({ format });
        expect(component.validate()).toBe(true);
      });
    });
  });
  
  describe('setText', () => {
    test('should update text property', () => {
      const component = new TextComponent();
      component.setText('New text');
      
      expect(component.props.text).toBe('New text');
    });
    
    test('should return component instance for chaining', () => {
      const component = new TextComponent();
      const result = component.setText('New text');
      
      expect(result).toBe(component);
    });
  });
  
  describe('setFormat', () => {
    test('should update format property', () => {
      const component = new TextComponent();
      component.setFormat('markdown');
      
      expect(component.props.format).toBe('markdown');
    });
    
    test('should return component instance for chaining', () => {
      const component = new TextComponent();
      const result = component.setFormat('html');
      
      expect(result).toBe(component);
    });
  });
  
  describe('applyFormat', () => {
    test('should leave plain text unchanged', () => {
      const text = 'Hello, world!';
      expect(TextComponent.applyFormat(text, 'plain')).toBe(text);
    });
    
    test('should escape markdown special characters', () => {
      const text = 'Hello *world* with _emphasis_';
      const formatted = TextComponent.applyFormat(text, 'markdown');
      
      expect(formatted).toBe('Hello \\*world\\* with \\_emphasis\\_');
    });
    
    test('should escape HTML special characters', () => {
      const text = 'Hello <world> & "quotes"';
      const formatted = TextComponent.applyFormat(text, 'html');
      
      expect(formatted).toBe('Hello &lt;world&gt; &amp; &quot;quotes&quot;');
    });
    
    test('should default to plain format for unknown format', () => {
      const text = 'Hello, world!';
      expect(TextComponent.applyFormat(text, 'unknown')).toBe(text);
    });
  });
}); 