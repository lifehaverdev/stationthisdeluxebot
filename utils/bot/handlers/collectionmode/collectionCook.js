const { studio, lobby, flows } = require('../../bot');
const GlobalStatusDB = require('../../../../db/models/globalStatus');
const { CollectionDB } = require('../../../../db/index');
const { 
    getOrLoadCollection, 
    findExclusions, 
    processPromptWithOptionals,
    TraitSelector,
    validateMasterPrompt,
    buildCookModePromptObjFromWorkflow
} = require('./collectionUtils');
const { sendMessage, editMessage, logThis } = require('../../../utils');
const UserEconomyDB = require('../../../../db/models/userEconomy');

class CollectionCook {
    // Private static instance
    static #instance = null;
    // Private cached status
    #cachedStatus = null;
    #lastFetch = 0;
    #cacheTimeout = 5000; // 5 seconds cache timeout
    #enqueueTask = null;
    // Private constructor
    constructor() {
        if (CollectionCook.#instance) {
            throw new Error("CollectionCook is a singleton - use getInstance() instead");
        }
        
        // Initialize existing class properties
        this.collectionDB = new CollectionDB();
        this.globalStatusDB = new GlobalStatusDB();
        
        // Set instance
        CollectionCook.#instance = this;
        
        // Attempt initialization
        this.initialize();
    }

    // Public static instance getter
    static getInstance() {
        if (!CollectionCook.#instance) {
            new CollectionCook();
        }
        return CollectionCook.#instance;
    }

    setEnqueueTask(fn) {
        this.#enqueueTask = fn;
    }

    // Private status management methods
    async #getCookingStatus() {
        const now = Date.now();
        
        // Return cached version if fresh
        if (this.#cachedStatus && (now - this.#lastFetch) < this.#cacheTimeout) {
            console.log('CollectionCook using cached status:', {
                age: now - this.#lastFetch,
                cookingTasks: this.#cachedStatus.cooking?.length || 0
            });
            return this.#cachedStatus;
        }

        // Fetch fresh status
        console.log('CollectionCook fetching fresh status');
        const freshStatus = await this.globalStatusDB.getGlobalStatus();
        this.#cachedStatus = freshStatus;
        this.#lastFetch = now;

        console.log('CollectionCook status refreshed:', {
            cookingTasks: freshStatus.cooking?.length || 0
        });

