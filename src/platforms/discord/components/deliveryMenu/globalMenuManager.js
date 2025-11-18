/**
 * @file globalMenuManager.js
 * @description Handles global menu actions that don't fit into other categories.
 */

/**
 * Handles the 'hide_menu' button interaction to remove the action buttons from a message.
 * @param {object} client - The Discord client instance.
 * @param {object} interaction - The Discord button interaction.
 * @param {string} masterAccountId - The master account ID of the user.
 * @param {object} dependencies - Shared dependencies.
 */
async function handleHideMenuCallback(client, interaction, masterAccountId, dependencies) {
    const { logger } = dependencies;

    logger.info(`[GlobalMenuManager] hide_menu interaction received for messageId: ${interaction.message.id} in channelId: ${interaction.channel.id}`);
    
    try {
        // Edit the message to remove components (buttons)
        await interaction.message.edit({
            components: []
        });
        
        // Respond to the interaction (bot.js already deferred it, so use followUp)
        // Note: Since we're editing the message, we don't need to reply, but we can send a follow-up
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: '🤫🫡',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: '🤫🫡',
                flags: 64 // Ephemeral
            });
        }
    } catch (error) {
        logger.error(`[GlobalMenuManager] Error hiding menu for messageId: ${interaction.message.id}:`, error.message);
        try {
            // Check if interaction is already deferred/replied
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: "Couldn't hide menu.",
                    flags: 64 // Ephemeral
                });
            } else {
                await interaction.reply({
                    content: "Couldn't hide menu.",
                    flags: 64 // Ephemeral
                });
            }
        } catch (replyError) {
            logger.error(`[GlobalMenuManager] Failed to reply to interaction:`, replyError.message);
        }
    }
}

function registerHandlers(dispatchers, dependencies) {
    const { buttonInteractionDispatcher } = dispatchers;
    const { logger } = dependencies;

    buttonInteractionDispatcher.register('hide_menu', handleHideMenuCallback);

    logger.info('[GlobalMenuManager] Handlers registered for global callbacks.');
}

module.exports = {
    registerHandlers,
};

