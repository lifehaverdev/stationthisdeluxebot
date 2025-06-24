// /vibecode/scripts/analysis/session_analyzer.js
// Standalone script for User Session Analysis and Refinement



const { MongoClient } = require('mongodb');
const crypto = require('crypto'); // For generating session IDs
const fs = require('fs'); // ADDED: For file system operations
const path = require('path'); // ADDED: For path manipulation

const OUTPUT_FILE = path.join(__dirname, '../../reports/user_sessions_output.json');

// const DAYS_TO_SCAN = 30; // Removed for full history analysis
const INACTIVITY_TIMEOUT_MINUTES = parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 30;
const SPECIFIC_USER_ID = process.env.SPECIFIC_USER_ID_TO_ANALYZE || null;

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
async function analyzeUserSessions(specificUserId, inactivityTimeoutMinutes) {
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

        let matchQuery = {};
        if (SPECIFIC_USER_ID) {
            matchQuery.userId = SPECIFIC_USER_ID;
            console.log(`Fetching ALL history for user ${SPECIFIC_USER_ID} for session analysis.`);
        } else {
            console.log(`Fetching ALL history for ALL users for session analysis (will sort in Node.js).`);
        }

        console.log('Fetching all history events with a cursor to process and sort in Node.js...');
        const cursor = historyCollection.find(matchQuery); // No DB sort

        const userEventsMap = new Map(); // To group events by userId
        let eventCount = 0;

        await cursor.forEach(event => {
            eventCount++;
            const eventUserId = typeof event.userId === 'string' ? parseInt(event.userId) : event.userId;
            if (!userEventsMap.has(eventUserId)) {
                userEventsMap.set(eventUserId, []);
            }
            userEventsMap.get(eventUserId).push(event);

            if (eventCount % 20000 === 0) {
                console.log(`Fetched ${eventCount} events so far...`);
            }
        });
        console.log(`Finished fetching ${eventCount} total events. Now processing per user.`);

        if (eventCount === 0) {
            console.log('No history events found for the specified criteria.');
            return { sessions: [] };
        }

        const allUserSessions = [];
        const sortedUserIds = Array.from(userEventsMap.keys()).sort((a, b) => {
            // Ensure consistent sorting of user IDs if they are mixed types or need specific numeric/alpha sort
            const valA = typeof a === 'string' ? parseInt(a) : a;
            const valB = typeof b === 'string' ? parseInt(b) : b;
            return valA - valB;
        });

        for (const userId of sortedUserIds) {
            const eventsForUser = userEventsMap.get(userId);
            // Sort events for this specific user by timestamp
            eventsForUser.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            processEventsForUser(userId, eventsForUser, allUserSessions, inactivityTimeoutMs, db);
        }
        
        const distinctUserIdsInSessions = new Set(allUserSessions.map(session => session.userId));
        console.log(`Reconstructed ${allUserSessions.length} sessions for ${distinctUserIdsInSessions.size} unique users across the entire history.`); // MODIFIED
        
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
            console.log(`\nAttempting to write ${allUserSessions.length} sessions to ${OUTPUT_FILE}. This might take a while for full history...`); // ADDED
            // Ensure the reports directory exists
            const reportsDir = path.join(__dirname, '../../reports'); // Assuming script is in scripts/analysis
            if (!fs.existsSync(reportsDir)){
                fs.mkdirSync(reportsDir, { recursive: true });
            }
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allUserSessions, null, 2));
            console.log(`\nSuccessfully saved ${allUserSessions.length} sessions to ${OUTPUT_FILE}`);
        } else {
            console.log('\nNo sessions reconstructed, nothing to save.');
        }
        // --- End save sessions to a file ---
        
        return {
            parameters: { specificUserId, inactivityTimeoutMinutes },
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
    console.log('--- User Session Analyzer (Full History) ---'); // MODIFIED
    const inactivityTimeoutMs = INACTIVITY_TIMEOUT_MINUTES * 60 * 1000;

    // MODIFIED: these were defined inside analyzeUserSessions, moved here for clarity or if needed by main directly
    const MONGO_URI = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const DB_NAME = process.env.BOT_NAME;

    if (!MONGO_URI || !DB_NAME) {
        console.error('Error: MONGO_PASS or MONGODB_URI or BOT_NAME environment variable is not set.');
        return;
    }

    try {
        // Call analyzeUserSessions without daysToScan, as it's now handled by SPECIFIC_USER_ID and no date filtering
        await analyzeUserSessions(SPECIFIC_USER_ID, INACTIVITY_TIMEOUT_MINUTES);
        console.log('User session analysis complete.');
        console.log(`Output saved to ${OUTPUT_FILE}`);
        console.log('--- User Session Analyzer Finished ---'); // MODIFIED
    } catch (error) {
        console.error('An error occurred during session analysis:', error);
    }
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