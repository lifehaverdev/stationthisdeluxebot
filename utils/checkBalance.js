const path = require ('path')
const sdk = require('api')('@alchemy-docs/v1.0#1qz7y1elt7gubvr');
const blessings = require('./fortune');
const curses = require('./fortune');
const fs = require('fs');

//token shit
async function getBalance(address) {
    //console.log('checking balalnce')
    let balance = 0;
    
    await sdk.getTokenAccountBalance({
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        "params": [
          address,
          {
              "mint": "AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg"
          },
          {
              "encoding": "jsonParsed"
          }
      ]
      }, {apiKey: process.env.ALCHEMY_SECRET})
    .then(({ data }) => {
        //console.log(data.result.value[0].account.data.parsed.info.tokenAmount.uiAmount)
        balance = data.result.value[0].account.data.parsed.info.tokenAmount.uiAmount
    })
    .catch(err => console.error(err));
    //console.log('balance ',balance)
    return balance
}

function getUserWalletAddress(chatId) {
    // Check if chat folder exists
    const chatsFolderPath = path.join(__dirname, '../chats');

    // Check if JSON file exists for this chat ID
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    //console.log(chatFilePath)
    
    if (!fs.existsSync(chatFilePath)) {
        return null; // JSON file doesn't exist, user needs to sign in
    }

    // Read JSON file and get wallet address
    const rawData = fs.readFileSync(chatFilePath);
    const chatData = JSON.parse(rawData);
    console.log(chatData.wallet);
    return chatData.wallet || null; // Return wallet address or null if not found

}

//token shit
async function getBalance(address) {
    //console.log('checking balalnce')
    let balance = null;
    await sdk.getTokenAccountBalance({
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        "params": [
          address,
          {
              "mint": "AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg"
          },
          {
              "encoding": "jsonParsed"
          }
      ]
      }, {apiKey: process.env.ALCHEMY_SECRET})
    .then(({ data }) => {
        //
        //console.log('data in checkbalance response',data)
        if(data.error || (data.result.value && data.result.value.length == 0)){
            balance = 0;
        } else if (data.result.value.length > 0){
            balance = data.result.value[0].account.data.parsed.info.tokenAmount.uiAmount
        } else {
            balance = 0
        }
    })
    .catch(err => console.error(err));
    if(blessings.hasOwnProperty(address)){
        if(balance == 0){
            balance = blessings[address];
        } else {
            balance += blessings[address];
        }
    }
    return balance
}

module.exports = {
    getBalance,
    getUserWalletAddress
}