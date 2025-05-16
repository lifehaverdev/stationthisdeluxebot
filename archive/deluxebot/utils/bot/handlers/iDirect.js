const { lobby, commandRegistry, stateHandlers, actionMap, prefixHandlers } = require('../bot')
const { sendMessage, setUserState, safeExecute, editMessage, react, escapeMarkdown } = require('../../utils')
const { gptAssist, formatters } = require('../../../commands/assist')
const { handleFlux } = require('./iMake')

// Create a global ledger to store user direct sessions
const ledger = {}

// Helper function for showing "thinking" state
const showThinking = async (message, customText) => {
    return await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: customText || '🤔 Thinking...',
        options: { parse_mode: 'MarkdownV2' }
    })
}

const ledgerOps = {
    initializeScene: (userId, sceneIndex) => {
        if (!ledger[userId].scenes) ledger[userId].scenes = {}
        if (!ledger[userId].scenes[sceneIndex]) {
            ledger[userId].scenes[sceneIndex] = {
                history: [],
                finalPrompt: null
            }
        }
        return ledger[userId].scenes[sceneIndex]
    },
    addToHistory: (userId, sceneIndex, entry) => {
        ledgerOps.initializeScene(userId, sceneIndex)
        ledger[userId].scenes[sceneIndex].history.push(entry)
    }
}

const gptTemplates = {
    storyDevelopment: (seedText) => ([
        {
            role: "system",
            content: `You are a creative storyboard director helping to develop visual narratives.
Your role is to help break down the story concept into key scenes that will make compelling images.
First, ask about the overall narrative elements such as:
- Main characters or subjects
- Setting and world details
- Emotional journey or arc
- Key story beats
- Visual style or aesthetic

Ask only ONE question at a time to help develop the story concept.
Focus on getting a clear picture of the narrative before breaking it into scenes.`
        },
        {
            role: "user",
            content: `Initial story concept: ${seedText}. Ask your first question to help develop this narrative.`
        }
    ]),

    storyEvaluation: (seed, history) => ([
        {
            role: "system",
            content: `You are evaluating whether there's enough story information to create a storyboard.
Review the conversation history and determine if we have a clear understanding of:
- Main characters/subjects
- Setting/world
- Basic story arc
- Visual style

Return a JSON response with:
- "ready": boolean indicating if we can move to storyboard creation
- "reasoning": brief explanation of the decision
- "nextQuestion": if not ready, provide the next question to ask
- "summary": if ready, provide a brief summary of the story elements we have`
        },
        {
            role: "user",
            content: `Initial concept: ${seed}\n\nConversation history:\n${
                history.map((entry, i) => 
                    `Q${i+1}: ${entry.question}\nA${i+1}: ${entry.answer}`
                ).join('\n\n')
            }`
        }
    ]),

    storyboardGeneration: (summary) => ([
        {
            role: "system",
            content: `Based on the story elements provided, create a sequence of 3-5 key scenes that would make compelling images.
Each scene should be a pivotal moment in the story.
Return a JSON array of scenes, where each scene has:
- "description": A brief description of what's happening
- "visualNotes": Key visual elements to focus on
- "mood": The emotional tone of the scene`
        },
        {
            role: "user",
            content: `Story summary: ${summary}\n\nCreate a sequence of key scenes for this narrative.`
        }
    ]),

    sceneDevelopment: (scene) => ([
        {
            role: "system",
            content: `You are a film director focusing on a specific scene.
Ask detailed questions about the visual elements needed to create this shot, such as:
- Camera angle and framing
- Character positioning and expressions
- Lighting and atmosphere
- Key props and set details
- Color palette and mood
- Environmental details

Ask ONE specific question at a time to develop the visual details of this scene.`
        },
        {
            role: "user",
            content: `Scene description: ${scene.description}
Visual notes: ${scene.visualNotes}
Mood: ${scene.mood}

Ask your first question to develop the visual details of this scene.`
        }
    ]),

    sceneEvaluation: (scene, history) => ([
        {
            role: "system",
            content: `You are evaluating whether there's enough detail to create a rich image prompt for this scene.
Review the scene information and conversation history to determine if key visual elements are defined.
Return a JSON response with:
- "ready": boolean indicating if we can create a final prompt
- "reasoning": brief explanation of the decision
- "nextQuestion": if not ready, provide the next question to ask`
        },
        {
            role: "user",
            content: `Scene details:
Description: ${scene.description}
Visual notes: ${scene.visualNotes}
Mood: ${scene.mood}

Conversation history:
${history.map((entry, i) => 
    `Q${i+1}: ${entry.question}\nA${i+1}: ${entry.answer}`
).join('\n\n')}`
        }
    ]),

    fluxPromptGeneration: (scene, history, skipMode = false) => ([
        {
            role: "system",
            content: `You are a FLUX prompt engineer. Create a detailed image prompt for this scene.
Follow the standard FLUX format:
- Start with "This image is a" or "This image is an"
- Include specific details about positioning, lighting, and atmosphere
- Be descriptive but concise (100-200 words)
- Maintain consistency with the overall story's style and mood${
    skipMode ? '\nEven if details are limited, create the best possible prompt from available information.' : ''
}`
        },
        {
            role: "user",
            content: `Create a prompt for this scene:
${scene.description}
${scene.visualNotes}
${scene.mood}

${history ? `Additional details from conversation:
${history.map((entry, i) => 
    `Q${i+1}: ${entry.question}\nA${i+1}: ${entry.answer}`
).join('\n\n')}` : ''}`
        }
    ])
}

