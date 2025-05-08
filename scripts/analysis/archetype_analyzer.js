// /vibecode/scripts/analysis/archetype_analyzer.js
// Script to analyze aggregated user features for archetype development and churn analysis.

const fs = require('fs');
const path = require('path');
require('dotenv').config(); // For configurable thresholds via .env file

const INPUT_FILE = path.join(__dirname, '../../reports/user_aggregated_features.json');
const OUTPUT_DIR = path.join(__dirname, '../../reports'); // For potential future output files

function analyzeArchetypes() {
    console.log('--- Archetype Analyzer ---');
    console.log(`Attempting to load aggregated user features from ${INPUT_FILE}...`);

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Error: Input file not found: ${INPUT_FILE}`);
        console.error('Please run user_aggregator.js first to generate user_aggregated_features.json');
        return;
    }

    try {
        const aggregatedDataString = fs.readFileSync(INPUT_FILE, 'utf-8');
        const users = JSON.parse(aggregatedDataString);
        console.log(`Successfully loaded data for ${users.length} users.`);

        if (users.length === 0) {
            console.log('No user data to analyze.');
            return;
        }

        // Placeholder for archetype definitions and analysis logic
        // For now, let's print some basic info about the loaded data
        console.log(`\nFirst user loaded: ${users[0].username} (ID: ${users[0].userId})`);
        console.log(`  Total Sessions: ${users[0].total_sessions}`);
        console.log(`  Total Commands: ${users[0].total_commands}`);
        console.log(`  Total Generation Duration (ms): ${users[0].total_generation_duration_ms}`);

        // Archetype Definitions & Categorization
        const archetypes = {
            touchAndGoNewcomers: [],
            powerUsers: [],
            iterativeRefiners: [],
            videoEnthusiasts: [],
            engagedRegulars: [],
            focusedTaskUsers: [],
            newLightUsers: [], // Users who are not "touch and go" but still light
            unclassifiedUsers: [] // ENABLED: for users not fitting any category
        };

        // --- Define Thresholds (Defaults here, can be overridden by .env variables) ---
        const TOUCH_AND_GO_MAX_SESSIONS = parseInt(process.env.ARCHETYPE_TAG_MAX_SESSIONS || '4'); // < 5 sessions

        const POWER_USER_MIN_GEN_TIME_MS = (parseFloat(process.env.ARCHETYPE_POWER_MIN_GEN_HOURS) || 20) * 3600 * 1000;
        const POWER_USER_MIN_COMMANDS = parseInt(process.env.ARCHETYPE_POWER_MIN_COMMANDS) || 1500;

        const ITERATIVE_MIN_COMMANDS = parseInt(process.env.ARCHETYPE_ITERATIVE_MIN_COMMANDS) || 200;
        const ITERATIVE_AGAIN_EFFECT_REGEN_TO_MAKE_RATIO = parseFloat(process.env.ARCHETYPE_ITERATIVE_RATIO) || 0.5;
        const ITERATIVE_MIN_ITERATIVE_CMDS_SUM = parseInt(process.env.ARCHETYPE_ITERATIVE_MIN_SUM_ITERATIVE) || 50;

        const VIDEO_ENTHUSIAST_MIN_VIDEO_COMMANDS = parseInt(process.env.ARCHETYPE_VIDEO_MIN_COMMANDS) || 20;

        const ENGAGED_REGULAR_MIN_SESSIONS = parseInt(process.env.ARCHETYPE_ENGAGED_MIN_SESSIONS || '30');
        const ENGAGED_REGULAR_MIN_COMMANDS = parseInt(process.env.ARCHETYPE_ENGAGED_MIN_COMMANDS) || 300;
        const ENGAGED_REGULAR_MIN_MGMT_COMMANDS = parseInt(process.env.ARCHETYPE_ENGAGED_MIN_MGMT_CMDS) || 10; // /account, /utils, /set
        const ENGAGED_REGULAR_MIN_TOTAL_MENU_INTERACTIONS = parseInt(process.env.ARCHETYPE_ENGAGED_MIN_TOTAL_MENU_INTERACTIONS || '75');
        const ENGAGED_REGULAR_MIN_AVG_MENU_INTERACTIONS_PER_SESSION = parseFloat(process.env.ARCHETYPE_ENGAGED_MIN_AVG_MENU_INTERACTIONS_PER_SESSION || '1.5');

        const FOCUSED_TASK_MAX_SESSIONS = parseInt(process.env.ARCHETYPE_FOCUSED_MAX_SESSIONS) || 25;
        const FOCUSED_TASK_MIN_SESSIONS = TOUCH_AND_GO_MAX_SESSIONS + 1;
        const FOCUSED_TASK_MIN_AVG_CMDS_PER_SESSION = parseFloat(process.env.ARCHETYPE_FOCUSED_MIN_AVG_CMDS) || 4.0;
        const FOCUSED_DOMINANT_CMD_RATIO = parseFloat(process.env.ARCHETYPE_FOCUSED_DOMINANT_RATIO) || 0.6;

        const NEW_LIGHT_MAX_SESSIONS = parseInt(process.env.ARCHETYPE_NEWLIGHT_MAX_SESSIONS) || 15;
        const NEW_LIGHT_MAX_COMMANDS = parseInt(process.env.ARCHETYPE_NEWLIGHT_MAX_COMMANDS) || 150;
        const NEW_LIGHT_MAX_GEN_TIME_MS = (parseFloat(process.env.ARCHETYPE_NEWLIGHT_MAX_GEN_HOURS) || 2) * 3600 * 1000;
        // --- End Thresholds ---

        users.forEach(user => {
            const userIdName = `${user.username} (ID: ${user.userId})`;
            let isOtherwiseCategorized = false; // For helping place users in NewLight or Unclassified

            // 1. Touch and Go Newcomers (Primary category for them)
            if (user.total_sessions <= TOUCH_AND_GO_MAX_SESSIONS) {
                archetypes.touchAndGoNewcomers.push({ ...user, name: userIdName });
                // Generally, we consider this their primary defining characteristic for this analysis.
                // We could allow them to be categorized further, but for churn insights, this is key.
            } else {
                // Only categorize further if NOT a "Touch and Go Newcomer" for primary archetypes
                let currentUserCategories = []; // Track categories for this user

                // 2. Power User
                if (user.total_generation_duration_ms >= POWER_USER_MIN_GEN_TIME_MS &&
                    user.total_commands >= POWER_USER_MIN_COMMANDS) {
                    archetypes.powerUsers.push({ ...user, name: userIdName });
                    isOtherwiseCategorized = true;
                    currentUserCategories.push("PowerUser");
                }

                // 3. Iterative Refiner
                const makeCommands = user.command_frequencies['/make'] || 0;
                const againCommands = user.command_frequencies['/again'] || 0;
                const effectCommands = user.command_frequencies['/effect'] || 0;
                const regenCommands = user.command_frequencies['/regen'] || 0;
                const iterativeSum = againCommands + effectCommands + regenCommands;

                if (user.total_commands >= ITERATIVE_MIN_COMMANDS && iterativeSum >= ITERATIVE_MIN_ITERATIVE_CMDS_SUM) {
                    let isIterative = false;
                    if (makeCommands > 0 && (iterativeSum / makeCommands) >= ITERATIVE_AGAIN_EFFECT_REGEN_TO_MAKE_RATIO) {
                        isIterative = true;
                    } else if (makeCommands === 0 && iterativeSum > ITERATIVE_MIN_ITERATIVE_CMDS_SUM * 0.5) { // Iterative without much /make (e.g. effects on uploads)
                        isIterative = true;
                    }
                    if (isIterative) {
                        archetypes.iterativeRefiners.push({ ...user, name: userIdName });
                        isOtherwiseCategorized = true;
                        currentUserCategories.push("IterativeRefiner");
                    }
                }

                // 4. Video Enthusiast
                const viduthatCommands = user.command_frequencies['/viduthat'] || 0;
                const animateCommands = user.command_frequencies['/animate'] || 0;
                const makevideoCommands = user.command_frequencies['/makevideo'] || 0; // Check if this exists in data
                const totalVideoCommands = viduthatCommands + animateCommands + makevideoCommands;

                if (totalVideoCommands >= VIDEO_ENTHUSIAST_MIN_VIDEO_COMMANDS) {
                    archetypes.videoEnthusiasts.push({ ...user, name: userIdName });
                    isOtherwiseCategorized = true;
                    currentUserCategories.push("VideoEnthusiast");
                }

                // 5. Engaged Regular / Explorer
                const accountCommands = user.command_frequencies['/account'] || 0;
                const utilsCommands = user.command_frequencies['/utils'] || 0;
                const setCommands = user.command_frequencies['/set'] || 0;
                const totalMgmtCommands = accountCommands + utilsCommands + setCommands;

                if (user.total_sessions >= ENGAGED_REGULAR_MIN_SESSIONS &&
                    user.total_commands >= ENGAGED_REGULAR_MIN_COMMANDS &&
                    totalMgmtCommands >= ENGAGED_REGULAR_MIN_MGMT_COMMANDS) {
                    archetypes.engagedRegulars.push({ ...user, name: userIdName });
                    isOtherwiseCategorized = true;
                    currentUserCategories.push("EngagedRegular");
                } else if ( // Alternative path via menu interactions
                    user.total_sessions >= ENGAGED_REGULAR_MIN_SESSIONS &&
                    user.total_menu_interactions >= ENGAGED_REGULAR_MIN_TOTAL_MENU_INTERACTIONS &&
                    user.avg_menu_interactions_per_session >= ENGAGED_REGULAR_MIN_AVG_MENU_INTERACTIONS_PER_SESSION
                ) {
                    archetypes.engagedRegulars.push({ ...user, name: userIdName });
                    isOtherwiseCategorized = true;
                    currentUserCategories.push("EngagedRegular_MenuFocus"); // Differentiate if needed, or keep same
                }

                // 6. Focused Task User
                if (user.total_sessions >= FOCUSED_TASK_MIN_SESSIONS && // Is above touch-and-go implicitly by else block
                    user.total_sessions <= FOCUSED_TASK_MAX_SESSIONS &&
                    user.avg_commands_per_session >= FOCUSED_TASK_MIN_AVG_CMDS_PER_SESSION) {
                    let isDominantTask = false;
                    if (user.command_counts_sorted && Object.keys(user.command_counts_sorted).length > 0) {
                        const topCommandName = Object.keys(user.command_counts_sorted)[0];
                        const topCommandCount = Object.values(user.command_counts_sorted)[0];
                        // Example: /make is dominant and user is not already a power user or highly iterative
                        if ((topCommandName === '/make' || topCommandName === '/create') && (topCommandCount / user.total_commands) >= FOCUSED_DOMINANT_CMD_RATIO) {
                             isDominantTask = true;
                        }
                    }
                    if (isDominantTask) {
                        // Avoid classifying if already a PowerUser, Iterative, or EngagedRegular to make this more distinct
                        if (!currentUserCategories.includes("PowerUser") && !currentUserCategories.includes("IterativeRefiner") && !currentUserCategories.includes("EngagedRegular")) {
                            archetypes.focusedTaskUsers.push({ ...user, name: userIdName });
                            isOtherwiseCategorized = true;
                            currentUserCategories.push("FocusedTaskUser");
                        }
                    }
                }

                // 7. New / Light User (not Touch and Go, and not fitting other more active archetypes)
                if (!isOtherwiseCategorized && // Key: if not caught by any of the above specific archetypes
                    user.total_sessions <= NEW_LIGHT_MAX_SESSIONS && // Already know > TOUCH_AND_GO_MAX_SESSIONS
                    user.total_commands <= NEW_LIGHT_MAX_COMMANDS &&
                    user.total_generation_duration_ms <= NEW_LIGHT_MAX_GEN_TIME_MS) {
                    archetypes.newLightUsers.push({ ...user, name: userIdName });
                    isOtherwiseCategorized = true; // Mark as categorized if they fit NewLightUser
                    currentUserCategories.push("NewLightUser");
                }

                // 8. Unclassified Users (not Touch and Go, and not fitting any other defined archetype)
                if (!isOtherwiseCategorized) { // If still not categorized after all other checks (excluding TouchAndGo)
                    archetypes.unclassifiedUsers.push({ ...user, name: userIdName });
                    // No need to push to currentUserCategories as this is the final fallback for this branch
                }
            }
        });

        console.log('\n--- Archetype Analysis Results ---');
        for (const archetypeKey in archetypes) {
            const userList = archetypes[archetypeKey];
            console.log(`\n--- ${archetypeKey} (${userList.length} users) ---`);
            if (userList.length === 0) {
                console.log('No users found for this archetype with current criteria.');
                continue;
            }
            const usersToDisplay = userList.slice(0, Math.min(userList.length, 10)); // Display up to 10

            usersToDisplay.forEach(user => {
                console.log(`  User: ${user.name}`);
                console.log(`    Sessions: ${user.total_sessions}, Commands: ${user.total_commands}, Gen Time: ${(user.total_generation_duration_ms / 3600000).toFixed(2)}h`);
                const topCmds = Object.entries(user.command_counts_sorted || {}).slice(0,3).map(([c,n]) => `${c}(${n})`).join(', ') || 'None';
                console.log(`    Top Commands: ${topCmds}`);
                if (user.menu_interaction_counts_sorted && Object.keys(user.menu_interaction_counts_sorted).length > 0) {
                    const topMenus = Object.entries(user.menu_interaction_counts_sorted).slice(0,3).map(([m,c]) => `${m}(${c})`).join(', ') || 'None';
                    console.log(`    Top Menu Interactions: ${topMenus}`);
                }
                if (archetypeKey === 'touchAndGoNewcomers') {
                    console.log(`    Avg Cmds/Session: ${user.avg_commands_per_session.toFixed(2)}, Avg GenTime/Session: ${(user.avg_generation_duration_ms_per_session / 1000).toFixed(2)}s`);
                    console.log(`    Start Reasons: ${JSON.stringify(user.session_start_reasons)}`);
                }
                 if (archetypeKey === 'focusedTaskUsers') {
                    console.log(`    Avg Cmds/Session: ${user.avg_commands_per_session.toFixed(2)}`);
                }
                if (archetypeKey === 'engagedRegulars') { // Specific output for Engaged Regulars
                    console.log(`    Total Menu Interactions: ${user.total_menu_interactions}, Avg Menu/Session: ${user.avg_menu_interactions_per_session.toFixed(2)}`);
                }
            });
            if (userList.length > 10) {
                console.log(`  ... and ${userList.length - 10} more.`);
            }
        }

    } catch (error) {
        console.error('Error during archetype analysis:', error);
    }

    console.log('--- Archetype Analyzer Finished ---');
}

analyzeArchetypes();