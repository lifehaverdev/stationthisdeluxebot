const { S3, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
//const StudioDB = require('../models/studio');
const axios = require('axios');
require('dotenv').config();
const path = require('path');
const fs = require('fs');

class SpacesUploader {
    constructor() {
        // Initialize S3 client for DO Spaces
        this.s3 = new S3({
            endpoint: `https://${process.env.DO_SPACE_REGION}.digitaloceanspaces.com`,
            credentials: {
                accessKeyId: process.env.DO_ACCESS_KEY,
                secretAccessKey: process.env.DO_SECRET_KEY
            },
            region: process.env.DO_SPACE_REGION
        });
    }

    async cleanupExistingFiles(bucketName, prefix) {
        console.log(`Cleaning up existing files in ${prefix}...`);
        
        try {
            // List all objects in both assets and metadata directories
            const directories = [`${prefix}/assets`, `${prefix}/metadata`];
            let deletedCount = 0;

            for (const dir of directories) {
                let continuationToken = undefined;
                
                do {
                    // List objects in chunks
                    const listCommand = new ListObjectsV2Command({
                        Bucket: bucketName,
                        Prefix: dir,
                        ContinuationToken: continuationToken
                    });

                    const listedObjects = await this.s3.send(listCommand);
                    
                    if (listedObjects.Contents?.length > 0) {
                        // Delete objects in batches of 1000 (S3 limit)
                        const deleteParams = {
                            Bucket: bucketName,
                            Delete: {
                                Objects: listedObjects.Contents.map(({ Key }) => ({ Key }))
                            }
                        };

                        const deleteCommand = new DeleteObjectsCommand(deleteParams);
                        await this.s3.send(deleteCommand);
                        deletedCount += listedObjects.Contents.length;
                        console.log(`Deleted ${deletedCount} files...`);
                    }

                    continuationToken = listedObjects.NextContinuationToken;
                } while (continuationToken);
            }

            console.log(`Cleanup complete. Deleted ${deletedCount} files.`);
            return deletedCount;

        } catch (error) {
            console.error('Cleanup failed:', error);
            throw error;
        }
    }

    async uploadCollection(collectionId, options = {}) {
        const {
            bucketName = process.env.DO_SPACE_NAME,
            prefix = 'cultexecbadges/private',
            startIndex = 1,
            endIndex = null,
            cleanup = true,
            totalSupply = 4440, // Add total supply parameter
            unrevealedImageUrl = 'https://ms2.fun/public/unrevealed.png' // Add unrevealed image URL
        } = options;

        try {
            // Clean up existing files if requested
            if (cleanup) {
                await this.cleanupExistingFiles(bucketName, prefix);
            }

            
            const exportDir = path.join(__dirname, '../../temp', `export_STB OFFICIAL COLLECTION TEST`);

            console.log(`Reading files from ${exportDir}`);
            
            let processed = 0;
            let failed = 0;

            // Create a Set of all piece numbers we'll process
            const processedNumbers = new Set();
            
            // First pass: Upload actual pieces from local files
            for (let number = startIndex; number <= totalSupply; number++) {
                try {
                    const imagePath = path.join(exportDir, `${number}.png`);
                    const metadataPath = path.join(exportDir, `${number}.json`);

                    // Check if we have a real piece (image exists)
                    if (fs.existsSync(imagePath)) {
                        console.log(`Processing piece ${number}/${totalSupply}`);
                        processedNumbers.add(number);

                        // Read and upload image
                        const imageData = fs.readFileSync(imagePath);
                        await this.s3.putObject({
                            Bucket: bucketName,
                            Key: `${prefix}/assets/${number}.png`,
                            Body: imageData,
                            ContentType: 'image/png',
                            ACL: 'public-read'
                        });

                        // For real pieces, read metadata from file
                        const metadataPath = path.join(exportDir, `${number}.json`);
                        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                        // Update image path to be relative
                        metadata.image = `../assets/${number}.png`;

                        await this.s3.putObject({
                            Bucket: bucketName,
                            Key: `${prefix}/metadata/${number}.json`,
                            Body: JSON.stringify(metadata, null, 2),
                            ContentType: 'application/json',
                            ACL: 'public-read'
                        });

                        processed++;
                    }

                } catch (error) {
                    console.error(`Error processing piece ${number}:`, error);
                    failed++;
                }
            }

            // Second pass: Fill gaps with placeholder metadata
            for (let number = startIndex; number <= totalSupply; number++) {
                if (!processedNumbers.has(number)) {
                    try {
                        // Create and upload placeholder metadata
                        const placeholderMetadata = {
                            name: `CULT INCORPORATED BADGE ${number}`,
                            description: `You are now an Executive of the Cult.
Backed by 1,000,000 $EXEC and subject to burn if unaligned.
This badge confirms your standing, your timing, and your loyalty.
Transfer with care. Hold with conviction. You were chosen.`,
                            image: unrevealedImageUrl,
                            attributes: [] // Empty attributes for placeholder
                        };

                        await this.s3.putObject({
                            Bucket: bucketName,
                            Key: `${prefix}/metadata/${number}.json`,
                            Body: JSON.stringify(placeholderMetadata, null, 2),
                            ContentType: 'application/json',
                            ACL: 'public-read'
                        });

                        processed++;
                    } catch (error) {
                        console.error(`Error creating placeholder ${number}:`, error);
                        failed++;
                    }
                }
            }

            return {
                success: true,
                processed,
                failed,
                baseUrls: {
                    assets: `https://${bucketName}.${process.env.DO_SPACE_REGION}.digitaloceanspaces.com/${prefix}/assets`,
                    metadata: `https://${bucketName}.${process.env.DO_SPACE_REGION}.digitaloceanspaces.com/${prefix}/metadata`
                }
            };

        } catch (error) {
            console.error('Upload failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Allow direct script execution
if (require.main === module) {
    if (process.argv.length < 3) {
        console.log('Usage: node uploadToSpaces.js <collectionId> [startIndex] [endIndex] [--no-cleanup]');
        process.exit(1);
    }

    const collectionId = parseInt(process.argv[2]);
    const startIndex = parseInt(process.argv[3]) || 1;
    const endIndex = process.argv[4] ? parseInt(process.argv[4]) : null;
    const cleanup = !process.argv.includes('--no-cleanup');

    const uploader = new SpacesUploader();
    uploader.uploadCollection(collectionId, { startIndex, endIndex, cleanup })
        .then(result => {
            console.log('Upload completed:', result);
            if (result.success) {
                console.log('\nExample URLs:');
                console.log(`Image: ${result.baseUrls.assets}/1.png`);
                console.log(`Metadata: ${result.baseUrls.metadata}/1.json`);
            }
            process.exit(result.success ? 0 : 1);
        });
}

module.exports = SpacesUploader;