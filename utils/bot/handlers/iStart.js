const { commandRegistry, lobby, loraTriggers } = require('../bot')
const { sendMessage } = require('../../utils')
const { AnalyticsEvents } = require('../../../db/models/analyticsEvents');

const analytics = new AnalyticsEvents();

const tutorialSteps = {
    'quickmake': {
        command: '/quickmake',
        introduction: 
            "🤖 Hi\\! I'm StationThisBot, your AI image generation assistant\\!\n\n" +
            "Let's start with something fun \\- I'll teach you how to create images with a simple command\\.\n\n" +
            "Try this: Type exactly as shown:\n" +
            "`/quickmake Muscular Elon Musk with a sword`\n\n" +
            "Go ahead, try it now\\! 👆",
        nextStep: 'status',
        unlockedCommands: ['/start', '/quickmake'],
        checkpoints: {
            COMMAND_USED: true,
            // GENERATION_COMPLETE: true
        }
    },
    'status': {
        command: '/status',
        introduction: 
            "Yep that's pretty much what we do here\\! I am making your image quickly\\.\n\n" +
            "Why don't we check on it with /status command\\?\n" +
            "Go ahead and try it before I beat you to it\\! 👀",
        nextStep: 'signin',
        unlockedCommands: ['/status'],
        checkpoints: {
            COMMAND_USED: true
        }
    },
    'make': {
        command: '/make',
        introduction:
            "Great\\! Now you know how to check on your generations\\.\n\n" +
            "Let me show you a more advanced command \\- `/make`\n" +
            "This one lets you customize your generations with more options\\!\n\n" +
            "Try: `/make a cyberpunk cat`",
        nextStep: 'quickeffect',
        unlockedCommands: ['/make']
    },
    'quickeffect': {
        command: '/quickeffect',
        introduction: (triggers) => 
            "Now here's something cool \\- did you know your first image was actually using a special PS2 style\\? 🎮\n\n" +
            "We use what's called a LoRA \\(don't worry about the technical stuff\\) to create specific styles\\. " +
            "Let's try some different styles on your first image\\!\n\n" +
            "Reply to your first image with one of these commands:\n\n" +
            triggers.map(t => `\\• \`/quickeffect ${t}\``).join('\n') + "\n\n" +
            "Just reply to the image with any of those commands\\! 👆",
        nextStep: 'effect',
        unlockedCommands: ['/quickeffect']
    },
    'effect': {
        command: '/effect',
        introduction:
            "Great\\! Now you know how to use img2img generation with quickeffect\\.\n\n" +
            "Try using `/effect` on the same image instead\\! This command gives you a higher quality generation\\.\n\n" +
            "Just reply to the same image with `/effect` and see the difference\\! 🎨",
        nextStep: 'points_info',
        unlockedCommands: ['/effect']
    },
    'signin': {
        command: '/signin',
        introduction: 
            "By the way, let's talk about points\\! 🎯\n\n" +
            "You currently start with 370 points, however if you own MS2 you may connect a wallet and be credited with more points to work with, as well as unlocking more features of the bot \\(me\\)\\.\n\n" +
            "It's okay if you don't have any MS2 yet, let's do this\\! 🎁\n\n" +
            "If you connect your wallet, I'll give you 1000 bonus points\\! Then we can continue on to cool things\n" +
            "Ready to get those bonus points\\? Try: /signin",
        nextStep: 'points_info',
        unlockedCommands: ['/signin'],
        checkpoints: {
            COMMAND_USED: true,
            WALLET_CONNECTED: true
        }
    },
    'points_info': {
        command: null,
        introduction: 
            "Great\\! You've got your bonus points\\. 🎉\n\n" +
            "That concludes our tutorial\\! You now know the basics of creating and modifying images\\.\n\n" +
            "Feel free to explore more commands and have fun creating\\! 🎨",
        nextStep: null,
        unlockedCommands: []
    },
    // 'signin': {
    //     command: '/signin',
    //     introduction:
    //         "Perfect\\! Follow the signin process and once you're connected, you'll get your bonus points\\!\n\n" +
    //         "After that, I'll show you some really cool stuff you can do with LoRAs and special effects\\! 🎨",
    //     nextStep: null,
    //     unlockedCommands: ['/signin']
    // }
};

const CHECKPOINTS = {
    COMMAND_USED: 'COMMAND_USED',
    GENERATION_COMPLETE: 'GENERATION_COMPLETE',
    WALLET_CONNECTED: 'WALLET_CONNECTED',
    IMAGE_RECEIVED: 'IMAGE_RECEIVED',
    EFFECT_APPLIED: 'EFFECT_APPLIED'
};

class TutorialManager {
    static initializeProgress(userId) {
        console.log('Initializing progress for user:', userId);
        if (!lobby[userId].progress) {
            const firstStep = 'quickmake';
            const randomTriggers = getRandomSDXLTriggers(3);
            console.log('Random triggers for user:', randomTriggers);
            
            lobby[userId].progress = {
                currentStep: firstStep,
                steps: {
                    [firstStep]: {
                        started: Date.now(),
                        completed: null,
                        attempts: 0
                    }
                },
                unlockedCommands: tutorialSteps[firstStep].unlockedCommands,
                randomTriggers
            };
            console.log('Progress initialized:', lobby[userId].progress);
        }
    }

