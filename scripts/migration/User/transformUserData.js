const { fetchSourceUserData } = require('./examineCurrentUser.js');
const { ethers } = require('ethers');
const { ObjectId } = require('mongodb');

const userIdToTransform = 5472638766;
const QOINTS_TO_USD_RATE = 0.000337;

async function transformUserDataForNoema(userId) {
    try {
        const { coreData: sourceCore, economyData: sourceEconomy, preferencesData: sourcePrefs } = await fetchSourceUserData(userId);

        if (!sourceCore || !sourceEconomy) {
            console.error(`Error: Missing core or economy data for userId: ${userId}. Cannot transform.`);
            if (!sourceCore) console.log('Source Core Data was null or undefined.');
            if (!sourceEconomy) console.log('Source Economy Data was null or undefined.');
            return null;
        }

        const masterAccountId = new ObjectId();
        const now = new Date();

        // 1. Transform Core Data
        const newUserCore = {
            _id: masterAccountId,
            platformIdentities: {
                telegram: sourceCore.userId?.toString() // Ensure it's a string if not already
            },
            wallets: [],
            apiKeys: [],
            createdAt: sourceCore.createdAt ? new Date(sourceCore.createdAt) : now, // Use existing if available
            updatedAt: now
        };

        if (sourceCore.wallets && Array.isArray(sourceCore.wallets)) {
            newUserCore.wallets = sourceCore.wallets.map(w => ({
                address: w.address,
                type: w.type, // e.g., CONNECTED_ETH, CONNECTED_SOL
                isPrimary: w.active === true,
                verified: w.verified === true,
                addedAt: w.createdAt ? new Date(w.createdAt) : now, // Existing or new timestamp
                // lastUsed: w.lastUsed ? new Date(w.lastUsed) : now, // Optional: carry over lastUsed
                // assets: w.assets // Optional: carry over assets array if needed by new schema
            }));
        }
        // Ensure there's at least one primary wallet if logic based on 'active' flag missed any
        // or if the sourceCore.wallets was empty/malformed.
        // This is a fallback; ideally, the source data has a clear active wallet.
        if (newUserCore.wallets.length > 0 && !newUserCore.wallets.some(w => w.isPrimary)) {
            // If no wallet was marked active, try to find the one matching sourceCore.wallet
            const legacyPrimaryWalletAddress = sourceCore.wallet;
            let foundLegacyPrimary = false;
            if (legacyPrimaryWalletAddress) {
                newUserCore.wallets.forEach(w => {
                    if (w.address === legacyPrimaryWalletAddress) {
                        w.isPrimary = true;
                        foundLegacyPrimary = true;
                    }
                });
            }
            // If still no primary, mark the first one (if any) as primary as a last resort.
            if (!foundLegacyPrimary && newUserCore.wallets.length > 0) {
                newUserCore.wallets[0].isPrimary = true;
            }
        }


        if (sourceCore.apiKey) {
            // Convert API key string to UTF-8 bytes before hashing
            const apiKeyBytes = ethers.toUtf8Bytes(sourceCore.apiKey);
            newUserCore.apiKeys.push({
                keyHash: ethers.keccak256(apiKeyBytes), // Use ethers.keccak256
                label: 'Migrated API Key',
                createdAt: sourceCore.apiKeyCreatedAt ? new Date(sourceCore.apiKeyCreatedAt) : now,
                lastUsedAt: null, // No last used info for a fresh migration
                scopes: ['migrated_full_access'] // Default scope
            });
        }

        // 2. Transform Economy Data
        const newUserEconomy = {
            _id: new ObjectId(), // Separate ObjectId for this document
            masterAccountId: masterAccountId,
            usdCredit: 0, // Default to 0
            exp: sourceEconomy.exp || 0,
            createdAt: sourceEconomy.lastUpdated ? new Date(sourceEconomy.lastUpdated) : now, // Or another relevant source date
            updatedAt: now
        };

        if (sourceEconomy.qoints && typeof sourceEconomy.qoints === 'number') {
            newUserEconomy.usdCredit = parseFloat((sourceEconomy.qoints * QOINTS_TO_USD_RATE).toFixed(6)); // toFixed for precision
        }

        // 3. Transform Preferences Data (initialize as empty as per decision)
        const newUserPreferences = {
            _id: new ObjectId(), // Separate ObjectId for this document
            masterAccountId: masterAccountId,
            preferences: {},
            // globalSettings: {} // Or this if a top-level global is always expected
            createdAt: now,
            updatedAt: now
        };

        return { newUserCore, newUserEconomy, newUserPreferences };

    } catch (error) {
        console.error(`Error during transformation for userId ${userId}:`, error);
        return null;
    }
}

// This part runs if the script is executed directly
if (require.main === module) {
    transformUserDataForNoema(userIdToTransform)
        .then(transformedData => {
            if (transformedData) {
                console.log('--- Transformed User Data for Noema DB ---');
                console.log('\n--- newUserCore ---');
                console.log(JSON.stringify(transformedData.newUserCore, null, 2));
                console.log('\n--- newUserEconomy ---');
                console.log(JSON.stringify(transformedData.newUserEconomy, null, 2));
                console.log('\n--- newUserPreferences ---');
                console.log(JSON.stringify(transformedData.newUserPreferences, null, 2));
            }
        })
        .catch(error => {
            // Error already logged in transformUserDataForNoema, just exit or add minimal log
            console.error('Main execution caught an error.');
        });
}

module.exports = { transformUserDataForNoema }; 