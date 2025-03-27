const StudioDB = require('../models/studio');
const { CollectionDB } = require('../index');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

async function exportCollection(collectionId, totalSupply, outputPath = null) {
    try {
        // Initialize metrics
        const metrics = {
            startTime: performance.now(),
            totalBytes: 0,
            pieces: 0
        };

        // Get collection info
        const collectionDb = new CollectionDB();
        const collection = await collectionDb.findOne({ collectionId });
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        // Create output directory
        const exportDir = outputPath || path.join(__dirname, '../../temp', `export_${collection.name}`);
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        // Get approved pieces
        const studioDb = new StudioDB();
        const pieces = await studioDb.findMany({
            collectionId,
            status: { $in: ['approved', 'pending_review'] }
        });

        // Shuffle and limit to totalSupply
        const shuffledPieces = pieces
            .sort(() => Math.random() - 0.5)
            .slice(0, totalSupply);

        // Download and save images/metadata
        for (let i = 0; i < shuffledPieces.length; i++) {
            const piece = shuffledPieces[i];
            const number = i + 1;
            
            // Download image
            const imageUrl = piece.files[0]?.url;
            if (imageUrl) {
                try {
                    const response = await axios({
                        url: imageUrl,
                        responseType: 'stream'
                    });

                    // Save image
                    const imagePath = path.join(exportDir, `${number}.png`);
                    const writer = fs.createWriteStream(imagePath);
                    response.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    // Create and save metadata
                    const metadata = {
                        name: `${collection.name} #${number}`,
                        description: collection.description || "",
                        image: `${number}.png`,
                        attributes: Object.entries(piece.traits)
                            .map(([type, traitData]) => ({
                                trait_type: type,
                                value: traitData.value.name
                            }))
                    };

                    fs.writeFileSync(
                        path.join(exportDir, `${number}.json`),
                        JSON.stringify(metadata, null, 2)
                    );

                    metrics.pieces++;
                    console.log(`Exported piece ${number}/${totalSupply}`);

                } catch (error) {
                    console.error(`Error exporting piece ${number}:`, error);
                }
            }
        }

        console.log(`Export complete! ${metrics.pieces} pieces exported to ${exportDir}`);
        return {
            success: true,
            exportPath: exportDir,
            piecesExported: metrics.pieces
        };

    } catch (error) {
        console.error('Export failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Allow direct script execution
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node exportCollection.js <collectionId> <totalSupply> [outputPath]');
        process.exit(1);
    }

    const [collectionId, totalSupply, outputPath] = args;
    exportCollection(parseInt(collectionId), parseInt(totalSupply), outputPath)
        .then(result => {
            console.log(result);
            process.exit(result.success ? 0 : 1);
        });
}

module.exports = exportCollection;