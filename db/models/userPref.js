const {BaseDB} = require('./BaseDB');
const defaultUserData = require('../../utils/users/defaultUserData')

class UserPrefDB extends BaseDB {
    constructor() {
        super('users_preferences');
    }

    // Data massager - extracts only pref-relevant fields
    massageData(user) {
        return {
            userId: user.userId,
            advancedUser: user.advancedUser || false,
            input_seed: user.input_seed || '',
            lastSeed: user.lastSeed || '',
            prompt: user.prompt || '',
            userPrompt: user.userPrompt || '',
            input_batch: user.input_batch || 1,
            input_steps: user.input_steps || 30,
            input_cfg: user.input_cfg || 7,
            input_strength: user.input_strength || 0.6,
            input_height: user.input_height || 1024,
            input_width: user.input_width || 1024,
            basePrompt: user.basePrompt || "MS2",
            input_negative: user.input_negative || '-1',
            input_checkpoint: user.input_checkpoint || "zavychromaxl_v60",
            input_image: user.input_image || '',
            lastImage: user.lastImage || '',
            tempSize: user.tempSize || 1024,
            inpaintTarget: user.inpaintTarget || '',
            lastPointsUpdate: user.lastPointsUpdate || '',
            advancedUser: user.advancedUser || false,
            waterMark: user.waterMark || 'mslogo',
            createSwitch: user.createSwitch || 'SDXL',
            voiceModel: user.voiceModel || "165UvtZp7kKnmrVrVQwx",
            favorites: user.favorites || defaultUserData.favorites,
            runs: user.runs || [],
            commandList: user.commandList || defaultUserData.commandList,
            
            // Additional flags from iMenu
            controlNet: user.controlNet || false,
            forceLogo: user.forceLogo || false,
            styleTransfer: user.styleTransfer || false,
            openPose: user.openPose || false,
            autoPrompt: user.autoPrompt || false,
            input_control_image: user.input_control_image || '',
            input_style_image: user.input_style_image || '',
            input_pose_image: user.input_pose_image || '',
            customFileNames: user.customFileNames || false,
            state: user.state || defaultUserData.state,
            type: user.type || ''
        };
    }

    async writeUserData(userId, data) {
        const prefData = this.massageData(data);
        const result = await this.updateOne(
            { userId },
            prefData,
        );
        console.log('pref writeUserData result:', result);
        return result;
    }

    writeUserDataPoint(userId, field, value, batch = false) {  // Remove async
        if (batch) {
            this.updateOne(
                { userId },
                { [field]: value },
                {},
                true  // batch mode
            );
            console.log('writeUserDataPoint batch mode:', batch);
            console.log('writeUserDataPoint returning: this');
            return this;
        }
    
        // Non-batch mode
        return this.updateOne(
            { userId },
            { [field]: value },
            {},
            false
        );
    }

    // For new users - creates initial document
    async writeNewUserData(userId, data) {
        const prefData = this.massageData(data);
        return this.updateOne(
            { userId },
            prefData,
            { upsert: true }  // Only use upsert here for new users
        );
    }
}

module.exports = UserPrefDB;