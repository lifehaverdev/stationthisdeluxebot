const fs = require('fs');
const path = require('path');
const defaultUserData = require('./defaultUserData')

async function generateMasterKey() {
    const chatsDir = path.join(__dirname, '../chats');
    const masterKey = {};

    // Read the chats directory
    try {
        const files = fs.readdirSync(chatsDir);

        // Loop through each file in the chats directory
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(chatsDir, file);
                const fileData = fs.readFileSync(filePath, 'utf-8');
                const jsonData = JSON.parse(fileData);

                // Check if walletAddress exists in the JSON data
                if (jsonData.wallet) {
                    const walletAddress = jsonData.wallet.toLowerCase(); // Assuming wallet addresses should be case-insensitive

                    // Check if walletAddress already exists in masterKey
                    if (!masterKey[walletAddress]) {
                        // Extract chatId from the filename (without the .json extension)
                        const chatId = file.replace('.json', '');
                        masterKey[walletAddress] = chatId;
                    } else {
                        console.error(`Duplicate wallet address found: ${walletAddress}. Deleting files...`);
                        
                        // Delete the duplicate files
                        fs.unlinkSync(filePath);
                        
                        const existingFilePath = path.join(chatsDir, `${masterKey[walletAddress]}.json`);
                        fs.unlinkSync(existingFilePath);
                        
                        // Remove the wallet from masterKey to ensure it's not added
                        delete masterKey[walletAddress];
                    }
                } else {
                    console.error(`Missing wallet in ${file}. Deleting file...`);
                    fs.unlinkSync(filePath);
                }
            }
        }

        // Write masterKey to a new file
        fs.writeFileSync(path.join(__dirname, '../chats/masterKey.json'), JSON.stringify(masterKey, null, 2));

        console.log('masterKey generated successfully!');
    } catch (error) {
        console.error('Error generating masterKey:', error);
    }
}

function resetAccountsToDefault() {
    const chatsFolderPath = path.join(__dirname, '../chats');

    // Check if the chats folder exists
    if (!fs.existsSync(chatsFolderPath)) {
        console.error('Chats folder does not exist.');
        return;
    }

    // Get a list of all files in the chats folder
    const chatFiles = fs.readdirSync(chatsFolderPath);

    // Loop through each file and reset account data to default values
    chatFiles.forEach(file => {
        const filePath = path.join(chatsFolderPath, file);

        try {
            // Read file content
            const rawData = fs.readFileSync(filePath, 'utf8');
            let userData = JSON.parse(rawData);

            // Reset account data to default values
            userData = { ...defaultUserData,
            wallet: userData.wallet
            };

            // Write updated data back to the file
            fs.writeFileSync(filePath, JSON.stringify(userData, null, 2), 'utf8');
            
            console.log(`Reset account data in ${file} to default values.`);
        } catch (error) {
            console.error(`Error resetting account data in ${file}:`, error);
        }
    });

    console.log('All accounts have been reset to default values.');
}

module.exports = {
    generateMasterKey,
    resetAccountsToDefault

}
