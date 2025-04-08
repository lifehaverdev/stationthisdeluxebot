/**
 * Lobby Replacement Example
 * Shows how to replace a direct lobby[userId] access with SessionAdapter
 */

// LEGACY APPROACH
function legacySetUserPoints(userId, points) {
  // Direct access to global lobby object
  if (!lobby[userId]) {
    lobby[userId] = {};
  }
  
  lobby[userId].points = points;
  
  // Typically would return the new points
  return lobby[userId].points;
}

function legacyGetUserPoints(userId) {
  // Direct access with fallback
  return lobby[userId]?.points || 0;
}

function legacyAddUserToChat(userId, chatId) {
  // Multiple mutations to global state
  if (!lobby[userId]) {
    lobby[userId] = {};
  }
  
  if (!lobby[userId].stationed) {
    lobby[userId].stationed = {};
  }
  
  lobby[userId].stationed[chatId] = true;
  lobby[userId].currentChatId = chatId;
  
  return true;
}

// NEW APPROACH
const { createSessionAdapter } = require('../../session');

// Get reference to legacy lobby for migration
const lobby = require('../../../../utils/bot/bot').lobby;

// Create adapter with reference to legacy lobby
const sessionAdapter = createSessionAdapter(lobby);

async function setUserPoints(userId, points) {
  // Using the adapter to update both systems
  await sessionAdapter.setSessionProperty(userId, 'points', points);
  
  // Get updated points
  return sessionAdapter.getSessionProperty(userId, 'points', 0);
}

async function getUserPoints(userId) {
  // Using the adapter with fallback value
  return sessionAdapter.getSessionProperty(userId, 'points', 0);
}

async function addUserToChat(userId, chatId) {
  // Using platform-specific adapter method
  return sessionAdapter.addToChat(userId, chatId);
}

// BONUS: Web Interface Support
async function authenticateWebUser(userId) {
  // Create web session with API key
  const result = await sessionAdapter.createWebSession(userId, {
    userAgent: 'Web Browser',
    firstLogin: new Date()
  });
  
  if (!result) {
    throw new Error('Failed to create web session');
  }
  
  // Return both session state and API key
  return {
    sessionState: result.state,
    apiKey: result.apiKey
  };
}

async function authenticateApiRequest(apiKey) {
  // Get session by API key
  const session = await sessionAdapter.getSessionByApiKey(apiKey);
  
  if (!session) {
    throw new Error('Invalid API key');
  }
  
  return {
    userId: session.userId,
    verified: session.verified,
    points: session.points,
    isWebSession: session.isWebSession()
  };
}

// Example migration helper
async function migrateUsers() {
  // Migrate all users from legacy lobby to new system
  const migratedCount = await sessionAdapter.migrateAllFromLobby();
  console.log(`Migrated ${migratedCount} users to new session system`);
}

module.exports = {
  // Legacy functions (for reference)
  legacySetUserPoints,
  legacyGetUserPoints,
  legacyAddUserToChat,
  
  // New functions (for actual use)
  setUserPoints,
  getUserPoints,
  addUserToChat,
  authenticateWebUser,
  authenticateApiRequest,
  migrateUsers
}; 