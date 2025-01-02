const { studio, lobby, flows } = require('../../bot');
const { CollectionDB, GlobalStatusDB } = require('../../../../db/index');
const { getOrLoadCollection } = require('./collectionUtils');
const { sendMessage, editMessage } = require('../../telegram');
const { validateMasterPrompt } = require('./validation');
const { enqueueTask } = require('../../../queue');
const { findExclusions, processPromptWithOptionals } = require('./promptUtils');
const { TraitSelector } = require('./traitUtils');
const { buildPromptObjFromWorkflow } = require('../iMake');

class CookModeHandler {
    constructor() {
        this.collectionDB = new CollectionDB();
        this.globalStatusDB = new GlobalStatusDB();
    }

    async initializeCookMode(message, user, collectionId) {
        try {
            // 1. Check for existing cooking task
            const existingTask = await this.checkExistingCookTask(user);
            if (existingTask) {
                await this.handleExistingCookTask(message, existingTask, collectionId);
                return;
            }

            // 2. Load and validate collection
            const collection = await this.validateCollection(message, user, collectionId);
            if (!collection) return;

            // 3. Initialize status message
            const statusMessage = await this.createInitialStatusMessage(message);
            
            // 4. Set up control panel and update status
            await this.setupControlPanel(message, statusMessage, collection);

        } catch (error) {
            console.error('Error initializing cook mode:', error);
            await sendMessage(message, "❌ An error occurred while initializing cook mode. Please try again.");
        }
    }

    async startCookMode(action, message, user) {
        try {
            const collectionId = action.split('_')[1];
            const collection = await getOrLoadCollection(user, collectionId);
            
            // Update global status with new cooking task
            const cookingTask = {
                userId: user,
                collectionId,
                status: 'active',
                startedAt: Date.now(),
                lastGenerated: null
            };

            await this.globalStatusDB.addCookingTask(cookingTask);

            // Queue first generation
            await this.queueNextGeneration(message, user, collection);

            // Update UI
            await this.updateCookingInterface(message, collection, 'active');

        } catch (error) {
            console.error('Error starting cook mode:', error);
            await sendMessage(message, "❌ An error occurred while starting cook mode.");
        }
    }

    async checkCookProgress(user, collectionId) {
        try {
            const cookingTask = await this.globalStatusDB.getCookingTask(user, collectionId);
            if (!cookingTask || cookingTask.status !== 'active') return;

            const collection = await getOrLoadCollection(user, collectionId);
            
            // Check supply limit
            if (await this.checkSupplyLimit(collection, cookingTask)) return;

            // Check if ready for next generation
            await this.checkAndQueueNextGeneration(cookingTask, collection);

        } catch (error) {
            console.error('[checkCookProgress] Error:', error);
        }
    }

    async checkExistingCookTask(user) {
        const currentStatus = await this.globalStatusDB.getGlobalStatus();
        return currentStatus.cooking?.find(task => 
            task.userId === user && task.status === 'active'
        );
    }

    async handleExistingCookTask(message, existingTask, collectionId) {
        const controlPanel = {
            inline_keyboard: [
                [
                    { text: "⏸ Pause", callback_data: `cookPause_${existingTask.collectionId}` },
                    { text: "👁 Review", callback_data: `cookReview_${existingTask.collectionId}` }
                ],
                [
                    { text: "📊 Stats", callback_data: `cookStats_${existingTask.collectionId}` },
                    { text: "❌ Exit", callback_data: `cookExit_${existingTask.collectionId}` }
                ]
            ]
        };

        if (existingTask.collectionId === collectionId) {
            await sendMessage(message, 
                "⚠️ You're already cooking this collection!\n\n" +
                "Current status:\n" +
                `• Batch: ${existingTask.currentBatch}/${existingTask.totalBatches}\n` +
                `• Last generated: ${existingTask.lastGenerated ? new Date(existingTask.lastGenerated).toLocaleString() : 'Never'}\n\n` +
                "Use the controls below to manage generation:",
                { reply_markup: controlPanel }
            );
        } else {
            await sendMessage(message, 
                "⚠️ You're already cooking another collection!\n\n" +
                "Current cook status:\n" +
                `• Collection ID: ${existingTask.collectionId}\n` +
                `• Batch: ${existingTask.currentBatch}/${existingTask.totalBatches}\n\n` +
                "Please use the controls below to manage the current cook:",
                { reply_markup: controlPanel }
            );
        }
    }