    static async progressToNextStep(message) {
        const userId = message.from.id;
        const currentStep = lobby[userId].progress.currentStep;
        const stepData = tutorialSteps[currentStep];

        if (!stepData) return;

        const nextStepId = stepData.nextStep;
        if (!nextStepId) {
            // Tutorial completed - clean up
            console.log('[Tutorial] Completed for user:', userId);
            lobby[userId].progress.completed = Date.now();
            // Optionally send a completion message
            await sendMessage(message, "🎉 Tutorial completed! You now have access to all commands. Enjoy creating!");
            return;
        }

        // Mark current step as completed
        lobby[userId].progress.steps[currentStep].completed = Date.now();

        // Initialize next step
        lobby[userId].progress.currentStep = nextStepId;
        lobby[userId].progress.steps[nextStepId] = {
            started: Date.now(),
            completed: null,
            attempts: 0
        };

        // Add new unlocked commands
        const newCommands = tutorialSteps[nextStepId].unlockedCommands || [];
        lobby[userId].progress.unlockedCommands.push(...newCommands);

        // Handle dynamic introduction messages
        const introduction = typeof tutorialSteps[nextStepId].introduction === 'function' 
        ? tutorialSteps[nextStepId].introduction(lobby[userId].progress.randomTriggers)
        : tutorialSteps[nextStepId].introduction;
        
        // Send the introduction for the next step
        await sendMessage(message, introduction, {parse_mode: 'MarkdownV2'});

        // If this step has no command, wait a moment before progressing
        if (!tutorialSteps[nextStepId].command) {
            // Wait 2 seconds to let user read the message
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.progressToNextStep(message);
        }
    }

    static isCommandAllowed(userId, command) {
        return lobby[userId]?.progress?.unlockedCommands?.includes(command) || false;
    }

    static getCurrentStep(userId) {
        return lobby[userId]?.progress?.currentStep;
    }

    static async checkpointReached(userId, checkpointType, context = {}) {
        console.log(`\n[Checkpoint] Reached for user ${userId}:`, checkpointType);
        
        if (!lobby[userId]?.progress) {
            console.log('[Checkpoint] No progress found for user');
            return;
        }

        const currentStep = lobby[userId].progress.currentStep;
        const stepData = tutorialSteps[currentStep];
        
        console.log('[Checkpoint] Current step:', currentStep);
        console.log('[Checkpoint] Step data:', stepData);

        // If this step doesn't require this checkpoint, ignore it
        if (!stepData?.checkpoints?.[checkpointType]) {
            console.log('[Checkpoint] This checkpoint not required for current step');
            return;
        }

        // Initialize checkpoints tracking if not exists
        if (!lobby[userId].progress.steps[currentStep].checkpoints) {
            console.log('[Checkpoint] Initializing checkpoints tracking');
            lobby[userId].progress.steps[currentStep].checkpoints = {};
        }

        // Mark this checkpoint as completed
        lobby[userId].progress.steps[currentStep].checkpoints[checkpointType] = true;
        console.log('[Checkpoint] Updated checkpoints:', lobby[userId].progress.steps[currentStep].checkpoints);

        // Check if all required checkpoints for this step are completed
        const allCheckpointsComplete = Object.entries(stepData.checkpoints)
            .every(([type, required]) => 
                required === lobby[userId].progress.steps[currentStep].checkpoints[type]
            );
        
        console.log('[Checkpoint] All checkpoints complete?', allCheckpointsComplete);

        // If all checkpoints are complete, progress to next step
        if (allCheckpointsComplete) {
            console.log('[Checkpoint] Progressing to next step...');
            const message = context.message || { from: { id: userId }, chat: { id: userId } };
            await this.progressToNextStep(message);
        }
    }
}

commandRegistry['/start'] = {
    handler: async (message) => {
        const userId = message.from.id;
        
        // Initialize tutorial progress
        TutorialManager.initializeProgress(userId);

        // Send the first tutorial message
        await sendMessage(message, tutorialSteps['quickmake'].introduction, {parse_mode: 'MarkdownV2'});
    }
};

function getMatchingTriggerPairs() {
    console.log('Getting matching trigger pairs...');
    console.log('First 3 lora triggers:', Object.entries(loraTriggers).slice(0, 3));
    
    const sdxlTriggers = new Set(
        Object.entries(loraTriggers)
            .filter(([_, data]) => data.version === 'SDXL')
            .map(([_, data]) => data.triggerWords[0].toLowerCase())
    );
    console.log('SDXL triggers found:', sdxlTriggers.size);

    const fluxTriggers = new Set(
        Object.entries(loraTriggers)
            .filter(([_, data]) => data.version === 'FLUX')
            .map(([_, data]) => data.triggerWords[0].toLowerCase())
    );
    console.log('FLUX triggers found:', fluxTriggers.size);

    const matchingTriggers = [...sdxlTriggers].filter(trigger => fluxTriggers.has(trigger));
    console.log('Matching triggers found:', matchingTriggers.length);

    const pairs = matchingTriggers.map(trigger => ({
        sdxl: Object.entries(loraTriggers).find(([key, data]) => 
            data.triggerWords[0].toLowerCase() === trigger && data.version === 'SDXL'
        ),
        flux: Object.entries(loraTriggers).find(([key, data]) => 
            data.triggerWords[0].toLowerCase() === trigger && data.version === 'FLUX'
        )
    }));
    console.log('Final pairs:', pairs.length);
    return pairs;
}

function getRandomSDXLTriggers(count = 3) {
    console.log('Getting random SDXL triggers...');
    const pairs = getMatchingTriggerPairs();
    console.log('Got pairs:', pairs.length);
    const shuffled = shuffle([...pairs]);
    const selected = shuffled.slice(0, count);
    const triggers = selected.map(pair => pair.sdxl[1].triggerWords[0]);
    console.log('Selected triggers:', triggers);
    return triggers;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

module.exports = { 
    tutorialSteps, 
    TutorialManager,
    CHECKPOINTS 
};