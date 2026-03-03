/**
 * Group Menu Manager for Discord
 *
 * Handles group sponsorship — allows a user to sponsor a Discord guild
 * so their account/credits are used when admins execute commands.
 * Analogous to Telegram's groupMenuManager.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

function getApiClient(dependencies) {
    return dependencies.internalApiClient || dependencies.internal?.client;
}

const PLATFORM_KEY = 'discord_guild';

/**
 * Build the group settings embed showing sponsorship status.
 */
async function buildGroupMenu(guildId, guildName, currentMasterAccountId, dependencies) {
    const { logger = console } = dependencies;
    const apiClient = getApiClient(dependencies);

    let groupDoc = null;
    try {
        const res = await apiClient.get(`/internal/v1/data/groups/${guildId}?platform=${PLATFORM_KEY}`);
        groupDoc = res.data;
    } catch (err) {
        if (err.response?.status !== 404) {
            logger.error(`[GroupMenu] Failed to fetch group doc: ${err.message}`);
        }
    }

    const isSponsored = groupDoc && groupDoc.sponsorMasterAccountId;
    const isSponsor = isSponsored && groupDoc.sponsorMasterAccountId.toString() === currentMasterAccountId;

    // Fetch pool balance if sponsored
    let poolBalance = 0;
    if (isSponsored) {
        try {
            const balanceRes = await apiClient.get(`/internal/v1/data/groups/${guildId}/balance?platform=${PLATFORM_KEY}`);
            poolBalance = balanceRes.data?.balance || 0;
        } catch (balErr) {
            logger.warn(`[GroupMenu] Failed to fetch pool balance for guild ${guildId}: ${balErr.message}`);
        }
    }

    const description = isSponsored
        ? `This server is sponsored. Admins use the server pool when running commands.\n\n**Server Pool: ${poolBalance.toLocaleString()} points**`
        : 'No sponsor set. Commands use each user\'s own account.';

    const embed = new EmbedBuilder()
        .setColor(isSponsored ? 0x00CC66 : 0x666666)
        .setTitle('Group Sponsorship')
        .setDescription(description)
        .setFooter({ text: guildName });

    const row = new ActionRowBuilder();

    if (!isSponsored) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`groupsettings:sponsor:${guildId}`)
                .setLabel('Sponsor this server')
                .setStyle(ButtonStyle.Success)
        );
    } else {
        // Fund button — visible to everyone (anyone can fund)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`groupsettings:fund:${guildId}`)
                .setLabel('Fund this server')
                .setStyle(ButtonStyle.Primary)
        );
        if (isSponsor) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`groupsettings:unsponsor:${guildId}`)
                    .setLabel('Withdraw sponsorship')
                    .setStyle(ButtonStyle.Danger)
            );
        }
    }

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('groupsettings:close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

/**
 * Handle the /groupsettings slash command.
 */
async function handleGroupSettingsCommand(client, interaction, dependencies) {
    const { logger = console } = dependencies;
    const apiClient = getApiClient(dependencies);

    if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
        return;
    }

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: 64 });
        }

        const userResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
            platform: 'discord',
            platformId: interaction.user.id.toString(),
            platformContext: {
                username: interaction.user.username,
                discriminator: interaction.user.discriminator,
                globalName: interaction.user.globalName
            }
        });
        const masterAccountId = userResponse.data.masterAccountId;

        const menu = await buildGroupMenu(
            interaction.guild.id,
            interaction.guild.name,
            masterAccountId,
            dependencies
        );

        await interaction.editReply(menu);
    } catch (err) {
        logger.error(`[GroupMenu] Error showing group settings: ${err.message}`);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ Failed to load group settings.' });
        }
    }
}

/**
 * Handle button interactions for group sponsorship.
 */
