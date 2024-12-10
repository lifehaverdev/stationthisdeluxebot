const { STATES } = require('../../bot')
const {setUserState} = require('../../../utils')

class StudioAction {
    constructor(studio) {
        this.studio = studio;
    }

    setPendingAction(userId, action, collectionId, additionalData = {}) {
        if (!this.studio[userId]) {
            this.studio[userId] = {};
        }

        this.studio[userId].pendingAction = {
            action,
            collectionId,
            ...additionalData
        };
    }

    getPendingAction(userId) {
        return this.studio[userId]?.pendingAction;
    }

    clearPendingAction(userId) {
        if (this.studio[userId]) {
            delete this.studio[userId].pendingAction;
        }
    }

    // Helper method to create standard edit message configuration
    createEditMessageConfig(message, text, options = {}) {
        return {
            chat_id: message.chat.id,
            message_id: message.message_id,
            text,
            ...options
        };
    }

    // Common action setup pattern
    async setupAction(message, user, collectionId, action, text, additionalData = {}) {
        this.setPendingAction(user, action, collectionId, additionalData);
        // Helper method to set user state
        setUserState({message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION)
        return this.createEditMessageConfig(message, text);
    }
}

module.exports = { StudioAction };
