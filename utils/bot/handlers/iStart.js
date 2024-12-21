const { commandRegistry, lobby } = require('../bot')
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
        unlockedCommands: ['/start', '/quickmake']
    },
    'status': {
        command: '/status',
        introduction: 
            "Yep that's pretty much what we do here\\! I am making your image quickly\\.\n\n" +
            "Why don't we check on it with /status command\\?\n" +
            "Go ahead and try it before I beat you to it\\! 👀",
        nextStep: 'make',
        unlockedCommands: ['/status']
    },
    'make': {
        command: '/make',
        introduction:
            "Great\\! Now you know how to check on your generations\\.\n\n" +
            "Let me show you a more advanced command \\- `/make`\n" +
            "This one lets you customize your generations with more options\\!\n\n" +
            "Try: `/make a cyberpunk cat`",
        nextStep: null,
        unlockedCommands: ['/make']
    }
};

class TutorialManager {
    static initializeProgress(userId) {
        if (!lobby[userId].progress) {
            const firstStep = 'quickmake';
            lobby[userId].progress = {
                currentStep: firstStep,
                steps: {
                    [firstStep]: {
                        started: Date.now(),
                        completed: null,
                        attempts: 0
                    }
                },
                unlockedCommands: tutorialSteps[firstStep].unlockedCommands
            };
        }
    }

    static async progressToNextStep(message) {
        const userId = message.from.id;
        const currentStep = lobby[userId].progress.currentStep;
        const stepData = tutorialSteps[currentStep];

        if (!stepData) return;

        const nextStepId = stepData.nextStep;
        if (!nextStepId) return; // Tutorial completed

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

        // Send the introduction for the next step
        await sendMessage(message, tutorialSteps[nextStepId].introduction, {parse_mode: 'MarkdownV2'});
    }

    static isCommandAllowed(userId, command) {
        return lobby[userId]?.progress?.unlockedCommands?.includes(command) || false;
    }

    static getCurrentStep(userId) {
        return lobby[userId]?.progress?.currentStep;
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

module.exports = { 
    tutorialSteps, 
    TutorialManager 
};