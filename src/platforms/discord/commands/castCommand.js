/**
 * Cast Command Handler for Discord
 * 
 * Handles the /cast command which allows users to cast spells.
 * Matches Telegram's /cast command functionality for platform parity.
 */

/**
 * Create cast command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createCastCommandHandler(dependencies) {
  const { logger = console } = dependencies;
  
  /**
   * Handle the cast command
   * @param {Object} client - Discord client instance
   * @param {Object} interaction - Discord interaction
   * @param {Object} dependencies - Dependencies object
   * @returns {Promise<void>}
   */
  return async function handleCastCommand(client, interaction, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    const { spellsService } = dependencies;
    
    if (!apiClient) {
      throw new Error('[castCommand] internalApiClient dependency missing');
    }
    
    const discordUserId = interaction.user.id;
    const platformIdStr = discordUserId.toString();
    const platform = 'discord';

    try {
      logger.debug(`[Cast Command] Processing /cast for Discord user ${platformIdStr}...`);
      
      // Validate interaction object
      if (!interaction || typeof interaction.deferReply !== 'function') {
        logger.error('[Cast Command] Invalid interaction object received');
        throw new Error('Invalid interaction object');
      }
      
      // Acknowledge the interaction immediately (Discord requires response within 3 seconds)
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
        logger.debug('Interaction deferred for cast command');
      }
      
      // Get spell slug from command options
      const spellSlug = interaction.options?.getString('spell');
      const paramString = interaction.options?.getString('params');
      
      if (!spellSlug) {
        await interaction.editReply({
          content: '❌ Usage: `/cast spell:<spell_slug> [params:<param1=val1 param2=val2 ...>]`\nExample: `/cast spell:my-spell params:prompt="a cat"`',
          flags: 64 // Ephemeral
        });
        return;
      }
      
      // Parse parameter overrides
      let paramOverrides = {};
      if (paramString) {
        // Regex to match key=value pairs, supporting quotes
        const paramRegex = /([\w_.-]+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s"'`]+)/g;
        
        const parsedParams = {};
        let lastIndex = 0;
        let isKeyValueFormat = true;
        let matchResult;
        
        // Only attempt key-value parsing if there's at least one '='
        if (paramString.includes('=')) {
          while ((matchResult = paramRegex.exec(paramString)) !== null) {
            // Check for any non-whitespace characters between the last match and this one
            if (paramString.substring(lastIndex, matchResult.index).trim() !== '') {
              isKeyValueFormat = false;
              break;
            }

            const key = matchResult[1];
            let value = matchResult[2];

            // Unquote and unescape
            if (value.startsWith('"') && value.endsWith('"')) {
              try {
                value = JSON.parse(value);
              } catch (e) {
                value = value.slice(1, -1);
              }
            } else if (value.startsWith("'") && value.endsWith("'")) {
              value = value.slice(1, -1).replace(/\\'/g, "'");
            }
            
            parsedParams[key] = value;
            lastIndex = paramRegex.lastIndex;
          }

          // Check for any trailing non-whitespace characters
          if (isKeyValueFormat && paramString.substring(lastIndex).trim() !== '') {
            isKeyValueFormat = false;
          }
        } else {
          isKeyValueFormat = false;
        }
        
        if (!isKeyValueFormat || Object.keys(parsedParams).length === 0 && paramString.includes('=')) {
          // Treat the whole thing as a single prompt
          paramOverrides = { prompt: paramString };
        } else {
          paramOverrides = parsedParams;
        }
      }
      
      // Verify dependencies are available
      if (!spellsService) {
        logger.error('[Cast Command] spellsService is not available in dependencies');
        await interaction.editReply({
          content: '❌ Spell service is not available. Please contact support.',
          flags: 64
        });
        return;
      }
      
      // Get masterAccountId
      logger.debug(`[Cast Command] Resolving masterAccountId for user ${platformIdStr}...`);
      const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
        platform: platform,
        platformId: platformIdStr,
        platformContext: {
          username: interaction.user.username,
          discriminator: interaction.user.discriminator,
          globalName: interaction.user.globalName,
        }
      });
      
      const masterAccountId = findOrCreateResponse.data.masterAccountId;
      if (!masterAccountId) {
        logger.error(`[Cast Command] Could not resolve masterAccountId for user ${platformIdStr}.`);
        await interaction.editReply({
          content: '❌ I couldn\'t identify your account. Please try again or contact support.',
          flags: 64
        });
        return;
      }
      
      logger.debug(`[Cast Command] Resolved masterAccountId ${masterAccountId}, casting spell "${spellSlug}"`);
      
      // Call SpellsService to cast the spell
      try {
        const result = await spellsService.castSpell(spellSlug, {
          masterAccountId,
          parameterOverrides: paramOverrides,
          platform: 'discord',
          discordContext: {
            channelId: interaction.channel?.id,
            messageId: interaction.id,
            userId: interaction.user.id
          }
        });
        
        logger.info(`[Cast Command] Spell "${spellSlug}" execution started successfully`);
        
        // Send success message
        await interaction.editReply({
          content: `✅ Spell "${spellSlug}" is now casting! You'll receive a notification when it completes.`,
          flags: 64
        });
      } catch (castError) {
        logger.error(`[Cast Command] Error casting spell "${spellSlug}": ${castError.stack || castError}`);
        const errorMessage = castError.message.includes('starting with') 
          ? castError.message 
          : `❌ Failed to cast spell '${spellSlug}': ${castError.message || castError}`;
        await interaction.editReply({
          content: errorMessage,
          flags: 64
        });
      }
      
    } catch (error) {
      logger.error(`[Cast Command] Error processing /cast for discordUserId ${platformIdStr}: ${error.response ? JSON.stringify(error.response.data) : error.message} ${error.stack}`);
      
      // Handle errors gracefully
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ 
            content: '❌ Sorry, an error occurred while processing the cast command. Please try again later.',
            flags: 64
          });
        } else {
          await interaction.reply({ 
            content: '❌ Sorry, an error occurred while processing the cast command. Please try again later.',
            flags: 64
          });
        }
      } catch (replyError) {
        logger.error('Failed to send error response:', replyError);
      }
    }
  };
}

module.exports = createCastCommandHandler;

