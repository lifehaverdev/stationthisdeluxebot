const { UserCore, UserEconomy, UserPref } = require('../index');

const userCore = new UserCore();
const userEconomy = new UserEconomy();
const userPref = new UserPref();

async function fetchUserCore(userId) {
    try {
        return await userCore.findOne({ userId });
    } catch (error) {
        console.error('Error fetching user core:', error);
        return null;
    }
}

async function fetchFullUserData(userId) {
    try {
        // Fetch all data in parallel
        const [coreData, economyData, prefData] = await Promise.all([
            userCore.findOne({ userId }),
            userEconomy.findOne({ userId }),
            userPref.findOne({ userId })
        ]);
        // Log the data retrieved from each collection
        console.log('=== Fetched User Data ===');
        console.log(`User ID: ${userId}`);
        console.log('Core Data:', coreData ? {
            username: coreData.username,
            verified: coreData.verified,
            //joined: new Date(coreData.joined).toISOString(),
            state: coreData.state
        } : 'Not found');
        console.log('Economy Data:', economyData ? {
            balance: economyData.balance,
            points: economyData.points,
            exp: economyData.exp,
            doints: economyData.doints
        } : 'Not found');
        console.log('Preferences:', prefData );
        console.log('=====================');
        // Combine the data
        return {
            ...coreData,
            ...economyData,
            ...prefData,
            lastTouch: Date.now()
        };
    } catch (error) {
        console.error('Error fetching full user data:', error);
        return null;
    }
}

module.exports = {
    fetchUserCore,
    fetchFullUserData
};