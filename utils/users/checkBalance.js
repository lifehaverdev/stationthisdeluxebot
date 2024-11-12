const sdk = require('api')('@alchemy-docs/v1.0#1qz7y1elt7gubvr');
const sdk2 = require('api')('@alchemy-docs/v1.0#eyr736lt7gueji');
const { burns } = require('../bot/bot');

const blessings = {
    //FU STUDIOS PROMO
    //"2bBaEQ2BhbYR5YwFYrVgaawn8DxUEfGTE2Mo6oW1yvjm": 1000000,
    //"B2VNytRnn1ZUvEtefJZn5iMD8Ez7sSfuxC27EH1odJW": 1000000,
    //"2BejAjjLer46EMsdYw3VYcL5CGPUSprpeBbp8XUHxESJ": 1000000,
    //"GDSa1MaSTYKbNwcvJqhhgUEx97UsCTNKVPDKVE6ASzT8": 1000000,
    //"85vHqjTYuWjpURT1vLkQPXBourkzAF6SjTohbxhwAZgs": 1000000,
    //egmund
    //"qDYNYPYcMiBy4R5yvjrpQvpdkBQuB8q3aehmSr7EoBt": 1000000,
    //42069
    //"J8w8wRLewHwjAmckHEgncC6GpBkc1EdeLUaoV35bN73w": 1000000,
    //"4PygoXdiNArUNWbpTLF6rUKgmaMqD8FW4hJAZcZJksW9": 1000000,
    //"7UZkrsrgijtqs4ihNdrYxK3SvyC4Ju3RhacAEb8ibskD": 1000000,
    //aefek
    "4rrJak8BHdMKbQU387jWrf8QLhnCtZcwn1oTKURYTZRk": 1000000,
    //anon
    //"5ycSW3RiSWv87a4diRNRLR1Wk5Ygig4XENMyVeNi4xxk": 1000000,
    //veil
    //"6sHPndv6XLhCwjPW5kbejwAaeWAWi9DhCWfvGvmWUUzu": 1000000,
    //"egmund"
    //"36NQZbu7KzFKj3YTjfWEDFaaZqNodEc4QywA8yAagjwB": 1000000,
    //xdrar
    //"9D2UVKHKmaCNwizw6iPS3NmideY2Qvq7A2jvLvVGfyVZ": 5000000,
    //wifeystation
    //"BiFSjP1uDi9D9euchgYzwJGmYbfomBexXDzN6iJNC5Gv": 10000000,
    //tom
    //"UrTz5ydH7gg2XpJoG6CNRuForc5PSHH14mtd4hhW9a2": 5000000
}

const curses = {
    'Edsmy5Nqr3bCy8XcU33nsKtADkq22evY4P1XccS5jxYP': 2000000,
    //"EcQG1GUxNNk7BFQ6Fgq8nz3JbBQg82TtPDnPSj3izVfb": 10000000,
}

//token shit
async function getBalance(address, ca = "AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg") {
    console.log('checking balalnce',ca)
    const isMS2 = ca == "AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg" ? true : false
    let balance = null;
    await sdk.getTokenAccountBalance({
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        "params": [
          address,
          {
              "mint": ca
          },
          {
              "encoding": "jsonParsed"
          }
      ]
      }, {apiKey: process.env.ALCHEMY_SECRET})
    .then(({ data }) => {
        //
        console.log('data in checkbalance response',JSON.stringify(data))//.result.value[0].account.data.parsed.info.tokenAmount.uiAmount)
        if(data.error || (data.result.value && data.result.value.length == 0)){
            balance = 0;
        } else if (data.result.value.length > 0){
            balance = data.result.value[0].account.data.parsed.info.tokenAmount.uiAmount
        } else {
            balance = 0
        }
    })
    .catch(err => console.error(err));
    if(isMS2 && blessings.hasOwnProperty(address)){
        console.log('we have this blessed',address)
        console.log('this is current balance',balance)
        if(balance == 0 || balance == NaN){
            balance = blessings[address]
        } else {
            balance += blessings[address]
        }
    }
    if(isMS2 && curses.hasOwnProperty(address)){
        console.log('we have this blessed',address)
        console.log('this is current balance',balance)
        if(balance == 0 || balance == NaN){
            balance = 0
        } else {
            balance -= curses[address];
        }
    }

    const burnRecord = burns.find(burn => burn.wallet === address);
    if (isMS2 && burnRecord) {
        //console.log(burnRecord.burned)
        balance += parseInt(burnRecord.burned) * 2 / 1000000;
    }

    return balance
}
const getNFTBalance = async (ownerAddress, mintAddress) => {
    const url = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`;
    let page = 1;
    let allAssets = [];
    let hasMore = true;

    while (hasMore) {
        try {
            console.log('Checking page:', page);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'my-id',
                    method: 'getAssetsByOwner',
                    params: {
                        ownerAddress,
                        page,
                        limit: 1000,
                    },
                }),
            });

            const { result } = await response.json();

            if (result && result.items.length > 0) {
                allAssets = allAssets.concat(result.items);
                page++;
            } else {
                hasMore = false;
            }

        } catch (err) {
            console.error('Error fetching assets:', err);
            hasMore = false;
        }
    }

    // Print a sample of the assets to inspect their structure
    if (allAssets.length > 0) {
        // console.log('Sample of assets owned by the address:');
        // console.log(JSON.stringify(allAssets.slice(0, 5), null, 2));
    } else {
        console.log('No assets found for the given owner address.');
    }

    // Now let's try filtering by the provided mint address or collection address
    const filteredAssets = allAssets.filter(asset => {
        // Check if the asset `id` matches the `mintAddress`
        if (asset.id === mintAddress) {
            return true;
        }

        // Check if the asset belongs to a specific collection using the grouping field
        if (asset.grouping && Array.isArray(asset.grouping)) {
            return asset.grouping.some(group => group.group_key === 'collection' && group.group_value === mintAddress);
        }

        return false;
    });

    // Get the count of filtered NFTs
    const nftCount = filteredAssets.length;

    console.log(`Number of NFTs owned by ${ownerAddress} for mint ${mintAddress}:`, nftCount);
    return nftCount;
};

// Example Usage
// const ownerAddress = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
// const mintAddress = 'BUjZjAS2vbbb65g7Z1Ca9ZRVYoJscURG5L3AkVvHP9ac';
// getNFTBalance(ownerAddress, mintAddress);

  
function checkBlacklist(wallet) {
    const blacklist = [
        "FtSobG6Bw36QnZ6gbbvj2ssYC9xnj5L6tKRN7rEfWzwQ",
        "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        "ECzNcuvo6ww28n41JHb84Pd4u8ofuKPkdCVPMp1uiSGU",
        //"EcQG1GUxNNk7BFQ6Fgq8nz3JbBQg82TtPDnPSj3izVfb"
    ]
    if(blacklist.includes(wallet)){
        return true;
    } else {
        return false;
    }
}

module.exports = {
    getBalance, getNFTBalance,
    checkBlacklist
}