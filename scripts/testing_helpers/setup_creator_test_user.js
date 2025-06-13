const { initializeDatabase } = require('../../src/core/initDB');
const { initializeDbServices } = require('../../src/core/services/db');
const { ObjectId } = require('mongodb');
const { slugify } = require('../../src/utils/stringUtils');

/**
 * This script creates a test user and assigns them a new LoRA and a new Spell.
 * This is useful for end-to-end testing of features that require content ownership,
 * like the creator micro-fee reward system.
 * 
 * To run: `node scripts/testing_helpers/setup_creator_test_user.js`
 */
async function setupTestUser() {
    console.log('--- Setting up Test Creator User ---');
    let db;

    try {
        // 1. Initialize DB Connection and Services
        console.log('Initializing database connection...');
        db = await initializeDatabase();
        const { data: dbServices } = initializeDbServices(console);
        console.log('Database and services initialized.');

        const { userCore, userEconomy, userPreferences, loraModels, spells } = dbServices;

        // 2. Create the Test User
        console.log('Creating test user records...');
        const masterAccountId = new ObjectId();
        const now = new Date();
        const testUserIdentifier = `test_creator_${masterAccountId.toHexString().substring(0, 6)}`;

        const newUserCore = {
            _id: masterAccountId,
            platformIdentities: {
                telegram: testUserIdentifier
            },
            wallets: [],
            apiKeys: [],
            createdAt: now,
            updatedAt: now
        };

        const newUserEconomy = {
            _id: new ObjectId(),
            masterAccountId: masterAccountId,
            usdCredit: "1.00", // Give them some starting credit
            exp: 0,
            createdAt: now,
            updatedAt: now
        };

        const newUserPreferences = {
            _id: new ObjectId(),
            masterAccountId: masterAccountId,
            preferences: {},
            createdAt: now,
            updatedAt: now
        };

        await userCore.insertOne(newUserCore);
        await userEconomy.insertOne(newUserEconomy);
        await userPreferences.insertOne(newUserPreferences);
        console.log(`Successfully created test user with Master Account ID: ${masterAccountId}`);

        // 3. Create a Test LoRA owned by the new user
        console.log('Creating test LoRA...');
        const loraName = `Test LoRA by ${testUserIdentifier}`;
        const loraSlug = `${slugify(loraName)}-${new ObjectId().toHexString().substring(0, 6)}`;
        
        const newLora = {
            name: loraName,
            slug: loraSlug,
            ownedBy: masterAccountId,
            createdBy: masterAccountId,
            visibility: 'public', // Make it public so other users can use it
            moderation: { status: 'approved' },
            triggerWords: [`trigger_${testUserIdentifier}`],
            usageCount: 0,
            createdAt: now,
            updatedAt: now,
        };
        await loraModels.insertOne(newLora);
        console.log(`Successfully created test LoRA: ${loraName} (Slug: ${loraSlug})`);


        // 4. Create a Test Spell owned by the new user
        console.log('Creating test Spell...');
        const spellName = `Test Spell by ${testUserIdentifier}`;
        const spellSlug = `${slugify(spellName)}-${new ObjectId().toHexString().substring(0, 6)}`;

        const newSpell = {
            name: spellName,
            slug: spellSlug,
            ownedBy: masterAccountId,
            creatorId: masterAccountId,
            visibility: 'public', // Make it public
            permissionType: 'public',
            moderation: { status: 'approved' },
            usageCount: 0,
            steps: [
                // A simple spell that just runs one tool
                {
                    stepId: 1,
                    toolId: 'comfy-flux-de-luxe-direct', // A known, existing tool
                    parameterOverrides: {},
                    outputMappings: {}
                }
            ],
            createdAt: now,
            updatedAt: now,
        };
        await spells.insertOne(newSpell);
        console.log(`Successfully created test Spell: ${spellName} (Slug: ${spellSlug})`);

        console.log('\n--- Test Setup Complete ---');
        console.log('You can now test with another user by running a generation that includes:');
        console.log(`- The LoRA trigger word: "trigger_${testUserIdentifier}"`);
        console.log(`- Or by casting the spell: "/cast ${spellSlug}"`);
        console.log(`Then, check the credit balance of the test creator user (ID: ${masterAccountId}).`);


    } catch (error) {
        console.error('An error occurred during test user setup:', error);
    } finally {
        // Ensure the database connection is closed
        if (db) {
            await db.client.close();
            console.log('\nDatabase connection closed.');
        }
        process.exit();
    }
}

setupTestUser(); 