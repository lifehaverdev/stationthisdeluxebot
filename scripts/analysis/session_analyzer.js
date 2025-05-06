// /vibecode/scripts/analysis/session_analyzer.js
// Standalone script for User Session Analysis and Refinement

// require('dotenv').config({ path: '../../../.env' }); // Adjust path to .env if necessary
const dotenv = require('dotenv');
console.log('dotenv module loaded:', typeof dotenv, typeof dotenv.config);
// dotenv.config({ path: '../../../.env' }); // Adjust path to .env if necessary
dotenv.config(); // RELY ON DEFAULT BEHAVIOR (process.cwd()/.env)
console.log('After dotenv.config(), BOT_NAME is:', process.env.BOT_NAME); // ADDED LINE FOR DEBUGGING

const { MongoClient } = require('mongodb');
const crypto = require('crypto'); // For generating session IDs
const fs = require('fs'); // ADDED: For file system operations
const path = require('path'); // ADDED: For path manipulation

// --- Helper function to generate a simple session ID (copied from routes) ---
function generateSessionId(userId, startTime) {
    const hash = crypto.createHash('sha256');
    hash.update(String(userId) + String(new Date(startTime).getTime()));
    return hash.digest('hex').substring(0, 16);
}

// --- Copied and adapted processEventsForUser from routes ---
// Added db as a direct parameter for standalone use
function processEventsForUser(userId, events, allUserSessions, inactivityTimeoutMs, db) {
    if (!events || events.length === 0) return;

    let currentSession = null;
    // Assuming username is consistent for the user. If not, might need to fetch from users_core
    const username = events[0].username || 'unknown_user';


    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const eventTime = new Date(event.timestamp).getTime();

        if (currentSession === null) {
            currentSession = startNewSession(event, userId, username, db); // Pass db
            if (currentSession) {
                allUserSessions.push(currentSession);
            }
            continue;
        }

        if (eventTime - new Date(currentSession.lastEventTimestamp).getTime() > inactivityTimeoutMs) {
            currentSession.endReason = 'timeout';
            currentSession.endTime = currentSession.lastEventTimestamp;
            currentSession.duration = new Date(currentSession.endTime).getTime() - new Date(currentSession.startTime).getTime();

            currentSession = startNewSession(event, userId, username, db); // Start new session
            if (currentSession) {
                allUserSessions.push(currentSession);
            }
            continue;
        }

        if (currentSession && currentSession.events[currentSession.events.length -1] !== event ) {
             currentSession.events.push(event);
        }
        currentSession.lastEventTimestamp = event.timestamp;

        if (event.type === 'user_state' && event.data && event.data.eventType === 'kicked') {
            currentSession.endReason = 'kicked';
            currentSession.endTime = event.timestamp;
            currentSession.duration = new Date(currentSession.endTime).getTime() - new Date(currentSession.startTime).getTime();
            currentSession = null;
        }
    }

    if (currentSession) {
        if (!currentSession.endTime) {
            currentSession.endReason = 'data_ended';
            currentSession.endTime = currentSession.lastEventTimestamp;
            currentSession.duration = new Date(currentSession.endTime).getTime() - new Date(currentSession.startTime).getTime();
        }
    }
}

// --- Copied and adapted startNewSession from routes ---
// Added db as a direct parameter for standalone use
function startNewSession(event, userId, username, db) {
    let sessionStartReason = null;
    let isDesignatedStartEvent = false;

    if (event.type === 'user_state' && event.data) {
        if (event.data.eventType === 'first_join') { sessionStartReason = 'first_join'; isDesignatedStartEvent = true; }
        else if (event.data.eventType === 'check_in') { sessionStartReason = 'check_in'; isDesignatedStartEvent = true; }
    } else if (event.type === 'command' && event.data && event.data.command === '/start') {
        sessionStartReason = 'command_start';
        isDesignatedStartEvent = true;
    }

    if (!isDesignatedStartEvent) {
        sessionStartReason = 'implicit_start'; // Use generic reason for non-designated starts
    }

    const startTime = event.timestamp;
    return {
        sessionId: generateSessionId(userId, startTime),
        userId: userId,
        username: username,
        startTime: startTime,
        endTime: null,
        duration: null,
        startReason: sessionStartReason,
        endReason: null,
        events: [event],
        lastEventTimestamp: event.timestamp
    };
}


