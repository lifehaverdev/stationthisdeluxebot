/**
 * Train Model Command Handler for Discord
 * 
 * Handles the /train command which allows users to train custom LoRA models.
 */

const { 
  SlashCommandBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');
const createDiscordMediaAdapter = require('../mediaAdapter');

/**
 * Create train model command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createTrainModelCommandHandler(dependencies) {
  const { 
    sessionService,
    workflowsService,
    client,
    logger = console
  } = dependencies;
  
  // Create Discord adapter for media operations
  const discordMediaAdapter = createDiscordMediaAdapter(client);
  
  // Command data for slash command registration
  const commandData = new SlashCommandBuilder()
    .setName('train')
    .setDescription('Train a custom LoRA model with your images')
    .addSubcommand(subcommand => 
      subcommand
        .setName('list')
        .setDescription('List your training datasets')
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('create')
        .setDescription('Create a new training dataset')
        .addStringOption(option => 
          option
            .setName('name')
            .setDescription('Name for your new LoRA')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('view')
        .setDescription('View details of a training dataset')
        .addStringOption(option => 
          option
            .setName('id')
            .setDescription('ID of the training dataset')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('upload')
        .setDescription('Upload images to a training dataset')
        .addStringOption(option => 
          option
            .setName('id')
            .setDescription('ID of the training dataset')
            .setRequired(true)
        )
        .addAttachmentOption(option => 
          option
            .setName('image')
            .setDescription('Image to add to training dataset')
            .setRequired(true)
        )
        .addStringOption(option => 
          option
            .setName('caption')
            .setDescription('Caption for the image')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('start')
        .setDescription('Start training the model')
        .addStringOption(option => 
          option
            .setName('id')
            .setDescription('ID of the training dataset')
            .setRequired(true)
        )
    );

  /**
   * List training datasets for a user
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async function listTrainingDatasets(interaction, userId) {
    try {
      const userSession = await sessionService.getSession(userId);
      const loras = userSession?.loras || [];
      
      if (loras.length === 0) {
        await interaction.editReply({
          content: "You don't have any training datasets yet. Use `/train create` to create one."
        });
        return;
      }
      
      // Build embed to display datasets
      const embed = new EmbedBuilder()
        .setTitle('🧠 Your LoRA Training Datasets')
        .setColor(0x0099FF)
        .setDescription('Here are your training datasets:');
      
      loras.forEach(lora => {
        const filledImages = lora.images.filter(img => img).length;
        const filledCaptions = lora.captions.filter(cap => cap).length;
        
        embed.addFields({
          name: lora.name,
          value: `ID: ${lora.loraId}\nStatus: ${lora.status}\nImages: ${filledImages}/20\nCaptions: ${filledCaptions}/20`
        });
      });
      
      // Add button row for each dataset (limited by Discord's max 5 action rows)
      const rows = [];
      
      for (let i = 0; i < Math.min(loras.length, 5); i++) {
        const lora = loras[i];
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`train:view:${lora.loraId}`)
              .setLabel(`View ${lora.name}`)
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`train:upload:${lora.loraId}`)
              .setLabel('Upload Images')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`train:start:${lora.loraId}`)
              .setLabel('Start Training')
              .setStyle(ButtonStyle.Success)
          );
        rows.push(row);
      }
      
      // Add create button as last row
      const createRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('train:create')
            .setLabel('Create New Dataset')
            .setStyle(ButtonStyle.Primary)
        );
      rows.push(createRow);
      
      await interaction.editReply({
        embeds: [embed],
        components: rows
      });
    } catch (error) {
      logger.error('Error listing training datasets:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while retrieving your training datasets.'
      });
    }
  }

  /**
   * Create a new training dataset
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} name - Name for the dataset
   * @returns {Promise<void>}
   */
  async function createTrainingDataset(interaction, userId, name) {
    try {
      // Call the trainModel workflow to create a new dataset
      const result = await workflowsService.trainModel({
        userId,
        name,
        platform: 'discord'
      });
      
      if (!result.success) {
        await interaction.editReply({
          content: `Failed to create training dataset: ${result.message || 'Unknown error'}`
        });
        return;
      }
      
      // Build success embed
      const embed = new EmbedBuilder()
        .setTitle('Training Dataset Created')
        .setColor(0x00FF00)
        .setDescription(`Your training dataset "${name}" has been created.`)
        .addFields(
          { name: 'Dataset ID', value: result.loraId },
          { name: 'Instructions', value: 'Use the buttons below to upload training images or view details.' }
        );
      
      // Add action buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`train:view:${result.loraId}`)
            .setLabel('View Dataset')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`train:upload:${result.loraId}`)
            .setLabel('Upload Images')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error creating training dataset:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while creating your training dataset.'
      });
    }
  }

  /**
   * View details of a training dataset
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} loraId - Training dataset ID
   * @returns {Promise<void>}
   */
  async function viewTrainingDataset(interaction, userId, loraId) {
    try {
      const userSession = await sessionService.getSession(userId);
      const lora = userSession?.loras?.find(l => l.loraId === loraId);
      
      if (!lora) {
        await interaction.editReply({
          content: 'Training dataset not found. Please check the ID and try again.'
        });
        return;
      }
      
      // Count filled slots
      const filledImages = lora.images.filter(img => img).length;
      const filledCaptions = lora.captions.filter(cap => cap).length;
      
      // Build detailed embed
      const embed = new EmbedBuilder()
        .setTitle(`Training Dataset: ${lora.name}`)
        .setColor(0x0099FF)
        .setDescription(`Status: ${lora.status}`)
        .addFields(
          { name: 'Dataset ID', value: lora.loraId, inline: true },
          { name: 'Created', value: new Date(lora.initiated).toLocaleDateString(), inline: true },
          { name: 'Images', value: `${filledImages}/20`, inline: true },
          { name: 'Captions', value: `${filledCaptions}/20`, inline: true }
        );
      
      // Add training requirements
      embed.addFields({
        name: 'Training Requirements',
        value: 'You need at least 4 images with captions to start training'
      });
      
      // Add image slots information
      let imageFieldValue = '';
      lora.images.forEach((image, index) => {
        if (image) {
          const caption = lora.captions[index] || 'No caption';
          imageFieldValue += `Slot ${index + 1}: ${caption.substring(0, 30)}${caption.length > 30 ? '...' : ''}\n`;
        }
      });
      
      if (imageFieldValue) {
        embed.addFields({
          name: 'Uploaded Images',
          value: imageFieldValue
        });
      }
      
      // Create action buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`train:upload:${lora.loraId}`)
            .setLabel('Upload Images')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`train:start:${lora.loraId}`)
            .setLabel('Start Training')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`train:list`)
            .setLabel('Back to List')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error viewing training dataset:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while retrieving your training dataset details.'
      });
    }
  }

  /**
   * Upload images to a training dataset
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} loraId - Training dataset ID
   * @param {Object} attachment - Discord attachment
   * @param {string} caption - Caption for the image
   * @returns {Promise<void>}
   */
  async function uploadTrainingImage(interaction, userId, loraId, attachment, caption) {
    try {
      if (!attachment || !attachment.url) {
        await interaction.editReply({
          content: 'Please provide a valid image to upload.'
        });
        return;
      }
      
      // Download the image data
      const imageData = await discordMediaAdapter.downloadImage(attachment.url);
      
      // Call the trainModel workflow to add the image
      const result = await workflowsService.trainModel({
        userId,
        loraId,
        platform: 'discord',
        images: [imageData],
        captions: [caption]
      });
      
      if (!result.success) {
        await interaction.editReply({
          content: `Failed to upload image: ${result.message || 'Unknown error'}`
        });
        return;
      }
      
      // Success embed
      const embed = new EmbedBuilder()
        .setTitle('Image Uploaded')
        .setColor(0x00FF00)
        .setDescription('Your training image has been uploaded successfully!')
        .addFields(
          { name: 'Dataset', value: result.name },
          { name: 'Caption', value: caption }
        )
        .setImage(attachment.url);
      
      // Action buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`train:view:${loraId}`)
            .setLabel('View Dataset')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`train:upload:${loraId}`)
            .setLabel('Upload Another')
            .setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      logger.error('Error uploading training image:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while uploading your training image.'
      });
    }
  }

  /**
   * Start training process
   * @param {Object} interaction - Discord interaction
   * @param {string} userId - User ID
   * @param {string} loraId - Training dataset ID
   * @returns {Promise<void>}
   */
  async function startTraining(interaction, userId, loraId) {
    try {
      // Call the trainModel workflow to start training
      const result = await workflowsService.trainModel({
        userId,
        loraId,
        platform: 'discord',
        options: {
          submitTraining: true
        }
      });
      
      if (!result.success) {
        let errorMessage = 'Failed to start training.';
        
        // Handle specific error cases
        switch (result.error) {
          case 'insufficient_images':
            errorMessage = `You need at least 4 images. Currently you have ${result.currentCount}.`;
            break;
          case 'missing_captions':
            errorMessage = `Each image must have a caption. You have ${result.imageCount} images but only ${result.captionCount} captions.`;
            break;
          case 'not_enough_points':
            errorMessage = `You don't have enough points. Training requires ${result.requiredPoints} points.`;
            break;
          default:
            errorMessage = result.message || errorMessage;
        }
        
        await interaction.editReply({
          content: errorMessage
        });
        return;
      }
      
      // Success embed
      const embed = new EmbedBuilder()
        .setTitle('Training Started')
        .setColor(0x00FF00)
        .setDescription(`Your LoRA model "${result.name}" is now training!`)
        .addFields(
          { name: 'Training ID', value: result.trainingId },
          { name: 'Estimated Time', value: `Approximately ${result.estimatedHours} hours` },
          { name: 'Points Spent', value: result.pointCost.toString() }
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: []
      });
      
      // Send follow-up with notification instructions
      await interaction.followUp({
        content: 'You will be notified when your training is complete. You can check training status with `/train list`.',
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error starting training:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while starting the training process.'
      });
    }
  }

  /**
   * Main command handler function
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<void>}
   */
  async function handleTrainModelCommand(interaction) {
    await interaction.deferReply();
    
    try {
      const userId = interaction.user.id;
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'list':
          await listTrainingDatasets(interaction, userId);
          break;
          
        case 'create':
          const name = interaction.options.getString('name');
          await createTrainingDataset(interaction, userId, name);
          break;
          
        case 'view':
          const viewId = interaction.options.getString('id');
          await viewTrainingDataset(interaction, userId, viewId);
          break;
          
        case 'upload':
          const uploadId = interaction.options.getString('id');
          const image = interaction.options.getAttachment('image');
          const caption = interaction.options.getString('caption');
          await uploadTrainingImage(interaction, userId, uploadId, image, caption);
          break;
          
        case 'start':
          const startId = interaction.options.getString('id');
          await startTraining(interaction, userId, startId);
          break;
          
        default:
          await interaction.editReply({
            content: 'Unknown subcommand. Please use list, create, view, upload, or start.'
          });
      }
    } catch (error) {
      logger.error('Error handling train command:', error);
      await interaction.editReply({
        content: 'Sorry, an error occurred while processing your command.'
      });
    }
  }

  /**
   * Register button interaction handlers
   * @param {Object} client - Discord client
   * @param {Function} handler - Command handler function
   */
  function registerTrainInteractions(client, handler) {
    client.on('interactionCreate', async interaction => {
      if (!interaction.isButton()) return;
      
      const customId = interaction.customId;
      if (!customId.startsWith('train:')) return;
      
      await interaction.deferReply();
      
      const userId = interaction.user.id;
      const [_, action, loraId] = customId.split(':');
      
      try {
        switch (action) {
          case 'list':
            await listTrainingDatasets(interaction, userId);
            break;
            
          case 'create':
            // Show modal for dataset name
            const modal = new ModalBuilder()
              .setCustomId(`train:createModal`)
              .setTitle('Create Training Dataset');
              
            const nameInput = new TextInputBuilder()
              .setCustomId('datasetName')
              .setLabel('Dataset Name')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Enter a name for your training dataset')
              .setRequired(true);
              
            const row = new ActionRowBuilder().addComponents(nameInput);
            modal.addComponents(row);
            
            await interaction.showModal(modal);
            return;
            
          case 'view':
            await viewTrainingDataset(interaction, userId, loraId);
            break;
            
          case 'upload':
            // Show modal for image upload
            const uploadModal = new ModalBuilder()
              .setCustomId(`train:uploadModal:${loraId}`)
              .setTitle('Upload Training Image');
              
            const captionInput = new TextInputBuilder()
              .setCustomId('imageCaption')
              .setLabel('Image Caption')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('Describe the image in detail')
              .setRequired(true);
              
            const uploadRow = new ActionRowBuilder().addComponents(captionInput);
            uploadModal.addComponents(uploadRow);
            
            await interaction.showModal(uploadModal);
            return;
            
          case 'start':
            await startTraining(interaction, userId, loraId);
            break;
            
          default:
            await interaction.editReply({
              content: 'Unknown action. Please try again.'
            });
        }
      } catch (error) {
        logger.error('Error handling train interaction:', error);
        await interaction.editReply({
          content: 'Sorry, an error occurred while processing your request.'
        });
      }
    });
    
    // Handle modal submissions
    client.on('interactionCreate', async interaction => {
      if (!interaction.isModalSubmit()) return;
      
      const customId = interaction.customId;
      if (!customId.startsWith('train:')) return;
      
      await interaction.deferReply();
      
      const userId = interaction.user.id;
      
      try {
        if (customId === 'train:createModal') {
          const name = interaction.fields.getTextInputValue('datasetName');
          await createTrainingDataset(interaction, userId, name);
        } else if (customId.startsWith('train:uploadModal:')) {
          const loraId = customId.split(':')[2];
          const caption = interaction.fields.getTextInputValue('imageCaption');
          
          await interaction.editReply({
            content: 'Please upload an image using the /train upload command with this caption.'
          });
        }
      } catch (error) {
        logger.error('Error handling modal submission:', error);
        await interaction.editReply({
          content: 'Sorry, an error occurred while processing your submission.'
        });
      }
    });
  }

  // Register interaction handlers
  registerTrainInteractions(client, handleTrainModelCommand);
  
  // Return the command handler and command data
  handleTrainModelCommand.commandData = commandData;
  return handleTrainModelCommand;
}

module.exports = createTrainModelCommandHandler; 