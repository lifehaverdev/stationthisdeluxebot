const { lobby, commandRegistry, stateHandlers, actionMap, prefixHandlers } = require('../bot')
const { sendMessage, setUserState, safeExecute, editMessage, react, escapeMarkdown } = require('../../utils')
const { gptAssist, formatters } = require('../../../commands/assist')
const { handleFlux } = require('./iMake')
// Create a global ledger to store user riff sessions
const ledger = {}

commandRegistry['/riff'] = {
    handler: async (message) => {
        console.log('riff command received')
        
        const userId = message.from.id
        const seedText = message.text.split('/riff')[1].trim()
        
        // Initialize a new ledger entry for this user
        ledger[userId] = {
            seed: seedText,
            step: 0,
            history: []
        }

        if (!seedText) {
            return await sendMessage(message, 'Please provide a seed idea after the /riff command. For example: /riff a magical forest')
        }

        // Create the initial prompt for the AI
        const messages = [
            {
                "role": "system",
                "content": `You are a creative visual development assistant helping to explore and expand image concepts.
Your role is to ask thought-provoking questions about the given concept that will help develop it into a more detailed and interesting image.
Focus on one aspect at a time, such as:
- Mood and atmosphere
- Time period or setting
- Key visual elements
- Color palette
- Lighting conditions
- Composition and framing
- Artistic style

Ask only ONE question at a time. Make it specific but open-ended.
Do not make suggestions - only ask questions that will help the user develop their own vision.`
            },
            {
                "role": "user",
                "content": `Initial concept: ${seedText}. Ask your first question to help develop this idea.`
            }
        ]

        try {
            const response = await gptAssist({
                messages,
                model: "gpt-4",
                temperature: 0.7
            })

            // Store the AI's question in the history
            ledger[userId].history.push({
                question: response.result
            })
            setUserState(message, 'riff')
            return await sendMessage(message, response.result)
        } catch (error) {
            console.error('Error in riff handler:', error)
            return await sendMessage(message, 'Sorry, there was an error processing your request.')
        }
    }
}
//stateHandlers[STATES.EFFECTHANG] = (message) => safeExecute(message, iMenu.handleEffectHang);

stateHandlers['riff'] = (message) => safeExecute(message, async () => {
    console.log('riff state handler received');
    const userId = message.from.id;
    await react(message,'✍')
    
    if (!ledger[userId]) {
        return sendMessage(message, 'Please start a new riff session with /riff command first');
    }

    // Store user's response to the previous question
    ledger[userId].history.push({
        answer: message.text
    });

    // First stage: Evaluate if we have enough information
    const evaluationMessages = [
        {
            "role": "system",
            "content": `You are evaluating whether there's enough detail to create a rich image prompt.
Review the conversation history and determine if key visual elements are defined.
Return a JSON response with:
- "ready": boolean indicating if we can create a final prompt
- "reasoning": brief explanation of the decision
- "nextQuestion": if not ready, provide the next question to ask`
        },
        {
            "role": "user",
            "content": `Initial concept: ${ledger[userId].seed}\n\nConversation history:\n${
                ledger[userId].history.map((entry, i) => 
                    `Q${i+1}: ${entry.question}\nA${i+1}: ${entry.answer}`
                ).join('\n\n')
            }`
        }
    ];

    try {
        const evaluation = await gptAssist({
            messages: evaluationMessages,
            temperature: 0.7,
            formatResult: formatters.json
        });

        if (evaluation.result.ready) {
            // Second stage: Generate the final prompt
            const promptMessages = [
                {
                    "role": "system",
                    "content": `You are a FLUX prompt engineer. Create a detailed image prompt based on the provided conversation.
Follow the standard FLUX format:
- Start with "This image is a" or "This image is an"
- Include specific details about positioning, lighting, and atmosphere
- Be descriptive but concise (100-200 words)`
                },
                {
                    "role": "user",
                    "content": `Create a prompt based on:\nInitial concept: ${ledger[userId].seed}\n\nDetails from conversation:\n${
                        ledger[userId].history.map((entry, i) => 
                            `Q${i+1}: ${entry.question}\nA${i+1}: ${entry.answer}`
                        ).join('\n\n')
                    }`
                }
            ];

            const finalPrompt = await gptAssist({
                messages: promptMessages,
                temperature: 0.8
            });

            ledger[userId].finalPrompt = finalPrompt.result;
            
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🎨 Create Image", callback_data: "riff_create" },
                            { text: "✏️ Tweak Prompt", callback_data: "riff_tweak" },
                            { text: "🔄 Start Over", callback_data: "riff_reset" }
                        ]
                    ]
                },
                parse_mode: 'MarkdownV2'
            };
            setUserState(message, 'IDLE')
            return sendMessage(
                message, 
                escapeMarkdown(`I think we have enough details! Here's a proposed prompt:\n\n\`${finalPrompt.result}\``), 
                options
            );
        } else {
            // Not ready yet, ask the next question
            const nextQuestion = evaluation.result.nextQuestion;
            ledger[userId].history[ledger[userId].history.length - 1].question = nextQuestion;
            // Maintain the riff state as we need more information
            setUserState(message, 'riff');
            
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "⏩ Skip to Final Prompt", callback_data: "riff_skip" }]
                    ]
                }
            };

            return sendMessage(message, nextQuestion, options);
        }

    } catch (error) {
        console.error('Error in riff state handler:', error);
        return sendMessage(message, 'Sorry, there was an error processing your request.');
    }
});

