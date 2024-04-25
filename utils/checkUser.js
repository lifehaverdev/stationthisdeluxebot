const fs = require('fs');
const path = require ('path');
const defaultUserData = require('./defaultUserData');

function getUserData(chatId) {

    const chatsFolderPath = path.join(__dirname, '../chats');

    // Check if JSON file exists for this chat ID
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    
    if (!fs.existsSync(chatsFolderPath)) {
        fs.mkdirSync(chatsFolderPath);
    }

    
    let userData;

    if (!fs.existsSync(chatFilePath)) {
        fs.writeFileSync(chatFilePath,JSON.stringify({...defaultUserData}),'utf-8');
    }

    try {
        const data = fs.readFileSync(chatFilePath, 'utf8');
        userData = JSON.parse(data);
        userData = mergeWithDefault(userData, defaultUserData)
        fs.writeFileSync(chatFilePath, JSON.stringify(userData, null, 2), 'utf-8');
    } catch (error) {
        console.error("Error reading user data:", error);
        throw error;
    }

    return userData;

}

function writeUserData(chatId, data) {
    const chatsFolderPath = path.join(__dirname, '../chats');
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    
    try {
        fs.writeFileSync(chatFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error writing chat data:", error);
    }
}

function mergeWithDefault(userData, defaultUserData) {
    // Create a new object with defaultUserData properties
    let mergedData = { ...defaultUserData };

    // Loop through userData properties and override default values
    for (let key in userData) {
        if (userData.hasOwnProperty(key)) {
            mergedData[key] = userData[key];
        }
    }

    return mergedData;
}

module.exports = {
    getUserData,
    writeUserData
}