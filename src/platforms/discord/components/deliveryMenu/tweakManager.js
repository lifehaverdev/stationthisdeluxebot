/**
 * @file tweakManager.js
 * @description Handles button interactions for tweaking a generation's parameters.
 * This manager introduces a temporary, in-memory session to hold parameter changes.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const { escapeDiscordMarkdown } = require('../../utils/messaging');

// Map short tokens to sessionKeys to keep custom IDs under Discord's 100-char limit
const tokenToSessionKey = new Map();
const sessionKeyToToken = new Map();
function getSessionToken(sessionKey) {
    if (sessionKeyToToken.has(sessionKey)) return sessionKeyToToken.get(sessionKey);
    const token = uuidv4().split('-')[0]; // 8 chars
    tokenToSessionKey.set(token, sessionKey);
    sessionKeyToToken.set(sessionKey, token);
    return token;
}
function resolveSessionKey(token) {
    return tokenToSessionKey.get(token);
}

// In-memory store for pending tweaks. Key: `generationId_masterAccountId`
const pendingTweaks = {};

function formatParamName(param) {
    return param.replace(/^input_/, '').replace(/_/g, ' ');
}

/**
 * Builds the embed and components for the Tweak UI menu.
 * @param {string} generationId - The original generation ID.
 * @param {string} masterAccountId - The master account ID.
 * @param {object} currentParams - The current state of parameters for the tweak.
 * @param {object} toolDef - The tool definition.
 * @param {boolean} hasPendingChanges - Whether there are pending changes.
 * @param {object} dependencies - Shared dependencies.
 * @returns {object} - { embeds, components }
 */
function buildTweakUIMenu(generationId, masterAccountId, currentParams, toolDef, hasPendingChanges = false, dependencies = {}) {
    const sessionKey = `${generationId}_${masterAccountId}`;
    const token = getSessionToken(sessionKey);

    const { logger } = dependencies;
    if (!toolDef) {
        logger?.warn(`[TweakManager] buildTweakUIMenu: toolDef null for generation ${generationId}`);
    } else {
        logger?.info(`[TweakManager] buildTweakUIMenu: tool ${toolDef.displayName} params ${Object.keys(toolDef.inputSchema||{}).join(',')}`);
    }

    const embed = new EmbedBuilder()
        .setTitle('🔧 Tweak Parameters')
        .setColor(0xFFA500)
        .setDescription('Select a parameter to edit:');

    const components = [];
    const paramRows = [];

    if (toolDef && toolDef.inputSchema) {
        const paramKeys = Object.keys(toolDef.inputSchema);
        
        // Group parameters into rows of 5 buttons each (Discord limit)
        for (let i = 0; i < paramKeys.length; i += 5) {
            const row = new ActionRowBuilder();
            const paramGroup = paramKeys.slice(i, i + 5);
            
            for (const param of paramGroup) {
                const rawVal = currentParams[param];
                let label;
                if (typeof rawVal === 'string' && rawVal.startsWith('http')) {
                    label = `${formatParamName(param)}: link`;
                } else if (rawVal === undefined || rawVal === null || rawVal === '') {
                    label = `${formatParamName(param)}: (none)`;
                } else {
                    const str = String(rawVal);
                    label = `${formatParamName(param)}: ${str.length > 15 ? str.slice(0, 12) + '…' : str}`;
                }
                
                // Discord custom ID limit is 100 chars, so we use token
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`tpe_${token}_${param}`)
                        .setLabel(label.length > 80 ? label.slice(0, 77) + '...' : label)
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            
            paramRows.push(row);
        }
    }

    components.push(...paramRows);

    // Add action buttons row
    const actionRow = new ActionRowBuilder();
    if (hasPendingChanges) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`tweak_apply:${token}`)
                .setLabel('Send')
                .setStyle(ButtonStyle.Success)
        );
    }
    actionRow.addComponents(
        new ButtonBuilder()
            .setCustomId(`tweak_cancel:${token}`)
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Danger)
    );
    components.push(actionRow);

    return { embeds: [embed], components };
}

