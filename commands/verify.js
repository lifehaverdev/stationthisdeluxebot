//const crypto = require('crypto');
const bs58 = require('bs58')
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { SHA256 } = require('crypto-js');

// Function to generate hash based on the wallet address and timestamp
function generateHash(walletAddress, timestamp, salt) {
    
    const data = `${walletAddress}${Math.floor(timestamp)}${salt}`;
    //console.log(data);
    // const bs = bs58.decode(walletAddress);
    
    // const buff = Buffer.from(bs,'utf8');
    
    //const hash = createHash('sha256').update(data).digest('hex');
    const hash = SHA256(data).toString();
    
    return hash;
}

// Function to verify the hash
function verifyHash(walletAddress, timestamp, salt, receivedHash) {
    console.log(receivedHash, typeof receivedHash);
    const expectedHash = generateHash(walletAddress, timestamp, salt);
    console.log(expectedHash, typeof expectedHash);
    console.log(expectedHash == receivedHash)
    return expectedHash == receivedHash;
}

module.exports = { verifyHash }