const handleDirectError = async (error, message, customMessage = 'Sorry, there was an error processing your request.') => {
    console.error('Error in direct handler:', error)
    return await sendMessage(message, customMessage)
}

commandRegistry['/direct'] = {
    handler: async (message) => {
        console.log('direct command received')
        
        const userId = message.from.id
        const seedText = message.text.split('/direct')[1].trim()
        
        // Initialize a new ledger entry for this user
        ledger[userId] = {
            seed: seedText,
            step: 0,
            history: [],
            storyboard: [],
            scenes: [],
            currentScene: 0
        }

        if (!seedText) {
            return await sendMessage(message, 'Please provide a story idea after the /direct command. For example: /direct a hero\'s journey through a cyberpunk city')
        }

        // Create the initial prompt for story development
        const messages = gptTemplates.storyDevelopment(seedText)

        try {
            const response = await gptAssist({
                messages,
                model: "gpt-4",
                temperature: 0.7
            })

            ledger[userId].history.push({
                question: response.result
            })
            setUserState(message, 'direct_development')
            return await sendMessage(message, response.result)
        } catch (error) {
            return await handleDirectError(error, message)
        }
    }
}

// Helper function to create storyboard menu content
const createStoryboardMenu = (storyboard) => {
    const storyboardPreview = storyboard.map((scene, index) => 
        `Scene ${index + 1}:\n${scene.description}\n`
    ).join('\n')

    const sceneButtons = storyboard.map((_, index) => [{
        text: `🎬 Scene ${index + 1}`,
        callback_data: `directScene_${index}`
    }])

    return {
        text: escapeMarkdown(`Your story scenes:\n\n${storyboardPreview}\n\nSelect a scene to develop or modify the storyboard:`),
        options: {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📝 Modify Storyboard", callback_data: "direct_modify" }],
                    ...sceneButtons
                ]
            },
            parse_mode: 'MarkdownV2'
        }
    }
}