/**
 * Handles the 'tweak_gen:' button interaction to initiate tweak mode.
 */
async function handleTweakGenCallback(client, interaction, masterAccountId, dependencies) {
    const { logger, internalApiClient } = dependencies;
    const { customId, message, user } = interaction;

    logger.info(`[TweakManager] handleTweakGenCallback triggered with customId: ${customId}`);

    try {
        const apiClient = internalApiClient || dependencies.internal?.client;
        if (!apiClient) {
            throw new Error('Internal API client not available');
        }

        const parts = customId.split(':');
        const generationId = parts[1];

        // 1. Fetch the original generation record
        const genResponse = await apiClient.get(`/internal/v1/data/generations/${generationId}`);
        const generationRecord = genResponse.data;
        if (!generationRecord) throw new Error(`Generation record ${generationId} not found.`);

        // 2. Extract necessary info
        const originalParams = generationRecord.requestPayload || {};
        const toolDisplayName = generationRecord.toolDisplayName || generationRecord.metadata?.toolDisplayName;
        const originalMessageId = message.id;
        const originalChannelId = message.channel.id;

        // 3. Initialize pendingTweaks for this session
        const tweakSessionKey = `${generationId}_${masterAccountId}`;
        const userFacingPrompt = generationRecord.metadata?.userInputPrompt || originalParams.input_prompt;
        
        // Store original message components for restoration after tweak
        const __origComponents = message.components || [];
        
        const toolDefForInit = dependencies.toolRegistry.findByDisplayName(toolDisplayName);
        pendingTweaks[tweakSessionKey] = { 
            ...originalParams,
            input_prompt: userFacingPrompt,
            toolDisplayName,
            __canonicalToolId__: toolDefForInit ? toolDefForInit.toolId : generationRecord.metadata?.toolId,
            __menuChannelId: originalChannelId,
            __menuMessageId: originalMessageId,
            __origComponents: __origComponents, // Store original components for restoration
            __isNewMenu: false
        }; 
        logger.info(`[TweakManager] Initialized pendingTweaks for sessionKey: ${tweakSessionKey}`);

        // 4. Build and send the Tweak UI Menu
        const toolDef = dependencies.toolRegistry.findByDisplayName(
            pendingTweaks[tweakSessionKey].toolDisplayName || toolDisplayName
        );
        const tweakMenu = buildTweakUIMenu(
            generationId,
            masterAccountId,
            pendingTweaks[tweakSessionKey],
            toolDef,
            false,
            dependencies
        );

        try {
            await interaction.message.edit({
                embeds: tweakMenu.embeds,
                components: tweakMenu.components
            });
            // Check if interaction is already deferred/replied (bot.js defers it)
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: 'Tweak mode activated! Select a parameter to edit.',
                    flags: 64 // Ephemeral
                });
            } else {
                await interaction.reply({
                    content: 'Tweak mode activated! Select a parameter to edit.',
                    flags: 64 // Ephemeral
                });
            }
        } catch (err) {
            // If message is too old to edit, send a new message
            if (err.code === 50027 || err.message?.includes('too old')) {
                logger.info('[TweakManager] Message too old to edit, sending new tweak menu');
                const sent = await interaction.channel.send({
                    content: '🔧 Tweak parameters',
                    embeds: tweakMenu.embeds,
                    components: tweakMenu.components,
                    reply: {
                        messageReference: message.id,
                        failIfNotExists: false
                    }
                });
                pendingTweaks[tweakSessionKey].__menuChannelId = sent.channel.id;
                pendingTweaks[tweakSessionKey].__menuMessageId = sent.id;
                pendingTweaks[tweakSessionKey].__isNewMenu = true;
                // Check if interaction is already deferred/replied (bot.js defers it)
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({
                        content: 'Tweak mode activated! Select a parameter to edit.',
                        flags: 64 // Ephemeral
                    });
                } else {
                    await interaction.reply({
                        content: 'Tweak mode activated! Select a parameter to edit.',
                        flags: 64 // Ephemeral
                    });
                }
            } else {
                throw err;
            }
        }

    } catch (error) {
        logger.error(`[TweakManager] Error in handleTweakGenCallback:`, error.stack);
        try {
            // Check if interaction is already deferred/replied
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: 'Error initiating tweak mode.',
                    flags: 64 // Ephemeral
                });
            } else {
                await interaction.reply({
                    content: 'Error initiating tweak mode.',
                    flags: 64 // Ephemeral
                });
            }
        } catch (replyError) {
            logger.error(`[TweakManager] Failed to reply to interaction:`, replyError.message);
        }
    }
}

