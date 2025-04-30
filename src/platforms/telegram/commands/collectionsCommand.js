/**
 * Collections Command Handler for Telegram
 * 
 * Handles the /collections command which allows users to manage their collections.
 */

const { CollectionsWorkflow } = require('../../../workflows/collections');
const createTelegramMediaAdapter = require('../mediaAdapter');
const crypto = require('crypto');

/**
 * Create collections command handler for Telegram
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createCollectionsCommandHandler(dependencies) {
  const { 
    sessionService,
    mediaService,
    db,
    bot,
    logger = console
  } = dependencies;
  
  // Create Telegram adapter for media operations
  const telegramMediaAdapter = createTelegramMediaAdapter(bot);
  
  // Create collections workflow instance
  const collectionsWorkflow = new CollectionsWorkflow({
    sessionService,
    mediaService,
    db
  });

  /**
   * Display a list of user collections
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async function listCollections(message, userId) {
    try {
      const collections = await collectionsWorkflow.getUserCollections(userId);
      
      if (!collections || collections.length === 0) {
        await bot.sendMessage(
          message.chat.id,
          'You don\'t have any collections yet. Use /collections create [name] to create one.',
          { reply_to_message_id: message.message_id }
        );
        return;
      }
      
      // Build collections list with inline buttons
      let text = '📚 Your Collections:\n\n';
      const inlineKeyboard = [];
      
      collections.forEach((collection) => {
        text += `• ${collection.name} (${collection.status})\n`;
        
        // Add row of buttons for each collection
        inlineKeyboard.push([
          { text: `View ${collection.name}`, callback_data: `collection:view:${collection.collectionId}` },
          { text: '✏️ Edit', callback_data: `collection:edit:${collection.collectionId}` },
          { text: '🗑️ Delete', callback_data: `collection:delete:${collection.collectionId}` }
        ]);
      });
      
      await bot.sendMessage(
        message.chat.id,
        text,
        {
          reply_to_message_id: message.message_id,
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        }
      );
    } catch (error) {
      logger.error('Error listing collections:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while retrieving your collections.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Display a list of collections shared with user
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async function listSharedCollections(message, userId) {
    try {
      const collections = await collectionsWorkflow.getSharedCollections(userId);
      
      if (!collections || collections.length === 0) {
        await bot.sendMessage(
          message.chat.id,
          'You don\'t have any collections shared with you yet.',
          { reply_to_message_id: message.message_id }
        );
        return;
      }
      
      // Build collections list with inline buttons
      let text = '📚 Collections Shared With You:\n\n';
      const inlineKeyboard = [];
      
      collections.forEach((collection) => {
        // Find the share for this user
        const userShare = collection.shares.find(share => share.userId === userId);
        const permissionType = userShare ? userShare.permissions : 'view';
        
        text += `• ${collection.name} (${permissionType} access)\n`;
        
        // Add row of buttons for each collection
        inlineKeyboard.push([
          { text: `View ${collection.name}`, callback_data: `collection:view:${collection.collectionId}` }
        ]);
      });
      
      await bot.sendMessage(
        message.chat.id,
        text,
        {
          reply_to_message_id: message.message_id,
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        }
      );
    } catch (error) {
      logger.error('Error listing shared collections:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while retrieving shared collections.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Create a new collection
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} name - Collection name
   * @returns {Promise<void>}
   */
  async function createCollection(message, userId, name) {
    if (!name || name.trim() === '') {
      await bot.sendMessage(
        message.chat.id,
        'Please provide a name for your collection. Example: /collections create My Awesome Collection',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    
    try {
      // Send status message
      const statusMessage = await bot.sendMessage(
        message.chat.id, 
        'Creating your collection...',
        { reply_to_message_id: message.message_id }
      );
      
      // Create the collection
      const newCollection = await collectionsWorkflow.createCollection(userId, name);
      
      // Update status message
      await bot.editMessageText(
        `Collection "${name}" created successfully! You can now add items to it.`,
        {
          chat_id: statusMessage.chat.id,
          message_id: statusMessage.message_id,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'View Collection', callback_data: `collection:view:${newCollection.collectionId}` },
                { text: 'Edit Settings', callback_data: `collection:edit:${newCollection.collectionId}` }
              ]
            ]
          }
        }
      );
    } catch (error) {
      logger.error('Error creating collection:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while creating your collection.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * View a specific collection
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function viewCollection(message, userId, collectionId) {
    try {
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      
      // Format collection details
      let text = `📚 Collection: ${collection.name}\n`;
      text += `Status: ${collection.status}\n`;
      text += `Size: ${collection.size || 0} items\n\n`;
      
      if (collection.config?.masterPrompt) {
        text += `Master Prompt: ${collection.config.masterPrompt}\n\n`;
      }
      
      // Add trait types if available
      if (collection.config?.traitTypes && collection.config.traitTypes.length > 0) {
        text += 'Trait Types:\n';
        collection.config.traitTypes.forEach(trait => {
          text += `• ${trait.name}\n`;
        });
      }
      
      // Add sharing information if collection has shares
      if (collection.shares && collection.shares.length > 0) {
        text += '\nShared with:\n';
        collection.shares.forEach(share => {
          text += `• User ${share.userId} (${share.permissions})\n`;
        });
      }
      
      const buttons = [];
      
      // Add main action buttons
      buttons.push([
        { text: 'Edit Collection', callback_data: `collection:edit:${collectionId}` },
        { text: 'Delete Collection', callback_data: `collection:delete:${collectionId}` }
      ]);
      
      // Add sharing buttons if user is the owner (not a shared collection)
      if (!collection.isShared) {
        buttons.push([
          { text: '🔗 Share Collection', callback_data: `collection:share:${collectionId}` },
          { text: '🔗 Create Share Link', callback_data: `collection:createShareLink:${collectionId}` }
        ]);
        
        if (collection.shares && collection.shares.length > 0) {
          buttons.push([
            { text: '⚙️ Manage Shares', callback_data: `collection:manageShares:${collectionId}` }
          ]);
        }
      }
      
      await bot.sendMessage(
        message.chat.id,
        text,
        {
          reply_to_message_id: message.message_id,
          reply_markup: {
            inline_keyboard: buttons
          }
        }
      );
    } catch (error) {
      logger.error('Error viewing collection:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while retrieving collection details.',
        { reply_to_message_id: message.message_id }
      );
    }
  }

  /**
   * Share a collection with another user
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function shareCollection(message, userId, collectionId) {
    try {
      // First check if user owns the collection
      await collectionsWorkflow.getCollection(userId, collectionId, false);
      
      // Ask for target user ID
      const promptMessage = await bot.sendMessage(
        message.chat.id,
        'Please enter the user ID of the person you want to share this collection with:',
        {
          reply_markup: {
            force_reply: true,
            selective: true
          }
        }
      );
      
      // Store the context for handling the reply
      bot.onReplyToMessage(message.chat.id, promptMessage.message_id, async (replyMessage) => {
        try {
          const targetUserId = replyMessage.text.trim();
          
          // Now ask for permission level
          const permissionMessage = await bot.sendMessage(
            message.chat.id,
            'Select permission level:',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: 'View Only', callback_data: `collection:shareProcess:${collectionId}:${targetUserId}:view` },
                    { text: 'Edit Access', callback_data: `collection:shareProcess:${collectionId}:${targetUserId}:edit` }
                  ]
                ]
              }
            }
          );
        } catch (error) {
          logger.error('Error processing share collection:', error);
          await bot.sendMessage(
            message.chat.id,
            'Sorry, an error occurred while processing your request.',
            { reply_to_message_id: replyMessage.message_id }
          );
        }
      });
    } catch (error) {
      logger.error('Error sharing collection:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while sharing your collection.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Process share collection with selected permissions
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - Target user ID to share with
   * @param {string} permissions - Permission level (view/edit)
   * @returns {Promise<void>}
   */
  async function processShareCollection(message, userId, collectionId, targetUserId, permissions) {
    try {
      // Share the collection with the specified permissions
      await collectionsWorkflow.shareCollection(userId, collectionId, {
        targetUserId,
        permissions
      });
      
      await bot.sendMessage(
        message.chat.id,
        `Collection shared with user ${targetUserId} with ${permissions} permissions.`,
        { reply_to_message_id: message.message_id }
      );
      
      // Show updated collection
      await viewCollection(message, userId, collectionId);
    } catch (error) {
      logger.error('Error processing share collection:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while sharing your collection.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Create a share link for a collection
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function createShareLink(message, userId, collectionId) {
    try {
      // First check if user owns the collection
      await collectionsWorkflow.getCollection(userId, collectionId, false);
      
      // Ask for share link expiry
      const expiryMessage = await bot.sendMessage(
        message.chat.id,
        'Select expiry time for the share link:',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '24 hours', callback_data: `collection:createShareLinkProcess:${collectionId}:24h:view` },
                { text: '7 days', callback_data: `collection:createShareLinkProcess:${collectionId}:7d:view` }
              ],
              [
                { text: '30 days', callback_data: `collection:createShareLinkProcess:${collectionId}:30d:view` },
                { text: 'No expiry', callback_data: `collection:createShareLinkProcess:${collectionId}:none:view` }
              ]
            ]
          }
        }
      );
    } catch (error) {
      logger.error('Error creating share link:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while creating a share link.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Process share link creation with selected expiry
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} expiry - Expiry time
   * @param {string} permissions - Permission level
   * @returns {Promise<void>}
   */
  async function processCreateShareLink(message, userId, collectionId, expiry, permissions) {
    try {
      // Create a share link with the specified expiry
      const shareLink = await collectionsWorkflow.createShareLink(userId, collectionId, {
        expiry: expiry === 'none' ? '365d' : expiry,
        permissions
      });
      
      let expiryText = '';
      if (expiry === 'none') {
        expiryText = 'no expiry';
      } else if (expiry.endsWith('h')) {
        expiryText = `${expiry.slice(0, -1)} hours`;
      } else if (expiry.endsWith('d')) {
        expiryText = `${expiry.slice(0, -1)} days`;
      }
      
      await bot.sendMessage(
        message.chat.id,
        `Share link created with ${expiryText}!\n\n` +
        `Link: ${shareLink.url}\n\n` +
        `Anyone with this link can access the collection with ${permissions} permissions.`,
        { reply_to_message_id: message.message_id }
      );
    } catch (error) {
      logger.error('Error processing share link creation:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while creating a share link.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Manage shares for a collection
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function manageShares(message, userId, collectionId) {
    try {
      // Get the collection
      const collection = await collectionsWorkflow.getCollection(userId, collectionId, false);
      
      if (!collection.shares || collection.shares.length === 0) {
        await bot.sendMessage(
          message.chat.id,
          'This collection is not shared with anyone.',
          { reply_to_message_id: message.message_id }
        );
        return;
      }
      
      // Create a message showing all shares with buttons to manage each
      let text = `📚 Manage shares for: ${collection.name}\n\n`;
      
      const inlineKeyboard = [];
      
      collection.shares.forEach(share => {
        text += `• User ${share.userId} (${share.permissions})\n`;
        
        inlineKeyboard.push([
          { 
            text: `${share.permissions === 'view' ? '📝 Grant Edit' : '👁️ Set View-only'}`, 
            callback_data: `collection:changePermissions:${collectionId}:${share.userId}:${share.permissions === 'view' ? 'edit' : 'view'}`
          },
          { 
            text: '🗑️ Remove', 
            callback_data: `collection:unshare:${collectionId}:${share.userId}`
          }
        ]);
      });
      
      // Add back button
      inlineKeyboard.push([
        { text: '◀️ Back', callback_data: `collection:view:${collectionId}` }
      ]);
      
      await bot.sendMessage(
        message.chat.id,
        text,
        {
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        }
      );
    } catch (error) {
      logger.error('Error managing shares:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while managing shares.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Remove sharing for a collection with a specific user
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - Target user ID to unshare with
   * @returns {Promise<void>}
   */
  async function unshareCollection(message, userId, collectionId, targetUserId) {
    try {
      await collectionsWorkflow.unshareCollection(userId, collectionId, targetUserId);
      
      await bot.sendMessage(
        message.chat.id,
        `Collection unshared with user ${targetUserId}.`,
        { reply_to_message_id: message.message_id }
      );
      
      // Show updated manage shares screen
      await manageShares(message, userId, collectionId);
    } catch (error) {
      logger.error('Error unsharing collection:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while unsharing your collection.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Update share permissions for a collection
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - Target user ID to update permissions for
   * @param {string} newPermissions - New permissions (view/edit)
   * @returns {Promise<void>}
   */
  async function updateSharePermissions(message, userId, collectionId, targetUserId, newPermissions) {
    try {
      await collectionsWorkflow.updateSharePermissions(userId, collectionId, targetUserId, newPermissions);
      
      await bot.sendMessage(
        message.chat.id,
        `Permissions updated for user ${targetUserId} to ${newPermissions}.`,
        { reply_to_message_id: message.message_id }
      );
      
      // Show updated manage shares screen
      await manageShares(message, userId, collectionId);
    } catch (error) {
      logger.error('Error updating share permissions:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while updating share permissions.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Delete a collection
   * @param {Object} message - Telegram message
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function deleteCollection(message, userId, collectionId) {
    try {
      await collectionsWorkflow.deleteCollection(userId, collectionId);
      
      await bot.sendMessage(
        message.chat.id,
        'Collection deleted successfully.',
        { reply_to_message_id: message.message_id }
      );
    } catch (error) {
      logger.error('Error deleting collection:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while deleting your collection.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Handle the collections command
   * @param {Object} message - Telegram message
   * @param {string} args - Command arguments
   * @returns {Promise<void>}
   */
  const handleCollectionsCommand = async function(message, args) {
    const userId = message.from.id;
    
    // Parse command arguments
    const [subCommand, ...restArgs] = args ? args.split(' ') : [''];
    
    // Handle different subcommands
    switch (subCommand.toLowerCase()) {
      case 'create':
        await createCollection(message, userId, restArgs.join(' '));
        break;
      
      case 'view':
        if (!restArgs[0]) {
          await bot.sendMessage(
            message.chat.id,
            'Please specify a collection ID to view. Use /collections to see your collections.',
            { reply_to_message_id: message.message_id }
          );
          return;
        }
        await viewCollection(message, userId, restArgs[0]);
        break;
      
      case 'delete':
        if (!restArgs[0]) {
          await bot.sendMessage(
            message.chat.id,
            'Please specify a collection ID to delete. Use /collections to see your collections.',
            { reply_to_message_id: message.message_id }
          );
          return;
        }
        await deleteCollection(message, userId, restArgs[0]);
        break;
        
      case 'shared':
        await listSharedCollections(message, userId);
        break;
      
      default:
        // Default to listing collections
        await listCollections(message, userId);
        break;
    }
  };
  
  // Expose share-related functions to be called by callback query handler
  handleCollectionsCommand._shareCollection = shareCollection;
  handleCollectionsCommand._processShareCollection = processShareCollection;
  handleCollectionsCommand._createShareLink = createShareLink;
  handleCollectionsCommand._processCreateShareLink = processCreateShareLink;
  handleCollectionsCommand._manageShares = manageShares;
  handleCollectionsCommand._unshareCollection = unshareCollection;
  handleCollectionsCommand._updateSharePermissions = updateSharePermissions;
  
  return handleCollectionsCommand;
}

module.exports = createCollectionsCommandHandler; 