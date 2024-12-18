const { UserEconomy } = require('../index');
const userEconomy = new UserEconomy();

async function addPointsToAllUsers(lobby) {
    console.log("========== Starting addPointsToAllUsers ==========");
    
    try {
        // Get all users from lobby who have any type of points
        const users = Object.values(lobby).filter(user => 
            (user.points && user.points > 0) || 
            (user.doints && user.doints > 0) || 
            (user.boints && user.boints > 0)
        );

        console.log(`Found ${users.length} users in lobby with points/doints/boints`);

        let modifiedCount = 0;

        // Process users in smaller batches to avoid overwhelming the database
        const BATCH_SIZE = 10;
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const userBatch = users.slice(i, i + BATCH_SIZE);
            const batch = userEconomy.startBatch();

            for (const user of userBatch) {
                if (!user.userId) continue; // Skip invalid users

                const oldPoints = user.points || 0;
                const oldDoints = user.doints || 0;
                const oldBoints = user.boints || 0;
                const oldExp = user.exp || 0;
                
                console.log(`User ${user.userId} before: points=${oldPoints}, doints=${oldDoints}, boints=${oldBoints}, exp=${oldExp}`);

                // Only process if there are actually points to update
                if (oldPoints > 0 || oldBoints > 0) {
                    const totalPoints = oldPoints + oldBoints;
                    const newDoints = oldDoints + oldPoints;
                    const newExp = oldExp + totalPoints;

                    batch.updateOne(
                        { userId: user.userId },
                        { 
                            points: 0,
                            doints: newDoints,
                            boints: 0,
                            exp: newExp,
                            lastPointsUpdate: new Date()
                        }
                    );
                    
                    // Update the lobby data as well
                    if (lobby[user.userId]) {
                        lobby[user.userId].points = 0;
                        lobby[user.userId].doints = newDoints;
                        lobby[user.userId].boints = 0;
                        lobby[user.userId].exp = newExp;
                    }

                    modifiedCount++;
                    console.log(`User ${user.userId} after: points=0, doints=${newDoints}, boints=0, exp=${newExp}`);
                }
            }

            // Execute batch and wait for result
            await batch.executeBatch();
        }

        console.log("========== Completed addPointsToAllUsers ==========");
        console.log(`Updated ${modifiedCount} users`);
        
        return modifiedCount > 0;

    } catch (error) {
        console.error("Error in addPointsToAllUsers:", error);
        throw error;
    }
}

module.exports = {
    addPointsToAllUsers
};