/**
 * Handles the 'tpe_' button interaction to start editing a parameter.
 */
async function handleParamEditStart(client, interaction, masterAccountId, dependencies) {
    const { logger, replyContextManager } = dependencies;
    const { customId, message, user } = interaction;

    // customId format: tpe_<token>_<paramName>
    const match = customId.match(/^tpe_([^_]+)_(.+)$/);
    if (!match) {
        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Invalid parameter selection.',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Invalid parameter selection.',
                flags: 64 // Ephemeral
            });
        }
        return;
    }
    const [, token, paramName] = match;
    const sessionKey = resolveSessionKey(token);
    if (!sessionKey) {
        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Session expired.',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Session expired.',
                flags: 64 // Ephemeral
            });
        }
        return;
    }
    const [generationId, sessionMasterAccountId] = sessionKey.split('_');
    
    // Verify that the masterAccountId from the interaction matches the session
    if (sessionMasterAccountId !== masterAccountId) {
        logger.warn(`[TweakManager] masterAccountId mismatch: session=${sessionMasterAccountId}, interaction=${masterAccountId}`);
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Session validation failed.',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Session validation failed.',
                flags: 64 // Ephemeral
            });
        }
        return;
    }
    
    const currentParams = pendingTweaks[sessionKey] || {};

    const menuChannelId = currentParams.__menuChannelId;
    const menuMessageId = currentParams.__menuMessageId;

    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Error: Internal API client not available.',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Error: Internal API client not available.',
                flags: 64 // Ephemeral
            });
        }
        return;
    }
    
    const generationResp = await apiClient.get(`/internal/v1/data/generations/${generationId}`);
    const generationRecord = generationResp.data;
    const toolDisplayName = generationRecord.toolDisplayName || generationRecord.metadata?.toolDisplayName;
    const toolDef = dependencies.toolRegistry.findByDisplayName(toolDisplayName);

    let currentVal = currentParams[paramName];
    if (currentVal === undefined) {
        currentVal = generationRecord.requestPayload?.[paramName];
    }
    // Redact file URLs
    if (typeof currentVal === 'string' && (currentVal.startsWith('https://') || currentVal.startsWith('http://'))) {
        currentVal = '(file link)';
    }
    
    const safeLabel = escapeDiscordMarkdown(paramName);
    const safeVal = currentVal !== undefined ? escapeDiscordMarkdown(String(currentVal)) : '(none)';
    const promptText = `**Current value for ${safeLabel}:**\n\`${safeVal}\`\n\nReply to this message with the new value.`;

    const sent = await interaction.channel.send({
        content: promptText,
        reply: {
            messageReference: message.id,
            failIfNotExists: false
        }
    });

    replyContextManager.addContext(sent, { 
        type: 'tweak_param_edit', 
        token, 
        paramName, 
        sessionKey, 
        generationId, 
        masterAccountId, 
        menuChannelId, 
        menuMessageId 
    });

    // Check if interaction is already deferred/replied (bot.js defers it)
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
            content: 'Please reply to the message above with the new value.',
            flags: 64 // Ephemeral
        });
    } else {
        await interaction.reply({
            content: 'Please reply to the message above with the new value.',
            flags: 64 // Ephemeral
        });
    }
}

