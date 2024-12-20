require('dotenv').config();
const UserStats = require('../models/userStats');
const fs = require('fs/promises');
const path = require('path');

async function downloadAllGens() {
    try {
        console.log('Initializing UserStats...');
        const userStats = new UserStats();

        console.log('Fetching all generations...');
        // Using the findMany method inherited from BaseDB with no filter to get all records
        const allGens = await userStats.findMany();

        console.log(`Found ${allGens.length} generations`);

        // Create a timestamp for the filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join(__dirname, '..', 'data', `generations_${timestamp}.json`);

        // Ensure the data directory exists
        await fs.mkdir(path.join(__dirname, '..', 'data'), { recursive: true });

        // Write to file with pretty formatting
        await fs.writeFile(
            outputPath,
            JSON.stringify(allGens, null, 2)
        );

        console.log(`Successfully saved generations to: ${outputPath}`);
        
        // Return the data in case you want to work with it directly
        return allGens;
    } catch (error) {
        console.error('Error downloading generations:', error);
        throw error;
    }
}

// Run the script if called directly
if (require.main === module) {
    downloadAllGens()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { downloadAllGens };