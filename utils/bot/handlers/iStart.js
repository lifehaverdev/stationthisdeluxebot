const { commandRegistry, lobby, loraTriggers } = require('../bot')
const { sendMessage, escapeMarkdown } = require('../../utils')
const { AnalyticsEvents } = require('../../../db/models/analyticsEvents');
const { refreshLoraCache } = require('../../../db/models/cache');
const { Loras } = require('../../../db/models/loras');

const analytics = new AnalyticsEvents();

const tutorialSteps = {
    'quickmake': {
        command: '/quickmake',
        introduction: 
            "🤖 Hi! I'm StationThisBot, your AI image generation assistant!\n\n" +
            "Let's start with something fun - I'll teach you how to create images with a simple command.\n\n" +
            "Try this: Type exactly as shown:\n" +
            "`/quickmake Muscular Elon Musk with a sword`\n\n" +
            "Go ahead, try it now! 👆",
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
            "Yep that's pretty much what we do here! I am making your image quickly.\n\n" +
            "Why don't we check on it with /status command?\n" +
            "Go ahead and try it before I beat you to it! 👀",
        nextStep: 'make',
        unlockedCommands: ['/status'],
        checkpoints: {
            COMMAND_USED: true,
            BOT_REPLY_SENT: true
        }
    },
    'make': {
        command: '/make',
        introduction:
            "Great! Now you know how to check on your generations.\n\n" +
            "Let me show you a more advanced command - `/make`\n" +
            "This one lets you customize your generations with more options!\n\n" +
            "Try: `/make Stationthisbot cute small plushy figurine standing up, wearing a shirt with old English text that reads, “MS2”. and wearing zebra pattern pants. Stationthisbot is wearing black nike shoes. Stationthisbot holding a lit cigar in hand. round yellow body, rounded, five sided star head. Short stubby body. Standing in front of a pink and yellow zig zag pattern, background, with studio lighting. Warped wide angle lens effect, centered image. Central focus. 333. film noir cinematic shot. Wide angle camera lens.`",
        nextStep: 'quickeffect',
        unlockedCommands: ['/make'],
        checkpoints: {
            COMMAND_USED: true,
            BOT_RESULT_SENT: true
        }
    },
    'quickeffect': {
        command: '/quickeffect',
        introduction: async (triggers) => {
            const intro = "Now here's something cool - did you know your first image was actually using a special PS2 style? 🎮\n\n" +
            "We use what's called a LoRA (don't worry about the technical stuff) to create specific styles. " +
            "Let's try some different styles on your first image!\n\n" +
            "Reply to your first image with one of these commands:\n\n" +
            triggers.map(t => `• \`/quickeffect ${t}\``).join('\n') + "\n\n" +
            "Just reply to the image with any of those commands! 👆"
            console.log("[QuickEffect] Generated introduction:", intro);
            return intro;
        },
        nextStep: 'effect',
        unlockedCommands: ['/quickeffect'],
        checkpoints: {
            COMMAND_USED: true,
            BOT_RESULT_SENT: true
        }
    },
    'effect': {
        command: '/effect',
        introduction:
            "Great! Now you know how to use img2img generation with quickeffect.\n\n" +
            "Try using `/effect` on the same image instead! This command gives you a higher quality generation.\n\n" +
            "Just reply to the same image with the same prompt but using `/effect` instead and see the difference! 🎨",
        nextStep: 'signin',
        unlockedCommands: ['/effect'],
        checkpoints: {
            COMMAND_USED: true,
            //BOT_REPLY_SENT: true
        }
    },
    'signin': {
        command: '/signin',
        introduction: 
            "By the way, let's talk about points! 🎯\n\n" +
            "You currently start with 370 points, however if you own MS2 you may connect a wallet and be credited with more points to work with, as well as unlocking more features of the bot (me).\n\n" +
            "It's okay if you don't have any MS2 yet, let's do this! 🎁\n\n" +
            "If you connect your wallet, I'll give you 1000 points! ⚡️ Then we can continue on to cool things\n" +
            "Ready to get those bonus points\\? Try: /signin\n" +
            "It will ask for your wallet address, you send that to the chat\n" +
            "Then you will need to go to the project site verify page and sign a message (not a transaction) with the same wallet you provided" + 
            "It will give you a hash, once you send that back here to me, I give you your points 😼",
        nextStep: 'points_info_assist',
        unlockedCommands: ['/signin'],
        checkpoints: {
            WALLET_CONNECTED: true
        }
    },
    'points_info_assist': {
        command: '/assist',
        introduction: 
            "Great! You've got your bonus points. 🎉\n\n" +
            "Let me explain how points work! ⚡️\n\n" +
            "You have two types of points:\n" +
            "1. *Charge* ⚡️ - These are one-time use bonus points\n" +
            "2. *Points* 🎯 - These are based on your MS2 token holdings\n\n" +
            "Every generation costs points, but don't worry! Your points automatically replenish. " +
            "Every 15 minutes, you get back 1/18th of your total points balance, meaning a full recharge every 4\.5 hours!\n\n" +
            "Now, let me show you something really cool that will help you create better images. " +
            "Type this command:\n" +
            "`/assist girl sitting alone at the club`",
        nextStep: 'loras',
        unlockedCommands: ['/assist'],
        checkpoints: {
            COMMAND_USED: true,
            BOT_ASSIST_SENT: true
        }
    },
    'loras': {
        command: '/loras',
        introduction:
            "The `/assist` command is your creative companion! 🎨\n\n" +
            "I'll help expand your simple prompts into detailed descriptions that create better images. " +
            "Try using the expanded prompt with `/make` or `/quickmake`!\n\n" +
            "Now, let me show you something really powerful - custom AI models we call LoRAs. " +
            "These help create specific styles or subjects that normal AI might struggle with.\n\n" +
            "Type `/loras` to see our collection!",
        nextStep: 'loras_menu',
        unlockedCommands: ['/loras'],
        checkpoints: {
            COMMAND_USED: true,
            BOT_REPLY_SENT: true
        }
        
    },
    'loras_menu': {
        command: null,
        introduction:
            "Welcome to our LoRA collection! 🎨\n\n" +
            "These are mini custom models that help create specific styles or subjects. " +
            "The best part? You can even train your own!\n\n" +
            "Click the *Popular* button to explore some of our most popular styles. 👆",
        nextStep: 'loras_style',
        unlockedCommands: ['/loras'],
        checkpoints: {
            BUTTON_CLICKED: true
        }
    },
    'loras_style': {
        command: null,
        introduction:
            "These are some of our style LoRAs! Each one gives images a unique artistic touch.\n\n" +
            "Try combining your previous prompt with one of these styles. " +
            "The 🔥 styles are popular with our users",
        nextStep: null,
        unlockedCommands: []
    },
    
};