/**
 * Handles message replies for parameter editing.
 * Note: This is called by MessageReplyDispatcher, which doesn't pass masterAccountId
 */
async function handleParamEditReply(client, message, context, dependencies) {
    const { logger, replyContextManager } = dependencies;
    const { token, paramName, sessionKey, generationId, masterAccountId, menuChannelId, menuMessageId } = context;
    const newValue = message.content?.trim();
    
    if (!sessionKey || !pendingTweaks[sessionKey]) {
        try {
            await message.reply('Session expired.');
        } catch (e) {
            logger.warn('[TweakManager] Failed to reply to expired session:', e.message);
        }
        return;
    }
    
    pendingTweaks[sessionKey][paramName] = newValue;

    // Delete the instruction prompt and clear context
    if (message.reference?.messageId) {
        try {
            const promptMessage = await message.channel.messages.fetch(message.reference.messageId);
            await promptMessage.delete();
        } catch (e) {
            logger?.warn('Failed to delete prompt:', e.message);
        }
    }
    replyContextManager.removeContext(message.reference?.messageId ? { id: message.reference.messageId } : null);

    // Rebuild menu with Send button
    const toolDisplayName = pendingTweaks[sessionKey].toolDisplayName;
    const toolDef = dependencies.toolRegistry.findByDisplayName(toolDisplayName);
    const tweakMenu = buildTweakUIMenu(generationId, masterAccountId, pendingTweaks[sessionKey], toolDef, true, dependencies);

    if (menuChannelId && menuMessageId) {
        try {
            const channel = await client.channels.fetch(menuChannelId);
            const menuMessage = await channel.messages.fetch(menuMessageId);
            await menuMessage.edit({
                embeds: tweakMenu.embeds,
                components: tweakMenu.components
            });
        } catch (e) {
            logger.error('[TweakManager] failed to refresh menu:', e.message);
        }
    }

    try {
        await message.reply('✅ Parameter updated! Click "Send" to apply your changes.');
    } catch (e) {
        logger.warn('[TweakManager] Failed to confirm parameter update:', e.message);
    }
}

/**
 * Handles the 'tweak_apply:' button interaction to submit tweaked generation.
 */
