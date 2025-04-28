# Platform-Agnostic UI Component System

This module provides a unified interface for creating UI components that can be rendered across different platforms (Telegram, Web, API, etc.).

## Architecture

The UI component system follows these design principles:

1. **Platform Agnosticism**: Components define their structure and behavior independently of how they'll be rendered.
2. **Separation of Concerns**: Rendering logic is separated from component definitions.
3. **Extensibility**: New component types and renderers can be easily added.
4. **Consistency**: Components behave consistently across platforms.

The system consists of three main parts:

- **Components**: Define the structure and behavior of UI elements
- **Renderers**: Transform components into platform-specific representations
- **Manager**: Coordinates components and renderers

## Core Interfaces

### UIComponent

Base class for all UI components. Defines common properties and methods:

- `id`: Unique identifier
- `type`: Component type
- `props`: Component properties
- `validate()`: Validates component configuration
- `update()`: Updates component properties
- `toJSON()`: Serializes the component

### UIRenderer

Interface for platform-specific renderers. Defines methods:

- `render()`: Renders a component
- `update()`: Updates a previously rendered component
- `processInput()`: Processes user input for a component
- `remove()`: Removes a rendered component
- `supportsComponentType()`: Checks if the renderer supports a component type

### UIManager

Central manager for UI components and renderers:

- `registerRenderer()`: Registers a platform-specific renderer
- `registerComponent()`: Registers a component type
- `createComponent()`: Creates a component instance
- `render()`: Renders a component using the appropriate renderer
- `update()`: Updates a previously rendered component
- `processInput()`: Processes user input for a component
- `remove()`: Removes a rendered component

## Available Components

### TextComponent

Displays formatted text:

```javascript
const { createTextComponent } = require('../../core/ui');

const text = createTextComponent({
  text: 'Hello, world!',
  format: 'markdown', // 'plain', 'markdown', 'html'
  inline: false
});
```

### ButtonComponent

Displays an interactive button:

```javascript
const { createButtonComponent } = require('../../core/ui');

const button = createButtonComponent({
  text: 'Click me',
  action: 'submit',
  style: 'primary', // 'default', 'primary', 'danger'
  data: { id: 123 }
});
```

### InputComponent

Collects user input:

```javascript
const { createInputComponent } = require('../../core/ui');

const input = createInputComponent({
  label: 'Email Address',
  placeholder: 'Enter your email',
  type: 'email', // 'text', 'number', 'email', etc.
  required: true,
  validation: {
    type: 'string',
    format: 'email'
  }
});
```

## Platform-Specific Renderers

### TelegramRenderer

Renders components on the Telegram platform:

```javascript
const { UIManager } = require('../../core/ui');
const TelegramRenderer = require('../../integrations/telegram/ui/TelegramRenderer');

const uiManager = new UIManager();
uiManager.registerRenderer('telegram', new TelegramRenderer({ bot: telegramBot }));

// Render a component
await uiManager.render(textComponent, {}, 'telegram', { chatId: 123456789 });
```

## Usage Example

```javascript
const { createUIManager, createTextComponent, createButtonComponent } = require('../../core/ui');
const TelegramRenderer = require('../../integrations/telegram/ui/TelegramRenderer');

// Create UI manager
const uiManager = createUIManager();

// Register renderer
uiManager.registerRenderer('telegram', new TelegramRenderer({ bot: telegramBot }));

// Create components
const text = createTextComponent({
  text: 'Would you like to proceed?',
  format: 'markdown'
});

const confirmButton = createButtonComponent({
  text: 'Yes',
  action: 'confirm',
  style: 'primary'
});

const cancelButton = createButtonComponent({
  text: 'No',
  action: 'cancel',
  style: 'danger'
});

// Render components
const renderContext = { chatId: message.chat.id };
const textRef = await uiManager.render(text, {}, 'telegram', renderContext);
const confirmRef = await uiManager.render(confirmButton, {}, 'telegram', renderContext);
const cancelRef = await uiManager.render(cancelButton, {}, 'telegram', renderContext);

// Process input when received
telegramBot.on('callback_query', async (callbackQuery) => {
  const result = await uiManager.processInput(callbackQuery.id, callbackQuery, {});
  
  if (result.handled) {
    // Handle the action
    if (result.action === 'confirm') {
      // Process confirmation
    } else if (result.action === 'cancel') {
      // Process cancellation
    }
  }
});
```

## Extending the System

### Creating a New Component

```javascript
const { UIComponent } = require('../../core/ui');

class ImageComponent extends UIComponent {
  constructor(props = {}) {
    super(props);
    this.type = 'image';
    
    this.props.url = props.url || '';
    this.props.caption = props.caption || '';
    this.props.width = props.width || 'auto';
    this.props.height = props.height || 'auto';
  }
  
  validate() {
    return typeof this.props.url === 'string' && this.props.url.length > 0;
  }
}

module.exports = ImageComponent;
```

### Creating a New Renderer

```javascript
const { UIRenderer } = require('../../core/ui');

class WebRenderer extends UIRenderer {
  constructor(options = {}) {
    super(options);
    this.platform = 'web';
  }
  
  supportsComponentType(componentType) {
    return ['text', 'button', 'input', 'image'].includes(componentType);
  }
  
  async render(component, context) {
    // Implement web-specific rendering
  }
  
  // Implement other methods...
}

module.exports = WebRenderer;
```

## Best Practices

1. **Component Independence**: Components should be self-contained and not depend on specific platforms.
2. **Validation**: Always validate component properties and user input.
3. **Error Handling**: Handle rendering and input processing errors gracefully.
4. **Context Preservation**: Maintain context between renders and updates.
5. **Cleanup**: Remove components when they're no longer needed. 