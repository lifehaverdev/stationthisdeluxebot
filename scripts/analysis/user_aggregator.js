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
    console.log(`Loaded ${sessions.length} enriched sessions.`);

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
                command_frequencies: {},
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
        
        // Aggregate command_counts
        for (const [command, count] of Object.entries(session.command_counts || {})) {
            user.command_frequencies[command] = (user.command_frequencies[command] || 0) + count;
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
        
        // Sort command_frequencies for easier reading in summaries
        const sortedCommandFrequencies = Object.entries(user.command_frequencies)
            .sort(([,a],[,b]) => b-a)
            .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});
        user.command_frequencies = sortedCommandFrequencies;
        return user;
    });

    console.log(`Finished aggregating features for ${aggregatedFeaturesArray.length} unique users.`);

    // --- Save the full aggregated data ---
    try {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(aggregatedFeaturesArray, null, 2));
        console.log(`Successfully saved aggregated user features to ${OUTPUT_FILE}`);
    } catch (error) {
        console.error(`Error writing output file ${OUTPUT_FILE}:`, error);
    }
    // --- End save --- 

    // --- ADDED: Print Summaries and Top N Users ---
    console.log('\n--- Top User Summaries ---');

    const printTopNUsers = (metricName, dataArray, N = 5) => {
        console.log(`\nTop ${N} Users by ${metricName}:`);
        const sortedUsers = [...dataArray].sort((a, b) => b[metricName] - a[metricName]);
        sortedUsers.slice(0, N).forEach(user => {
            console.log(
                `  User: ${user.username || user.userId}, ${metricName}: ${user[metricName].toLocaleString()}` + 
                ` (Sessions: ${user.total_sessions}, GenTime: ${(user.total_generation_duration_ms/1000).toFixed(1)}s, ` + 
                `TotalCmds: ${user.total_commands})`
            );
            // Print top 3 commands for these users
            const topCommands = Object.entries(user.command_frequencies).slice(0,3).map(([cmd,count]) => `${cmd} (${count})`).join(', ');
            console.log(`    Top Commands: ${topCommands || 'N/A'}`); 
        });
    };

    printTopNUsers('total_generation_duration_ms', aggregatedFeaturesArray);
    printTopNUsers('total_sessions', aggregatedFeaturesArray);
    printTopNUsers('total_commands', aggregatedFeaturesArray);
    printTopNUsers('avg_commands_per_session', aggregatedFeaturesArray);
    // --- End Print Summaries ---

}

aggregateUserFeatures(); 