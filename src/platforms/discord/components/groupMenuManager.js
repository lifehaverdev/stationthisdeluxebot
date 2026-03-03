/**
 * Group Menu Manager for Discord
 *
 * Handles group sponsorship — allows a user to sponsor a Discord guild
 * so their account/credits are used when admins execute commands.
 * Analogous to Telegram's groupMenuManager.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

    const embed = new EmbedBuilder()
        .setColor(isSponsored ? 0x00CC66 : 0x666666)
        .setTitle('Group Sponsorship')
        .setDescription(
            isSponsored
                ? 'This server is sponsored. Admins will use the sponsor\'s account when running commands.'
                : 'No sponsor set. Commands use each user\'s own account.'
        )
        .setFooter({ text: guildName });

    const row = new ActionRowBuilder();

    if (!isSponsored) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`groupsettings:sponsor:${guildId}`)
                .setLabel('Sponsor this server')
                .setStyle(ButtonStyle.Success)
        );
    } else if (isSponsor) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`groupsettings:unsponsor:${guildId}`)
                .setLabel('Withdraw sponsorship')
                .setStyle(ButtonStyle.Danger)
        );
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

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
    }

    const parts = interaction.customId.split(':');
    const action = parts[1]; // sponsor | unsponsor | close
    const guildId = parts[2];

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

    logger.debug('[GroupMenuManager] Handlers registered');
}

module.exports = {
    registerHandlers,
    buildGroupMenu,
    handleGroupSettingsCommand,
    handleGroupSettingsInteraction,
    PLATFORM_KEY
};
