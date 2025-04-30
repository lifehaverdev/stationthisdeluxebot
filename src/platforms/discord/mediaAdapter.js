/**
 * Discord Media Adapter
 * 
 * Provides Discord-specific media handling functions to the MediaService.
 * This adapter connects the platform-agnostic MediaService with Discord-specific functionality.
 */

const { AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

/**
 * Creates a Discord Media Adapter
 * @param {Object} client - Discord client instance
 * @param {Object} options - Additional options
 * @returns {Object} - Discord media adapter functions
 */
function createDiscordMediaAdapter(client, options = {}) {
  /**
   * Get file URL from Discord attachment
   * @param {Object} attachment - Discord attachment object
   * @returns {Promise<string>} - File URL
   */
  async function getFileUrl(attachment) {
    try {
      return attachment.url;
    } catch (error) {
      console.error('Error getting Discord file URL:', error);
      return null;
    }
  }
  
  /**
   * Send a photo to a Discord channel
   * @param {Object} interaction - Discord interaction
   * @param {string} filePath - Path to the image file
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendPhoto(interaction, filePath, options = {}) {
    try {
      // Create attachment
      const attachment = new AttachmentBuilder(filePath);
      
      // Prepare message components if reply_markup exists
      let components = [];
      if (options.reply_markup && options.reply_markup.inline_keyboard) {
        // Convert Telegram-style inline keyboard to Discord buttons
        // Implementation will depend on how we structure the platform-agnostic components
        // This is a placeholder for now
      }
      
      // If interaction is already replied to, use followUp, otherwise reply
      if (interaction.replied || interaction.deferred) {
        return await interaction.followUp({
          content: options.caption || '',
          files: [attachment],
          components
        });
      } else {
        return await interaction.reply({
          content: options.caption || '',
          files: [attachment],
          components
        });
      }
    } catch (error) {
      console.error('Error sending photo to Discord:', error);
      return null;
    }
  }
  
  /**
   * Send a document to a Discord channel
   * @param {Object} interaction - Discord interaction
   * @param {string} filePath - Path to the document
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendDocument(interaction, filePath, options = {}) {
    try {
      // Create attachment
      const attachment = new AttachmentBuilder(filePath);
      
      // If interaction is already replied to, use followUp, otherwise reply
      if (interaction.replied || interaction.deferred) {
        return await interaction.followUp({
          content: options.caption || '',
          files: [attachment]
        });
      } else {
        return await interaction.reply({
          content: options.caption || '',
          files: [attachment]
        });
      }
    } catch (error) {
      console.error('Error sending document to Discord:', error);
      return null;
    }
  }
  
  /**
   * Send an animation to a Discord channel
   * @param {Object} interaction - Discord interaction
   * @param {string} filePath - Path to the animation file
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendAnimation(interaction, filePath, options = {}) {
    try {
      // Create attachment
      const attachment = new AttachmentBuilder(filePath);
      
      // If interaction is already replied to, use followUp, otherwise reply
      if (interaction.replied || interaction.deferred) {
        return await interaction.followUp({
          content: options.caption || '',
          files: [attachment]
        });
      } else {
        return await interaction.reply({
          content: options.caption || '',
          files: [attachment]
        });
      }
    } catch (error) {
      console.error('Error sending animation to Discord:', error);
      return null;
    }
  }
  
  /**
   * Send a video to a Discord channel
   * @param {Object} interaction - Discord interaction
   * @param {string} filePath - Path to the video file
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendVideo(interaction, filePath, options = {}) {
    try {
      // Create attachment
      const attachment = new AttachmentBuilder(filePath);
      
      // If interaction is already replied to, use followUp, otherwise reply
      if (interaction.replied || interaction.deferred) {
        return await interaction.followUp({
          content: options.caption || '',
          files: [attachment]
        });
      } else {
        return await interaction.reply({
          content: options.caption || '',
          files: [attachment]
        });
      }
    } catch (error) {
      console.error('Error sending video to Discord:', error);
      return null;
    }
  }
  
  return {
    getFileUrl,
    sendPhoto,
    sendDocument,
    sendAnimation,
    sendVideo
  };
}

module.exports = createDiscordMediaAdapter; 