stateHandlers['direct_development'] = async (message) => {
    const userId = message.from.id
    const response = message.text

    // Store user's response
    ledger[userId].history.push({
        answer: response
    })

    // Evaluate if we have enough story information
    const evaluationMessages = gptTemplates.storyEvaluation(ledger[userId].seed, ledger[userId].history)

    try {
        const evaluation = await gptAssist({
            messages: evaluationMessages,
            temperature: 0.7,
            formatResult: formatters.json
        })

        if (evaluation.result.ready) {
            // Generate storyboard scenes
            const storyboardMessages = gptTemplates.storyboardGeneration(evaluation.result.summary)

            const storyboard = await gptAssist({
                messages: storyboardMessages,
                temperature: 0.8,
                formatResult: formatters.json
            })

            // Store the storyboard
            ledger[userId].storyboard = storyboard.result
            ledger[userId].currentScene = 0

            const menu = createStoryboardMenu(ledger[userId].storyboard)

            setUserState(message, 'IDLE')
            return sendMessage(
                message, 
                menu.text,
                menu.options
            )
        } else {
            // Not ready yet, ask the next question
            const nextQuestion = evaluation.result.nextQuestion
            ledger[userId].history.push({
                question: nextQuestion
            })
            
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "⏩ Skip to Storyboard", callback_data: "direct_skip" }]
                    ]
                }
            }

            setUserState(message, 'direct_development')
            return sendMessage(message, nextQuestion, options)
        }

    } catch (error) {
        return await handleDirectError(error, message)
    }
}

actionMap['direct_skip'] = async (message, user) => {
    console.log('direct_skip action received')
    
    if (!ledger[user]?.seed) {
        return editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'No story concept found. Please start a new session with /direct'
        })
    }

    try {
        // Generate storyboard with existing information
        const storyboardMessages = gptTemplates.storyboardGeneration(ledger[user].seed)
        
        const storyboard = await gptAssist({
            messages: storyboardMessages,
            temperature: 0.8,
            formatResult: formatters.json
        })

        await showThinking(message, 'Generating storyboard...')

        // Store the storyboard
        ledger[user].storyboard = storyboard.result
        ledger[user].currentScene = 0

        // Display the storyboard menu
        const menu = createStoryboardMenu(storyboard.result)
        setUserState(message, 'IDLE')
        
        return await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: menu.text,
            ...menu.options
        })

    } catch (error) {
        console.error('Error in direct_skip handler:', error)
        return await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'Sorry, there was an error generating the storyboard.'
        })
    }
}

actionMap['direct_modify'] = async (message, user) => {
    console.log('direct_modify action received')
    
    if (!ledger[user]?.storyboard) {
        return editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'No storyboard found. Please start a new session with /direct'
        })
    }

    // Show current storyboard and ask for modifications
    const storyboardPreview = ledger[user].storyboard.map((scene, index) => 
        `Scene ${index + 1}:\n${scene.description}\n${scene.visualNotes}\n${scene.mood}\n`
    ).join('\n')

    setUserState({
        chat: { id: message.chat.id },
        from: { id: user },
        message_thread_id: message.message_thread_id
    }, 'tweakstory')

    return await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: escapeMarkdown(`Current storyboard:\n\n${storyboardPreview}\nWhat adjustments would you like to make to this storyboard? You can:\n- Add new scenes\n- Remove scenes\n- Modify existing scenes\n- Reorder scenes\n\nPlease describe your desired changes.`),
        options: {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "↩️ Cancel Changes", callback_data: "direct_back" }]
                ]
            },
            parse_mode: 'MarkdownV2'
        }
    })
}