async function handleApplyTweaks(client, interaction, masterAccountId, dependencies) {
    const { logger, internalApiClient } = dependencies;
    const { customId, message, user } = interaction;

    const parts = customId.split(':');
    const token = parts[1];
    const sessionKey = resolveSessionKey(token);
    const [generationId] = sessionKey ? sessionKey.split('_') : [];

    const finalTweakedParams = sessionKey ? pendingTweaks[sessionKey] : undefined;
    logger.info(`[TweakManager] Applying tweaks for session: ${sessionKey}`);

    if (!sessionKey || !finalTweakedParams) {
        logger.warn(`[TweakManager] tweak_apply: No pending tweak session found.`);
        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Error: Your tweak session has expired.',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Error: Your tweak session has expired.',
                flags: 64 // Ephemeral
            });
        }
        return;
    }

    try {
        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Applying tweaks...',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Applying tweaks...',
                flags: 64 // Ephemeral
            });
        }

        const apiClient = internalApiClient || dependencies.internal?.client;
        const genResponse = await apiClient.get(`/internal/v1/data/generations/${generationId}`);
        const originalRecord = genResponse.data;
        if (!originalRecord) throw new Error(`Original generation record ${generationId} not found.`);

        const displayName = finalTweakedParams.toolDisplayName || originalRecord.toolDisplayName || originalRecord.metadata?.toolDisplayName;
        if (!displayName) throw new Error('Could not resolve toolDisplayName for tweaked generation.');

        const toolDef = dependencies.toolRegistry.findByDisplayName(displayName);
        if (!toolDef) throw new Error(`Tool definition not found for displayName: ${displayName}`);

        const toolId = toolDef.toolId;
        finalTweakedParams.__canonicalToolId__ = toolId;

        const { discordMessageId, discordChannelId, platformContext } = originalRecord.metadata || {};

        // Build payload containing only valid input params
        const permittedKeys = new Set(Object.keys(toolDef.inputSchema || {}));
        const servicePayload = {};
        for (const [k, v] of Object.entries(finalTweakedParams)) {
            if (permittedKeys.has(k) && !k.startsWith('__')) {
                servicePayload[k] = v;
            }
        }

        // Build notificationContext
        const channelId = discordChannelId || platformContext?.channelId || message.channel.id;
        const messageId = discordMessageId || platformContext?.messageId || message.id;
        const notificationContext = {
            channelId: channelId,
            messageId: messageId,
            userId: user.id.toString(),
        };

        const newGenMetadata = {
            discordMessageId: messageId,
            discordChannelId: channelId,
            platformContext: platformContext || {
                channelId: channelId,
                messageId: messageId,
                username: user.username,
                discriminator: user.discriminator,
                globalName: user.globalName
            },
            parentGenerationId: generationId,
            isTweaked: true,
            toolId,
            userInputPrompt: finalTweakedParams.input_prompt,
            notificationContext,
        };

        // Create an event
        let eventId;
        try {
            const evResp = await apiClient.post('/internal/v1/data/events', {
                masterAccountId,
                eventType: 'tweak_submitted',
                sourcePlatform: 'discord',
                eventData: { parentGenerationId: generationId, toolId }
            });
            eventId = evResp.data._id;
        } catch (e) {
            logger.warn('[TweakManager] failed to create event for tweak submission:', e.message);
        }

        const executionPayload = {
            toolId,
            inputs: servicePayload,
            user: {
                masterAccountId,
                platform: 'discord',
                platformId: user.id.toString(),
                platformContext: platformContext || {
                    channelId: channelId,
                    messageId: messageId,
                    username: user.username,
                    discriminator: user.discriminator,
                    globalName: user.globalName
                },
            },
            sessionId: originalRecord.sessionId,
            ...(eventId ? { eventId } : {}),
            metadata: {
                ...newGenMetadata,
                platform: 'discord'
            }
        };

        const executionResponse = await apiClient.post('/internal/v1/data/execute', executionPayload);
        logger.info(`[TweakManager] Tweaked generation submitted. GenID: ${executionResponse.data.generationId}`);

        // Update the tweak button count and restore delivery menu
        const { __menuChannelId, __menuMessageId, __origComponents } = finalTweakedParams;
        if (!finalTweakedParams.__isNewMenu && __menuChannelId && __menuMessageId && __origComponents) {
            try {
                const channel = await client.channels.fetch(__menuChannelId);
                const origMessage = await channel.messages.fetch(__menuMessageId);
                
                // Rebuild components as ActionRowBuilder/ButtonBuilder instances
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const newComponents = [];
                
                for (const row of __origComponents) {
                    const newRow = new ActionRowBuilder();
                    for (const component of row.components || []) {
                        if (component.type === 2) { // Button component
                            const button = new ButtonBuilder()
                                .setCustomId(component.customId)
                                .setLabel(component.label || '')
                                .setStyle(component.style || ButtonStyle.Secondary);
                            
                            // Update tweak button count
                            if (component.customId && component.customId.startsWith('tweak_gen:')) {
                                const match = component.label?.match(/^✎\s*(\d+)?/);
                                const n = match ? parseInt(match[1] || '0', 10) + 1 : 1;
                                button.setLabel(`✎${n}`);
                            } else {
                                if (component.emoji) button.setEmoji(component.emoji);
                                if (component.disabled !== undefined) button.setDisabled(component.disabled);
                                if (component.url) button.setURL(component.url);
                            }
                            
                            newRow.addComponents(button);
                        }
                    }
                    if (newRow.components.length > 0) {
                        newComponents.push(newRow);
                    }
                }
                
                if (newComponents.length > 0) {
                    await origMessage.edit({ components: newComponents });
                    logger.info(`[TweakManager] Restored delivery menu with updated tweak button count.`);
                }
            } catch (e) {
                logger.warn('[TweakManager] Failed to restore delivery buttons:', e.message, e.stack);
            }
        } else {
            // Separate tweak menu path - close the tweak menu
            try {
                await interaction.message.edit({
                    content: '🚀 Your tweaked generation is on its way!',
                    embeds: [],
                    components: []
                });
            } catch (e) {
                logger.warn('[TweakManager] Failed to close tweak menu:', e.message);
            }
        }

        // Cleanup
        delete pendingTweaks[sessionKey];
        logger.info(`[TweakManager] Cleared pendingTweaks for sessionKey: ${sessionKey}`);

    } catch (error) {
        logger.error(`[TweakManager] Error in tweak_apply for session ${sessionKey}:`, error.stack);
        try {
            await interaction.followUp({
                content: 'Error applying tweaks.',
                flags: 64 // Ephemeral
            });
        } catch (replyError) {
            logger.error(`[TweakManager] Failed to follow up:`, replyError.message);
        }
    }
}

