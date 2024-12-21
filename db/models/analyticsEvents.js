const { BaseDB } = require('./BaseDB');
const { PRIORITY } = require('../utils/queue');
const { lobby, waiting, taskQueue } = require('../../utils/bot/bot')

const EVENT_TYPES = {
    GENERATION: 'generation',
    COMMAND: 'command',
    MENU: 'menu_interaction',
    QUEUE: 'queue_event',
    DELIVERY: 'delivery_event',
    ERROR: 'error_event',
    USER_STATE: 'user_state',
    GATEKEEPING: 'gatekeeping',
    ASSET_CHECK: 'asset_check',
    ACCOUNT: 'account_action',
    VERIFICATION: 'verification'
};

class AnalyticsEvents extends BaseDB {
    constructor() {
        super('history');
    }

    async trackQueueEvent(task, eventType) {
        const queuePosition = eventType === 'enqueued' 
            ? waiting.length 
            : waiting.findIndex(t => t.run_id === task.run_id);

        const event = {
            type: EVENT_TYPES.QUEUE,
            userId: task.promptObj.userId,
            username: task.promptObj.username,
            timestamp: new Date(),
            data: {
                eventType,
                runId: task.run_id,
                queuePosition: queuePosition >= 0 ? queuePosition : null,
                waitingCount: waiting.length,
                queueCount: taskQueue.length
            },
            groupId: task.message.chat.id < 0 ? task.message.chat.id : null
        };

        return this.updateOne(
            { runId: task.run_id, type: EVENT_TYPES.QUEUE },
            event,
            { upsert: true }
        );
    }

    async trackGeneration(task, run, status) {
        const event = {
            type: EVENT_TYPES.GENERATION,
            userId: task.promptObj.userId,
            username: task.promptObj.username,
            timestamp: new Date(),
            data: {
                genType: task.promptObj.type,
                runId: run?.run_id,
                status,
                queueTime: task.runningStart ? task.runningStart - task.timestamp : null,
                processingTime: task.runningStop ? task.runningStop - task.runningStart : null,
                settings: {
                    strength: task.promptObj.strength,
                    cfg: task.promptObj.cfg,
                    steps: task.promptObj.steps
                }
            },
            groupId: task.message.chat.id < 0 ? task.message.chat.id : null
        };

        return this.updateOne(
            { runId: run?.run_id, type: EVENT_TYPES.GENERATION },
            event,
            { upsert: true }
        );
    }

    async trackCommand(message, command, isCustom = false) {
        const event = {
            type: EVENT_TYPES.COMMAND,
            userId: message.from.id,
            username: message.from.username,
            timestamp: new Date(),
            data: {
                command,
                isCustomCommand: isCustom,
                chatType: message.chat.type,
                messageThreadId: message.message_thread_id || null,
                hasArgs: message.text !== command,
                isReply: !!message.reply_to_message
            },
            groupId: message.chat.id < 0 ? message.chat.id : null
        };

        return this.updateOne(
            { runId: message.message_id, type: EVENT_TYPES.COMMAND },
            event,
            { upsert: true }
        );
    }

    async trackDeliveryEvent(task, success, error = null) {
        const event = {
            type: EVENT_TYPES.DELIVERY,
            userId: task.promptObj.userId,
            username: task.promptObj.username,
            timestamp: new Date(),
            data: {
                success,
                runId: task.run_id,
                error: error ? {
                    message: error.message,
                    code: error.code
                } : null,
                retryCount: task.deliveryFail || 0,
                totalTime: Date.now() - task.timestamp
            },
            groupId: task.message.chat.id < 0 ? task.message.chat.id : null
        };

        return this.updateOne(
            { runId: task.run_id, type: EVENT_TYPES.DELIVERY },
            event,
            { upsert: true }
        );
    }

    async trackError(error, context) {
        const event = {
            type: EVENT_TYPES.ERROR,
            timestamp: new Date(),
            data: {
                error: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                },
                context
            }
        };