stateHandlers['tweakstory'] = (message) => safeExecute(message, async () => {
    console.log('tweakstory state handler received')
    const userId = message.from.id
    await react(message, '✍')

    // Create a prompt to modify the storyboard based on user's request
    const messages = [
        {
            "role": "system",
            "content": `You are a creative storyboard director helping to modify a sequence of scenes.
Analyze the requested changes and return a modified JSON array of scenes.
Each scene should maintain the format:
- "description": A brief description of what's happening
- "visualNotes": Key visual elements to focus on
- "mood": The emotional tone of the scene

Return only the modified array of scenes, maintaining the same format as the original.
IMPORTANT: Return ONLY the JSON array with no additional text or prefixes.`
        },
        {
            "role": "user",
            "content": `Current storyboard:
${JSON.stringify(ledger[userId].storyboard, null, 2)}

Requested changes:
${message.text}

Return the modified storyboard array.`
        }
    ]

    try {
        const modifiedStoryboard = await gptAssist({
            messages,
            temperature: 0.7,
            formatResult: formatters.json
        })

        // Store the modified storyboard
        ledger[userId].storyboard = modifiedStoryboard.result

        // Display the updated storyboard menu
        const menu = createStoryboardMenu(modifiedStoryboard.result)
        setUserState(message, 'IDLE')
        
        return sendMessage(
            message,
            escapeMarkdown(`Storyboard updated! Here are your modified scenes:\n\n${
                modifiedStoryboard.result.map((scene, index) => 
                    `Scene ${index + 1}:\n${scene.description}\n`
                ).join('\n')
            }`),
            menu.options
        )

    } catch (error) {
        return handleDirectError(error, message, 'Sorry, there was an error modifying the storyboard.')
    }
})

prefixHandlers['directScene_'] = async (action, message, user) => {
    const sceneIndex = parseInt(action.split('_')[1])
    const scene = ledger[user].storyboard[sceneIndex]
    ledger[user].currentScene = sceneIndex

    // Initialize scene-specific history if it doesn't exist
    if (!ledger[user].scenes[sceneIndex]) {
        ledger[user].scenes[sceneIndex] = {
            history: [],
            finalPrompt: null
        }
    }

    // Create the initial scene development prompt
    const messages = gptTemplates.sceneDevelopment(scene)

    try {
        const response = await gptAssist({
            messages,
            model: "gpt-4",
            temperature: 0.7
        })

        await showThinking(message, `Scene ${sceneIndex + 1}: ${scene.description}`)

        // Store the first question
        ledger[user].scenes[sceneIndex].history.push({
            question: response.result
        })

        setUserState({
            chat: { id: message.chat.id },
            from: { id: user },
            message_thread_id: message.message_thread_id
        }, 'direct_scene')

        return await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: `Scene ${sceneIndex + 1}: ${scene.description}\n\n${response.result}`,
            options: {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "⏩ Skip to Prompt", callback_data: `directSkip_${sceneIndex}` }]
                    ]
                }
            }
        })
    } catch (error) {
        return await handleDirectError(error, message)
    }
}

stateHandlers['direct_scene'] = (message) => safeExecute(message, async () => {
    console.log('direct_scene state handler received')
    const userId = message.from.id
    await react(message, '✍')
    
    const sceneIndex = ledger[userId].currentScene
    const scene = ledger[userId].storyboard[sceneIndex]
    
    if (!ledger[userId].scenes[sceneIndex]) {
        return sendMessage(message, 'Scene data not found. Please select a scene again.')
    }

    // Store user's response
    ledger[userId].scenes[sceneIndex].history.push({
        answer: message.text
    })

    // Evaluate if we have enough details for the scene
    const evaluationMessages = gptTemplates.sceneEvaluation(scene, ledger[userId].scenes[sceneIndex].history)

    try {
        const evaluation = await gptAssist({
            messages: evaluationMessages,
            temperature: 0.7,
            formatResult: formatters.json
        })

        

        if (evaluation.result.ready) {
            // Generate the final prompt for this scene
            const promptMessages = gptTemplates.fluxPromptGeneration(scene, ledger[userId].scenes[sceneIndex].history)

            const finalPrompt = await gptAssist({
                messages: promptMessages,
                temperature: 0.8
            })

            ledger[userId].scenes[sceneIndex].finalPrompt = finalPrompt.result

            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🎨 Generate Image", callback_data: `directGenerate_${sceneIndex}` },
                            { text: "✏️ Tweak Prompt", callback_data: `directTweak_${sceneIndex}` }
                        ],
                        [{ text: "↩️ Back to Storyboard", callback_data: "direct_back" }]
                    ]
                },
                parse_mode: 'MarkdownV2'
            }

            setUserState(message, 'IDLE')
            return sendMessage(
                message,
                escapeMarkdown(`Scene ${sceneIndex + 1} Prompt:\n\n\`${finalPrompt.result}\``),
                options
            )
        } else {
            // Not ready yet, ask the next question
            const nextQuestion = evaluation.result.nextQuestion
            ledger[userId].scenes[sceneIndex].history.push({
                question: nextQuestion
            })

            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "⏩ Skip to Prompt", callback_data: `directSkip_${sceneIndex}` }]
                    ]
                }
            }

            setUserState(message, 'direct_scene')
            return sendMessage(message, nextQuestion, options)
        }
    } catch (error) {
        return await handleDirectError(error, message)
    }
})

