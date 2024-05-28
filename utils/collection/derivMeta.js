const basePath = process.cwd();
const https = require('https');
const { addMetadataToCollection } = require('../../db/mongodb');


// async function getMeta(number) {
//     try {
//         await fetchMeta(number);
//         await sleep(700);
//         const data = await fs.promises.readFile(`${config.metaFilePath}${number}.json`, 'utf8');
//         return JSON.parse(data).attributes;
//     } catch (err) {
//         console.error(`Error in getMeta: ${err.message}`);
//         throw err;
//     }
// };

const fetchMeta = async (collectionId, number) => {
    let metaIPFS;
    let urlAppend;
    let link
    let baseURI = collectionId.uri;
    if(baseURI[0] == "i"){
        baseURI = baseURI.slice(7)
        metaIPFS= `https://mony.mypinata.cloud/ipfs/${baseURI}`,
        urlAppend= '?pinataGatewayToken=uyN3_jcO6fLxjvmAV82o6PezM48bw7BlDk3ij1hpSOG5FSVgODrv-eIz_1OEkvAw'
        link  = `${metaIPFS}${number}.json/${urlAppend}`
    } else if (baseURI[0] == "h"){
        link = `${baseURI}${number}`;
    }
    
    //const link = `${baseURI}/${number}.json${config.urlAppend}`;
    console.log('Fetching metadata from:', link);
    try {
        const message = await copyMetaToCollection(collectionId.collectionName,link);
        console.log(message);
        return message;
    } catch (err) {
        console.error(`Error in fetchMeta: ${err.message}`);
    }
};

async function copyMetaToCollection(collectionName, url) {
    console.log('Fetching metadata from:', url);
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => data += chunk);
            response.on('end', () => {
                console.log('we got a response')
                try {
                    const jsonData = JSON.parse(data);
                    console.log('here is the json',jsonData)
                    addMetadataToCollection(collectionName, jsonData)
                        .then(() => resolve(jsonData.image))
                        .catch(error => reject(`Error adding metadata to collection: ${error.message}`));
                } catch (error) {
                    reject(`Error parsing JSON: ${error.message}`);
                }
            });
        }).on('error', (error) => {
            reject(`Error making HTTP request: ${error.message}`);
        });
    });
}

exports.fetchMeta = fetchMeta;
