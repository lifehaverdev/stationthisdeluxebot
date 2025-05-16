# StationThis Bot Web Interface

This directory contains the web interface for the StationThis Bot, providing a browser-based command panel and monitoring system for the bot's functionality.

## Overview

The web interface uses a clean, modular architecture that separates concerns:

- **Views**: HTML templates for the user interface
- **Static Assets**: CSS styles and JavaScript for interactivity
- **Integration**: Express router to serve and connect the interface to the bot

The UI follows the patterns established in the core UI component system, while adapting them for direct browser use.

## Directory Structure

```
src/core/ui/web/
├── README.md          # This documentation
├── static/            # Static assets
│   ├── css/           # Stylesheets
│   │   └── main.css   # Main styles
│   └── js/            # JavaScript files
│       └── main.js    # Main application logic
└── views/             # HTML templates
    └── index.html     # Main interface page
```

## Access and Usage

The web interface is available at:

```
http://localhost:3001/interface/
```

From here, you can:

1. Execute commands with arguments
2. View real-time system status
3. Monitor bot uptime and feature flags
4. View logs of activity within the interface

## Integration with Internal API

All command executions from the web interface go through the internal API layer (`src/core/internalAPI.js`). This ensures:

- **Consistent behavior** across all interfaces (Telegram, Web, etc.)
- **Clean separation** of UI and business logic
- **Uniform error handling** and logging

## Styling and Customization

The interface uses a CSS variable system for easy theming and customization. The main color scheme and layout dimensions are defined at the top of `main.css`:

```css
:root {
    --primary-color: #5865F2;
    --primary-light: #7984f5;
    --primary-dark: #4752c4;
    /* ... more variables ... */
}
```

To customize the appearance:

1. Modify these variables for global changes
2. Add new CSS classes for specific components
3. For structural changes, edit the HTML in `views/index.html`

## Extending the Interface

### Adding New Pages/Views

1. Create a new HTML file in `views/`
2. Add a route in `src/integrations/web/router.js`
3. Link to it from the main interface

### Adding New API Integration

The web interface communicates with the bot through the API endpoints at:

- `/api/health` - Service health and uptime
- `/api/status` - Detailed system status
- `/api/commands/:commandName` - Command execution

To integrate with new API endpoints:

1. Add the endpoint in the appropriate router 
2. Add the corresponding fetch function in `main.js`
3. Update the UI to display the data

### Recommended Practices

When extending the web interface:

- Keep the UI and business logic separate
- Use the existing CSS variable system for consistent styling
- Follow the modular pattern of the existing components
- Process all business logic through the internal API
- Validate inputs on both client and server sides

## Development Notes

- The interface is designed to be lightweight and not dependent on external frameworks
- The modular CSS uses CSS variables for theming
- Error handling is centralized in the API integration functions
- Commands executed from the interface will be logged in the server logs with their source identified 