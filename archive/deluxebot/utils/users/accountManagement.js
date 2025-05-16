const { updateAllUserSettings } = require('../../db/mongodb');

async function updateUserData() {
    await updateAllUserSettings();
}

updateUserData()