        return freshStatus;
    }

    // Public method for external access
    async getCookingStatus() {
        return await this.#getCookingStatus();
    }

    async #updateCookingStatus(updates) {
        try {
            // Update DB
            await this.globalStatusDB.updateStatus(updates, false);
            
            // Update cache with new values
            this.#cachedStatus = {
                ...this.#cachedStatus,
                ...updates,
                updatedAt: new Date()
            };
            
            console.log('CollectionCook status updated:', {
                cookingTasks: this.#cachedStatus.cooking?.length || 0
            });
        } catch (error) {
            console.error('Error updating cooking status:', error);
            // Invalidate cache on error
            this.#cachedStatus = null;
            throw error;
        }
    }

    // Add a method for external status updates
    async updateCookingStatus(updates) {
        return await this.#updateCookingStatus(updates);
    }

    // Private initialization method
    async initialize() {
        try {
            console.log('CollectionCook initialize starting...');
            const maxAttempts = 10;
            let attempts = 0;
            
            
            while (attempts < maxAttempts) {
                console.log(`Checking status (attempt ${attempts + 1}/${maxAttempts})...`);
                const status = await this.#getCookingStatus();
                const workflowsLoaded = Array.isArray(flows) && flows.length > 0;
                if (status.cooking && workflowsLoaded) {
                    console.log('Global dependencies loaded, initializing cooking tasks...');
                    await this.initializeCookingTasks();
                    return;
                }
                
                console.log('Waiting for global dependencies to load...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            if (attempts >= maxAttempts) {
                console.error('Timeout waiting for status. Current state:', {
                    statusExists: !!status,
                    cookingArrayExists: !!status?.cooking
                });
            }
            
        } catch (error) {
            console.error('Error initializing CollectionCook:', error);
        }
    }

    async initializeCookingTasks() {
        try {
            const status = await this.#getCookingStatus();
            if (status.cooking && status.cooking.length > 0) {
                console.log('Found active cooking tasks, resuming...');
                
                for (const cookTask of status.cooking) {
                    if (cookTask.status === 'active') {
                        await this.resumeCooking(cookTask);
                    }
                }
            }
        } catch (error) {
            console.error('Error initializing cooking tasks:', error);
        }
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

    async startCooking(action, message, user) {
        try {
            const collectionId = parseInt(action.split('_')[1]);
            
            // 1. Check qoints
            const userQoints = lobby[user]?.balance || '0';
            if (parseInt(userQoints) < 100) {
                await sendMessage(message, "❌ Insufficient qoints to start cooking (100 required).");
                return;
            }
    
            // 2. Load collection and generate prompt
            const collection = await getOrLoadCollection(user, collectionId);
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
                collectionId: collectionId,
                type: workflowType,
                prompt: generatedPrompt,
                basePrompt: -1,
                userPrompt: -1,
                input_cfg: 6,
                input_width: 1024,
                input_height: 1024,
                input_checkpoint: 'flux-schnell',
                input_negative: 'embedding:easynegative',
                balance: userQoints,
                forceLogo: false,
                input_batch: 1,
                input_seed: -1,
                controlNet: false,
                styleTransfer: false,
                openPose: false,
                username: message.from?.username || 'unknown_user',
                first_name: message.from?.first_name || 'Unknown',
            };
    
            // 3. Create cooking task
            const cookingTask = {
                userId: user,
                collectionId,
                startedAt: Date.now(),
                status: 'active',
                generationCount: 0,  // Changed from currentBatch
                targetSupply: collection.config.totalSupply || 5,  // Default to 5 for testing
                lastGenerated: null,
                generationStatus: 'pending',
                qointsRequired: collection.config.totalSupply * 100,
                userContextCache: {
                    ...userContext,
                    collection: {
                        name: collection.name,
                        workflow: workflowType,
                        masterPrompt,
                        traitTypes
                    }
                }
            };
            const status = await this.#getCookingStatus();
            // Update global status with new cooking task
            const updatedCooking = [...status.cooking, cookingTask];
            await this.#updateCookingStatus({ cooking: updatedCooking });
    
            // 4. Queue first generation
            const workflow = flows.find(flow => flow.name === workflowType);
            if (!workflow) {
                throw new Error(`Invalid workflow type: ${workflowType}`);
            }
    
            let promptObj = buildCookModePromptObjFromWorkflow(workflow, userContext, message);
    
            await this.#enqueueTask({
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
    
            // 5. Update UI with new control panel
            const controlPanel = await this.getControlPanel(collectionId, 'active');  // New cook is active

            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: "🧑‍🍳 Cook Mode Started!\n\n" +
                    `Collection: ${collection.name}\n` +
                    "First prompt queued for generation...",
                reply_markup: controlPanel
            });
    
        } catch (error) {
            console.error('Error starting cook mode:', error);
            await sendMessage(message, "❌ An error occurred while starting cook mode.");
        }
    }

    async pauseCooking(action, message, user) {
        try {
            const collectionId = parseInt(action.split('_')[1]);
            const status = await this.#getCookingStatus();
            // Find the cooking task
            const taskIndex = status.cooking.findIndex(
                task => task.userId === user && task.collectionId === collectionId
            );
    
            if (taskIndex === -1) {
                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: "❌ No active cooking task found to pause.",
                });
                return;
            }
            
            const existingTask = status.cooking[taskIndex];
    
            // Update task status
            const updatedCooking = [...status.cooking];
            updatedCooking[taskIndex] = {
                ...existingTask,
                status: 'paused',
                pausedAt: Date.now(),
                resumeData: {
                    generationCount: existingTask.generationCount,
                    targetSupply: existingTask.targetSupply,
                    lastGenerated: existingTask.lastGenerated,
                    traits: existingTask.traits,
                    userContextCache: existingTask.userContextCache
                }
            };
    
            // Save to DB
            await this.#updateCookingStatus({ cooking: updatedCooking });
            console.log(`Paused cooking task for user ${user}, collection ${collectionId}`);
    
            // Update UI
            const controlPanel = await this.getControlPanel(collectionId, 'paused');

            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: "⏸ Cook Mode Paused\n\n" +
                    `Collection: ${collectionId}\n` +
                    `Progress: ${existingTask.generationCount}/5\n` +
                    "Generation will resume when you press play.",
                reply_markup: controlPanel
            });
    
        } catch (error) {
            console.error('Error pausing cook mode:', error);
            await sendMessage(message, "❌ An error occurred while pausing cook mode.");
        }
    }

    async resumeCooking(cookTask) {
        try {
            const user = cookTask.userId;
            const collectionId = cookTask.collectionId;
            const status = await this.#getCookingStatus();
            // 1. Check qoints in both lobby and DB
            let userQoints = '0';
            if (lobby[user]?.qoints) {
                console.log('using in resume cooking user lobby qoints', lobby[user].qoints)
                userQoints = lobby[user].qoints;
            } else {
                const userEconomy = new UserEconomyDB();
                const userEco = await userEconomy.findOne({ userId: user });
                if (userEco) {
                    userQoints = userEco.qoints.toString() || '0';
                    console.log('using in resume cooking user db qoints', userEco.qoints)
                }
            }
    
            if (parseInt(userQoints) < 100) {
                console.log(`Cannot resume cooking for user ${user}: insufficient qoints (${userQoints})`);
                return false;
            }
    
            // 2. Use cached context or rebuild
            let userContext;
            if (cookTask.userContextCache) {
                console.log('Using cached user context for cooking task');
                userContext = cookTask.userContextCache;
            } else {
                console.log('No cached context found, rebuilding...');
                const collection = await getOrLoadCollection(user, collectionId);
                const { masterPrompt, traitTypes } = collection.config;
                
                // Process master prompt and generate traits
                const { exclusions, cleanedPrompt } = findExclusions(masterPrompt);
                const conflictMap = TraitSelector.buildConflictMap(exclusions);
                const selectedTraits = TraitSelector.generateTraitSelection(traitTypes, conflictMap);
                const generatedPrompt = processPromptWithOptionals(cleanedPrompt, selectedTraits);
    
                userContext = {
                    userId: user,
                    type: collection.config.workflow || 'MAKE',
                    prompt: generatedPrompt,
                    basePrompt: -1,
                    userPrompt: -1,
                    input_cfg: 6,
                    input_width: 1024,
                    input_height: 1024,
                    input_checkpoint: 'flux-schnell',
                    input_negative: 'embedding:easynegative',
                    balance: userQoints,
                    forceLogo: false,
                    input_batch: 1,
                    input_seed: -1,
                    controlNet: false,
                    styleTransfer: false,
                    openPose: false,
                    traits: selectedTraits
                };
            }
    
            // 3. Create dummy message
            const dummyMessage = {
                chat_id: user,
                from: {
                    id: user,
                    username: userContext.username || 'unknown_user',
                    first_name: userContext.first_name || 'Unknown'
                },
                message_id: Date.now()
            };
    
            // 4. Build and queue the task
            const workflow = flows.find(flow => flow.name === userContext.type);
            if (!workflow) {
                throw new Error(`Invalid workflow type: ${userContext.type}`);
            }
    
            let promptObj = buildCookModePromptObjFromWorkflow(workflow, userContext, dummyMessage);
            
    
            await this.#enqueueTask({
                message: dummyMessage,
                promptObj
            });
    
            // 5. Update cooking task status to active
            const updatedCooking = status.cooking.map(task => {
                if (task.userId === user && task.collectionId === collectionId) {
                    return {
                        ...task,
                        status: 'active',
                        resumedAt: Date.now(),
                        pausedAt: null
                    };
                }
                return task;
            });
    
            await this.#updateCookingStatus({ cooking: updatedCooking });
            console.log(`Successfully resumed cooking for user ${user}, collection ${collectionId}`);
            return true;
    
        } catch (error) {
            console.error('Error resuming cook mode:', error);
            return false;
        }
    }

    // For checking a specific cook's progress after generation
    async checkCookProgress(user, collectionId) {
        try {
            const status = await this.#getCookingStatus();
            const cookingTask = status.cooking.find(c => 
                c.userId === user && 
                c.collectionId === collectionId
            );

            if (!cookingTask || cookingTask.status !== 'active') {
                return;
            }

            // Check generation count instead of supply
            if (cookingTask.generationCount >= 5) {  // Testing limit
                await this.completeCookingTask(cookingTask, 'generation_limit_reached');
                return;
            }

            // Wait 5 seconds before next generation
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // After delay, check if still active in globalStatus
            const isStillActive = status.cooking.find(c => 
                c.userId === user && 
                c.collectionId === collectionId && 
                c.status === 'active'
            );

            

            if (isStillActive) {
                // Get collection info from cache or DB
                const collection = await getOrLoadCollection(user, collectionId);
                if (!collection) {
                    throw new Error('Collection not found');
                }

                // Create dummy message object
                const dummyMessage = {
                    chat_id: user,
                    from: {
                        id: user,
                        username: cookingTask.userContextCache?.username || 'unknown_user',
                        first_name: cookingTask.userContextCache?.first_name || 'Unknown'
                    }
                };
                await this.queueNextGeneration(dummyMessage, user, collection);
            }
        } catch (error) {
            console.error('[checkCookProgress] Error:', error);
        }
    }

    // For startup and periodic checks of all cooking tasks
    async checkKitchen() {
        try {
            console.log('🔍 Checking kitchen status...');
            const status = await this.#getCookingStatus();
            if (!status.cooking || status.cooking.length === 0) {
                console.log('Kitchen is empty, no active cooks found');
                return;
            }

            console.log(`Found ${status.cooking.length} cooking tasks`);
            
            for (const cookTask of status.cooking) {
                if (cookTask.status !== 'active') {
                    console.log(`Skipping ${cookTask.status} cook for user ${cookTask.userId}`);
                    continue;
                }

                try {
                    // Verify collection still exists
                    const collection = await getOrLoadCollection(cookTask.userId, cookTask.collectionId);
                    if (!collection) {
                        console.log(`Collection ${cookTask.collectionId} not found, marking cook as completed`);
                        await this.completeCookingTask(cookTask, 'collection_not_found');
                        continue;
                    }

                    // Check generation count instead of supply
                    if (cookTask.generationCount >= 5) {  // Testing limit
                        console.log(`Generation limit reached for collection ${cookTask.collectionId}`);
                        await this.completeCookingTask(cookTask, 'generation_limit_reached');
                        continue;
                    }   

                    // If all checks pass, resume cooking
                    console.log(`Resuming cook for user ${cookTask.userId}, collection ${cookTask.collectionId}`);
                    const dummyMessage = {
                        chat_id: cookTask.userId,
                        from: {
                            id: cookTask.userId,
                            username: cookTask.userContextCache?.username || 'unknown_user',
                            first_name: cookTask.userContextCache?.first_name || 'Unknown'
                        }
                    };
                    
                    await this.queueNextGeneration(dummyMessage, cookTask.userId, collection);

                } catch (error) {
                    console.error(`Error processing cook task for user ${cookTask.userId}:`, error);
                }
            }
        } catch (error) {
            console.error('Error checking kitchen status:', error);
        }
    }

    async checkExistingCookTask(user) {
        const status = await this.#getCookingStatus();
        const currentStatus = status;
        return currentStatus.cooking?.find(task => 
            task.userId === user && task.status === 'active'
        );
    }

    async handleExistingCookTask(message, existingTask, requestedCollectionId) {
        try {
            // Get collection info for better messaging
            const collection = await getOrLoadCollection(existingTask.userId, existingTask.collectionId);
            
            // Get appropriate control panel based on task status
            const controlPanel = await this.getControlPanel(existingTask.collectionId, existingTask.status);
    
            // Prepare status message based on whether they're trying to cook the same or different collection
            let statusText;
            if (existingTask.collectionId === requestedCollectionId) {
                statusText = "⚠️ You're already cooking this collection!\n\n" +
                            "Current status:\n" +
                            `Collection: ${collection.name}\n` +
                            `Generated: ${existingTask.generationCount}/5\n` +
                            `Last generated: ${existingTask.lastGenerated ? 
                                new Date(existingTask.lastGenerated).toLocaleString() : 
                                'Never'}\n\n` +
                            "Use the controls below to manage generation:";
            } else {
                statusText = "⚠️ You're already cooking another collection!\n\n" +
                            "Current cook status:\n" +
                            `Collection: ${collection.name}\n` +
                            `Generated: ${existingTask.generationCount}/5\n` +
                            `Last generated: ${existingTask.lastGenerated ? 
                                new Date(existingTask.lastGenerated).toLocaleString() : 
                                'Never'}\n\n` +
                            "Please use the controls below to manage the current cook:";
            }
    
            // Send message with current status and controls
            await sendMessage(message, statusText, { reply_markup: controlPanel });
    
        } catch (error) {
            console.error('Error handling existing cook task:', error);
            await sendMessage(message, "❌ An error occurred while checking cook status.");
        }
    }

    async validateCollection(message, user, collectionId) {
        try {
            // 1. Load collection
            const collection = await getOrLoadCollection(user, collectionId);
            if (!collection) {
                await sendMessage(message, "❌ Collection not found");
                return null;
            }
    
            // 2. Validate collection configuration
            const validationErrors = [];
    
            // Check master prompt
            if (!collection.config.masterPrompt) {
                validationErrors.push("• Missing master prompt");
            } else {
                // Validate master prompt structure
                const { isValid, errors } = validateMasterPrompt(collection.config.masterPrompt);
                if (!isValid) {
                    validationErrors.push("• Invalid master prompt structure:\n  " + errors.join("\n  "));
                }
            }
    
            // Check trait types
            if (!collection.config.traitTypes || collection.config.traitTypes.length === 0) {
                validationErrors.push("• No trait types defined");
            } else {
                // Check for empty trait types
                const emptyTraits = collection.config.traitTypes
                    .filter(type => !type.traits || type.traits.length === 0)
                    .map(type => type.title);
                
                if (emptyTraits.length > 0) {
                    validationErrors.push(`• Empty trait types found: ${emptyTraits.join(", ")}`);
                }
            }
    
            // If validation failed, send error message
            if (validationErrors.length > 0) {
                const errorMessage = "⚠️ Collection not ready for cooking:\n" + 
                                   validationErrors.join("\n") + 
                                   "\n\nPlease complete the trait setup before starting cook mode.";
                await sendMessage(message, errorMessage);
                return null;
            }
    
            // 3. Return validated collection
            return collection;
    
        } catch (error) {
            console.error('Error validating collection:', error);
            await sendMessage(message, "❌ An error occurred while validating the collection.");
            return null;
        }
    }

    async createInitialStatusMessage(message) {
        try {
            // Send initial "please wait" message
            const statusMessage = await sendMessage(message, 
                "🧑‍🍳 Initializing cook mode...", 
                { 
                    reply_markup: { 
                        inline_keyboard: [[
                            { text: "⏳ Please wait...", callback_data: "wait" }
                        ]] 
                    }
                }
            );
    
            if (!statusMessage) {
                throw new Error('Failed to create initial status message');
            }
    
            return statusMessage;
    
        } catch (error) {
            console.error('Error creating initial status message:', error);
            await sendMessage(message, "❌ An error occurred while setting up cook mode.");
            return null;
        }
    }

    async queueNextGeneration(message, user, collection) {
        try {
            // Check user's qoints first
            let userQoints = '0';
            if (lobby[user]?.qoints) {
                userQoints = lobby[user].qoints;
            } else {
                // If not in lobby, check DB
                const userEconomy = new UserEconomyDB();
                const userEco = await userEconomy.findOne({ userId: user });
                if (userEco) {
                    userQoints = userEco.qoints.toString() || '0';
                }
            }

            if (parseInt(userQoints) < 100) {
                console.log(`Insufficient qoints for user ${user}, pausing cook`);
                const status = await this.#getCookingStatus();
                const cookingTask = status.cooking.find(c => 
                    c.userId === user && 
                    c.collectionId === collection.collectionId
                );
                await this.pauseCooking(cookingTask, 'insufficient_qoints');
                return;
            }

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
            

            await this.#enqueueTask({
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

            

        } catch (error) {
            console.error('Error queueing next generation:', error);
            throw error;
        }
    }

    // Then update our interface methods to use this:
    async setupControlPanel(message, statusMessage, collection) {
        const controlPanel = await this.getControlPanel(collection.collectionId);
        
        await editMessage({
            chat_id: message.chat.id,
            message_id: statusMessage.message_id,
            text: "🧑‍🍳 Cook Mode Ready!\n\n" +
                `Collection: ${collection.name}\n` +
                `Generated: ${0}/${collection.config.supply || 5}\n` +
                "Use the controls below to manage generation:",
            reply_markup: controlPanel
        });
    }

    async getControlPanel(collectionId, cookStatus = null) {
        // If no cookStatus provided, check if there's an existing cook
        if (!cookStatus) {
            const status = await this.#getCookingStatus();
            const existingCook = status.cooking.find(c => 
                c.collectionId === collectionId && 
                ['active', 'paused'].includes(c.status)
            );
            cookStatus = existingCook?.status;
        }
    
        // Determine primary action button based on status
        let primaryButton;
        if (!cookStatus) {
            primaryButton = { 
                text: "▶️ Start", 
                callback_data: `cookStart_${collectionId}` 
            };
        } else if (cookStatus === 'active') {
            primaryButton = { 
                text: "⏸ Pause", 
                callback_data: `cookPause_${collectionId}` 
            };
        } else if (cookStatus === 'paused') {
            primaryButton = { 
                text: "▶️ Resume", 
                callback_data: `cookResume_${collectionId}` 
            };
        }
    
        return {
            inline_keyboard: [
                [
                    primaryButton,
                    { text: "👁 Review", callback_data: `cookReview_${collectionId}` }
                ],
                [
                    { text: "📊 Stats", callback_data: `cookStats_${collectionId}` },
                    { text: "❌ Exit", callback_data: `cookExit_${collectionId}` }
                ]
            ]
        };
    }

    async updateCookingInterface(message, collection, status) {
        const controlPanel = await this.getControlPanel(collection.collectionId, status);
        
        const statusText = status === 'active' ? 
            "🧑‍🍳 Cook Mode Active!\n\n" :
            "⏸ Cook Mode Paused\n\n";

        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: statusText +
                `Collection: ${collection.name}\n` +
                `Generated: ${cookingTask.generationCount}/5\n` +
                "Use the controls below to manage generation:",
            reply_markup: controlPanel
        });
    }

    async checkSupplyLimit(cookingTask) {
        if (cookingTask.generationCount >= 5) {
            // Get current status
            const status = await this.#getCookingStatus();
            
            // Update the specific task in the cooking array
            const updatedCooking = status.cooking.map(task => {
                if (task.userId === cookingTask.userId && task.collectionId === cookingTask.collectionId) {
                    return {
                        ...task,
                        status: 'completed',
                        completedAt: Date.now(),
                        completionReason: 'supply_limit_reached'
                    };
                }
                return task;
            });

            // Update both cache and DB
            await this.#updateCookingStatus({ cooking: updatedCooking });
            return true;
        }
        return false;
    }

    async initializeBot() {
        try {
            // Give DB time to connect
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check for required globals
            const maxAttempts = 10;
            let attempts = 0;
            
            while (attempts < maxAttempts) {
                const status = await this.#getCookingStatus();
                if (flows && flows.length > 0 && status) {
                    console.log('Global dependencies loaded, initializing cooking tasks...');
                    await this.initializeCookingTasks();
                    return;
                }
                
                console.log('Waiting for global dependencies to load...');
                await new Promise(resolve => setTimeout(resolve, 10000));
                attempts++;
            }
            
            if (attempts >= maxAttempts) {
                console.error('Timeout waiting for global dependencies');
            }
        } catch (error) {
            console.error('Error during bot initialization:', error);
        }
    }

    async completeCookingTask(cookTask, reason) {
        try {
            console.log(`Completing cook task for user ${cookTask.userId}, collection ${cookTask.collectionId}`);
            console.log(`Completion reason: ${reason}`);
    
            // 1. Update task status in globalStatus
            const status = await this.#getCookingStatus();
            const updatedCooking = status.cooking.map(task => {
                if (task.userId === cookTask.userId && task.collectionId === cookTask.collectionId) {
                    return {
                        ...task,
                        status: 'completed',
                        completedAt: Date.now(),
                        completionReason: reason,
                        deliveryStatus: 'pending'  // New field to track final delivery
                    };
                }
                return task;
            });
    
            await this.#updateCookingStatus({ cooking: updatedCooking });
    
            // 2. Get collection info for the message
            const collection = await getOrLoadCollection(cookTask.userId, cookTask.collectionId);
            
            // 3. Create completion message with appropriate context
            let completionMessage = "✨ Collection Cooking Complete!\n\n";
            completionMessage += `Collection: ${collection.name}\n`;
            completionMessage += `Generated: ${cookTask.generationCount}/5\n\n`;
    
            switch (reason) {
                case 'generation_limit_reached':
                    completionMessage += "🎉 All pieces have been generated successfully!\n";
                    break;
                case 'collection_not_found':
                    completionMessage += "⚠️ Collection was deleted or not found.\n";
                    break;
                case 'insufficient_qoints':
                    completionMessage += "⚠️ Cooking stopped due to insufficient qoints.\n";
                    break;
                default:
                    completionMessage += "Generation process has ended.\n";
            }
    
            completionMessage += "\nPlease review your collection and prepare for delivery:";
    
            // 4. Show modified control panel for completed state
            const completionControlPanel = {
                inline_keyboard: [
                    [
                        { text: "👁 Review Collection", callback_data: `cookReview_${cookTask.collectionId}` },
                        { text: "📊 Final Stats", callback_data: `cookStats_${cookTask.collectionId}` }
                    ],
                    [
                        { text: "📦 Prepare Delivery", callback_data: `cookDeliver_${cookTask.collectionId}` }
                    ]
                ]
            };
    
            // 5. Send completion message to user
            await sendMessage({
                chat_id: cookTask.userId,
                text: completionMessage,
                reply_markup: completionControlPanel
            });
    
            return true;
        } catch (error) {
            console.error('Error completing cook task:', error);
            return false;
        }
    }
}

module.exports = CollectionCook.getInstance();