// Add the skip action handler
actionMap['riff_skip'] = async (message, user) => {
    console.log('riff_skip action received');
    
    // Generate final prompt with what we have so far
    const promptMessages = [
        {
            "role": "system",
            "content": `You are a FLUX prompt engineer. Create a detailed image prompt based on the provided conversation.
Even though the conversation was cut short, make the best prompt you can with the available information.
Follow the standard FLUX format:
- Start with "This image is a" or "This image is an"
- Include specific details about positioning, lighting, and atmosphere
- Be descriptive but concise (100-200 words)`
        },
        {
            "role": "user",
            "content": `Create a prompt based on:\nInitial concept: ${ledger[user].seed}\n\nDetails from conversation:\n${
                ledger[user].history.map((entry, i) => 
                    `Q${i+1}: ${entry.question}\nA${i+1}: ${entry.answer}`
                ).join('\n\n')
            }`
        }
    ];

    try {
        const finalPrompt = await gptAssist({
            messages: promptMessages,
            temperature: 0.8
        });

        ledger[user].finalPrompt = finalPrompt.result;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🎨 Create Image", callback_data: "riff_create" },
                        { text: "✏️ Tweak Prompt", callback_data: "riff_tweak" },
                        { text: "🔄 Start Over", callback_data: "riff_reset" }
                    ]
                ]
            }
        };

        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: escapeMarkdown(`Here's what I can do with the details so far:\n\n\`${finalPrompt.result}\``),
            reply_markup: options.reply_markup,
            options: {parse_mode: 'MarkdownV2'}
        });

    } catch (error) {
        console.error('Error in skip handler:', error);
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'Sorry, there was an error generating the prompt.'
        });
    }
};

actionMap['riff_reset'] = async (message, user) => {
    console.log('riff_reset action received', user);
    
    // Keep the original seed but clear the history and final prompt
    const originalSeed = ledger[user].seed;
    ledger[user] = {
        seed: originalSeed,
        step: 0,
        history: []
    };

    // Set state back to 'riff'
    setUserState({
        chat: { id: message.chat.id },
        from: { id: user },
        message_thread_id: message.message_thread_id
    }, 'riff');

    // Create the initial prompt for the AI just like in the /riff command
    const messages = [
        {
            "role": "system",
            "content": `You are a creative visual development assistant helping to explore and expand image concepts.
Your role is to ask thought-provoking questions about the given concept that will help develop it into a more detailed and interesting image.
Focus on one aspect at a time, such as:
- Mood and atmosphere
- Time period or setting
- Key visual elements
- Color palette
- Lighting conditions
- Composition and framing
- Artistic style

Ask only ONE question at a time. Make it specific but open-ended.
Do not make suggestions - only ask questions that will help the user develop their own vision.`
        },
        {
            "role": "user",
            "content": `Initial concept: ${originalSeed}. Ask your first question to help develop this idea.`
        }
    ];

    try {
        const response = await gptAssist({
            messages,
            model: "gpt-4",
            temperature: 0.7
        });

        // Store the AI's question in the history
        ledger[user].history.push({
            question: response.result
        });

        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: `Starting over with "${originalSeed}"\n\n${response.result}`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "⏩ Skip to Final Prompt", callback_data: "riff_skip" }]
                ]
            }
        });

    } catch (error) {
        console.error('Error in reset handler:', error);
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'Sorry, there was an error resetting the riff session.'
        });
    }
};

