const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '../../reports/enriched_user_sessions.json');
const OUTPUT_FILE = path.join(__dirname, '../../reports/user_aggregated_features.json');

function aggregateUserFeatures() {
    console.log(`Loading enriched sessions from ${INPUT_FILE}...`);
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Error: Input file not found: ${INPUT_FILE}`);
        console.error('Please run feature_extractor.js first to generate enriched_user_sessions.json');
        return;
    }

    const sessionsData = fs.readFileSync(INPUT_FILE, 'utf-8');
    const sessions = JSON.parse(sessionsData);
    console.log(`Successfully loaded ${sessions.length} enriched sessions from ${INPUT_FILE}. Starting aggregation.`);

    const userAggregates = {};

    sessions.forEach(session => {
        const userId = session.userId || 'unknown_user_id'; // Handle cases where userId might be missing
        const username = session.username || 'unknown_username';

        if (!userAggregates[userId]) {
            userAggregates[userId] = {
                userId: userId,
                username: username, // Store first encountered username, might need refinement
                total_sessions: 0,
                total_duration_ms: 0,
                total_events: 0,
                total_commands: 0,
                total_generation_events: 0,
                total_error_events: 0,
                total_generation_duration_ms: 0,
                total_menu_interactions: 0,
                command_frequencies: {},
                menu_interaction_frequencies: {},
                // Initialize specific command totals
                total_make_commands: 0,
                total_again_commands: 0,
                total_help_commands: 0,
                total_effect_commands: 0,
                total_account_commands: 0,
                total_quickmake_commands: 0,
                total_viduthat_commands: 0,
                total_utils_commands: 0,
                total_set_commands: 0,
                total_status_commands: 0,
                total_regen_commands: 0,
                total_create_commands: 0,
                session_start_reasons: {},
            };
        }

        const user = userAggregates[userId];
        user.total_sessions++;
        user.total_duration_ms += session.duration || 0;
        user.total_events += session.num_events || 0;
        user.total_commands += session.num_commands || 0;
        user.total_generation_events += session.num_generation_events || 0;
        user.total_error_events += session.num_error_events || 0;
        user.total_generation_duration_ms += session.total_generation_duration_ms || 0;
        user.total_menu_interactions += session.num_menu_interactions || 0;
        
        // Aggregate command_counts
        for (const [command, count] of Object.entries(session.command_counts || {})) {
            user.command_frequencies[command] = (user.command_frequencies[command] || 0) + count;
        }
        
        // Aggregate menu_interaction_counts
        for (const [interaction, count] of Object.entries(session.menu_interaction_counts || {})) {
            user.menu_interaction_frequencies[interaction] = (user.menu_interaction_frequencies[interaction] || 0) + count;
        }
        
        // Aggregate specific command counters
        user.total_make_commands += session.num_make_commands || 0;
        user.total_again_commands += session.num_again_commands || 0;
        user.total_help_commands += session.num_help_commands || 0;
        user.total_effect_commands += session.num_effect_commands || 0;
        user.total_account_commands += session.num_account_commands || 0;
        user.total_quickmake_commands += session.num_quickmake_commands || 0;
        user.total_viduthat_commands += session.num_viduthat_commands || 0;
        user.total_utils_commands += session.num_utils_commands || 0;
        user.total_set_commands += session.num_set_commands || 0;
        user.total_status_commands += session.num_status_commands || 0;
        user.total_regen_commands += session.num_regen_commands || 0;
        user.total_create_commands += session.num_create_commands || 0;

        // Aggregate session start reasons
        if (session.startReason) {
            user.session_start_reasons[session.startReason] = (user.session_start_reasons[session.startReason] || 0) + 1;
        }
    });

    // Convert userAggregates object to an array and calculate averages
    const aggregatedFeaturesArray = Object.values(userAggregates).map(user => {
        user.avg_duration_ms_per_session = user.total_sessions > 0 ? user.total_duration_ms / user.total_sessions : 0;
        user.avg_events_per_session = user.total_sessions > 0 ? user.total_events / user.total_sessions : 0;
        user.avg_commands_per_session = user.total_sessions > 0 ? user.total_commands / user.total_sessions : 0;
        user.avg_generation_events_per_session = user.total_sessions > 0 ? user.total_generation_events / user.total_sessions : 0;
        user.avg_error_events_per_session = user.total_sessions > 0 ? user.total_error_events / user.total_sessions : 0;
        user.avg_generation_duration_ms_per_session = user.total_sessions > 0 ? user.total_generation_duration_ms / user.total_sessions : 0;
        user.avg_menu_interactions_per_session = user.total_sessions > 0 ? user.total_menu_interactions / user.total_sessions : 0;
        
        // Sort command_frequencies for easier reading in summaries
        const sortedCommandFrequencies = Object.entries(user.command_frequencies)
            .sort(([,a],[,b]) => b-a)
            .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});
        user.command_frequencies = sortedCommandFrequencies;

        // Sort user's own command frequencies
        user.command_counts_sorted = Object.entries(user.command_frequencies)
            .sort(([,a],[,b]) => b-a)
            .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

        // Sort user's own menu interaction frequencies
        user.menu_interaction_counts_sorted = Object.entries(user.menu_interaction_frequencies)
            .sort(([,a],[,b]) => b-a)
            .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

        return user;
    });

    console.log(`\nAttempting to write ${aggregatedFeaturesArray.length} aggregated user profiles to ${OUTPUT_FILE}. This may take a while...`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(aggregatedFeaturesArray, null, 2));
    console.log(`User aggregated features saved to ${OUTPUT_FILE}`);

    // --- CHURN ANALYSIS ---
    console.log('\n--- Churn Analysis (Users with 1 or 2 Sessions Lifetime) ---');
    const churnedUsersOneSession = [];
    const churnedUsersTwoSessions = [];

    aggregatedFeaturesArray.forEach(user => {
        if (user.total_sessions === 1) {
            churnedUsersOneSession.push(user);
        } else if (user.total_sessions === 2) {
            churnedUsersTwoSessions.push(user);
        }
    });

    console.log(`\nFound ${churnedUsersOneSession.length} users with exactly 1 session:`);
    churnedUsersOneSession.forEach(user => {
        console.log(`  User: ${user.username} (ID: ${user.userId}), Sessions: 1`);
        console.log(`    Total Duration: ${(user.total_duration_ms / 60000).toFixed(2)} mins, Commands: ${user.total_commands}, Menu Interactions: ${user.total_menu_interactions}`);
        console.log(`    Gen Events: ${user.total_generation_events}, Gen Time: ${(user.total_generation_duration_ms / 1000).toFixed(2)}s, Errors: ${user.total_error_events}`);
        console.log(`    Top Commands: ${Object.entries(user.command_counts_sorted).slice(0,3).map(([c,n]) => `${c}(${n})`).join(', ') || 'None'}`);
        console.log(`    Top Menu Interactions: ${Object.entries(user.menu_interaction_counts_sorted || {}).slice(0,3).map(([i,n]) => `${i}(${n})`).join(', ') || 'None'}`);
        console.log(`    Start Reasons: ${JSON.stringify(user.session_start_reasons)}`);
    });

    console.log(`\nFound ${churnedUsersTwoSessions.length} users with exactly 2 sessions:`);
    churnedUsersTwoSessions.forEach(user => {
        console.log(`  User: ${user.username} (ID: ${user.userId}), Sessions: 2`);
        console.log(`    Total Duration: ${(user.total_duration_ms / 60000).toFixed(2)} mins, Commands: ${user.total_commands}, Menu Interactions: ${user.total_menu_interactions}`);
        console.log(`    Gen Events: ${user.total_generation_events}, Gen Time: ${(user.total_generation_duration_ms / 1000).toFixed(2)}s, Errors: ${user.total_error_events}`);
        console.log(`    Top Commands: ${Object.entries(user.command_counts_sorted).slice(0,3).map(([c,n]) => `${c}(${n})`).join(', ') || 'None'}`);
        console.log(`    Top Menu Interactions: ${Object.entries(user.menu_interaction_counts_sorted || {}).slice(0,3).map(([i,n]) => `${i}(${n})`).join(', ') || 'None'}`);
        console.log(`    Start Reasons: ${JSON.stringify(user.session_start_reasons)}`);
    });
    console.log('--- End Churn Analysis ---');

    // --- Existing Top N Analysis (will now use full history data) ---
    console.log('\n--- Top User Summaries (Full History) ---');
    const N_TOP_USERS = 10; // Number of top users to display for each metric

    const printTopUsers = (metricName, dataArray, N = 5, valueFormatter = null) => {
        console.log(`\nTop ${N} Users by ${metricName}:`);
        const sortedUsers = [...dataArray].sort((a, b) => (b[metricName] || 0) - (a[metricName] || 0)); // Handle undefined/null for sorting

        sortedUsers.slice(0, N).forEach(user => {
            const metricValue = user[metricName];
            const displayValue = (metricValue !== null && typeof metricValue !== 'undefined') ? metricValue.toLocaleString() : 'N/A'; // MODIFIED: Check for null/undefined
            let logMessage = `  User: ${user.username || user.userId}, ${metricName}: ${displayValue}`;
            if (valueFormatter) {
                logMessage += ` (${valueFormatter(user)})`;
            }
            console.log(logMessage);
            // Log top 3 commands for these users
            const topCommands = Object.entries(user.command_counts_sorted || {}).slice(0,3).map(([c,n]) => `${c}(${n})`).join(', ') || 'None';
            console.log(`    Top Commands: ${topCommands}`);
            // Log top 3 menu interactions for these users
            const topMenuInteractions = Object.entries(user.menu_interaction_counts_sorted || {}).slice(0,3).map(([i,n]) => `${i}(${n})`).join(', ') || 'None';
            console.log(`    Top Menu Interactions: ${topMenuInteractions}`);
        });
    };

    printTopUsers('total_generation_duration_ms', aggregatedFeaturesArray);
    printTopUsers('total_sessions', aggregatedFeaturesArray);
    printTopUsers('total_commands', aggregatedFeaturesArray);
    printTopUsers('total_menu_interactions', aggregatedFeaturesArray, N_TOP_USERS);
    printTopUsers('avg_commands_per_session', aggregatedFeaturesArray);
    printTopUsers('avg_menu_interactions_per_session', aggregatedFeaturesArray, N_TOP_USERS);
    printTopUsers('Avg Generation Duration MS per Session', aggregatedFeaturesArray, N_TOP_USERS, user => `${(user.avg_generation_duration_ms_per_session / 1000).toFixed(2)}s`);

    console.log('\n--- User Aggregator Finished ---');
}

aggregateUserFeatures(); 