const { UserCore, UserEconomy, UserPref } = require('../index');

const userCore = new UserCore();
const userEconomy = new UserEconomy();
const userPref = new UserPref();

async function fetchUserCore(userId) {
    try {
        // Convert userId to integer
        const numericUserId = parseInt(userId, 10);
        
        // Check if conversion was successful (not NaN)
        if (isNaN(numericUserId)) {
            console.error('Invalid userId format:', userId);
            return null;
        }
        
        return await userCore.findOne({ userId: numericUserId });
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