prefixHandlers['directSkip_'] = async (action, message, user) => {
    console.log('directSkip handler received')
    const sceneIndex = parseInt(action.split('_')[1])
    const scene = ledger[user].storyboard[sceneIndex]

    // Generate final prompt with existing information
    const promptMessages = gptTemplates.fluxPromptGeneration(scene, ledger[user].scenes[sceneIndex].history, true)

    try {
        const finalPrompt = await gptAssist({
            messages: promptMessages,
            temperature: 0.8
        })

        await showThinking(message, `Scene ${sceneIndex + 1}: ${scene.description}`)

        // Initialize scene data if it doesn't exist
        if (!ledger[user].scenes[sceneIndex]) {
            ledger[user].scenes[sceneIndex] = {}
        }
        
        ledger[user].scenes[sceneIndex].finalPrompt = finalPrompt.result

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🎨 Generate Image", callback_data: `directGenerate_${sceneIndex}` },
                        { text: "✏️ Tweak Prompt", callback_data: `directTweak_${sceneIndex}` }
                    ],
                    [{ text: "↩️ Back to Storyboard", callback_data: "direct_back" }]
                ]
            },
            parse_mode: 'MarkdownV2'
        }

        return await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: escapeMarkdown(`Scene ${sceneIndex + 1} Prompt:\n\n\`${finalPrompt.result}\``),
            options
        })

    } catch (error) {
        return await handleDirectError(error, message)
    }
}
prefixHandlers['directTweak_'] = async (action, message, user) => {
    console.log('directTweak handler received')
    const sceneIndex = parseInt(action.split('_')[1])
    
    if (!ledger[user]?.scenes[sceneIndex]?.finalPrompt) {
        return editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'No prompt found for this scene. Please generate a prompt first.'
        })
    }

    // Store current scene index for the state handler
    ledger[user].currentScene = sceneIndex

    setUserState({
        chat: { id: message.chat.id },
        from: { id: user },
        message_thread_id: message.message_thread_id
    }, 'scenetweak')

    return await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: escapeMarkdown(`Current prompt for Scene ${sceneIndex + 1}:\n\n\`${ledger[user].scenes[sceneIndex].finalPrompt}\`\n\nHow would you like to modify this prompt? You can:\n- Add specific details\n- Change the mood or atmosphere\n- Adjust camera angles or positioning\n- Modify lighting or colors\n\nPlease describe your desired changes.`),
        options: {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "↩️ Cancel Changes", callback_data: `directScene_${sceneIndex}` }]
                ]
            },
            parse_mode: 'MarkdownV2'
        }
    })
}