    async validateCollection(message, user, collectionId) {
        const collection = await getOrLoadCollection(user, collectionId);
        if (!collection) {
            await sendMessage(message, "❌ Collection not found");
            return null;
        }

        const validationErrors = [];

        // Check master prompt
        if (!collection.config.masterPrompt) {
            validationErrors.push("• Missing master prompt");
        } else {
            const { isValid, errors } = validateMasterPrompt(collection.config.masterPrompt);
            if (!isValid) {
                validationErrors.push("• Invalid master prompt structure:\n  " + errors.join("\n  "));
            }
        }

        // Check trait types
        if (!collection.config.traitTypes || collection.config.traitTypes.length === 0) {
            validationErrors.push("• No trait types defined");
        } else {
            const emptyTraits = collection.config.traitTypes
                .filter(type => !type.traits || type.traits.length === 0)
                .map(type => type.title);
            if (emptyTraits.length > 0) {
                validationErrors.push(`• Empty trait types found: ${emptyTraits.join(", ")}`);
            }
        }

        if (validationErrors.length > 0) {
            const errorMessage = "⚠️ Collection not ready for cooking:\n" + 
                               validationErrors.join("\n") + 
                               "\n\nPlease complete the trait setup before starting cook mode.";
            await sendMessage(message, errorMessage);
            return null;
        }

        return collection;
    }

    async createInitialStatusMessage(message) {
        return await sendMessage(message, 
            "🧑‍🍳 Initializing cook mode...", 
            { reply_markup: { inline_keyboard: [[{ text: "⏳ Please wait...", callback_data: "wait" }]] }}
        );
    }

    async setupControlPanel(message, statusMessage, collection) {
        const controlPanel = {
            inline_keyboard: [
                [
                    { text: "▶️ Start", callback_data: `cookStart_${collection.collectionId}` },
                    { text: "⏸ Pause", callback_data: `cookPause_${collection.collectionId}` }
                ],
                [
                    { text: "👁 Review", callback_data: `cookReview_${collection.collectionId}` },
                    { text: "📊 Stats", callback_data: `cookStats_${collection.collectionId}` }
                ],
                [{ text: "❌ Exit", callback_data: `cookExit_${collection.collectionId}` }]
            ]
        };

        await editMessage({
            chat_id: message.chat.id,
            message_id: statusMessage.message_id,
            text: "🧑‍🍳 Cook Mode Ready!\n\n" +
                  `Collection: ${collection.name}\n` +
                  `Supply: ${collection.totalSupply}\n` +
                  "Use the controls below to manage generation:",
            reply_markup: controlPanel
        });
    }

