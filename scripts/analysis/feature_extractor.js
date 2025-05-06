const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const INPUT_FILE = path.join(__dirname, '../../reports/user_sessions_output.json');
const OUTPUT_FILE = path.join(__dirname, '../../reports/enriched_user_sessions.json');

const MONGO_URI = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.BOT_NAME;
const GENS_COLLECTION_NAME = 'gens';

async function extractFeatures() {
    console.log(`Loading sessions from ${INPUT_FILE}...`);
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Error: Input file not found: ${INPUT_FILE}`);
        console.error('Please run session_analyzer.js first to generate user_sessions_output.json');
        return;
    }

    const sessionsData = fs.readFileSync(INPUT_FILE, 'utf-8');
    const sessions = JSON.parse(sessionsData);
    console.log(`Loaded ${sessions.length} sessions.`);

    const overallCommandFrequencies = {};

    let mongoClient;
    let gensCollection;
    try {
        if (!DB_NAME || !MONGO_URI) {
            console.error('MongoDB environment variables (BOT_NAME, MONGO_PASS/MONGODB_URI) are not set properly.');
        } else {
            mongoClient = new MongoClient(MONGO_URI);
            await mongoClient.connect();
            console.log('Successfully connected to MongoDB for gens duration lookup.');
            const db = mongoClient.db(DB_NAME);
            gensCollection = db.collection(GENS_COLLECTION_NAME);
        }
    } catch (dbError) {
        console.error('Error connecting to MongoDB for gens duration lookup:', dbError);
        gensCollection = null;
    }

    const enrichedSessionsPromises = sessions.map(async session => {
        const newFeatures = {
            num_events: 0,
            num_commands: 0,
            num_generation_events: 0,
            num_error_events: 0,
            command_counts: {},
            total_generation_duration_ms: 0
        };

        if (session.events && Array.isArray(session.events)) {
            newFeatures.num_events = session.events.length;

            for (const event of session.events) {
                switch (event.type) {
                    case 'command':
                        newFeatures.num_commands++;
                        if (event.data && event.data.command) {
                            const commandName = event.data.command;
                            newFeatures.command_counts[commandName] = (newFeatures.command_counts[commandName] || 0) + 1;
                            overallCommandFrequencies[commandName] = (overallCommandFrequencies[commandName] || 0) + 1;
                        }
                        break;
                    case 'generation':
                        newFeatures.num_generation_events++;
                        if (gensCollection) {
                            const runId = event.runId || (event.data ? event.data.runId : null);
                            if (runId) {
                                try {
                                    const genDoc = await gensCollection.findOne({ runId: runId });
                                    if (genDoc && typeof genDoc.duration === 'number') {
                                        newFeatures.total_generation_duration_ms += genDoc.duration;
                                    }
                                } catch (lookupError) {
                                    console.warn(`Warning: Error looking up gen duration for runId ${runId}:`, lookupError.message);
                                }
                            }
                        }
                        break;
                    case 'error_event':
                        newFeatures.num_error_events++;
                        break;
                }
            }
        }
        
        newFeatures.num_make_commands = newFeatures.command_counts['/make'] || 0;
        newFeatures.num_again_commands = newFeatures.command_counts['/again'] || 0;
        newFeatures.num_help_commands = newFeatures.command_counts['/help'] || 0;
        newFeatures.num_effect_commands = newFeatures.command_counts['/effect'] || 0;
        newFeatures.num_account_commands = newFeatures.command_counts['/account'] || 0;
        newFeatures.num_quickmake_commands = newFeatures.command_counts['/quickmake'] || 0;
        newFeatures.num_viduthat_commands = newFeatures.command_counts['/viduthat'] || 0;
        newFeatures.num_utils_commands = newFeatures.command_counts['/utils'] || 0;
        newFeatures.num_set_commands = newFeatures.command_counts['/set'] || 0;
        newFeatures.num_status_commands = newFeatures.command_counts['/status'] || 0;
        newFeatures.num_regen_commands = newFeatures.command_counts['/regen'] || 0;
        newFeatures.num_create_commands = newFeatures.command_counts['/create'] || 0;

        return { ...session, ...newFeatures };
    });

    const enrichedSessions = await Promise.all(enrichedSessionsPromises);

    console.log(`Finished extracting features for ${enrichedSessions.length} sessions.`);

    console.log('\n--- Overall Command Frequencies ---');
    const sortedOverallCommandFrequencies = Object.entries(overallCommandFrequencies)
        .sort(([,a],[,b]) => b-a)
        .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});
    console.log(JSON.stringify(sortedOverallCommandFrequencies, null, 2));
    console.log('--- End log overall command frequencies ---');

    try {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(enrichedSessions, null, 2));
        console.log(`Successfully saved enriched sessions to ${OUTPUT_FILE}`);
    } catch (error) {
        console.error(`Error writing output file ${OUTPUT_FILE}:`, error);
    }

    if (mongoClient) {
        await mongoClient.close();
        console.log('MongoDB connection closed.');
    }
}

extractFeatures(); 