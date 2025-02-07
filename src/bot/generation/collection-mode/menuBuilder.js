// Import necessary modules and utilities
const { studio } = require('../../core/core.js');
const { getOrLoadCollection, calculateCompletionPercentage } = require('./collectionUtils.js');

class CollectionMenuBuilder {
    // Helper method to calculate total combinations
    static calculateTotalCombinations(collectionData) {
        let totalCombinations = 1;
        const { traitTypes = [] } = collectionData.config;
        
        traitTypes.forEach(traitType => {
            if (traitType.traits?.length > 0) {
                totalCombinations *= traitType.traits.length;
            }
        });
        
        return totalCombinations;
    }

    // Method to build the main collection menu
    static async buildCollectionMenu(userId, collectionId) {
        try {
            // Load collection data
            let collectionData = await getOrLoadCollection(userId, collectionId);
            
            // Calculate total combinations
            let totalCombinations = this.calculateTotalCombinations(collectionData);

            // Build menu text
            let menuText = this.buildMenuText(collectionData, totalCombinations);

            // Build inline keyboard
            let inlineKeyboard = this.buildMenuKeyboard(userId, collectionId, collectionData);

            // Return menu object
            return { 
                text: menuText, 
                reply_markup: { inline_keyboard: inlineKeyboard } 
            };
        } catch (error) {
            console.error("Error building collection menu:", error);
            return null;
        }
    }

    // Helper method to build menu text
    static buildMenuText(collectionData, totalCombinations) {
        const { name, status, submitted, config, totalSupply, chain, description, baseURI } = collectionData;
        
        let text = `${name}\nSTATUS: ${status}`;
        
        // Add metadata overview
        text += `\n\nMETADATA OVERVIEW:`;
        text += `\n• Total Supply: ${totalSupply || 'Not set'}`;
        text += `\n• Possible Combinations: ${totalCombinations.toLocaleString()}`;
        
        if (totalSupply && totalCombinations < totalSupply) {
            text += `\n⚠️ Warning: Total supply exceeds possible combinations!`;
        }
        
        text += `\n• Trait Types: ${config.traitTypes?.length || 0}`;
        text += `\n• Base URI: ${baseURI ? '✓' : '✗'}`;
        text += `\n• Description: ${description ? '✓' : '✗'}`;
        
        if (chain === 'sol') {
            text += `\n• Royalties: ${config.royalties || '0'}%`;
        }

        if (submitted) {
            const timeSinceSubmitted = Math.floor((Date.now() - submitted) / 1000);
            text += `\n\nSubmitted: ${timeSinceSubmitted} seconds ago`;
        }

        return text;
    }

    // Helper method to build inline keyboard
    static buildMenuKeyboard(userId, collectionId, collectionData) {
        const { submitted } = collectionData;
        const COMPLETION_THRESHOLD = 100;

        const inlineKeyboard = [
            [{ text: '↖︎', callback_data: `collectionModeMenu` }],
            [{ text: 'metadata', callback_data: `collectionMetaData_${collectionId}` }],
            [{ text: 'config', callback_data: `collectionConfigMenu_${collectionId}` }],
            [{ text: 'consult', callback_data: `collectionConsult_${collectionId}` }],
            [{ text: 'cook 🧑🏼‍🍳', callback_data: `cook_${collectionId}` }],
        ];

        if (!submitted) {
            let completedCount = calculateCompletionPercentage(collectionData);
            
            inlineKeyboard.push([
                { text: '🗑️', callback_data: `rmc_${collectionId}` },
                { text: '💾', callback_data: `savec_${collectionId}` }
            ]);

            if (completedCount >= COMPLETION_THRESHOLD) {
                inlineKeyboard.push([
                    { text: 'Submit', callback_data: `sc_${collectionId}` }
                ]);
            }
        }

        return inlineKeyboard;
    }