    async queueNextGeneration(message, user, collection) {
        try {
            const { masterPrompt, traitTypes } = collection.config;
            
            // Process master prompt and generate traits
            const { exclusions, cleanedPrompt } = findExclusions(masterPrompt);
            const conflictMap = TraitSelector.buildConflictMap(exclusions);
            const selectedTraits = TraitSelector.generateTraitSelection(traitTypes, conflictMap);
            const generatedPrompt = processPromptWithOptionals(cleanedPrompt, selectedTraits);

            // Build user context
            const workflowType = collection.config.workflow || 'MAKE';
            const userContext = {
                userId: user,
                type: workflowType,
                prompt: generatedPrompt,
                basePrompt: -1,
                userPrompt: -1,
                input_cfg: 6,
                input_width: 1024,
                input_height: 1024,
                input_checkpoint: 'flux-schnell',
                input_negative: 'embedding:easynegative',
                balance: lobby[user]?.balance || '0',
                forceLogo: false,
                input_batch: 1,
                input_seed: -1,
                controlNet: false,
                styleTransfer: false,
                openPose: false,
                username: message.from?.username || 'unknown_user',
                first_name: message.from?.first_name || 'Unknown',
            };

            // Build and queue the task
            const workflow = flows.find(flow => flow.name === workflowType);
            if (!workflow) {
                throw new Error(`Invalid workflow type: ${workflowType}`);
            }

            let promptObj = buildCookModePromptObjFromWorkflow(workflow, userContext, message);
            promptObj = {
                ...promptObj,
                isCookMode: true,
                collectionId: collection.collectionId,
                traits: selectedTraits
            };

            await enqueueTask({
                message: {
                    ...message,
                    from: {
                        id: user,
                        username: userContext.username || 'unknown_user',
                        first_name: userContext.first_name || 'Unknown'
                    },
                    chat: {
                        id: user
                    }
                }, 
                promptObj
            });

            // Update last generated timestamp
            await this.globalStatusDB.updateCookingTask(user, collection.collectionId, {
                lastGenerated: Date.now()
            });

        } catch (error) {
            console.error('Error queueing next generation:', error);
            throw error;
        }
    }

    async updateCookingInterface(message, collection, status) {
        const controlPanel = {
            inline_keyboard: [
                [
                    { text: status === 'active' ? "⏸ Pause" : "▶️ Resume", 
                      callback_data: status === 'active' ? `cookPause_${collection.collectionId}` : `cookStart_${collection.collectionId}` },
                    { text: "👁 Review", callback_data: `cookReview_${collection.collectionId}` }
                ],
                [
                    { text: "📊 Stats", callback_data: `cookStats_${collection.collectionId}` },
                    { text: "❌ Exit", callback_data: `cookExit_${collection.collectionId}` }
                ]
            ]
        };

        const statusText = status === 'active' ? 
            "🧑‍🍳 Cook Mode Active!\n\n" :
            "⏸ Cook Mode Paused\n\n";

        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: statusText +
                  `Collection: ${collection.name}\n` +
                  `Supply: ${collection.totalSupply || 0}/5\n` +
                  "Use the controls below to manage generation:",
            reply_markup: controlPanel
        });
    }

    async checkSupplyLimit(collection, cookingTask) {
        const currentSupply = collection.totalSupply || 0;
        if (currentSupply >= 5) {
            // Update cooking task status to completed
            await this.globalStatusDB.updateCookingTask(cookingTask.userId, cookingTask.collectionId, {
                status: 'completed',
                completedAt: Date.now(),
                completionReason: 'supply_limit_reached'
            });
            return true;
        }
        return false;
    }

    async checkAndQueueNextGeneration(cookingTask, collection) {
        if (!cookingTask.lastGenerated) return;

        const timeSinceLastGen = Date.now() - cookingTask.lastGenerated;
        if (timeSinceLastGen > 5000) { // 5 second buffer
            const dummyMessage = {
                chat_id: cookingTask.userId,
                from: {
                    id: cookingTask.userId,
                    username: cookingTask.userContextCache?.username || 'unknown_user',
                    first_name: cookingTask.userContextCache?.first_name || 'Unknown'
                },
                message_id: Date.now()
            };

            await this.queueNextGeneration(dummyMessage, cookingTask.userId, collection);
        }
    }

    // Helper method to build prompt object
    buildCookModePromptObjFromWorkflow(workflow, userContext, message) {
        let promptObj = buildPromptObjFromWorkflow(workflow, userContext, message);
        return {
            ...promptObj,
            isCookMode: true,
            collectionId: userContext.collectionId,
            traits: userContext.traits
        };
    }
}

// Export a singleton instance
const cookModeHandler = new CookModeHandler();
module.exports = cookModeHandler;