stateHandlers['scenetweak'] = (message) => safeExecute(message, async () => {
    console.log('scenetweak state handler received')
    const userId = message.from.id
    const sceneIndex = ledger[userId].currentScene
    await react(message, '✍')

    const scene = ledger[userId].storyboard[sceneIndex]
    const currentPrompt = ledger[userId].scenes[sceneIndex].finalPrompt

    // Create a prompt to modify the scene's prompt based on user's request
    const messages = [
        {
            "role": "system",
            "content": `You are a FLUX prompt engineer modifying an existing image prompt.
Analyze the requested changes and create an updated prompt that:
- Maintains the FLUX format (starts with "This image is a/an")
- Incorporates the requested modifications
- Stays consistent with the scene's overall mood and story context
- Remains concise (100-200 words)`
        },
        {
            "role": "user",
            "content": `Original scene:
Description: ${scene.description}
Visual notes: ${scene.visualNotes}
Mood: ${scene.mood}

Current prompt:
${currentPrompt}

Requested changes:
${message.text}

Return only the modified prompt.`
        }
    ]

    try {
        const modifiedPrompt = await gptAssist({
            messages,
            temperature: 0.8
        })

        // Store the modified prompt
        ledger[userId].scenes[sceneIndex].finalPrompt = modifiedPrompt.result

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🎨 Generate Image", callback_data: `directGenerate_${sceneIndex}` },
                        { text: "✏️ Tweak Again", callback_data: `directTweak_${sceneIndex}` }
                    ],
                    [{ text: "↩️ Back to Storyboard", callback_data: "direct_back" }]
                ]
            },
            parse_mode: 'MarkdownV2'
        }

        setUserState(message, 'IDLE')
        return sendMessage(
            message,
            escapeMarkdown(`Updated prompt for Scene ${sceneIndex + 1}:\n\n\`${modifiedPrompt.result}\``),
            options
        )

    } catch (error) {
        return handleDirectError(error, message, 'Sorry, there was an error modifying the prompt.')
    }
})


prefixHandlers['directGenerate_'] = async (action, message, user) => {
    console.log('directGenerate handler received', user)
    const sceneIndex = parseInt(action.split('_')[1])
    
    if (!ledger[user]?.scenes[sceneIndex]?.finalPrompt) {
        return editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'No prompt available for this scene. Please develop the scene first.'
        })
    }

    // Create a mock message that looks like a direct /make command
    const mockMessage = {
        from: { id: user },
        chat: { id: message.chat.id },
        message_thread_id: message.message_thread_id,
        isDirect: true,
        text: `/make ${ledger[user].scenes[sceneIndex].finalPrompt}`
    }

    // Route through handleFlux
    try {
        await handleFlux(mockMessage)
        await react(message)
        // Update message but keep scene-specific options available
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: escapeMarkdown(`Creating image for Scene ${sceneIndex + 1}...\n\n\`${ledger[user].scenes[sceneIndex].finalPrompt}\``),
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🎨 Generate Again", callback_data: `directGenerate_${sceneIndex}` },
                        { text: "✏️ Tweak Prompt", callback_data: `directTweak_${sceneIndex}` }
                    ],
                    [
                        { text: "↩️ Back to Storyboard", callback_data: "direct_back" },
                        { text: "⏭️ Next Scene", callback_data: `directScene_${sceneIndex + 1}` }
                    ]
                ]
            },
            options: {parse_mode: 'MarkdownV2'}
        })
    } catch (error) {
        console.error('Error in directGenerate handler:', error)
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'Sorry, there was an error starting the image creation.'
        })
    }
}

actionMap['direct_back'] = async (message, user) => {
    console.log('direct_back action received')
    
    if (!ledger[user]?.storyboard) {
        return editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'No storyboard found. Please start a new session with /direct'
        })
    }

    await showThinking(message, '🔄 Loading storyboard...')
    
    // Set user back to IDLE state
    setUserState({
        chat: { id: message.chat.id },
        from: { id: user }
    }, 'IDLE')

    // Get the menu structure and display it
    const menu = createStoryboardMenu(ledger[user].storyboard)
    return await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: menu.text,
        ...menu.options
    })
}