/**
 * Handles the 'tweak_cancel:' button interaction to cancel tweak mode.
 */
async function handleTweakCancel(client, interaction, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const { customId, message } = interaction;

    const parts = customId.split(':');
    const token = parts[1];
    const sessionKey = resolveSessionKey(token);
    
    if (!sessionKey) {
        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Session expired.',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Session expired.',
                flags: 64 // Ephemeral
            });
        }
        return;
    }
    
    const tweaks = pendingTweaks[sessionKey];
    if (!tweaks) {
        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'No active tweak session.',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'No active tweak session.',
                flags: 64 // Ephemeral
            });
        }
        return;
    }
    
    const { __isNewMenu, __menuChannelId, __menuMessageId, __origComponents } = tweaks;

    try {
        if (__isNewMenu && __menuChannelId && __menuMessageId) {
            const channel = await client.channels.fetch(__menuChannelId);
            const menuMessage = await channel.messages.fetch(__menuMessageId);
            await menuMessage.delete();
        } else if (!__isNewMenu && __menuChannelId && __menuMessageId && __origComponents) {
            const channel = await client.channels.fetch(__menuChannelId);
            const menuMessage = await channel.messages.fetch(__menuMessageId);
            await menuMessage.edit({
                components: __origComponents
            });
        }
    } catch (e) {
        logger?.warn('[TweakManager] tweak_cancel handling error:', e.message);
    }
    
    delete pendingTweaks[sessionKey];
    // Check if interaction is already deferred/replied (bot.js defers it)
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
            content: 'Tweak mode cancelled.',
            flags: 64 // Ephemeral
        });
    } else {
        await interaction.reply({
            content: 'Tweak mode cancelled.',
            flags: 64 // Ephemeral
        });
    }
}

function registerHandlers(dispatchers, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
        throw new Error('[TweakManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;

    const { buttonInteractionDispatcher, messageReplyDispatcher } = dispatchers;
    const { logger } = dependencies;

    buttonInteractionDispatcher.register('tweak_gen:', handleTweakGenCallback);
    buttonInteractionDispatcher.register('tpe_', handleParamEditStart);
    buttonInteractionDispatcher.register('tweak_apply:', handleApplyTweaks);
    buttonInteractionDispatcher.register('tweak_cancel:', handleTweakCancel);
    
    // Register reply handler for param edit
    messageReplyDispatcher.register('tweak_param_edit', handleParamEditReply);

    logger.info('[TweakManager] All handlers registered.');
}

module.exports = {
    registerHandlers,
};

