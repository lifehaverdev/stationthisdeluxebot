/**
 * MessageComponent Tests
 * 
 * Tests for the message component functionality
 */

const MessageComponent = require('../MessageComponent');
const TextComponent = require('../TextComponent');

describe('MessageComponent', () => {
  describe('constructor', () => {
    test('should create with minimal props', () => {
      const component = new MessageComponent();
      expect(component.type).toBe('message');
      expect(component.props.text).toBe('');
      expect(component.props.format).toBe('plain');
      expect(component.props.sender).toBeNull();
      expect(component.props.avatar).toBeNull();
      expect(component.props.attachments).toEqual([]);
      expect(component.props.isOutgoing).toBe(false);
      expect(component.props.timestamp).toBeInstanceOf(Date);
    });

    test('should create with provided props', () => {
      const timestamp = new Date('2023-01-01T12:00:00Z');
      const component = new MessageComponent({
        text: 'Hello world',
        format: 'markdown',
        sender: 'John',
        avatar: 'http://example.com/avatar.png',
        timestamp: timestamp,
        attachments: [{ type: 'image', url: 'http://example.com/image.jpg' }],
        isOutgoing: true,
        style: { color: 'blue' }
      });
      
      expect(component.props.text).toBe('Hello world');
      expect(component.props.format).toBe('markdown');
      expect(component.props.sender).toBe('John');
      expect(component.props.avatar).toBe('http://example.com/avatar.png');
      expect(component.props.timestamp).toBe(timestamp);
      expect(component.props.attachments).toHaveLength(1);
      expect(component.props.attachments[0].type).toBe('image');
      expect(component.props.isOutgoing).toBe(true);
      expect(component.props.style.color).toBe('blue');
    });

    test('should create text component with same text and format', () => {
      const component = new MessageComponent({
        text: 'Hello world',
        format: 'markdown'
      });
      
      expect(component.textComponent).toBeInstanceOf(TextComponent);
      expect(component.textComponent.props.text).toBe('Hello world');
      expect(component.textComponent.props.format).toBe('markdown');
    });
  });

  describe('validation', () => {
    test('should validate correct props', () => {
      const component = new MessageComponent({
        text: 'Hello world',
        format: 'markdown',
        sender: 'John'
      });
      
      expect(component.validate()).toBe(true);
    });

    test('should invalidate non-string text', () => {
      const component = new MessageComponent();
      component.props.text = 123;
      
      expect(component.validate()).toBe(false);
    });

    test('should invalidate invalid format', () => {
      const component = new MessageComponent();
      component.props.format = 'invalid-format';
      
      expect(component.validate()).toBe(false);
    });

    test('should invalidate non-string sender', () => {
      const component = new MessageComponent();
      component.props.sender = 123;
      
      expect(component.validate()).toBe(false);
    });

    test('should invalidate non-string avatar', () => {
      const component = new MessageComponent();
      component.props.avatar = 123;
      
      expect(component.validate()).toBe(false);
    });

    test('should invalidate non-array attachments', () => {
      const component = new MessageComponent();
      component.props.attachments = 'invalid';
      
      expect(component.validate()).toBe(false);
    });
  });

  describe('methods', () => {
    test('should set text and update text component', () => {
      const component = new MessageComponent();
      component.setText('New text');
      
      expect(component.props.text).toBe('New text');
      expect(component.textComponent.props.text).toBe('New text');
    });

    test('should set format and update text component', () => {
      const component = new MessageComponent();
      component.setFormat('markdown');
      
      expect(component.props.format).toBe('markdown');
      expect(component.textComponent.props.format).toBe('markdown');
    });

    test('should set sender with or without avatar', () => {
      const component = new MessageComponent();
      
      component.setSender('John');
      expect(component.props.sender).toBe('John');
      expect(component.props.avatar).toBeNull();
      
      component.setSender('Jane', 'http://example.com/avatar.png');
      expect(component.props.sender).toBe('Jane');
      expect(component.props.avatar).toBe('http://example.com/avatar.png');
    });

    test('should set timestamp', () => {
      const component = new MessageComponent();
      const timestamp = new Date('2023-01-01T12:00:00Z');
      
      component.setTimestamp(timestamp);
      expect(component.props.timestamp).toBe(timestamp);
    });

    test('should add attachment', () => {
      const component = new MessageComponent();
      const attachment = { type: 'image', url: 'http://example.com/image.jpg' };
      
      component.addAttachment(attachment);
      expect(component.props.attachments).toHaveLength(1);
      expect(component.props.attachments[0]).toBe(attachment);
    });

    test('should set outgoing state', () => {
      const component = new MessageComponent();
      
      component.setOutgoing(true);
      expect(component.props.isOutgoing).toBe(true);
      
      component.setOutgoing(false);
      expect(component.props.isOutgoing).toBe(false);
    });

    test('should format timestamp', () => {
      // Mock toLocaleTimeString to return consistent result
      const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
      Date.prototype.toLocaleTimeString = jest.fn(() => '10:30 AM');
      
      const component = new MessageComponent({
        timestamp: new Date('2023-01-01T10:30:00Z')
      });
      
      expect(component.getFormattedTimestamp()).toBe('10:30 AM');
      
      // Restore original method
      Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    });

    test('should handle string timestamp', () => {
      // Mock toLocaleTimeString to return consistent result
      const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
      Date.prototype.toLocaleTimeString = jest.fn(() => '10:30 AM');
      
      const component = new MessageComponent({
        timestamp: '2023-01-01T10:30:00Z'
      });
      
      expect(component.getFormattedTimestamp()).toBe('10:30 AM');
      
      // Restore original method
      Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    });

    test('should handle invalid timestamp', () => {
      const component = new MessageComponent();
      component.props.timestamp = 'invalid-date';
      
      expect(component.getFormattedTimestamp()).toBe('');
    });

    test('should get text component', () => {
      const component = new MessageComponent();
      
      expect(component.getTextComponent()).toBe(component.textComponent);
    });
  });

  describe('serialization', () => {
    test('should serialize to JSON with ISO timestamp', () => {
      const timestamp = new Date('2023-01-01T12:00:00Z');
      const component = new MessageComponent({
        text: 'Hello world',
        sender: 'John',
        timestamp: timestamp
      });
      
      const json = component.toJSON();
      
      expect(json.type).toBe('message');
      expect(json.props.text).toBe('Hello world');
      expect(json.props.sender).toBe('John');
      expect(json.props.timestamp).toBe(timestamp.toISOString());
    });

    test('should keep string timestamp as is', () => {
      const timestampString = '2023-01-01T12:00:00Z';
      const component = new MessageComponent({
        text: 'Hello world',
        timestamp: timestampString
      });
      
      const json = component.toJSON();
      
      expect(json.props.timestamp).toBe(timestampString);
    });
  });
}); 