        return this.updateOne(
            { timestamp: event.timestamp, type: EVENT_TYPES.ERROR },
            event,
            { upsert: true }
        );
    }

    async trackMenuInteraction(callbackQuery, action, isCustom = false) {
        const event = {
            type: EVENT_TYPES.MENU,
            userId: callbackQuery.from.id,
            username: callbackQuery.from.username,
            timestamp: new Date(),
            data: {
                action,
                isCustomAction: isCustom,
                chatType: callbackQuery.message.chat.type,
                messageThreadId: callbackQuery.message.message_thread_id || null,
                replyToMessage: !!callbackQuery.message.reply_to_message,
                callbackMessageId: callbackQuery.message.message_id
            },
            groupId: callbackQuery.message.chat.id < 0 ? callbackQuery.message.chat.id : null
        };

        return this.updateOne(
            { 
                runId: `${callbackQuery.message.message_id}_${callbackQuery.id}`, 
                type: EVENT_TYPES.MENU 
            },
            event,
            { upsert: true }
        );
    }

    // User State Events
    async trackUserJoin(userId, username, isFirstTime = false) {
        const event = {
            type: EVENT_TYPES.USER_STATE,
            userId,
            username,
            timestamp: new Date(),
            data: {
                eventType: isFirstTime ? 'first_join' : 'check_in',
                kickedAt: lobby[userId]?.kickedAt,
                verified: lobby[userId]?.verified || false
            },
            groupId: null
        };

        return this.updateOne(
            { userId, type: EVENT_TYPES.USER_STATE, timestamp: event.timestamp },
            event,
            { upsert: true }
        );
    }

    async trackUserKick(userId, username, reason = 'inactivity') {
        const event = {
            type: EVENT_TYPES.USER_STATE,
            userId,
            username,
            timestamp: new Date(),
            data: {
                eventType: 'kicked',
                reason,
                lastTouch: lobby[userId]?.lastTouch,
                timeSinceLastTouch: Date.now() - (lobby[userId]?.lastTouch || 0)
            },
            groupId: null
        };

        return this.updateOne(
            { userId, type: EVENT_TYPES.USER_STATE, timestamp: event.timestamp },
            event,
            { upsert: true }
        );
    }

    // Gatekeeping Events
    async trackGatekeeping(message, reason, details = {}) {
        const event = {
            type: EVENT_TYPES.GATEKEEPING,
            userId: message.from.id,
            username: message.from.username,
            timestamp: new Date(),
            data: {
                eventType: reason,
                chatType: message.chat.type,
                ...details
            },
            groupId: message.chat.id < 0 ? message.chat.id : null
        };

        return this.updateOne(
            { 
                userId: message.from.id, 
                type: EVENT_TYPES.GATEKEEPING, 
                timestamp: event.timestamp 
            },
            event,
            { upsert: true }
        );
    }

    // Asset Check Events
    async trackAssetCheck(userId, username, checkType, result, details = {}) {
        const event = {
            type: EVENT_TYPES.ASSET_CHECK,
            userId,
            username,
            timestamp: new Date(),
            data: {
                eventType: checkType,
                result,
                ...details
            },
            groupId: null
        };

        return this.updateOne(
            { userId, type: EVENT_TYPES.ASSET_CHECK, timestamp: event.timestamp },
            event,
            { upsert: true }
        );
    }

    async trackAccountAction(message, action, success, details = {}) {
        const event = {
            type: EVENT_TYPES.ACCOUNT,
            userId: message.from.id,
            username: message.from.username,
            timestamp: new Date(),
            data: {
                action,
                success,
                ...details
            },
            groupId: null
        };

        return this.updateOne(
            { userId: message.from.id, type: EVENT_TYPES.ACCOUNT, timestamp: event.timestamp },
            event,
            { upsert: true }
        );
    }

    async trackVerification(message, success, details = {}) {
        const event = {
            type: EVENT_TYPES.VERIFICATION,
            userId: message.from.id,
            username: message.from.username,
            timestamp: new Date(),
            data: {
                success,
                wallet: lobby[message.from.id]?.wallet,
                ...details
            },
            groupId: null
        };

        return this.updateOne(
            { userId: message.from.id, type: EVENT_TYPES.VERIFICATION, timestamp: event.timestamp },
            event,
            { upsert: true }
        );
    }
}

module.exports = {
    AnalyticsEvents,
    EVENT_TYPES
};