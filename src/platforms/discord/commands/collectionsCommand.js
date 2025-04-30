/**
 * Collections Command Handler for Discord
 * 
 * Handles the /collections command which allows users to manage their collections.
 */

const { CollectionsWorkflow } = require('../../../workflows/collections');
const createDiscordMediaAdapter = require('../mediaAdapter');
const { 
  SlashCommandBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

/**
 * Create collections command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createCollectionsCommandHandler(dependencies) {
  const { 
    sessionService,
    mediaService,
    db,
    client,
    logger = console
  } = dependencies;
  
  // Create Discord adapter for media operations
  const discordMediaAdapter = createDiscordMediaAdapter(client);
  
  // Create collections workflow instance
  const collectionsWorkflow = new CollectionsWorkflow({
    sessionService,
    mediaService,
    db
  });

  /**
   * Display a list of user collections
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async function listCollections(interaction, userId) {
    try {
      const collections = await collectionsWorkflow.getUserCollections(userId);
      
      if (!collections || collections.length === 0) {
        await interaction.editReply({
          content: "You don't have any collections yet. Use the Create button to create one."
        });
        
        // Add create collection button
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('collection:create')
              .setLabel('Create Collection')
              .setStyle(ButtonStyle.Primary)
          );
          
        await interaction.editReply({
          components: [row]
        });
        return;
      }
      
      // Build collections embed
      const embed = new EmbedBuilder()
        .setTitle('📚 Your Collections')
        .setColor(0x0099FF)
        .setDescription('Here are all your collections. Use the buttons to manage them.');
      
      // Add collection information as fields
      collections.forEach(collection => {
        embed.addFields({
          name: collection.name,
          value: `Status: ${collection.status}\nSize: ${collection.size || 'N/A'} items`
        });
      });
      
      // Create action rows with buttons for each collection (max 5 collections per message due to Discord limits)
      const rows = [];
      
      for (let i = 0; i < Math.min(collections.length, 5); i++) {
        const collection = collections[i];
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`collection:view:${collection.collectionId}`)
              .setLabel(`View ${collection.name}`)
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`collection:edit:${collection.collectionId}`)
              .setLabel('Edit')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`collection:delete:${collection.collectionId}`)
              .setLabel('Delete')
              .setStyle(ButtonStyle.Danger)
          );
        rows.push(row);
      }
      
      // Add create collection button as the last row
      const createRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('collection:create')
            .setLabel('Create New Collection')
            .setStyle(ButtonStyle.Success)
        );
      rows.push(createRow);
      
      await interaction.editReply({
        embeds: [embed],
        components: rows
      });
    } catch (error) {
      logger.error('Error listing collections:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while retrieving your collections.'
      });
    }
  }
  
  /**
   * Create a new collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} name - Collection name
   * @returns {Promise<void>}
   */
  async function createCollection(interaction, userId, name) {
    try {
      // Create the collection
      const newCollection = await collectionsWorkflow.createCollection(userId, name);
      
      // Create embed for success message
      const embed = new EmbedBuilder()
        .setTitle('Collection Created')
        .setColor(0x00FF00)
        .setDescription(`Collection "${name}" created successfully! You can now add items to it.`)
        .addFields(
          { name: 'Collection ID', value: newCollection.collectionId },
          { name: 'Status', value: newCollection.status }
        );
      
      // Create action row with buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:view:${newCollection.collectionId}`)
            .setLabel('View Collection')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`collection:edit:${newCollection.collectionId}`)
            .setLabel('Edit Settings')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error creating collection:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while creating your collection.'
      });
    }
  }
  
  /**
   * View a specific collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function viewCollection(interaction, userId, collectionId) {
    try {
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      
      // Create embed for collection details
      const embed = new EmbedBuilder()
        .setTitle(`📚 Collection: ${collection.name}`)
        .setColor(0x0099FF)
        .addFields(
          { name: 'Status', value: collection.status, inline: true },
          { name: 'Size', value: `${collection.size || 'N/A'} items`, inline: true },
          { name: 'ID', value: collection.collectionId, inline: true }
        );
      
      // Add sharing information if collection has shares
      if (collection.shares && collection.shares.length > 0) {
        const sharesText = collection.shares.map(share => 
          `<@${share.userId}> (${share.permissions})`
        ).join('\n');
        
        embed.addFields({ name: 'Shared With', value: sharesText });
      }

      // Create buttons for collection actions
      const row1 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:items:${collection.collectionId}`)
            .setLabel('View Items')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`collection:edit:${collection.collectionId}`)
            .setLabel('Edit Settings')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`collection:share:${collection.collectionId}`)
            .setLabel('Share Collection')
            .setStyle(ButtonStyle.Success)
        );
      
      const row2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:createShareLink:${collection.collectionId}`)
            .setLabel('Create Share Link')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`collection:manageShares:${collection.collectionId}`)
            .setLabel('Manage Shares')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`collection:delete:${collection.collectionId}`)
            .setLabel('Delete Collection')
            .setStyle(ButtonStyle.Danger)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row1, row2]
      });
    } catch (error) {
      logger.error('Error viewing collection:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while loading the collection.'
      });
    }
  }
  
  /**
   * Delete a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function deleteCollection(interaction, userId, collectionId) {
    try {
      await collectionsWorkflow.deleteCollection(userId, collectionId);
      
      await interaction.editReply({
        content: 'Collection deleted successfully.',
        components: [
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('collection:list')
                .setLabel('Back to Collections')
                .setStyle(ButtonStyle.Secondary)
            )
        ]
      });
    } catch (error) {
      logger.error('Error deleting collection:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while deleting your collection.'
      });
    }
  }
  
  /**
   * Add an item to a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {Object} item - Item to add
   * @returns {Promise<void>}
   */
  async function addItemToCollection(interaction, userId, collectionId, item) {
    try {
      // Get the collection first to verify it exists
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      
      // Call the workflow to add the item
      await collectionsWorkflow.addItemToCollection(userId, collectionId, item);
      
      // Create confirmation embed
      const embed = new EmbedBuilder()
        .setTitle('Item Added')
        .setColor(0x00FF00)
        .setDescription(`Item successfully added to collection "${collection.name}"!`)
        .addFields(
          { name: 'Item ID', value: item.id },
          { name: 'Collection', value: collection.name }
        );
      
      // If the item has an image, add it to the embed
      if (item.imageUrl) {
        embed.setImage(item.imageUrl);
      }
      
      // Create action row with buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:items:${collectionId}`)
            .setLabel('View Collection Items')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`collection:view:${collectionId}`)
            .setLabel('View Collection Details')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error adding item to collection:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while adding the item to your collection.'
      });
    }
  }
  
  /**
   * Show items in a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function showCollectionItems(interaction, userId, collectionId) {
    try {
      const items = await collectionsWorkflow.getCollectionItems(userId, collectionId);
      
      if (!items || items.length === 0) {
        await interaction.editReply({
          content: "This collection doesn't have any items yet. Use Add Item to add one."
        });
        
        // Add "Add Item" button
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`collection:additem:${collectionId}`)
              .setLabel('Add Item')
              .setStyle(ButtonStyle.Primary)
          );
          
        await interaction.editReply({
          components: [row]
        });
        return;
      }
      
      // Build collection items embed
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      const embed = new EmbedBuilder()
        .setTitle(`📚 Items in: ${collection.name}`)
        .setColor(0x0099FF)
        .setDescription(`This collection has ${items.length} items. Select an item to view or edit.`);
      
      // Use a thumbnail for the collection itself if available
      if (items.length > 0 && items[0].thumbnailUrl) {
        embed.setThumbnail(items[0].thumbnailUrl);
      }
      
      // Display the first set of items (Discord has a limit on fields)
      const pageSize = 5;
      const pageItems = items.slice(0, pageSize);
      
      // Add items as fields with thumbnails
      pageItems.forEach(item => {
        const fieldValue = `Type: ${item.type || 'Unknown'}\n${item.description || 'No description'}\n${item.thumbnailUrl ? '[Thumbnail Available]' : ''}`;
        
        embed.addFields({
          name: `Item: ${item.name || item.itemId.slice(0, 8)}`,
          value: fieldValue
        });
      });
      
      // If there are more than pageSize items, add pagination info
      if (items.length > pageSize) {
        embed.setFooter({ text: `Showing ${pageSize} of ${items.length} items. Use navigation buttons to see more.` });
      }
      
      // Create action rows with buttons for each displayed item
      const rows = [];
      
      // Add item-specific action buttons
      pageItems.forEach((item, index) => {
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`collection:viewitem:${collectionId}:${item.itemId}`)
              .setLabel(`View ${item.name || `Item ${index + 1}`}`)
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`collection:edititem:${collectionId}:${item.itemId}`)
              .setLabel('Edit Item')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`collection:removeitem:${collectionId}:${item.itemId}`)
              .setLabel('Remove')
              .setStyle(ButtonStyle.Danger)
          );
        rows.push(row);
      });
      
      // Add general action buttons as the last row
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:additem:${collectionId}`)
            .setLabel('Add Item')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`collection:view:${collectionId}`)
            .setLabel('Back to Collection')
            .setStyle(ButtonStyle.Secondary)
        );
      rows.push(actionRow);
      
      await interaction.editReply({
        embeds: [embed],
        components: rows
      });
    } catch (error) {
      logger.error('Error showing collection items:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while retrieving collection items.'
      });
    }
  }
  
  /**
   * Remove an item from a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} itemId - ID of the item to remove
   * @returns {Promise<void>}
   */
  async function removeItemFromCollection(interaction, userId, collectionId, itemId) {
    try {
      // Get the collection first to verify it exists
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      
      // Call the workflow to remove the item
      await collectionsWorkflow.removeItemFromCollection(userId, collectionId, itemId);
      
      // Create confirmation embed
      const embed = new EmbedBuilder()
        .setTitle('Item Removed')
        .setColor(0xFF0000)
        .setDescription(`Item successfully removed from collection "${collection.name}"!`);
      
      // Create action row with buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:items:${collectionId}`)
            .setLabel('View Collection Items')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`collection:view:${collectionId}`)
            .setLabel('View Collection Details')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error removing item from collection:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while removing the item from your collection.'
      });
    }
  }
  
  /**
   * Edit an item in a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} itemId - ID of the item to edit
   * @param {Object} updates - Updates to apply to the item
   * @returns {Promise<void>}
   */
  async function editItemInCollection(interaction, userId, collectionId, itemId, updates) {
    try {
      // Get the collection first to verify it exists
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      
      // Call the workflow to edit the item
      await collectionsWorkflow.editItemInCollection(userId, collectionId, itemId, updates);
      
      // Create confirmation embed
      const embed = new EmbedBuilder()
        .setTitle('Item Updated')
        .setColor(0x00FFFF)
        .setDescription(`Item successfully updated in collection "${collection.name}"!`);
      
      // Create action row with buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:items:${collectionId}`)
            .setLabel('View Collection Items')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`collection:view:${collectionId}`)
            .setLabel('View Collection Details')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error editing item in collection:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while updating the item in your collection.'
      });
    }
  }
  
  /**
   * View a single item in a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} itemId - Item ID
   * @returns {Promise<void>}
   */
  async function viewCollectionItem(interaction, userId, collectionId, itemId) {
    try {
      // Get all items first
      const items = await collectionsWorkflow.getCollectionItems(userId, collectionId);
      
      // Find the specific item
      const item = items.find(i => i.itemId === itemId);
      
      if (!item) {
        await interaction.editReply({
          content: 'Item not found. It may have been removed from the collection.'
        });
        return;
      }
      
      // Get collection details
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      
      // Create embed for item details
      const embed = new EmbedBuilder()
        .setTitle(`Item: ${item.name || `Item ${itemId.slice(0, 8)}`}`)
        .setColor(0x0099FF)
        .setDescription(item.description || 'No description available');
      
      // Add item metadata fields
      embed.addFields(
        { name: 'Type', value: item.type || 'Unknown', inline: true },
        { name: 'Collection', value: collection.name, inline: true },
        { name: 'ID', value: item.itemId, inline: true }
      );
      
      // If the item has a URL, add it as a field
      if (item.url) {
        embed.addFields({ name: 'URL', value: item.url });
      }
      
      // If the item has a thumbnail, set it as the embed image
      if (item.thumbnailUrl) {
        embed.setImage(item.thumbnailUrl);
      }
      
      // Add timestamp
      embed.setTimestamp();
      
      // Create action row with item action buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:edititem:${collectionId}:${itemId}`)
            .setLabel('Edit Item')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`collection:removeitem:${collectionId}:${itemId}`)
            .setLabel('Remove Item')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`collection:items:${collectionId}`)
            .setLabel('Back to Items')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // If the item has a URL, add a button to open it
      if (item.url) {
        row.addComponents(
          new ButtonBuilder()
            .setURL(item.url)
            .setLabel('Open URL')
            .setStyle(ButtonStyle.Link)
        );
      }
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error viewing collection item:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while retrieving the item details.'
      });
    }
  }
  
  /**
   * Share collection with another user
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function shareCollection(interaction, userId, collectionId) {
    try {
      // Create a modal for sharing the collection
      const modal = new ModalBuilder()
        .setCustomId(`collection:shareSubmit:${collectionId}`)
        .setTitle('Share Collection');
      
      // Add input fields for user ID and permissions
      const userIdInput = new TextInputBuilder()
        .setCustomId('targetUserId')
        .setLabel('Discord User ID')
        .setPlaceholder('Enter Discord user ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      const permissionsInput = new TextInputBuilder()
        .setCustomId('permissions')
        .setLabel('Permissions')
        .setPlaceholder('view or edit')
        .setValue('view')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      // Add to action rows
      const userIdRow = new ActionRowBuilder().addComponents(userIdInput);
      const permissionsRow = new ActionRowBuilder().addComponents(permissionsInput);
      
      // Add rows to modal
      modal.addComponents(userIdRow, permissionsRow);
      
      // Show modal
      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error showing share modal:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while preparing to share the collection.'
      });
    }
  }
  
  /**
   * Process share collection submission
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function processShareSubmit(interaction, userId, collectionId) {
    try {
      // Get values from modal
      const targetUserId = interaction.fields.getTextInputValue('targetUserId');
      const permissions = interaction.fields.getTextInputValue('permissions');
      
      // Validate permissions
      if (permissions !== 'view' && permissions !== 'edit') {
        await interaction.reply({
          content: 'Invalid permissions. Use "view" or "edit".',
          ephemeral: true
        });
        return;
      }
      
      // Share the collection
      await collectionsWorkflow.shareCollection(userId, collectionId, {
        targetUserId,
        permissions
      });
      
      // Reply with success message
      await interaction.reply({
        content: `Collection shared with <@${targetUserId}> with ${permissions} permissions.`,
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error sharing collection:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while sharing the collection.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Create a share link for a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function createShareLink(interaction, userId, collectionId) {
    try {
      // Create a modal for setting share link options
      const modal = new ModalBuilder()
        .setCustomId(`collection:createShareLinkSubmit:${collectionId}`)
        .setTitle('Create Share Link');
      
      // Add dropdown for expiry options instead of free text
      const expirySelect = new TextInputBuilder()
        .setCustomId('expiry')
        .setLabel('Expiry (days)')
        .setPlaceholder('Enter one of: 1, 3, 7, 14, 30, 90')
        .setValue('7')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      const permissionsInput = new TextInputBuilder()
        .setCustomId('permissions')
        .setLabel('Permissions')
        .setPlaceholder('view or edit')
        .setValue('view')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      // Add to action rows
      const expiryRow = new ActionRowBuilder().addComponents(expirySelect);
      const permissionsRow = new ActionRowBuilder().addComponents(permissionsInput);
      
      // Add rows to modal
      modal.addComponents(expiryRow, permissionsRow);
      
      // Show modal
      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error showing share link modal:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while preparing to create a share link.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Process create share link submission
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function processCreateShareLinkSubmit(interaction, userId, collectionId) {
    try {
      // Get values from modal
      const expiryInput = interaction.fields.getTextInputValue('expiry');
      const permissions = interaction.fields.getTextInputValue('permissions');
      
      // Validate permissions
      if (permissions !== 'view' && permissions !== 'edit') {
        await interaction.reply({
          content: 'Invalid permissions. Use "view" or "edit".',
          ephemeral: true
        });
        return;
      }
      
      // Validate expiry value
      const validExpiryValues = ['1', '3', '7', '14', '30', '90'];
      let expiryDays = parseInt(expiryInput);
      
      if (isNaN(expiryDays) || !validExpiryValues.includes(expiryInput)) {
        expiryDays = 7; // Default to 7 days if invalid input
      }
      
      // Convert to format expected by collectionsWorkflow
      const expiry = `${expiryDays}d`;
      
      // Create the share link
      const shareLink = await collectionsWorkflow.createShareLink(userId, collectionId, {
        expiry,
        permissions
      });
      
      // Create full share URL
      const baseUrl = process.env.BASE_URL || 'https://stationthis.com';
      const fullShareUrl = `${baseUrl}${shareLink.url}`;
      
      // Format the expiry date nicely
      const expiryDate = new Date(shareLink.expiresAt);
      const expiryDateFormatted = expiryDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Calculate days remaining
      const now = new Date();
      const diffTime = expiryDate - now;
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // Choose color based on days remaining
      let color = 0x00FF00; // Green by default
      if (daysRemaining <= 3) {
        color = 0xFFA500; // Orange for 3 days or less
      }
      
      // Create embed for share link
      const embed = new EmbedBuilder()
        .setTitle('Collection Share Link')
        .setColor(color)
        .setDescription('Share this link with others to give them access to your collection.')
        .addFields(
          { name: 'URL', value: fullShareUrl },
          { name: 'Permissions', value: shareLink.permissions, inline: true },
          { name: 'Expires', value: expiryDateFormatted, inline: true },
          { name: 'Days Remaining', value: `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}` }
        );
      
      // Add buttons for copying link and managing expiry
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:updateLinkExpiry:${collectionId}`)
            .setLabel('Update Expiry')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Reply with the share link
      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error creating share link:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while creating the share link.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Show update expiry modal
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function showUpdateExpiryModal(interaction, userId, collectionId) {
    try {
      // Create a modal for updating expiry
      const modal = new ModalBuilder()
        .setCustomId(`collection:updateExpirySubmit:${collectionId}`)
        .setTitle('Update Share Link Expiry');
      
      // Add dropdown for expiry options
      const expirySelect = new TextInputBuilder()
        .setCustomId('expiryDays')
        .setLabel('New Expiry (days)')
        .setPlaceholder('Enter one of: 1, 3, 7, 14, 30, 90')
        .setValue('7')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      // Add to action row
      const expiryRow = new ActionRowBuilder().addComponents(expirySelect);
      
      // Add row to modal
      modal.addComponents(expiryRow);
      
      // Show modal
      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error showing update expiry modal:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while preparing to update the expiry date.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Process update expiry submission
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function processUpdateExpirySubmit(interaction, userId, collectionId) {
    try {
      // Get values from modal
      const expiryDaysInput = interaction.fields.getTextInputValue('expiryDays');
      
      // Validate expiry value
      const validExpiryValues = ['1', '3', '7', '14', '30', '90'];
      let expiryDays = parseInt(expiryDaysInput);
      
      if (isNaN(expiryDays) || !validExpiryValues.includes(expiryDaysInput)) {
        expiryDays = 7; // Default to 7 days if invalid input
      }
      
      // Update the share link expiry
      const updatedShareLink = await collectionsWorkflow.updateShareLinkExpiry(userId, collectionId, expiryDays);
      
      // Format the expiry date nicely
      const expiryDate = new Date(updatedShareLink.expiresAt);
      const expiryDateFormatted = expiryDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Calculate days remaining
      const now = new Date();
      const diffTime = expiryDate - now;
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // Choose color based on days remaining
      let color = 0x00FF00; // Green by default
      if (daysRemaining <= 3) {
        color = 0xFFA500; // Orange for 3 days or less
      }
      
      // Create embed for updated share link
      const embed = new EmbedBuilder()
        .setTitle('Share Link Expiry Updated')
        .setColor(color)
        .setDescription('The expiry date for your share link has been updated.')
        .addFields(
          { name: 'New Expiry', value: expiryDateFormatted, inline: true },
          { name: 'Days Remaining', value: `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}`, inline: true }
        );
      
      // Reply with the updated expiry info
      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error updating share link expiry:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while updating the share link expiry.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Manage shares for a collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @returns {Promise<void>}
   */
  async function manageShares(interaction, userId, collectionId) {
    try {
      // Get the collection to see current shares
      const collection = await collectionsWorkflow.getCollection(userId, collectionId);
      
      if (!collection.shares || collection.shares.length === 0) {
        await interaction.reply({
          content: 'This collection is not shared with anyone.',
          ephemeral: true
        });
        return;
      }
      
      // Create embed for managing shares
      const embed = new EmbedBuilder()
        .setTitle(`Manage Shares: ${collection.name}`)
        .setColor(0x0099FF)
        .setDescription('Select a user to remove sharing or update permissions.');
      
      // Add each share as a field
      collection.shares.forEach(share => {
        embed.addFields({
          name: `User: <@${share.userId}>`,
          value: `Permissions: ${share.permissions}`
        });
      });
      
      // Create action rows with buttons for each share (max 5 per message)
      const rows = [];
      
      for (let i = 0; i < Math.min(collection.shares.length, 5); i++) {
        const share = collection.shares[i];
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`collection:unshare:${collectionId}:${share.userId}`)
              .setLabel(`Unshare with ${share.userId}`)
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`collection:changePermissions:${collectionId}:${share.userId}`)
              .setLabel('Change Permissions')
              .setStyle(ButtonStyle.Secondary)
          );
        rows.push(row);
      }
      
      // Add a back button
      const backRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`collection:view:${collectionId}`)
            .setLabel('Back to Collection')
            .setStyle(ButtonStyle.Primary)
        );
      rows.push(backRow);
      
      await interaction.reply({
        embeds: [embed],
        components: rows,
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error managing shares:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while loading collection shares.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Unshare a collection with a specific user
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - Target user ID to unshare with
   * @returns {Promise<void>}
   */
  async function unshareCollection(interaction, userId, collectionId, targetUserId) {
    try {
      // Unshare the collection
      await collectionsWorkflow.unshareCollection(userId, collectionId, targetUserId);
      
      // Reply with success message
      await interaction.reply({
        content: `Collection is no longer shared with <@${targetUserId}>.`,
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error unsharing collection:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while unsharing the collection.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Change permissions for a shared collection
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - Target user ID to change permissions for
   * @returns {Promise<void>}
   */
  async function changeSharePermissions(interaction, userId, collectionId, targetUserId) {
    try {
      // Create a modal for updating permissions
      const modal = new ModalBuilder()
        .setCustomId(`collection:updatePermissionsSubmit:${collectionId}:${targetUserId}`)
        .setTitle('Update Permissions');
      
      // Add input field for permissions
      const permissionsInput = new TextInputBuilder()
        .setCustomId('permissions')
        .setLabel('Permissions')
        .setPlaceholder('view or edit')
        .setValue('view')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      // Add to action row
      const permissionsRow = new ActionRowBuilder().addComponents(permissionsInput);
      
      // Add row to modal
      modal.addComponents(permissionsRow);
      
      // Show modal
      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error showing permissions modal:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while preparing to update permissions.',
        ephemeral: true
      });
    }
  }
  
  /**
   * Process update permissions submission
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} collectionId - Collection ID
   * @param {string} targetUserId - Target user ID
   * @returns {Promise<void>}
   */
  async function processUpdatePermissionsSubmit(interaction, userId, collectionId, targetUserId) {
    try {
      // Get values from modal
      const permissions = interaction.fields.getTextInputValue('permissions');
      
      // Validate permissions
      if (permissions !== 'view' && permissions !== 'edit') {
        await interaction.reply({
          content: 'Invalid permissions. Use "view" or "edit".',
          ephemeral: true
        });
        return;
      }
      
      // Update the permissions
      await collectionsWorkflow.updateSharePermissions(userId, collectionId, targetUserId, permissions);
      
      // Reply with success message
      await interaction.reply({
        content: `Updated permissions for <@${targetUserId}> to ${permissions}.`,
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error updating permissions:', error);
      await interaction.reply({
        content: 'Sorry, an error occurred while updating share permissions.',
        ephemeral: true
      });
    }
  }

  /**
   * List shared collections for user
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async function listSharedCollections(interaction, userId) {
    try {
      const sharedCollections = await collectionsWorkflow.getSharedCollections(userId);
      
      if (!sharedCollections || sharedCollections.length === 0) {
        await interaction.editReply({
          content: "You don't have any collections shared with you."
        });
        return;
      }
      
      // Build shared collections embed
      const embed = new EmbedBuilder()
        .setTitle('📚 Collections Shared with You')
        .setColor(0x0099FF)
        .setDescription('Here are collections that others have shared with you.');
      
      // Add collection information as fields
      sharedCollections.forEach(collection => {
        // Find the share to determine permissions
        const userShare = collection.shares.find(share => share.userId === userId);
        const permissions = userShare ? userShare.permissions : 'unknown';
        
        embed.addFields({
          name: collection.name,
          value: `Owner: <@${collection.userId}>\nPermissions: ${permissions}\nStatus: ${collection.status}`
        });
      });
      
      // Create action rows with buttons for each shared collection (max 5 per message)
      const rows = [];
      
      for (let i = 0; i < Math.min(sharedCollections.length, 5); i++) {
        const collection = sharedCollections[i];
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`collection:view:${collection.collectionId}`)
              .setLabel(`View ${collection.name}`)
              .setStyle(ButtonStyle.Primary)
          );
        rows.push(row);
      }
      
      await interaction.editReply({
        embeds: [embed],
        components: rows
      });
    } catch (error) {
      logger.error('Error listing shared collections:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while retrieving shared collections.'
      });
    }
  }

  /**
   * Command handler function for /collections
   */
  return async function handleCollectionsCommand(interaction) {
    try {
      const userId = interaction.user.id;
      await interaction.deferReply({ ephemeral: true });
      
      // Get command options
      const subcommand = interaction.options.getSubcommand();
      
      // Handle subcommands
      switch (subcommand) {
        case 'list':
          await listCollections(interaction, userId);
          break;
          
        case 'shared':
          await listSharedCollections(interaction, userId);
          break;
          
        case 'create':
          const name = interaction.options.getString('name');
          await createCollection(interaction, userId, name);
          break;
          
        case 'view':
          const collectionId = interaction.options.getString('id');
          await viewCollection(interaction, userId, collectionId);
          break;
          
        case 'items':
          const itemsCollectionId = interaction.options.getString('id');
          await showCollectionItems(interaction, userId, itemsCollectionId);
          break;
          
        default:
          await interaction.editReply({
            content: 'Unknown subcommand'
          });
      }
    } catch (error) {
      logger.error('Error handling collections command:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while processing your command.'
      });
    }
  };
}

/**
 * Register collections-related button interactions
 * @param {Object} client - Discord client
 * @param {Function} handler - Collections command handler
 */
function registerCollectionInteractions(client, handler) {
  // Register button click handlers
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const { customId } = interaction;
    
    // Parse the action and ID from the customId
    if (customId.startsWith('collection:')) {
      await interaction.deferUpdate().catch(err => {}); // Defer update to avoid "This interaction failed" message
      
      const userId = interaction.user.id;
      const parts = customId.split(':');
      const action = parts[1];
      
      switch (action) {
        case 'view':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.viewCollection(interaction, userId, collectionId);
          }
          break;
        case 'edit':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            // Implementation for edit collection
          }
          break;
        case 'delete':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.deleteCollection(interaction, userId, collectionId);
          }
          break;
        case 'create':
          // Show modal for creating collection
          const modal = new ModalBuilder()
            .setCustomId('collection:createSubmit')
            .setTitle('Create New Collection');
          
          const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Collection Name')
            .setPlaceholder('Enter a name for your collection')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          
          const row = new ActionRowBuilder().addComponents(nameInput);
          modal.addComponents(row);
          
          await interaction.showModal(modal);
          break;
        case 'items':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.showCollectionItems(interaction, userId, collectionId);
          }
          break;
        case 'share':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.shareCollection(interaction, userId, collectionId);
          }
          break;
        case 'createShareLink':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.createShareLink(interaction, userId, collectionId);
          }
          break;
        case 'manageShares':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.manageShares(interaction, userId, collectionId);
          }
          break;
        case 'unshare':
          if (parts.length >= 4) {
            const collectionId = parts[2];
            const targetUserId = parts[3];
            await handler.unshareCollection(interaction, userId, collectionId, targetUserId);
          }
          break;
        case 'changePermissions':
          if (parts.length >= 4) {
            const collectionId = parts[2];
            const targetUserId = parts[3];
            await handler.changeSharePermissions(interaction, userId, collectionId, targetUserId);
          }
          break;
        case 'updateLinkExpiry':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.showUpdateExpiryModal(interaction, userId, collectionId);
          }
          break;
      }
    }
  });
  
  // Register modal submit handlers
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    
    const { customId } = interaction;
    const userId = interaction.user.id;
    
    if (customId.startsWith('collection:')) {
      const parts = customId.split(':');
      const action = parts[1];
      
      switch (action) {
        case 'createSubmit':
          // Handle collection creation submit
          const name = interaction.fields.getTextInputValue('name');
          await handler.createCollection(interaction, userId, name);
          break;
        case 'shareSubmit':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.processShareSubmit(interaction, userId, collectionId);
          }
          break;
        case 'createShareLinkSubmit':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.processCreateShareLinkSubmit(interaction, userId, collectionId);
          }
          break;
        case 'updatePermissionsSubmit':
          if (parts.length >= 4) {
            const collectionId = parts[2];
            const targetUserId = parts[3];
            await handler.processUpdatePermissionsSubmit(interaction, userId, collectionId, targetUserId);
          }
          break;
        case 'updateExpirySubmit':
          if (parts.length >= 3) {
            const collectionId = parts[2];
            await handler.processUpdateExpirySubmit(interaction, userId, collectionId);
          }
          break;
      }
    }
  });
}

/**
 * Create the Slash Command builder for collections
 * @returns {SlashCommandBuilder} - Slash command
 */
function createCollectionsCommand() {
  return new SlashCommandBuilder()
    .setName('collections')
    .setDescription('Manage your collections')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List your collections')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('shared')
        .setDescription('List collections shared with you')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new collection')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Collection name')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View a collection')
        .addStringOption(option =>
          option
            .setName('id')
            .setDescription('Collection ID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('items')
        .setDescription('View items in a collection')
        .addStringOption(option =>
          option
            .setName('id')
            .setDescription('Collection ID')
            .setRequired(true)
        )
    );
}

module.exports = {
  createCollectionsCommandHandler,
  createCollectionsCommand,
  registerCollectionInteractions
}; 