    // Method to build metadata menu
    static async buildCollectionMetaDataMenu(user, collectionId) {
        const collection = await getOrLoadCollection(user, collectionId);
    
        const text = `Collection Metadata for ${collection.name}\n\n` +
                    `Supply: ${collection.totalSupply || 'Not set'}\n` +
                    `Chain: ${collection.chain || 'Not set'}\n` + 
                    `Meta Standard: ${collection.metaStandard || 'Not set'}\n` +
                    `Image Prefix: ${collection.imagePrefix || 'Not set'}\n` +
                    `Description: ${collection.description || 'Not set'}\n` +
                    `Base URI: ${collection.baseURI || 'Not set'}\n` +
                    `${collection.chain === 'sol' ? `Royalties: ${collection.royalties || '0'}%\n` : ''}`;

        return {
            text,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📊 Set Supply', callback_data: `supply_${collectionId}` },
                        { text: '⛓️ Set Chain', callback_data: `chain_${collectionId}` }
                    ],
                    [
                        { text: '🪪 Set Meta Standard', callback_data: `metaStandard_${collectionId}` }
                    ],
                    [
                        { text: '📝 Set Description', callback_data: `description_${collectionId}` },
                        { text: '✏️ Set Image Prefix', callback_data: `editionTitle_${collectionId}` }
                    ],
                    ...(studio[user][collectionId].chain === 'sol' ? [
                        [{ text: '💰 Set Royalties', callback_data: `royalty_${collectionId}` }]
                    ] : []),
                    ...(collection.config.metadataConfig?.standard === 'metaplex' ? [
                        { text: '🌐 Set External URL', callback_data: `setExternalUrl_${collectionId}` },
                        //{ text: '📁 Set Properties', callback_data: `setProperties_${collectionId}` }
                    ] : []),
                    [
                        { text: '« Back', callback_data: `ec_${collectionId}` }
                    ]
                ]
            }
        }
    }

    // Method to build trait types menu
    static async buildTraitTypesMenu(user, collectionId, page = 0) {
        const collection = await getOrLoadCollection(user, collectionId);
        const traitTypes = collection.config.traitTypes || [];
        
        const TRAITS_PER_PAGE = 6;
        const totalPages = Math.ceil(traitTypes.length / TRAITS_PER_PAGE);
        
        const startIdx = page * TRAITS_PER_PAGE;
        const endIdx = Math.min(startIdx + TRAITS_PER_PAGE, traitTypes.length);
        const currentTraits = traitTypes.slice(startIdx, endIdx);

        let text = `Trait Types (${traitTypes.length} total)\nPage ${page + 1} of ${Math.max(1, totalPages)}\n\n`;
        
        // Add trait details
        currentTraits.forEach((trait, idx) => {
            text += `${trait.title}: ${trait.traits?.length || 0} values\n`;
        });

        const inlineKeyboard = [];

        // Add trait type buttons - 2 per row
        for (let i = 0; i < currentTraits.length; i += 2) {
            const row = [];
            row.push({ text: currentTraits[i].title, callback_data: `editTraitType_${collectionId}_${startIdx + i}` });
            
            if (i + 1 < currentTraits.length) {
                row.push({ text: currentTraits[i + 1].title, callback_data: `editTraitType_${collectionId}_${startIdx + i + 1}` });
            }
            inlineKeyboard.push(row);
        }

        // Navigation row
        const navRow = [];
        if (page > 0) {
            navRow.push({ text: '«', callback_data: `traitPage_${collectionId}_${page - 1}` });
        }
        navRow.push({ text: '+ Add Trait', callback_data: `addTrait_${collectionId}` });
        if (page < totalPages - 1) {
            navRow.push({ text: '»', callback_data: `traitPage_${collectionId}_${page + 1}` });
        }
        inlineKeyboard.push(navRow);

        // Back button
        inlineKeyboard.push([{ text: '« Back', callback_data: `collectionConfigMenu_${collectionId}` }]);

        return {
            text,
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        };
    }

    static async buildCollectionConfigMenu(user,collectionId) {
            
        console.log('build collection config menu',user,collectionId)
        const collection = await getOrLoadCollection(user,collectionId)
        const { config } = collection
        const { masterPrompt, traitTypes } = config

        // Calculate total combinations and analyze traits
        let totalCombinations = 1;
        let traitAnalysis = [];
        
        traitTypes.forEach(trait => {
            if (trait.traits && trait.traits.length > 0) {
                totalCombinations *= trait.traits.length;
                
                // Calculate average rarity for this trait type
                const avgRarity = trait.traits.reduce((sum, t) => sum + (t.rarity || 0.5), 0) / trait.traits.length;
                
                traitAnalysis.push(
                    `- ${trait.title}: ${trait.traits.length} values (avg rarity: ${avgRarity.toFixed(2)})`
                );
            } else {
                traitAnalysis.push(`- ${trait.title}: No values yet`);
            }
        });

        const text = `Collection Config for ${collection.name}\n\n` +
                    `Master Prompt: ${masterPrompt}\n\n` +
                    `Trait Analysis:\n${traitAnalysis.join('\n')}\n\n` +
                    `Total Possible Combinations: ${totalCombinations.toLocaleString()}\n` +
                    `${totalCombinations > 10000 ? '⚠️ Warning: Large number of combinations may impact generation time' : ''}`;

        return {
            text,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '« Back', callback_data: `ec_${collectionId}` }],
                    [{ text: 'Edit Master Prompt', callback_data: `editMasterPrompt_${collectionId}` }],
                    [{ text: 'Edit Trait Tree', callback_data: `editTraitTypes_${collectionId}` }],
                    [{ text: 'Workflow', callback_data: `editWorkflow_${collectionId}` }],
                    [{ text: 'Test', callback_data: `testCollection_${collectionId}` }]
                ]
            }
        }
    }
    // Additional helper methods as needed
    // e.g., calculateTotalCombinations, buildTraitTypesText, buildTraitTypesKeyboard
}

// Export the class for use in other modules
module.exports = {
    CollectionMenuBuilder
}