actionMap['riff_tweak'] = async (message, user) => {
    console.log('riff_tweak action received',user);
        
    // Fix the message structure for setUserState
    setUserState({
        chat: { id: message.chat.id },
        from: { id: user },  // user is the user's ID
        message_thread_id: message.message_thread_id
    }, 'tweak');
    console.log('user state', lobby[user].state)
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: escapeMarkdown(`Okay how should we change this\.\. \n\n\`${ledger[user].finalPrompt}\``),
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎨 Create Image", callback_data: "riff_create" }, { text: "✏️ Tweak Prompt", callback_data: "riff_tweak" }, { text: "🔄 Start Over", callback_data: "riff_reset" }]
            ]
        },
        options: {parse_mode: 'MarkdownV2'}
    })
};

stateHandlers['tweak'] = (message) => safeExecute(message, async () => {
    console.log('tweak state handler received');
    const userId = message.from.id;
    await react(message,'✍')
    
    if (!ledger[userId]?.finalPrompt) {
        return sendMessage(message, 'No prompt to tweak. Please start a new riff session with /riff command');
    }

    // Store the current prompt in history before modifying
    ledger[userId].promptHistory = ledger[userId].promptHistory || [];
    ledger[userId].promptHistory.push(ledger[userId].finalPrompt);

    // Direct prompt modification without evaluation
    const tweakMessages = [
        {
            "role": "system",
            "content": `You are modifying an existing FLUX image prompt.
- Apply the user's requested changes directly to the prompt
- Maintain the same overall structure and format
- Keep the same level of detail and descriptive elements
- Do not ask questions or seek clarification
- Return only the modified prompt`
        },
        {
            "role": "user",
            "content": `Current prompt: ${ledger[userId].finalPrompt}\n\nModify the prompt according to this request: ${message.text}`
        }
    ];

    try {
        const modifiedPrompt = await gptAssist({
            messages: tweakMessages,
            temperature: 0.7
        });

        ledger[userId].finalPrompt = modifiedPrompt.result;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🎨 Create Image", callback_data: "riff_create" },
                        { text: "✏️ Tweak More", callback_data: "riff_tweak" }
                    ],
                    [
                        { text: "↩️ Undo Last Change", callback_data: "riff_undo" },
                        { text: "🔄 Start Over", callback_data: "riff_reset" }
                    ]
                ]
            },
            parse_mode: 'MarkdownV2'
        };
        setUserState(message, 'IDLE')
        return sendMessage(
            message,
            escapeMarkdown(`Updated prompt:\n\n\`${modifiedPrompt.result}\``),
            options
        );

    } catch (error) {
        console.error('Error in tweak handler:', error);
        return sendMessage(message, 'Sorry, there was an error modifying the prompt.');
    }
});

actionMap['riff_create'] = async (message, user) => {
    console.log('riff_create action received', user);
    
    if (!ledger[user]?.finalPrompt) {
        return editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'No prompt available to create. Please start a new riff session.'
        });
    }

    // Create a mock message that looks like a direct /make command
    const mockMessage = {
        from: { id: user },
        chat: { id: message.chat.id },
        message_thread_id: message.message_thread_id,
        isRiff: true,
        text: `/make ${ledger[user].finalPrompt}`  // Format as if user typed /make command
    };

    // Route through handleFlux
    try {
        await handleFlux(mockMessage);
        await react(message)
        // Update message but keep all options available
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: escapeMarkdown(`Creating image with this prompt...\n\n\`${ledger[user].finalPrompt}\``),
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🎨 Create Again", callback_data: "riff_create" },
                        { text: "✏️ Tweak Prompt", callback_data: "riff_tweak" }
                    ],
                    [
                        { text: "↩️ Undo Last Change", callback_data: "riff_undo" },
                        { text: "🔄 Start Over", callback_data: "riff_reset" }
                    ]
                ]
            },
            options: {parse_mode: 'MarkdownV2'}
        });
    } catch (error) {
        console.error('Error in create handler:', error);
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'Sorry, there was an error starting the image creation.'
        });
    }
};

// Add the undo action handler
actionMap['riff_undo'] = async (message, user) => {
    console.log('riff_undo action received');
    
    if (!ledger[user]?.promptHistory?.length) {
        return sendMessage(message, 'No previous version to return to.');
    }

    // Pop the last prompt from history and set it as current
    ledger[user].finalPrompt = ledger[user].promptHistory.pop();

    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🎨 Create Image", callback_data: "riff_create" },
                    { text: "✏️ Tweak More", callback_data: "riff_tweak" }
                ],
                [
                    { text: "↩️ Undo Last Change", callback_data: "riff_undo" },
                    { text: "🔄 Start Over", callback_data: "riff_reset" }
                ]
            ]
        }
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: `Reverted to previous version:\n\n${ledger[user].finalPrompt}`,
        reply_markup: options.reply_markup
    });
};
