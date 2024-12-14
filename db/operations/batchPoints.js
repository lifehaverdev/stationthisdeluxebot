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

        // Start a batch operation
        const batch = userEconomy.startBatch();

        for (const user of users) {
            const oldPoints = user.points || 0;
            const oldDoints = user.doints || 0;
            const oldBoints = user.boints || 0;
            const oldExp = user.exp || 0;
            
            // Log the before state
            console.log(`User ${user.userId} before: points=${oldPoints}, doints=${oldDoints}, boints=${oldBoints}, exp=${oldExp}`);

            // Calculate new values
            const totalPoints = oldPoints + oldBoints;
            const totalDoints = oldPoints + oldDoints;
            const newDoints = totalDoints;
            const newPoints = 0;
            const newBoints = 0;
            const newExp = oldExp + totalPoints; // Add total points to exp

            // Add to batch operation with safety checks
            if (totalPoints > 0) {
                batch.updateOne(
                    { userId: user.userId },
                    { 
                        points: newPoints,
                        doints: newDoints,
                        boints: newBoints,
                        exp: newExp,
                        lastPointsUpdate: new Date()
                    }
                );
                
                // Log the after state
                console.log(`User ${user.userId} after: points=${newPoints}, doints=${newDoints}, boints=${newBoints}, exp=${newExp}`);
            }
        }

        // Execute the batch operation
        const result = await batch.executeBatch();
        console.log("========== Completed addPointsToAllUsers ==========");
        console.log(`Updated ${result.modifiedCount} users`);
        
        return result.modifiedCount > 0;

    } catch (error) {
        console.error("Error in addPointsToAllUsers:", error);
        throw error;
    }
}

module.exports = {
    addPointsToAllUsers
};