async function handleGroupSettingsInteraction(client, interaction, masterAccountId, dependencies) {
    const { logger = console } = dependencies;
    const apiClient = getApiClient(dependencies);

    const parts = interaction.customId.split(':');
    const action = parts[1]; // sponsor | unsponsor | close | fund
    const guildId = parts[2];

    // Fund action must show a modal — do NOT deferUpdate before showModal
    if (action === 'fund') {
        try {
            const modal = new ModalBuilder()
                .setCustomId(`groupsettings:fundmodal:${guildId}`)
                .setTitle('Fund Server Pool');

            const pointsInput = new TextInputBuilder()
                .setCustomId('points')
                .setLabel('How many points to add?')
                .setPlaceholder('e.g. 500')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(pointsInput));
            await interaction.showModal(modal);
        } catch (err) {
            logger.error(`[GroupMenu] Failed to show fund modal: ${err.message}`);
        }
        return;
    }

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
    }

    if (action === 'close') {
        await interaction.editReply({ content: 'Group settings closed.', embeds: [], components: [] });
        return;
    }

    if (action === 'sponsor') {
        try {
            await apiClient.post('/internal/v1/data/groups/sponsor', {
                chatId: guildId,
                chatTitle: interaction.guild?.name || `Guild ${guildId}`,
                sponsorMasterAccountId: masterAccountId,
                platform: PLATFORM_KEY
            });

            const menu = await buildGroupMenu(guildId, interaction.guild?.name || '', masterAccountId, dependencies);
            await interaction.editReply(menu);
        } catch (err) {
            logger.error(`[GroupMenu] Sponsor failed: ${err.message}`);
            await interaction.editReply({ content: '❌ Failed to sponsor this server.', embeds: [], components: [] });
        }
        return;
    }

    if (action === 'unsponsor') {
        try {
            await apiClient.patch(`/internal/v1/data/groups/${guildId}/sponsor?platform=${PLATFORM_KEY}`, {
                sponsorMasterAccountId: null
            });

            const menu = await buildGroupMenu(guildId, interaction.guild?.name || '', masterAccountId, dependencies);
            await interaction.editReply(menu);
        } catch (err) {
            logger.error(`[GroupMenu] Unsponsor failed: ${err.message}`);
            await interaction.editReply({ content: '❌ Failed to withdraw sponsorship.', embeds: [], components: [] });
        }
        return;
    }
}

/**
 * Register handlers with dispatchers.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, buttonInteractionDispatcher } = dispatcherInstances;
    const { logger = console } = dependencies;

    commandDispatcher.register('groupsettings', handleGroupSettingsCommand);
    buttonInteractionDispatcher.register('groupsettings', handleGroupSettingsInteraction);

    // Register modal submit handler for fund modal
    if (dependencies.client) {
        dependencies.client.on('interactionCreate', async interaction => {
            if (!interaction.isModalSubmit()) return;
            if (!interaction.customId.startsWith('groupsettings:fundmodal:')) return;

            const apiClient = getApiClient(dependencies);
            const guildId = interaction.customId.split(':')[2];

            try {
                await interaction.deferReply({ flags: 64 });

                const pointsStr = interaction.fields.getTextInputValue('points');
                const points = parseInt(pointsStr, 10);
                if (!Number.isInteger(points) || points <= 0) {
                    await interaction.editReply({ content: 'Please enter a valid positive number of points.' });
                    return;
                }

                // Resolve user's masterAccountId
                const userResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
                    platform: 'discord',
                    platformId: interaction.user.id.toString(),
                    platformContext: {
                        username: interaction.user.username,
                        discriminator: interaction.user.discriminator,
                        globalName: interaction.user.globalName
                    }
                });
                const funderMasterAccountId = userResponse.data.masterAccountId;

                // Call fund endpoint
                const fundRes = await apiClient.post(`/internal/v1/data/groups/${guildId}/fund`, {
                    funderMasterAccountId,
                    points,
                    platform: PLATFORM_KEY
                });

                if (fundRes.data?.success) {
                    // Show updated menu
                    const menu = await buildGroupMenu(guildId, interaction.guild?.name || '', funderMasterAccountId, dependencies);
                    await interaction.editReply({
                        content: `Successfully funded **${points.toLocaleString()} points** to the server pool!`,
                        ...menu
                    });
                } else {
                    await interaction.editReply({ content: 'Funding failed. Please try again.' });
                }
            } catch (err) {
                logger.error(`[GroupMenu] Fund modal submit error: ${err.message}`);
                const errMsg = err.response?.data?.error?.code === 'INSUFFICIENT_FUNDS'
                    ? 'You do not have enough points. Purchase more with `/buypoints`.'
                    : 'Failed to fund the server pool. Please try again.';
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errMsg });
                }
            }
        });
    }

    logger.debug('[GroupMenuManager] Handlers registered');
}

module.exports = {
    registerHandlers,
    buildGroupMenu,
    handleGroupSettingsCommand,
    handleGroupSettingsInteraction,
    PLATFORM_KEY
};