const CHECKPOINTS = {
    COMMAND_USED: 'COMMAND_USED',
    BUTTON_CLICKED: 'BUTTON_CLICKED',
    GENERATION_COMPLETE: 'GENERATION_COMPLETE',
    WALLET_CONNECTED: 'WALLET_CONNECTED',
    IMAGE_RECEIVED: 'IMAGE_RECEIVED',
    EFFECT_APPLIED: 'EFFECT_APPLIED',
    BOT_REPLY_SENT: 'BOT_REPLY_SENT',
    BOT_RESULT_SENT: 'BOT_RESULT_SENT',
    BOT_ASSIST_SENT: 'BOT_ASSIST_SENT'
};

class TutorialManager {
    static async initializeProgress(userId) {
        console.log('Initializing progress for user:', userId);
        if (!lobby[userId].progress) {
            const firstStep = 'quickmake';
            const randomTriggers = await getRandomSDXLTriggers(3);
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
        ? await tutorialSteps[nextStepId].introduction(lobby[userId].progress.randomTriggers)
        : tutorialSteps[nextStepId].introduction;
        const cleanIntroduction = escapeMarkdown(introduction);
        // Send the introduction for the next step
        await sendMessage(message, cleanIntroduction, {parse_mode: 'MarkdownV2'});

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
        
        await sendMessage(message, escapeMarkdown(tutorialSteps['quickmake'].introduction), {parse_mode: 'MarkdownV2'});
    }
};

async function getMatchingTriggerPairs() {
    console.log('Getting matching trigger pairs...');
    
    const { triggers } = await refreshLoraCache(new Loras());
    
    const sdxlTriggers = new Set(
        Array.from(triggers.entries())
            .filter(([_, data]) => data.some(d => d.version === 'SDXL'))
            .map(([word, _]) => word.toLowerCase())
    );
    console.log('SDXL triggers found:', sdxlTriggers.size);

    const fluxTriggers = new Set(
        Array.from(triggers.entries())
            .filter(([_, data]) => data.some(d => d.version === 'FLUX'))
            .map(([word, _]) => word.toLowerCase())
    );
    console.log('FLUX triggers found:', fluxTriggers.size);

    const matchingTriggers = [...sdxlTriggers].filter(trigger => fluxTriggers.has(trigger));
    console.log('Matching triggers found:', matchingTriggers.length);

    const pairs = matchingTriggers.map(trigger => ({
        sdxl: Array.from(triggers.entries()).find(([word, data]) => 
            word.toLowerCase() === trigger && data.some(d => d.version === 'SDXL')
        ),
        flux: Array.from(triggers.entries()).find(([word, data]) => 
            word.toLowerCase() === trigger && data.some(d => d.version === 'FLUX')
        )
    }));
    console.log('Final pairs:', pairs.length);
    return pairs;
}

async function getRandomSDXLTriggers(count = 3) {
    console.log('Getting random SDXL triggers...');
    const pairs = await getMatchingTriggerPairs();
    console.log('Got pairs:', pairs.length);
    const shuffled = shuffle([...pairs]);
    const selected = shuffled.slice(0, count);
    const triggers = selected.map(pair => pair.sdxl[0]); // Using [0] to get the trigger word
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