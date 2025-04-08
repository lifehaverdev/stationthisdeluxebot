/**
 * Session Manager with Telegram Integration Example
 * 
 * This example demonstrates how to use the SessionManager with 
 * the Telegram integration to track and update user sessions
 */

const { SessionManager } = require('../services/sessionManager');

/**
 * Example function demonstrating the session manager with Telegram
 */
async function runSessionManagerExample() {
  console.log('Starting Telegram Session Manager example...');

  // Initialize components with defaults that include timestamps
  const now = Date.now();
  const sessionManager = new SessionManager({
    defaults: {
      createdAt: now,
      lastActivity: now,
      commands: { status: 0 },
      preferences: { language: 'en' }
    }
  });

  // Creating a mock Telegram message
  const mockMessage = {
    message_id: 12345,
    from: {
      id: 123456789,
      first_name: 'Example',
      username: 'example_user'
    },
    chat: {
      id: 123456789,
      type: 'private'
    },
    date: Math.floor(now / 1000),
    text: '/status'
  };

  // Simulate processing a command
  console.log(`Processing command from user ${mockMessage.from.id}...`);
  
  // Get or create a session for the user
  const userId = mockMessage.from.id.toString();
  let sessionData = await sessionManager.getUserData(userId);
  
  console.log('Initial session data:', JSON.stringify(sessionData, null, 2));
  
  if (Object.keys(sessionData).length === 0) {
    console.log('No existing session found, creating a new one...');
    sessionData = await sessionManager.createUserSession(userId, {
      firstName: mockMessage.from.first_name,
      username: mockMessage.from.username,
      createdAt: now,
      lastActivity: now
    });
    console.log('New session created:', JSON.stringify(sessionData, null, 2));
  } else {
    console.log('Session found for user:', userId);
  }
  
  // Update session with command data
  console.log('\nUpdating user session with command data...');
  const commandCount = (sessionData.commands?.status || 0) + 1;
  
  const updatedSession = await sessionManager.updateUserData(userId, {
    lastActivity: now,
    lastCommand: '/status',
    'commands.status': commandCount
  });
  
  console.log('Updated session data:', JSON.stringify(updatedSession, null, 2));
  
  // Safe access to session data with defaults
  const createdAt = updatedSession?.createdAt || now;
  const lastActivity = updatedSession?.lastActivity || now;
  const username = updatedSession?.username || 'Anonymous';
  const statusCount = updatedSession?.commands?.status || commandCount;
  
  // Format dates for display
  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleString();
  };
  
  // Generate command response
  const commandResponse = {
    chatId: mockMessage.chat.id,
    text: `📊 *Bot Status*\n\n` +
          `User: ${username}\n` + 
          `Session active since: ${formatDate(createdAt)}\n` +
          `Last activity: ${formatDate(lastActivity)}\n` +
          `Total status commands: ${statusCount}`,
    options: {
      parse_mode: 'Markdown',
      reply_markup: { 
        inline_keyboard: [[{ text: '🔄', callback_data: 'refresh' }]]
      }
    }
  };
  
  console.log('\nCommand response:');
  console.log(commandResponse);

  // Get session metrics
  console.log('\nSession Manager Metrics:');
  console.log(sessionManager.getMetrics());

  console.log('\nExample completed successfully.');
}

// Run the example if this file is executed directly
if (require.main === module) {
  runSessionManagerExample()
    .then(() => console.log('Example completed'))
    .catch(error => console.error('Example failed:', error));
}

module.exports = { runSessionManagerExample }; 