const { UserCore, UserEconomy, UserPref } = require('../index');
const {defaultUserData} = require('../../bot/core/users/defaultUserData.js');

const userCore = new UserCore();
const userEconomy = new UserEconomy();
const userPref = new UserPref();

async function initializeNewUser(userId, initialData = {}) {
    console.log('Initializing new user data');
    
    // Merge default data with any provided initial data
    const userData = {
        ...defaultUserData,
        userId,
        ...initialData,
        createdAt: new Date()
    };

    try {
        console.log('writing userCore');
        await userCore.writeNewUserData(userId, userData);
        
        console.log('writing userPref');
        await userPref.writeNewUserData(userId, userData);
        
        console.log('writing userEconomy');
        await userEconomy.writeNewUserData(userId, userData);
        
        console.log('NEW USER INITIALIZATION COMPLETE');
        
        return userData;
    } catch (error) {
        console.error('Error in initializeNewUser:', error);
        throw error;
    }
}

// Export both the function and a reference to writeNewUserDataMacro for compatibility
module.exports = {
    initializeNewUser,
    writeNewUserDataMacro: initializeNewUser  // Alias for backward compatibility
};