// --- Main analysis function (adapted from /api/admin/stats/user-sessions) ---
async function analyzeUserSessions(daysToScan, specificUserId, inactivityTimeoutMinutes) {
    const MONGO_URI = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const DB_NAME = process.env.BOT_NAME;
    const HISTORY_COLLECTION_NAME = 'history';
    const USERS_CORE_COLLECTION_NAME = 'users_core';

    if (!DB_NAME) {
        console.error('Error: BOT_NAME environment variable is not set. Make sure .env is loaded.');
        return;
    }
    if (!MONGO_URI) {
        console.error('Error: MONGO_PASS or MONGODB_URI environment variable is not set.');
        return;
    }
    
    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();
        console.log('Successfully connected to MongoDB.');
        const db = client.db(DB_NAME);
        const historyCollection = db.collection(HISTORY_COLLECTION_NAME);
        // const usersCoreCollection = db.collection(USERS_CORE_COLLECTION_NAME); // For fetching usernames if needed

        const inactivityTimeoutMs = inactivityTimeoutMinutes * 60 * 1000;

        const NDaysAgo = new Date();
        NDaysAgo.setDate(NDaysAgo.getDate() - daysToScan);
        console.log(`Fetching history for ${daysToScan} days (since ${NDaysAgo.toISOString()}) for session analysis.`);
        console.log(`User ID filter: ${specificUserId || 'all users'}`);
        console.log(`Inactivity timeout: ${inactivityTimeoutMinutes} minutes`);

        const matchQuery = {
            timestamp: { $gte: NDaysAgo } // Ensure timestamp is Date object for query if needed, or string if stored as string
        };
        if (specificUserId) {
            // Ensure specificUserId is the correct type (e.g., integer or string) as stored in DB
            matchQuery.userId = typeof specificUserId === 'string' ? parseInt(specificUserId) : specificUserId;
        }
        
        // Convert history timestamp to Date objects if they are stored as ISO strings
        // This might be needed if your history collection stores timestamps as strings
        // For this script, we assume event.timestamp will be a JS Date compatible string or a Date object
        // The original route code implies event.timestamp is an ISO string that new Date() can parse.

        console.log('Fetching history events. This might take a while for large datasets...');
        const userEvents = await historyCollection.find(matchQuery)
            .sort({ userId: 1, timestamp: 1 }) // Sort by user, then time
            .toArray();

        if (userEvents.length === 0) {
            console.log('No history events found for the specified criteria.');
            return { sessions: [] };
        }
        console.log(`Fetched ${userEvents.length} events for processing.`);

        const allUserSessions = [];
        let currentUserEvents = [];
        let currentProcessingUserId = null;

        for (const event of userEvents) {
            // Ensure event.userId is of a consistent type for comparison
            const eventUserId = typeof event.userId === 'string' ? parseInt(event.userId) : event.userId;
            if (currentProcessingUserId !== eventUserId) {
                if (currentUserEvents.length > 0 && currentProcessingUserId !== null) {
                    // Pass db to processEventsForUser for potential use by helpers (e.g. fetching user details)
                    processEventsForUser(currentProcessingUserId, currentUserEvents, allUserSessions, inactivityTimeoutMs, db);
                }
                currentProcessingUserId = eventUserId;
                currentUserEvents = [event];
            } else {
                currentUserEvents.push(event);
            }
        }
        
        if (currentUserEvents.length > 0 && currentProcessingUserId !== null) {
            processEventsForUser(currentProcessingUserId, currentUserEvents, allUserSessions, inactivityTimeoutMs, db);
        }

        const distinctUserIdsInSessions = new Set(allUserSessions.map(session => session.userId));
        console.log(`Reconstructed ${allUserSessions.length} sessions for ${distinctUserIdsInSessions.size} unique users.`);
        
        /*
        // --- Print a sample of sessions to console ---
        if (allUserSessions.length > 0) {
            console.log('\n--- Sample of First 5 Sessions ---');
            console.log(JSON.stringify(allUserSessions.slice(0, 5), null, 2));
        } else {
            console.log('\nNo sessions reconstructed, nothing to sample.');
        }
        // --- End print sample ---
        */

        // --- Save sessions to a file ---
        if (allUserSessions.length > 0) {
            // Ensure the reports directory exists
            const reportsDir = path.join(__dirname, '../../reports'); // Assuming script is in scripts/analysis
            if (!fs.existsSync(reportsDir)){
                fs.mkdirSync(reportsDir, { recursive: true });
            }
            const outputFilePath = path.join(reportsDir, 'user_sessions_output.json');
            fs.writeFileSync(outputFilePath, JSON.stringify(allUserSessions, null, 2));
            console.log(`\nSuccessfully saved ${allUserSessions.length} sessions to ${outputFilePath}`);
        } else {
            console.log('\nNo sessions reconstructed, nothing to save.');
        }
        // --- End save sessions to a file ---
        
        return {
            parameters: { daysToScan, specificUserId, inactivityTimeoutMinutes },
            sessions: allUserSessions
        };

    } catch (error) {
        console.error('An error occurred during session analysis:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('\nConnection to MongoDB closed.');
        }
    }
}

// --- Command-line argument parsing and execution ---
async function main() {
    const args = process.argv.slice(2);
    const daysArg = args.find(arg => arg.startsWith('--days='));
    const userIdArg = args.find(arg => arg.startsWith('--userId='));
    const timeoutArg = args.find(arg => arg.startsWith('--timeout='));

    const daysToScan = daysArg ? parseInt(daysArg.split('=')[1]) : 30; // Default to 30 days
    const specificUserId = userIdArg ? userIdArg.split('=')[1] : null; // Default to all users
    const inactivityTimeoutMinutes = timeoutArg ? parseInt(timeoutArg.split('=')[1]) : 30; // Default to 30 minutes

    console.log('--- User Session Analyzer ---');
    await analyzeUserSessions(daysToScan, specificUserId, inactivityTimeoutMinutes);
    console.log('--- Analysis Complete ---');
}

main();

// TODO:
// 1. Add more robust username fetching if events don't always contain it (e.g., from users_core).
//    - The current `processEventsForUser` assumes `events[0].username` is available.
// 2. Implement logic to save the output (sessions array) to a JSON file for further use.
// 3. Add more detailed summary statistics (e.g., distribution of session durations, start/end reasons).
// 4. Consider type conversion for `event.timestamp` if it's not consistently a Date object or parsable string across all events.
//    The original route had `new Date(event.timestamp)` which implies it's a string.
//    The `history` collection timestamp in `recent-history` endpoint was noted as ISO string.
//    The `gens` collection timestamp in `recent-gens` was BSON Date. Ensure `history` is consistent.
// 5. Ensure `userId` types are handled consistently (string vs. number) between `history` and `users_core` if joining. 