const archiver = require('archiver');
const path = require('path');
const fs = require('fs');

async function createCollectionZip(collectionPath, outputZipPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputZipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        output.on('close', () => {
            console.log(`Archive created: ${archive.pointer()} total bytes`);
            resolve(outputZipPath);
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        // Add the files from the collection directory
        archive.directory(collectionPath, false);

        archive.finalize();
    });
}

module.exports = { createCollectionZip };