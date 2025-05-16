const { getOrLoadCollection } = require('./collectionUtils.js');
const { studio, lobby } = require('../../bot.js');
const { CollectionDB } = require('../../../../db/index');
const collectionDB = new CollectionDB();

class StudioManager {
    // Studio state management
    static initializeUserStudio(userId) {
        if (!studio[userId]) {
            studio[userId] = {};
        }
    }

    static getStudioState(userId) {
        return studio[userId] || {};
    }

    // Pending actions management
    static setPendingAction(userId, action, extras = {}) {
        this.initializeUserStudio(userId);
        studio[userId].pendingAction = {
            action: action.type,
            collectionId: action.collectionId,
            ...extras
        };
    }

    static getPendingAction(userId) {
        return studio[userId]?.pendingAction;
    }

    static clearPendingAction(userId) {
        if (studio[userId]) {
            delete studio[userId].pendingAction;
        }
    }

    // Collection management
    static async getCollection(userId, collectionId) {
        return await getOrLoadCollection(userId, collectionId);
    }

    static async updateCollection(userId, collectionId, updates) {
        this.initializeUserStudio(userId);
        if (!studio[userId][collectionId]) {
            throw new Error('Collection not found');
        }
        
        studio[userId][collectionId] = {
            ...studio[userId][collectionId],
            ...updates
        };
        
        await this.saveCollection(userId, collectionId);
    }

    static async addTraitType(message, userId, collectionId) {
        // Add new trait with validation
        const traitType = {
            title: message.text,
            traits: [] // Array to hold trait instances
        };
        // Add new trait type via updateCollection
        await this.updateCollection(userId, collectionId, {
            config: {
                ...studio[userId][collectionId].config,
                traitTypes: [
                    ...studio[userId][collectionId].config.traitTypes,
                    traitType
                ]
            }
        });
        return 'traitTypes'
    }

    static async editTraitTypeName(message, userId, collectionId, traitTypeIndex) {
        const newTraitName = message.text;
        const oldTraitName = studio[userId][collectionId].config.traitTypes[traitTypeIndex].title;
        
        // Update trait type title and master prompt
        const updatedTraitTypes = [...studio[userId][collectionId].config.traitTypes];
        updatedTraitTypes[traitTypeIndex].title = newTraitName;

        await this.updateCollection(userId, collectionId, {
            config: {
                ...studio[userId][collectionId].config,
                traitTypes: updatedTraitTypes,
                masterPrompt: studio[userId][collectionId].config.masterPrompt.replace(
                    `[${oldTraitName}]`,
                    `[${newTraitName}]`
                )
            }
        });
        
        return 'traitTypes'
    }

    static async removeTraitValue(userId, collectionId, traitTypeIndex, traitIndex) {
        // Get current trait types
        const updatedTraitTypes = [...studio[userId][collectionId].config.traitTypes];
        
        // Remove trait from specified trait type
        updatedTraitTypes[traitTypeIndex].traits.splice(traitIndex, 1);

        await this.updateCollection(userId, collectionId, {
            config: {
                ...studio[userId][collectionId].config,
                traitTypes: updatedTraitTypes
            }
        });

        return 'traits'
    }

    // Prompt management 
    static async updateMasterPrompt(userId, collectionId, message) {
        await this.updateCollection(userId, collectionId, {
            config: {
                ...studio[userId][collectionId].config,
                masterPrompt: message.text
            }
        });
        return 'config'
    }

    static async addTraitValue(message, userId, collectionId, traitTypeIndex) {
        console.log('trait types', JSON.stringify(studio[userId][collectionId].config));
        console.log('pending action:', JSON.stringify(studio[userId].pendingAction));

        // Split input by newlines to handle multiple traits
        const traitInputs = message.text.split('\n');

        // Initialize traits array if needed
        if (!studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits) {
            console.log('traits array was empty, initializing')
            studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits = [];
        }

        // Process each trait input
        for (const traitInput of traitInputs) {
            try {
                // Parse the trait value input in format "name|prompt|rarity"
                const [name, prompt, rarity] = traitInput.split('|').map(s => s.trim());

                if (!name) continue; // Skip if name is empty

                const newTrait = {
                    name: name,
                    prompt: prompt || name, // Use name as prompt if no prompt provided
                    rarity: parseFloat(rarity) || 0.5 // Default 50% rarity if not specified
                };

                console.log('Adding trait:', JSON.stringify(newTrait));
                studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits.push(newTrait);
            } catch (err) {
                console.log('Error parsing trait input:', traitInput, err);
                // If this is the first/only trait and it failed, we might want to notify the user
                if (traitInputs.length === 1) {
                    throw err; // This will be caught by the outer error handler
                }
                // Otherwise continue processing other traits
                continue;
            }
        }

        console.log('traits array after:', JSON.stringify(studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits));
        return 'traitTypes'
    }

    static async removeCollection(userId, collectionId) {
        // Safely update the user's collections array
        if (lobby[userId]?.collections) {
            lobby[userId].collections = lobby[userId].collections.filter(collection => collection !== collectionId);
        } else {
            console.log(`User ${userId} has no collections to remove.`);
        }

        // Remove the collection from the studio
        if (studio.hasOwnProperty(userId) && studio[userId].hasOwnProperty(collectionId)) {
            delete studio[userId][collectionId];
            console.log(`studio entry for collection ${collectionId} removed.`);
        }
    }

    // State validation
    static validateCollectionState(collection) {
        // Check required metadata fields
        if (!collection.name || !collection.description || !collection.totalSupply || 
            !collection.chain || !collection.editionTitle) {
            return {
                valid: false,
                error: 'Missing required metadata fields. Please ensure name, description, total supply, chain and edition title are set.'
            };
        }

        // Validate chain-specific requirements
        if (collection.chain === 'sol' && (!collection.royalties && collection.royalties !== 0)) {
            return {
                valid: false, 
                error: 'Solana collections require royalties to be set'
            };
        }

        // Validate total supply is a positive number
        if (!Number.isInteger(collection.totalSupply) || collection.totalSupply <= 0) {
            return {
                valid: false,
                error: 'Total supply must be a positive integer'
            };
        }

        // Validate trait types exist
        if (!collection.config?.traitTypes || collection.config.traitTypes.length === 0) {
            return {
                valid: false,
                error: 'Collection must have at least one trait type'
            };
        }

        // Calculate total possible trait combinations
        let totalCombinations = 1;
        for (const traitType of collection.config.traitTypes) {
            if (!traitType.traits || traitType.traits.length === 0) {
                return {
                    valid: false,
                    error: `Trait type "${traitType.name}" has no trait values`
                };
            }
            totalCombinations *= traitType.traits.length;
        }

        // Validate combinations exceed total supply
        if (totalCombinations < collection.totalSupply) {
            return {
                valid: false,
                error: `Total possible combinations (${totalCombinations}) must exceed total supply (${collection.totalSupply})`
            };
        }

        return {
            valid: true
        };
    }

    static validateTraitState(trait) {
        // Validate trait data
    }

    // Error handling
    static handleError(error, context) {
        // Centralized error handling
    }

    // Utility methods
    static generateCollectionId() {
        // Generate unique collection ID
    }

    static calculateCollectionStats(collection) {
        // Calculate collection statistics
    }

    static async saveCollection(userId, collectionId) {
        // Save collection to database
        console.log('saving collection', userId, collectionId);
        await collectionDB.saveStudio(studio[userId][collectionId]);
        return true;
    }
}

// Export the class
module.exports = {StudioManager};