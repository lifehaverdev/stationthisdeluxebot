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