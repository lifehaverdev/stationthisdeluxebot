/**
 * MessageComponent Example
 * 
 * This example demonstrates how to use the MessageComponent in different scenarios,
 * including simple messages, messages with sender information, formatted messages,
 * and messages with attachments.
 */

const { MessageComponent } = require('../../src/core/ui/components');

// Simple example: Plain text message
const simpleMessage = new MessageComponent({
  text: 'Hello, world!'
});

console.log('Simple Message:', JSON.stringify(simpleMessage.toJSON(), null, 2));

// Example with sender information
const messageWithSender = new MessageComponent({
  text: 'This is a message from the system.',
  sender: 'System',
  avatar: 'https://example.com/system-avatar.png',
  isOutgoing: false
});

console.log('\nMessage with Sender:', JSON.stringify(messageWithSender.toJSON(), null, 2));

// Example with markdown formatting
const markdownMessage = new MessageComponent({
  text: 'This message contains **bold** and *italic* text.',
  format: 'markdown',
  sender: 'User',
  isOutgoing: true
});

console.log('\nMarkdown Message:', JSON.stringify(markdownMessage.toJSON(), null, 2));

// Example with attachments
const messageWithAttachments = new MessageComponent({
  text: 'Check out these files:',
  format: 'plain',
  sender: 'User',
  timestamp: new Date(),
  attachments: [
    {
      type: 'image',
      url: 'https://example.com/image.jpg',
      caption: 'Sample image'
    },
    {
      type: 'document',
      url: 'https://example.com/document.pdf',
      name: 'Sample document.pdf',
      size: 1024 * 1024 // 1MB
    }
  ],
  isOutgoing: true
});

console.log('\nMessage with Attachments:', JSON.stringify(messageWithAttachments.toJSON(), null, 2));

// Demonstration of component methods
console.log('\n--- Component Methods Demo ---');

const dynamicMessage = new MessageComponent({
  text: 'Initial message'
});

console.log('\nInitial state:', dynamicMessage.props.text);

// Update text content
dynamicMessage.setText('Updated message text');
console.log('After setText():', dynamicMessage.props.text);

// Set formatting to markdown
dynamicMessage.setFormat('markdown');
console.log('Format after setFormat():', dynamicMessage.props.format);

// Add sender information
dynamicMessage.setSender('Alice', 'https://example.com/alice-avatar.png');
console.log('Sender after setSender():', dynamicMessage.props.sender);
console.log('Avatar after setSender():', dynamicMessage.props.avatar);

// Add an attachment
dynamicMessage.addAttachment({
  type: 'image',
  url: 'https://example.com/new-image.jpg'
});
console.log('Attachments count after addAttachment():', dynamicMessage.props.attachments.length);

// Get formatted timestamp
console.log('Formatted timestamp:', dynamicMessage.getFormattedTimestamp());

// Get the text component
const textComponent = dynamicMessage.getTextComponent();
console.log('Text component type:', textComponent.type);
console.log('Text component text:', textComponent.props.text);

console.log('\nFinal message state:', JSON.stringify(dynamicMessage.toJSON(), null, 2)); 