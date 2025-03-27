const { S3, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const StudioDB = require('../models/studio');
const axios = require('axios');
require('dotenv').config();

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
            prefix = 'exectest/private', // This will create exectest/private/assets/
            startIndex = 1,
            endIndex = null,
            cleanup = true // Add cleanup option
        } = options;

        try {
            // Clean up existing files if requested
            if (cleanup) {
                await this.cleanupExistingFiles(bucketName, prefix);
            }

            // Get collection pieces from database
            const studioDb = new StudioDB();
            const pieces = await studioDb.findMany({ 
                collectionId,
                status: { $in: ['approved', 'pending_review'] }
            });

            console.log(`Found ${pieces.length} pieces to process`);
            
            // Process pieces within the specified range
            const end = endIndex || pieces.length;
            let processed = 0;
            let failed = 0;

            for (let i = 0; i < pieces.length && (i + startIndex) <= end; i++) {
                const piece = pieces[i];
                const number = i + startIndex;

                try {
                    console.log(`Processing piece ${number}/${end}`);

                    // 1. Upload image to assets folder
                    const imageUrl = piece.files[0]?.url;
                    if (!imageUrl) {
                        console.error(`No image URL for piece ${number}`);
                        failed++;
                        continue;
                    }

                    // Download image
                    const imageResponse = await axios({
                        url: imageUrl,
                        responseType: 'arraybuffer'
                    });

                    // Upload image to Spaces
                    await this.s3.putObject({
                        Bucket: bucketName,
                        Key: `${prefix}/assets/${number}.png`,
                        Body: imageResponse.data,
                        ContentType: 'image/png',
                        ACL: 'public-read'
                    });

                    // 2. Create and upload metadata to metadata folder
                    const metadata = {
                        name: `${piece.collection?.name || 'Exec'} #${number}`,
                        description: piece.collection?.description || "",
                        image: `../assets/${number}.png`, // Relative path from metadata to assets
                        attributes: Object.entries(piece.traits || {})
                            .map(([type, traitData]) => ({
                                trait_type: type,
                                value: traitData.value.name
                            }))
                    };

                    await this.s3.putObject({
                        Bucket: bucketName,
                        Key: `${prefix}/metadata/${number}.json`,
                        Body: JSON.stringify(metadata, null, 2),
                        ContentType: 'application/json',
                        ACL: 'public-read'
                    });

                    processed++;

                    // Log progress every 10 pieces
                    if (processed % 10 === 0) {
                        console.log(`Processed ${processed} pieces. Failed: ${failed}`);
                    }

                } catch (error) {
                    console.error(`Error processing piece ${number}:`, error);
                    failed++;
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